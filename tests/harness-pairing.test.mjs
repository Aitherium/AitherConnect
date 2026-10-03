/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * awconnect pairs with awsh instead of holding its root bearer, and every
 * decisions surface goes through that pairing (never Genesis).
 *
 *   1. Behaviour: shared/harness-auth.js in a vm sandbox with a stubbed fetch
 *      and storage -- the pairing state machine (awaiting -> paired, denied,
 *      expired, offline), token storage, and a 401 dropping the token.
 *   2. desk-bridge.js: a 403 from awdesk reads as "update awdesk".
 *   3. Wiring: no self.GenesisAuth in background.js, popup.html does not load
 *      genesis-auth.js, the side panel loads harness-auth.js.
 *
 * Run: node tests/harness-pairing.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${name}`) } else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

function json (status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sandbox (file) {
  const store = {}
  const storage = {
    get: async (k) => (k in store ? { [k]: store[k] } : {}),
    set: async (o) => { Object.assign(store, o) },
    remove: async (k) => { delete store[k] }
  }
  const ctx = { console, URL, URLSearchParams, Response, setTimeout, AbortSignal, Promise, JSON, Date }
  ctx.self = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(read(file), ctx)
  return { ctx, store, storage }
}

async function run () {
  // ── 1. pairing state machine ─────────────────────────────────────────
  {
    const { ctx, store, storage } = sandbox('shared/harness-auth.js')
    const HA = ctx.HarnessAuth
    const calls = []
    let polls = 0
    HA._configure({
      storage: () => storage,
      sleep: async () => {},
      fetch: async (url, opts = {}) => {
        calls.push({ url, opts })
        if (url.endsWith('/pair/start')) return json(200, { pair_id: 'p1', code: '123456', expires_in: 120 })
        if (url.endsWith('/pair/poll')) {
          polls++
          return polls < 3 ? json(200, { status: 'pending' }) : json(200, { status: 'approved', token: 'scoped-tok' })
        }
        if (url.includes('/decisions')) {
          return opts.headers?.Authorization === 'Bearer scoped-tok'
            ? json(200, { decisions: [{ id: 'd-2345', title: 'x' }], count: 1 })
            : json(403, { detail: 'invalid token' })
        }
        return json(404, {})
      }
    })
    const seen = []
    HA.onState((s) => seen.push(s.phase))
    check('unpaired before pairing', (await HA.isPaired()) === false)
    const noTok = await HA.daemonFetch('/decisions')
    check('no token -> synthetic 401 and NO request sent', noTok.status === 401 && calls.length === 0)
    check('unpaired UI offers a pair button', HA.describeState({ phase: 'unpaired' }).action === 'pair')

    const [a, b] = await Promise.all([HA.pair(), HA.pair()])
    check('concurrent pair() calls share one flow (one card)', calls.filter((c) => c.url.endsWith('/pair/start')).length === 1)
    check('pairing resolves paired', a.ok === true && b.ok === true, JSON.stringify(a))
    check('state walks starting -> awaiting -> paired', seen.join(',').endsWith('starting,awaiting,paired'), seen.join(','))
    check('the token is stored in storage.local', store[HA.TOKEN_KEY] === 'scoped-tok')
    const awaiting = HA.describeState({ phase: 'awaiting', code: '123456' })
    check('awaiting UI shows the code to approve on the desk', awaiting.code === '123456' && /desk/.test(awaiting.text) && !awaiting.action)

    const list = await HA.listDecisions('open')
    const last = calls[calls.length - 1]
    check('decisions go to awsh with the scoped token', last.url.startsWith('http://127.0.0.1:8362/decisions') &&
      last.opts.headers.Authorization === 'Bearer scoped-tok' && list.decisions.length === 1)

    store[HA.TOKEN_KEY] = 'revoked-tok'
    await HA.listDecisions('open')
    check('a 403 on a read drops the stored token', !(HA.TOKEN_KEY in store))
    check('and leaves the UI asking to pair again', HA.getState().phase === 'unpaired')

    store[HA.TOKEN_KEY] = 'fresh-tok'
    await HA.forget('some-older-tok')
    check('forget(stale) never erases a token another context just paired', store[HA.TOKEN_KEY] === 'fresh-tok')
  }

  {
    const { ctx, storage } = sandbox('shared/harness-auth.js')
    const HA = ctx.HarnessAuth
    HA._configure({
      storage: () => storage,
      sleep: async () => {},
      fetch: async (url) => url.endsWith('/pair/start')
        ? json(200, { pair_id: 'p', code: '000111', expires_in: 120 })
        : json(403, { detail: 'pairing denied' })
    })
    const r = await HA.pair()
    check('a denied pairing ends denied with a retry button', r.phase === 'denied' && HA.describeState(HA.getState()).action === 'pair')
  }

  {
    const { ctx, storage } = sandbox('shared/harness-auth.js')
    const HA = ctx.HarnessAuth
    HA._configure({
      storage: () => storage,
      sleep: async () => {},
      fetch: async (url) => url.endsWith('/pair/start')
        ? json(200, { pair_id: 'p', code: '000111', expires_in: 120 })
        : json(410, { detail: 'pairing expired or unknown' })
    })
    check('an expired code ends expired', (await HA.pair()).phase === 'expired')
  }

  {
    const { ctx, storage } = sandbox('shared/harness-auth.js')
    const HA = ctx.HarnessAuth
    HA._configure({ storage: () => storage, sleep: async () => {}, fetch: async () => { throw new TypeError('fetch failed') } })
    check('awsh down -> offline, not a hang', (await HA.pair()).phase === 'offline')
  }

  // ── 2. desk bridge ───────────────────────────────────────────────────
  {
    const { ctx } = sandbox('shared/desk-bridge.js')
    const DB = ctx.DeskBridge
    const sent = []
    DB._configure({ fetch: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Response('', { status: 403 }) } })
    const r = await DB.speak('hello')
    check('awdesk 403 reads as "update awdesk"', r.ok === false && r.error === 'awdesk too old: update awdesk')
    DB._configure({ fetch: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Response('{}', { status: 202 }) } })
    const page = await DB.sendPage({ url: 'https://example.com/', title: 'Ex', selection: 'y'.repeat(9000) })
    const lastSent = sent[sent.length - 1]
    check('send page posts a page event to awdesk /events', page.ok && lastSent.url === 'http://127.0.0.1:47931/events' &&
      lastSent.body.type === 'page' && lastSent.body.selection.length === 4000)
    check('non-http pages are not sent', (await DB.sendPage({ url: 'chrome://settings' })).ok === false)
    const opened = await DB.openInBrowser('https://example.com/a')
    const openSent = sent[sent.length - 1]
    check('open in Aither Browser posts the url to awdesk /browser/open', opened.ok &&
      openSent.url === 'http://127.0.0.1:47931/browser/open' && openSent.body.url === 'https://example.com/a')
    const before = sent.length
    check('a non-http page is never sent to the Aither Browser',
      (await DB.openInBrowser('javascript:alert(1)')).ok === false && sent.length === before)
  }

  // ── 3. wiring ────────────────────────────────────────────────────────
  const bg = read('background.js')
  check('background.js has no self.GenesisAuth (decisions live in awsh)', !/self\.GenesisAuth/.test(bg))
  check('background list-decisions uses HarnessAuth', /case "list-decisions":[\s\S]{0,600}self\.HarnessAuth\.listDecisions/.test(bg))
  check('background no longer hands out a harness token', !/get-harness-token/.test(bg))
  check('background imports desk-bridge.js', /importScripts\([\s\S]*shared\/desk-bridge\.js/.test(bg))
  check('the Open in Aither Browser menu row is wired to DeskBridge.openInBrowser',
    /id: "desk-open-browser"/.test(bg) && /menuItemId === "desk-open-browser"[\s\S]{0,200}DeskBridge\.openInBrowser/.test(bg))
  check('popup.html does not load genesis-auth.js', !/genesis-auth\.js/.test(read('popup/popup.html')))
  check('popup.js has no GenesisAuth', !/GenesisAuth/.test(read('popup/popup.js')))
  for (const f of ['background.js', 'popup/popup.html', 'sidepanel/sidepanel.html', 'options/options.html']) {
    check(`${f} does not load the retired genesis-auth.js`, !/genesis-auth\.js/.test(read(f)))
  }
  check('sidepanel.html loads harness-auth.js before sidepanel.js',
    /shared\/harness-auth\.js[\s\S]*sidepanel\.js/.test(read('sidepanel/sidepanel.html')))
  check('the paste-only token key is gone', !/aither_harness_token/.test(read('shared/harness-auth.js')))
  check('speak-replies is opt-in (default false)', /deskSpeakReplies:\s*false/.test(bg))

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1) }
  console.log('\nharness pairing: all checks passed')
}

run().catch((e) => { console.error(e); process.exit(1) })
