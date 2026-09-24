/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * shared/link-bundle.js — the extension learns its ROLE only from the server.
 * Run: node tests/link-bundle.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'shared', 'link-bundle.js'), 'utf8')

function load () {
  const sandbox = { AbortSignal, console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(src, sandbox)
  return sandbox.AitherLinkBundle
}

function memStore (initial = null) {
  let v = initial
  return { get: async () => v, set: async (x) => { v = x }, clear: async () => { v = null }, peek: () => v }
}

const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const OWNER = { role: 'owner', identity: { user_id: 'u' }, endpoints: { local: { awdesk: 'x' } } }
const USER = { role: 'user', identity: { user_id: 'u' }, endpoints: {} }

let failures = 0
async function check (name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failures += 1; console.log(`  FAIL ${name}: ${e.message}`) }
}

const LB = load()

await check('the owner bundle is stored and read back as owner', async () => {
  const store = memStore()
  const calls = []
  const res = await LB.refresh({ base: 'https://g/', bearer: 't', storage: store, fetchImpl: async (url, init) => { calls.push([url, init.headers.Authorization]); return respond(200, OWNER)() } })
  assert.equal(res.ok, true)
  assert.deepEqual(calls[0], ['https://g/v1/link/bundle', 'Bearer t'])
  assert.equal(LB.isOwner(await LB.current({ storage: store })), true)
})

await check('a regular user is never owner', async () => {
  const store = memStore()
  await LB.refresh({ base: 'g', bearer: 't', storage: store, fetchImpl: respond(200, USER) })
  assert.equal(LB.isOwner(await LB.current({ storage: store })), false)
})

await check('a flaky network keeps the last good bundle', async () => {
  const store = memStore({ ...OWNER })
  const res = await LB.refresh({ base: 'g', bearer: 't', storage: store, fetchImpl: async () => { throw new Error('ECONNRESET') } })
  assert.equal(res.ok, false)
  assert.equal(LB.isOwner(await LB.current({ storage: store })), true)
})

await check('a refused credential clears the old role', async () => {
  const store = memStore({ ...OWNER })
  const res = await LB.refresh({ base: 'g', bearer: 't', storage: store, fetchImpl: respond(401, { detail: 'no' }) })
  assert.equal(res.status, 401)
  assert.equal(await LB.current({ storage: store }), null)
})

await check('a response that is not a bundle is rejected, never stored', async () => {
  const store = memStore()
  const res = await LB.refresh({ base: 'g', bearer: 't', storage: store, fetchImpl: respond(200, { role: 'owner' }) })
  assert.equal(res.ok, false)
  assert.equal(store.peek(), null)
})

await check('no endpoint or no credential never calls out', async () => {
  let called = false
  const f = async () => { called = true; return respond(200, OWNER)() }
  assert.equal((await LB.refresh({ base: '', bearer: 't', storage: memStore(), fetchImpl: f })).ok, false)
  assert.equal((await LB.refresh({ base: 'g', bearer: '', storage: memStore(), fetchImpl: f })).ok, false)
  assert.equal(called, false)
})

await check('startLink asks Identity first and remembers where to poll', async () => {
  const calls = []
  const res = await LB.startLink({ portal: 'https://p/', fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return respond(200, { device_code: 'dc', user_code: 'ABCD-1234', verification_uri_complete: 'https://p/link?c=ABCD-1234', interval: 3 })() } })
  assert.deepEqual(calls[0], ['https://idp.aitherium.com/auth/device/code', { client_name: 'awconnect' }])
  assert.equal(calls.length, 1, 'the portal is not asked when Identity answers')
  assert.equal(res.ok, true)
  assert.equal(res.userCode, 'ABCD-1234')
  assert.equal(res.tokenUrl, 'https://idp.aitherium.com/auth/device/token')
})

await check('startLink falls back to the portal when Identity is unreachable', async () => {
  const res = await LB.startLink({ portal: 'https://p', fetchImpl: async (url) => { if (url.includes('idp.')) throw new Error('ECONNREFUSED'); return respond(200, { device_code: 'dc', user_code: 'X' })() } })
  assert.equal(res.ok, true)
  assert.equal(res.tokenUrl, 'https://p/api/auth/device/token')
})

await check('startLink reports when nobody can issue a code, never a fake one', async () => {
  const res = await LB.startLink({ portal: 'p', fetchImpl: respond(503, { error: 'Service Unavailable' }) })
  assert.equal(res.ok, false)
  assert.match(res.error, /Service Unavailable/)
})

await check('pollLink reads the Identity 400 detail as pending, and polls the issuing host', async () => {
  let hit = ''
  const res = await LB.pollLink({ tokenUrl: 'https://idp/auth/device/token', deviceCode: 'dc', fetchImpl: async (url) => { hit = url; return respond(400, { detail: 'authorization_pending' })() } })
  assert.equal(hit, 'https://idp/auth/device/token')
  assert.deepEqual([res.ok, res.status], [true, 'authorization_pending'])
  assert.equal((await LB.pollLink({ tokenUrl: 'https://idp/t', deviceCode: 'dc', fetchImpl: respond(400, { detail: 'access_denied' }) })).status, 'denied')
})

await check('pollLink: pending, then the Identity token on approval', async () => {
  const pending = await LB.pollLink({ portal: 'p', deviceCode: 'dc', fetchImpl: respond(200, { status: 'authorization_pending', interval: 5 }) })
  assert.deepEqual([pending.ok, pending.status], [true, 'authorization_pending'])
  const done = await LB.pollLink({ portal: 'p', deviceCode: 'dc', fetchImpl: respond(200, { access_token: 'id-token', token_type: 'bearer' }) })
  assert.deepEqual([done.status, done.token], ['complete', 'id-token'])
})

await check('pollLink: denied and expired are final; a dropped poll is not', async () => {
  assert.equal((await LB.pollLink({ portal: 'p', deviceCode: 'dc', fetchImpl: respond(400, { error: 'access_denied' }) })).status, 'denied')
  assert.equal((await LB.pollLink({ portal: 'p', deviceCode: 'dc', fetchImpl: respond(400, { error: 'expired_token' }) })).status, 'expired')
  const dropped = await LB.pollLink({ portal: 'p', deviceCode: 'dc', fetchImpl: async () => { throw new Error('reset') } })
  assert.deepEqual([dropped.ok, dropped.status], [true, 'authorization_pending'])
})

await check('background.js loads the module', async () => {
  const bg = readFileSync(join(here, '..', 'background.js'), 'utf8')
  assert.match(bg, /importScripts\([^)]*shared\/link-bundle\.js/s)
})

await check('the link flow is wired end to end: handlers, credential, bundle, button', async () => {
  const bg = readFileSync(join(here, '..', 'background.js'), 'utf8')
  const start = bg.indexOf('case "link-poll"')
  assert.ok(bg.includes('case "link-start"') && start > 0, 'link-start / link-poll handlers')
  const body = bg.slice(start, start + 1600)
  assert.match(body, /setPortalBearer\(res\.token\)/, 'the Identity token becomes the sign-in credential')
  assert.match(body, /resolveIdentity\(\)/, 'identity is re-resolved')
  assert.match(body, /AitherLinkBundle\.refresh/, 'the role-aware bundle is fetched')
  const html = readFileSync(join(here, '..', 'options', 'options.html'), 'utf8')
  const js = readFileSync(join(here, '..', 'options', 'options.js'), 'utf8')
  assert.ok(html.includes('id="btn-link"') && js.includes('type: "link-start"') && js.includes('type: "link-poll"'))
})

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
