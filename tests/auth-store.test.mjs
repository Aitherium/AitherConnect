/* shared/auth-store.js + the pinned id: sign in once via the local awdk login.
 * Run: node tests/auth-store.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function load () {
  const sandbox = { AbortSignal, console, Date }
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(read('shared/extension-id.js'), sandbox)
  vm.runInNewContext(read('shared/auth-store.js'), sandbox)
  return sandbox
}

function memStorage () {
  const data = {}
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))) },
    remove: async (k) => { delete data[k] },
  }
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const AUD = 'chrome-extension://hlmfknhcfhjjngckfpacgleffckpmphe'

let failures = 0
async function check (name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failures += 1; console.log(`  FAIL ${name}: ${e.message}`) }
}

const S = load()
const AS = S.AitherAuthStore

await check('the pinned id is the one the manifests\' key produces (both manifests)', async () => {
  for (const f of ['manifest.json', 'manifest.public.json']) {
    const key = JSON.parse(read(f)).key
    assert.ok(key, `${f} has no key`)
    const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
    assert.equal(id, S.AWCONNECT_EXTENSION_ID, f)
  }
})

await check('auth record round-trips and never keeps unknown fields', async () => {
  const st = memStorage()
  await AS.set({ user_bearer: 'b', expires_at: Date.now() + 60000, source: 'awdk',
    user: { id: 'u1', username: 'david', display_name: 'David', tenant_slug: 'aitherium' }, junk: 1 }, st)
  const rec = await AS.get(st)
  assert.equal(rec.user_bearer, 'b')
  assert.equal(rec.user.username, 'david')
  assert.equal(rec.junk, undefined)
  assert.equal(await AS.getUserBearer(st), 'b')
  await AS.clear(st)
  assert.equal(await AS.get(st), null)
})

await check('an expired bearer is not returned, the name is kept', async () => {
  const st = memStorage()
  await AS.set({ user_bearer: 'old', expires_at: Date.now() - 1, source: 'oidc', user: { username: 'd' } }, st)
  assert.equal(await AS.getUserBearer(st), null)
  assert.equal((await AS.get(st)).user.username, 'd')
})

await check('rung order: whoami -> handoff -> redeem for THIS extension origin', async () => {
  const st = memStorage()
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body])
    if (url.endsWith('/identity/whoami')) return json(200, { logged_in: true, username: 'david', display_name: 'David' })
    if (url.endsWith('/identity/handoff')) return json(200, { ticket: 'T' })
    if (url.endsWith('/auth/handoff/redeem')) return json(200, { access_token: 'AT', expires_in: 3600, user: { id: 'u1', username: 'david', tenant_slug: 'aitherium' } })
    throw new Error('unexpected ' + url)
  }
  const r = await AS.signInFromLocalAdk({ adkBase: 'http://127.0.0.1:9001/', audience: AUD, idpBase: 'https://idp.example/identity', fetchImpl, storage: st })
  assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1]), [
    'GET http://127.0.0.1:9001/identity/whoami',
    'POST http://127.0.0.1:9001/identity/handoff',
    'POST https://idp.example/identity/auth/handoff/redeem',
  ])
  assert.deepEqual(JSON.parse(calls[2][2]), { ticket: 'T', audience: AUD })
  assert.equal(r.ok, true); assert.equal(r.cloud, true); assert.equal(r.token, 'AT')
  const rec = await AS.get(st)
  assert.equal(rec.user_bearer, 'AT'); assert.equal(rec.source, 'awdk'); assert.equal(rec.user.tenant_slug, 'aitherium')
})

await check('redeem refused (IdP not deployed yet): name-only, no bearer, honest note', async () => {
  const st = memStorage()
  const fetchImpl = async (url) => {
    if (url.endsWith('/identity/whoami')) return json(200, { logged_in: true, username: 'david' })
    if (url.endsWith('/identity/handoff')) return json(200, { ticket: 'T' })
    return json(400, { detail: 'invalid_audience' })
  }
  const r = await AS.signInFromLocalAdk({ adkBase: 'http://a', audience: AUD, fetchImpl, storage: st })
  assert.equal(r.ok, true); assert.equal(r.token, null); assert.equal(r.cloud, false)
  assert.match(r.note, /Signed in locally as david; cloud features pending/)
  assert.equal((await AS.get(st)).user_bearer, null)
})

await check('not signed in / daemon down: no record written, no handoff attempted', async () => {
  const st = memStorage()
  const calls = []
  const r1 = await AS.signInFromLocalAdk({ adkBase: 'http://a', audience: AUD, storage: st,
    fetchImpl: async (u) => { calls.push(u); return json(200, { logged_in: false }) } })
  assert.equal(r1.ok, false); assert.equal(calls.length, 1)
  const r2 = await AS.signInFromLocalAdk({ adkBase: 'http://a', audience: AUD, storage: st,
    fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(r2.ok, false)
  assert.equal(await AS.get(st), null)
})

await check('background resolveIdentity runs the local rung before any cookie or key', async () => {
  const bg = read('background.js')
  const body = bg.slice(bg.indexOf('async function resolveIdentity()'))
  const i0 = body.indexOf('resolveFromLocalAdk()')
  assert.ok(i0 > 0, 'rung 0 missing')
  assert.ok(i0 < body.indexOf('chrome.cookies.get'), 'cookie rung runs first')
  assert.ok(i0 < body.indexOf('SETTINGS.apiKey'), 'settings-key rung runs first')
  assert.match(bg, /importScripts\([^)]*"shared\/extension-id\.js", "shared\/auth-store\.js"/)
})

await check('the gateway key is never published as the user bearer or sent to /api/me', async () => {
  const bg = read('background.js')
  const body = bg.slice(bg.indexOf('async function resolveIdentity()'), bg.indexOf('async function resolveDefaultWorkspace'))
  assert.match(body, /if \(token && source !== "cloud-key"\) \{\s*try \{ await self\.AitherPortal\.setPortalBearer\(token\)/)
  assert.match(body, /if \(source !== "cloud-key"\) meUrls\.push\("https:\/\/api\.aitherium\.com\/api\/me\/profile"\)/)
})

await check('portal-api: api.aitherium.com default, bearer in the auth store, no password login', async () => {
  const src = read('shared/portal-api.js')
  assert.match(src, /PORTAL_DEFAULT_URL = "https:\/\/api\.aitherium\.com"/)
  assert.doesNotMatch(src, /portal\.aitherium\.com"/)
  assert.doesNotMatch(src, /portalLogin|portalQuickOnboard|aither_portal_bearer/)
})

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nall auth-store checks passed')
