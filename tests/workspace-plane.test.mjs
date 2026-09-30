/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * shared/workspace-plane.js — after sign-in the user sees their workspace, picks
 * a backend, and the cloud tier uses THEIR credential, not a hand-pasted key.
 * Also pins the wiring: background.js loads every self.X it dereferences, the
 * side panel no longer claims "Connected" statically, and the settings-hub
 * bearer survives a browser restart.
 * Run: node tests/workspace-plane.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function load () {
  const sandbox = { AbortSignal, console, Date }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  vm.runInNewContext(read('shared/link-bundle.js'), sandbox)
  vm.runInNewContext(read('shared/workspace-plane.js'), sandbox)
  return sandbox
}

function chromeStore (initial = {}) {
  const data = { ...initial }
  return {
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => { Object.assign(data, o) },
    remove: async (k) => { delete data[k] },
    data,
  }
}

function lbStore (initial = null) {
  let v = initial
  return { get: async () => v, set: async (x) => { v = x }, clear: async () => { v = null } }
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

let failures = 0
async function check (name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failures += 1; console.log(`  FAIL ${name}: ${e.message}`) }
}

const G = load()
const W = G.AitherWorkspacePlane
const AUTH = { user_bearer: 'ub', user: { username: 'ada', display_name: 'Ada' } }

// ── workspace auto-select versus picker ──────────────────────────────────
await check('one workspace is auto-selected', async () => {
  const r = W.chooseWorkspace([{ id: 'w1', name: 'Solo' }], null)
  assert.equal(r.mode, 'auto')
  assert.equal(r.selected.id, 'w1')
})

await check('several workspaces show a picker, never silently the first', async () => {
  const r = W.chooseWorkspace([{ id: 'a' }, { id: 'b', is_default: true }], null)
  assert.equal(r.mode, 'picker')
  assert.equal(r.selected, null)
  assert.equal(r.suggested.id, 'b')
})

await check('a persisted choice that is still listed is kept', async () => {
  const r = W.chooseWorkspace([{ id: 'a' }, { id: 'b' }], 'b')
  assert.equal(r.mode, 'kept')
  assert.equal(r.selected.id, 'b')
})

await check('a persisted choice no longer listed goes back to the picker', async () => {
  const r = W.chooseWorkspace([{ id: 'a' }, { id: 'b' }], 'gone')
  assert.equal(r.mode, 'picker')
})

await check('fetchWorkspaces sends the user bearer to the cloud API and reads {workspaces}', async () => {
  let seen
  const r = await W.fetchWorkspaces({
    bearer: 'ub',
    fetchImpl: async (url, init) => { seen = { url, init }; return json(200, { workspaces: [{ id: 'w1' }, { name: 'no id' }] }) },
  })
  assert.equal(seen.url, 'https://api.aitherium.com/api/me/workspaces')
  assert.equal(seen.init.headers.Authorization, 'Bearer ub')
  assert.equal(r.ok, true)
  assert.deepEqual(r.workspaces.map((w) => w.id), ['w1'])
})

await check('fetchWorkspaces with no bearer never calls out', async () => {
  let called = false
  const r = await W.fetchWorkspaces({ bearer: null, fetchImpl: async () => { called = true } })
  assert.equal(called, false)
  assert.equal(r.ok, false)
})

// ── badge reasons ─────────────────────────────────────────────────────────
await check('badge: not signed in', async () => {
  assert.equal(W.badge({ auth: null }).text, 'not signed in')
})

await check('badge: an expired session says sign in again', async () => {
  assert.equal(W.badge({ auth: { user_bearer: null, expired: true } }).text, 'sign in again')
})

await check('badge: cloud unreachable carries the status', async () => {
  const b = W.badge({ auth: AUTH, workspaces: { ok: false, status: 503 } })
  assert.equal(b.text, 'cloud unreachable (503)')
  assert.equal(b.state, 'unreachable')
})

await check('badge: no workspaces links to the web app to create one', async () => {
  const b = W.badge({ auth: AUTH, workspaces: { ok: true, workspaces: [] } })
  assert.equal(b.text, 'no workspaces — create one')
  assert.match(b.href, /^https:\/\/aitherium\.com\//)
})

await check('badge: signed in with a selected workspace shows user · workspace', async () => {
  const ws = { id: 'w1', name: 'Research' }
  const b = W.badge({ auth: AUTH, workspaces: { ok: true, workspaces: [ws] }, selected: ws })
  assert.equal(b.text, 'Ada · Research')
  assert.equal(b.state, 'ok')
})

await check('badge: several workspaces and none chosen asks to pick', async () => {
  const b = W.badge({ auth: AUTH, workspaces: { ok: true, workspaces: [{ id: 'a' }, { id: 'b' }] }, selected: null })
  assert.equal(b.state, 'pick')
})

// ── cloud tier credential from the auth record ───────────────────────────
await check('cloud credential: a gateway key wins over the user bearer', async () => {
  const c = W.cloudCredential({ user_bearer: 'ub', gateway_key: 'gk' }, { cloudApiKey: 'pasted' })
  assert.deepEqual({ ...c }, { token: 'gk', kind: 'gateway_key' })
})

await check('cloud credential: the user bearer replaces a hand-pasted key', async () => {
  const c = W.cloudCredential({ user_bearer: 'ub' }, { cloudApiKey: 'pasted' })
  assert.deepEqual({ ...c }, { token: 'ub', kind: 'user_bearer' })
})

await check('cloud credential: the settings key is only the last fallback', async () => {
  assert.equal(W.cloudCredential(null, { cloudApiKey: 'pasted' }).kind, 'settings')
  assert.equal(W.cloudCredential(null, {}).token, null)
})

await check('readAuth drops an expired bearer but keeps the name', async () => {
  const store = chromeStore({ aither_auth: { user_bearer: 'ub', expires_at: Date.now() - 1, user: { username: 'ada' } } })
  const rec = await W.readAuth(store)
  assert.equal(rec.user_bearer, null)
  assert.equal(rec.expired, true)
  assert.equal(rec.user.username, 'ada')
})

await check('cloud chat goes to the gateway with the workspace header, credential in the header only', async () => {
  const r = W.cloudChatRequest({ credential: 'ub', workspaceId: 'w1', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.url, 'https://gateway.aitherium.com/v1/chat/completions')
  assert.equal(r.init.headers.Authorization, 'Bearer ub')
  assert.equal(r.init.headers['X-Workspace-ID'], 'w1')
  assert.ok(!r.url.includes('ub'))
})

await check('replyText reads OpenAI-shaped and adk-shaped bodies', async () => {
  assert.equal(W.replyText({ choices: [{ message: { content: 'hello' } }] }), 'hello')
  assert.equal(W.replyText({ response: 'hi there' }), 'hi there')
  assert.equal(W.replyText(null), '')
})

// ── the bundle drives capabilities ───────────────────────────────────────
await check('bundle capabilities replace the fleet presets', async () => {
  const d = W.fromBundle({ role: 'user', identity: {}, capabilities: { chat: true, shell: false } }, { chat: true, shell: true })
  assert.equal(d.source, 'bundle')
  assert.equal(d.capabilities.shell, false)
})

await check('never linked: the presets are the fallback', async () => {
  const d = W.fromBundle(null, { chat: true })
  assert.equal(d.source, 'defaults')
  assert.equal(d.capabilities.chat, true)
})

await check('the loopback map is the owner\'s only', async () => {
  const lb = { a: 'http://127.0.0.1:1' }
  assert.equal(W.fromBundle({ role: 'user', identity: {}, endpoints: { loopback: lb } }).loopback, null)
  assert.deepEqual({ ...W.fromBundle({ role: 'owner', identity: {}, endpoints: { loopback: lb } }).loopback }, lb)
})

await check('ensureBundle asks api.aitherium.com with the bearer when the cache is stale', async () => {
  let url
  const store = lbStore({ role: 'user', identity: {}, fetchedAt: 1 })
  const r = await W.ensureBundle({
    bearer: 'ub', storage: store, now: 10 ** 13,
    fetchImpl: async (u) => { url = u; return json(200, { role: 'user', identity: {}, capabilities: { chat: true } }) },
  })
  assert.equal(url, 'https://api.aitherium.com/v1/link/bundle')
  assert.equal(r.ok, true)
  assert.equal(r.cached, false)
  assert.equal(r.bundle.capabilities.chat, true)
})

await check('ensureBundle serves a fresh cache without a request', async () => {
  const now = 10 ** 13
  const store = lbStore({ role: 'user', identity: {}, fetchedAt: now - 1000 })
  const r = await W.ensureBundle({ bearer: 'ub', storage: store, now, fetchImpl: async () => { throw new Error('called') } })
  assert.equal(r.cached, true)
})

await check('ensureBundle keeps the last good bundle when the cloud is 503', async () => {
  const store = lbStore({ role: 'user', identity: {}, fetchedAt: 1 })
  const r = await W.ensureBundle({ bearer: 'ub', storage: store, now: 10 ** 13, fetchImpl: async () => json(503, {}) })
  assert.equal(r.ok, true)
  assert.equal(r.bundle.role, 'user')
  assert.equal(r.status, 503)
})

// ── agents + wizard ──────────────────────────────────────────────────────
await check('managed agents: workspace API first, bundle second', async () => {
  const a = await W.listCloudAgents({
    bearer: 'ub', workspaceId: 'w1', bundle: { agents: [{ id: 'from-bundle' }] },
    fetchImpl: async () => json(200, { agents: [{ id: 'atlas', display_name: 'Atlas' }] }),
  })
  assert.deepEqual(a.map((x) => x.id), ['atlas'])
  const b = await W.listCloudAgents({ bearer: 'ub', workspaceId: 'w1', bundle: { agents: [{ id: 'from-bundle' }] }, fetchImpl: async () => json(503, {}) })
  assert.deepEqual(b.map((x) => x.id), ['from-bundle'])
})

await check('local agents come from GET {adk}/agents', async () => {
  let url
  const a = await W.listLocalAgents({ adkBase: 'http://127.0.0.1:9001', fetchImpl: async (u) => { url = u; return json(200, { agents: [{ name: 'adk-daemon' }] }) } })
  assert.equal(url, 'http://127.0.0.1:9001/agents')
  assert.deepEqual(a.map((x) => x.id), ['adk-daemon'])
})

await check('wizard offers only detected local backends; awnode absent is an instruction', async () => {
  const list = W.wizardBackends({ adk: true, awnode: false, signedIn: false })
  assert.deepEqual(JSON.parse(JSON.stringify(list.map((b) => [b.id, b.ready]))), [['local-agent', true], ['local-model', false]])
  assert.equal(list[1].hint, 'awnode serve')
})

await check('wizard: signed in with a workspace adds the workspace key and cloud', async () => {
  const ids = [...W.wizardBackends({ adk: false, awnode: true, signedIn: true, workspaceId: 'w1' }).map((b) => b.id)]
  assert.deepEqual(ids, ['local-model', 'workspace-key', 'cloud'])
})

// ── wiring ────────────────────────────────────────────────────────────────
const bg = read('background.js')

function importedFiles (src) {
  const files = []
  for (const m of src.matchAll(/importScripts\(([\s\S]*?)\);/g)) {
    for (const f of m[1].matchAll(/"([^"]+\.js)"/g)) files.push(f[1])
  }
  return files
}

await check('background.js loads every self.X it dereferences (AC017)', async () => {
  const used = new Set([...bg.matchAll(/\bself\.([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))
  const defined = new Set()
  for (const f of importedFiles(bg)) {
    const src = read(f)
    for (const m of src.matchAll(/\b(?:self|global|root|globalThis|window)\.([A-Z][A-Za-z0-9_]*)\s*=[^=]/g)) defined.add(m[1])
    for (const m of src.matchAll(/(?:^|[;\s])(?:var|let|const|function)\s+([A-Z][A-Za-z0-9_]*)/g)) defined.add(m[1])
  }
  for (const m of bg.matchAll(/\bself\.([A-Z][A-Za-z0-9_]*)\s*=[^=]/g)) defined.add(m[1])
  const missing = [...used].filter((x) => !defined.has(x))
  assert.deepEqual(missing, [], `dereferenced but never loaded: ${missing.join(', ')}`)
})

await check('background.js answers the first-run messages', async () => {
  for (const t of ['awc-workspace-state', 'awc-select-workspace', 'awc-backends', 'awc-set-backend', 'awc-first-chat']) {
    assert.ok(bg.includes(`case "${t}":`), t)
  }
})

await check('tier detection uses the sign-in credential, not only a pasted key', async () => {
  assert.ok(/function cloudToken\(\)/.test(bg))
  assert.ok(!/TierDetect\.detect\([\s\S]{0,300}SETTINGS\.cloudApiKey/.test(bg), 'TierDetect still fed SETTINGS.cloudApiKey')
})

await check('the side panel greeting is not a static "Connected"', async () => {
  const html = read('sidepanel/sidepanel.html')
  assert.ok(!html.includes('Connected to AitherOS. Ask me anything.'))
  assert.ok(html.includes('id="chat-greeting"'))
})

await check('the onboarding page loads the plane and has the first-run panel', async () => {
  const html = read('onboard/onboard.html')
  assert.ok(html.includes('../shared/workspace-plane.js'))
  assert.ok(html.includes('id="panel-first-run"'))
  assert.ok(read('options/options.js').includes('onboard/onboard.html#first-run'))
})

await check('the settings-hub bearer survives a browser restart (AWC-10)', async () => {
  const src = read('shared/portal-api.js')
  const store = chromeStore({ aither_auth: { user_bearer: 'persisted', expires_at: null } })
  const sandbox = { console, Date, chrome: { storage: { local: store, session: chromeStore() } }, fetch: async () => json(200, {}) }
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  // portal-api reads the bearer through the shared sign-in record (auth-store.js),
  // which background.js loads before it.
  vm.runInNewContext(read('shared/auth-store.js'), sandbox)
  vm.runInNewContext(src, sandbox)
  assert.equal(await sandbox.AitherPortal.getPortalBearer(), 'persisted')
})

if (failures) { console.log(`${failures} failed`); process.exit(1) }
console.log('all passed')
