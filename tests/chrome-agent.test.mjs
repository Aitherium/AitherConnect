/**
 * chrome-agent: an agent may drive the owner's Chrome ONLY on a tab the owner
 * approved, on the site it was approved on. Every check below is the refusal or
 * the grant that rule depends on, against a fake chrome.* so it runs in node.
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

function fakeChrome (tabs) {
  const session = {}
  const listeners = { button: [], closed: [], removed: [], updated: [] }
  const notes = []
  const scripts = []
  const badges = {}
  let answer = null // index the "owner" clicks: 0 = Allow, 1 = Deny, null = no answer
  const chrome = {
    storage: { session: {
      get: async (k) => (k in session ? { [k]: session[k] } : {}),
      set: async (o) => { Object.assign(session, JSON.parse(JSON.stringify(o))) },
    } },
    tabs: {
      get: async (id) => { const t = tabs.find((x) => x.id === id); if (!t) throw new Error('no tab'); return { ...t } },
      query: async () => tabs.map((t) => ({ ...t })),
      onRemoved: { addListener: (f) => listeners.removed.push(f) },
      onUpdated: { addListener: (f) => listeners.updated.push(f) },
    },
    notifications: {
      create: (id, opts) => { notes.push({ id, opts }); if (answer != null) setTimeout(() => listeners.button.forEach((f) => f(id, answer)), 0) },
      clear: () => {},
      onButtonClicked: { addListener: (f) => listeners.button.push(f), removeListener: (f) => { listeners.button = listeners.button.filter((x) => x !== f) } },
      onClosed: { addListener: (f) => listeners.closed.push(f), removeListener: (f) => { listeners.closed = listeners.closed.filter((x) => x !== f) } },
    },
    action: {
      setBadgeText: async ({ tabId, text }) => { badges[tabId] = text },
      setBadgeBackgroundColor: async () => {},
    },
    scripting: { executeScript: async (opts) => { scripts.push(opts); return [{ result: { ok: true, ran: opts.args[0], tab: opts.target.tabId } }] } },
  }
  return { chrome, session, listeners, notes, scripts, badges, setAnswer: (v) => { answer = v } }
}

function load (fake) {
  const ctx = { console, URL, setTimeout, clearTimeout, Promise, JSON, Date, Number, String, Object, Array, Map, Error }
  ctx.self = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(read('shared/chrome-agent.js'), ctx)
  ctx.ChromeAgent._configure({ chrome: fake.chrome })
  return ctx.ChromeAgent
}

async function run () {
  const tabs = [
    { id: 1, url: 'https://mail.example.com/inbox', title: 'Inbox', active: true },
    { id: 2, url: 'https://shop.example.com/cart', title: 'Cart', active: false },
    { id: 3, url: 'chrome://settings', title: 'Settings', active: false },
  ]
  const fake = fakeChrome(tabs)
  const CA = load(fake)
  CA.wire()

  const listed = await CA.handle({ action: 'tabs' })
  check('chrome_tabs lists http(s) tabs only, with host and approved=false, no content',
    listed.ok && listed.tabs.length === 2 && listed.tabs.every((t) => t.approved === false && !('url' in t)) &&
    listed.tabs[0].host === 'mail.example.com')

  const refused = await CA.handle({ action: 'read', args: { tab: 2 } })
  check('a page action on an unapproved tab is REFUSED', refused.ok === false && /^REFUSED: the owner has not approved tab 2/.test(refused.error))
  check('...and nothing ran in the page', fake.scripts.length === 0)

  fake.setAnswer(1)
  const denied = await CA.handle({ action: 'request_tab', args: { tab: 2, reason: 'check the cart total' } })
  check('the owner is asked on their screen, with the site and the reason', fake.notes.length === 1 &&
    /shop\.example\.com: check the cart total/.test(fake.notes[0].opts.message) && fake.notes[0].opts.buttons[0].title === 'Allow on this tab')
  check('Deny keeps it refused', denied.ok === false && denied.approved === false &&
    (await CA.handle({ action: 'snapshot', args: { tab: 2 } })).ok === false)

  fake.setAnswer(0)
  const allowed = await CA.handle({ action: 'request_tab', args: { tab: 2, reason: 'check the cart total' } })
  check('Allow approves THAT tab and badges it', allowed.ok && allowed.approved && fake.badges[2] === 'AI')
  const ran = await CA.handle({ action: 'snapshot', args: { tab: 2 } })
  check('an approved tab is driven', ran.ok && ran.ran === 'snapshot' && ran.tab === 2)
  check('...while the OTHER tab is still refused', (await CA.handle({ action: 'read', args: { tab: 1 } })).ok === false)

  // The tab navigates to another site: the approval does not follow it.
  tabs[1].url = 'https://bank.example.com/login'
  const moved = await CA.handle({ action: 'read', args: { tab: 2 } })
  check('an approval is for one site: after a navigation away it is REFUSED', moved.ok === false && /changed site/.test(moved.error))
  for (const f of fake.listeners.updated) await f(2, { url: tabs[1].url })
  check('...and the onUpdated hook drops the approval and the badge', !('2' in (fake.session.chromeAgentApprovals || {})) && fake.badges[2] === '')

  fake.setAnswer(0)
  await CA.handle({ action: 'request_tab', args: { tab: 1, reason: 'x' } })
  for (const f of fake.listeners.removed) await f(1)
  check('closing an approved tab drops its approval', !('1' in (fake.session.chromeAgentApprovals || {})))

  check('chrome:// and unknown tabs cannot be requested', (await CA.requestTab(3, 'x')).ok === false && (await CA.requestTab(99, 'x')).ok === false)
  check('unknown actions are refused, never thrown', (await CA.handle({ action: 'eval', args: {} })).ok === false)
  check('a non-integer tab id is refused', /tab must be a tab id/.test((await CA.handle({ action: 'read', args: { tab: 'x' } })).error))

  // Wiring.
  const bg = read('background.js')
  check('background imports chrome-agent.js', /importScripts\([\s\S]*shared\/chrome-agent\.js/.test(bg))
  check('background wires the revocation hooks and starts the loop', /ChromeAgent\.wire\(\)/.test(bg) && /ChromeAgent\.start\(\)/.test(bg))
  const db = read('shared/desk-bridge.js')
  check('desk-bridge long-polls /chrome/next and posts /chrome/result', /\/chrome\/next/.test(db) && /\/chrome\/result/.test(db))

  if (failures) { console.log(`\nchrome-agent: ${failures} check(s) FAILED`); process.exit(1) }
  console.log('\nchrome-agent: all checks passed')
}

run().catch((e) => { console.error(e); process.exit(1) })
