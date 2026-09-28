/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * EVERY BUTTON ON THE ONBOARDING PAGE DOES SOMETHING, AND BOTH EXITS FINISH.
 *
 * Review finding on this branch (P0): the old :8090 probe was deleted together
 * with the `finish-fleet` click handler while onboard.html still rendered the
 * button, so "Skip - use this computer only" led to a "Finish setup" that did
 * nothing; and with AitherOS local the mode step preselected "hybrid", whose
 * portal call fails while portal.aitherium.com answers 503. Both exits were dead.
 *
 * This test runs the REAL onboard.js (and shared/onboard-flow.js) in a vm
 * against a small DOM stub built from onboard.html's ids, then asserts:
 *   1. every <button id> and <a id> in onboard.html has a click listener;
 *   2. skip-signin -> finish-fleet saves preferredTier=genesis and marks the
 *      browser onboarded with aither_mode=fleet, then opens the side panel;
 *   3. with a local node found, the mode step preselects "local";
 *   4. "hybrid" with the portal unreachable still finishes (local-only).
 *
 * Run: node tests/onboard-wiring.test.mjs   (exit 1 on failure, 0 on pass)
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
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const html = read('onboard/onboard.html')
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
const clickables = [...html.matchAll(/<(?:button|a)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1])
const modes = [...html.matchAll(/class="mode-card"[^>]*data-mode="([^"]+)"/g)].map((m) => m[1])

function makeEl (id, extra = {}) {
  const classes = new Set()
  const listeners = {}
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    className: '',
    dataset: {},
    children: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force
        if (on) classes.add(c); else classes.delete(c)
        return on
      },
    },
    listeners,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn) },
    appendChild: (child) => { el.children.push(child) },
    click: async () => { for (const fn of listeners.click || []) await fn({ preventDefault () {} }) },
    ...extra,
  }
  return el
}

function makeWorld ({ localUp, portalThrows }) {
  const byId = new Map(ids.map((id) => [id, makeEl(id)]))
  const modeCards = modes.map((m) => makeEl(`mode-${m}`, { dataset: { mode: m } }))
  const docListeners = {}
  const document = {
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => {
      if (sel === '.panel') return [...byId.values()].filter((e) => /^panel-/.test(e.id))
      if (sel === '#panel-3 .mode-card' || sel === '.mode-card') return modeCards
      return []
    },
    querySelector: (sel) => {
      const m = /data-mode="([^"]+)"/.exec(sel)
      return m ? modeCards.find((c) => c.dataset.mode === m[1]) || null : null
    },
    createElement: (tag) => makeEl(`<${tag}>`),
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn) },
  }
  const storage = {}
  const savedSettings = []
  const sidePanelOpened = []
  const chrome = {
    runtime: {
      sendMessage: (m, cb) => {
        if (m.type === 'get-settings') cb({ settings: {} })
        else if (m.type === 'save-settings') { savedSettings.push(m.settings); cb({ ok: true }) } else cb({})
      },
      getURL: (p) => `chrome-extension://x/${p}`,
    },
    storage: { local: { set: async (o) => { Object.assign(storage, o) } } },
    sidePanel: { open: (o) => { sidePanelOpened.push(o) } },
    windows: { WINDOW_ID_CURRENT: -2 },
    tabs: { create: () => {} },
    permissions: { request: async () => true },
  }
  const fetch = async (url) => {
    if (localUp && /127\.0\.0\.1:9001\/health$/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
    }
    if (/127\.0\.0\.1/.test(String(url))) throw new TypeError('Failed to fetch')
    return { ok: false, status: 503, json: async () => null }
  }
  const AitherPortal = {
    PORTAL_DEFAULT_URL: 'https://portal.aitherium.com',
    getPortalRecord: async () => ({}),
    setPortalRecord: async () => {},
    setPortalBearer: async () => {},
    getPortalUrl: async () => 'https://portal.aitherium.com',
    portalQuickOnboard: async () => {
      if (portalThrows) throw new TypeError('Failed to fetch')
      return { ok: false, status: 503 }
    },
  }
  const AitherProviders = { listProviders: () => [], getProvider: () => ({}) }
  const ctx = {
    document, chrome, fetch, AitherPortal, AitherProviders,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, AbortController, URL, URLSearchParams, console, Promise, Headers,
  }
  ctx.self = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(read('shared/onboard-flow.js'), ctx, { filename: 'onboard-flow.js' })
  vm.runInContext(read('onboard/onboard.js'), ctx, { filename: 'onboard.js' })
  for (const fn of docListeners.DOMContentLoaded || []) fn()
  return { ctx, byId, modeCards, storage, savedSettings, sidePanelOpened }
}

// ── 1. every clickable has a listener ──────────────────────────────────
{
  const w = makeWorld({ localUp: true })
  check('onboard.html declares buttons', clickables.length > 10, `found ${clickables.length}`)
  check('finish-fleet is still on the page', clickables.includes('finish-fleet'))
  const dead = clickables.filter((id) => !(w.byId.get(id).listeners.click || []).length)
  check('every button/link id in onboard.html has a click listener', dead.length === 0, `no listener: ${dead.join(', ')}`)
  check('the three mode cards are clickable', w.modeCards.length === 3 && w.modeCards.every((c) => (c.listeners.click || []).length))
}

// ── 2. skip sign-in -> Finish setup completes the local-only path ─────
{
  const w = makeWorld({ localUp: true })
  await tick(20) // detectLocal() from step 0
  const local = vm.runInContext('state.local', w.ctx)
  check('local node detected via the adk probe', local && local.found === true)
  await w.byId.get('choice-confirm').click()
  await tick(20)
  check('skip-signin shown when AitherOS is local', !w.byId.get('skip-signin').classList.contains('hidden'))
  await w.byId.get('skip-signin').click()
  await tick(20)
  check('skip-signin opens the local-only panel', !w.byId.get('panel-1').classList.contains('hidden'))
  await w.byId.get('finish-fleet').click()
  check('finish-fleet saves preferredTier=genesis', w.savedSettings.some((s) => s.preferredTier === 'genesis'),
    JSON.stringify(w.savedSettings))
  check('finish-fleet marks onboarded with aither_mode=fleet',
    w.storage.aither_mode === 'fleet' && typeof w.storage.aither_onboarded_at === 'number', JSON.stringify(w.storage))
  await tick(600)
  check('finish-fleet opens the side panel', w.sidePanelOpened.length === 1)
}

// ── 3. local found -> the mode step preselects "local", not "hybrid" ──
{
  const w = makeWorld({ localUp: true })
  await tick(20)
  vm.runInContext('initPortalMode()', w.ctx)
  const mode = vm.runInContext('state.portalMode', w.ctx)
  check('mode step preselects "local" when a local node is found', mode === 'local', `got ${mode}`)
  check('Continue is enabled on the preselected mode', w.byId.get('continue-to-provision').disabled === false)
}

// ── 4. hybrid with the portal down still finishes ─────────────────────
for (const portalThrows of [false, true]) {
  const w = makeWorld({ localUp: true, portalThrows })
  await tick(20)
  vm.runInContext('initPortalMode()', w.ctx)
  const hybrid = w.modeCards.find((c) => c.dataset.mode === 'hybrid')
  await hybrid.click()
  await w.byId.get('continue-to-provision').click()
  await tick(20)
  await w.byId.get('finish').click()
  const how = portalThrows ? 'network error' : '503'
  check(`hybrid + portal ${how} still finishes (local-only)`, w.storage.aither_mode === 'local', JSON.stringify(w.storage))
  check(`hybrid + portal ${how} says the portal was unreachable`, /maintenance or offline/i.test(w.byId.get('step4-message').innerHTML))
}

if (failures) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall onboarding wiring checks passed')
