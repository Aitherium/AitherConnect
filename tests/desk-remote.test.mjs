/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE POPUP'S DESK CONTROLS WRITE ONE FIELD, AND BELIEVE NOTHING THEY CANNOT SEE.
 *
 * shared/desk-remote.js edits the `awdesk` namespace of the portal preferences
 * store -- the same store the desktop app syncs to. Three ways it can be wrong,
 * each silent, each with an arm here:
 *
 *   1. It writes the WHOLE namespace back. The popup's copy is as old as the last
 *      time it was opened; a full write stamps it over whatever changed since.
 *   2. It trusts a 200. The store strips credential-NAMED keys and still answers
 *      ok, so "saved" can mean "discarded".
 *   3. It lets through a value the desk drops. The desk does not clamp; it
 *      ignores. A slider that reaches 150% would store 1.5 and change nothing.
 *
 * The module runs in a vm sandbox with a fake portal: it has no chrome.* and no
 * DOM on purpose, so this is the real code and not a copy of it.
 *
 * Run: node tests/desk-remote.test.mjs   (exit 1 on failure, 0 on pass)
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const sandbox = { self: {} }
vm.createContext(sandbox)
vm.runInContext(read('shared/desk-remote.js'), sandbox)
const D = sandbox.self.AitherDeskRemote

/** A store that behaves like the real one: deep-merges, strips credential-named
 *  keys, and answers ok either way. */
function fakePortal(initial = {}) {
  const state = { prefs: JSON.parse(JSON.stringify(initial)), puts: [] }
  const merge = (dst, src) => {
    for (const [k, v] of Object.entries(src)) {
      if (/(^|_)(token|key|secret|auth)($|_)/i.test(k)) continue
      if (v && typeof v === 'object' && !Array.isArray(v)) dst[k] = merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v)
      else dst[k] = v
    }
    return dst
  }
  return {
    state,
    get: async () => ({ ok: true, preferences: JSON.parse(JSON.stringify(state.prefs)) }),
    put: async (patch) => {
      state.puts.push(JSON.parse(JSON.stringify(patch)))
      merge(state.prefs, patch)
      return { ok: true, preferences: JSON.parse(JSON.stringify(state.prefs)) }
    },
  }
}

// ── 1. reading ───────────────────────────────────────────────────────
const empty = D.parseDeskRemote({ adk: { llm: 'local' } })
check('no desk has synced: stored=false, and the defaults are the desk built-ins',
  empty.stored === false && empty.volume === 1 && empty.muted === false && empty.bubbles === true, JSON.stringify(empty))
const pushed = D.parseDeskRemote({ awdesk: { voice: { volume: 0.35, muted: true }, stage: { bubbles: false } } })
check('reads what the desk pushed', pushed.stored && pushed.volume === 0.35 && pushed.muted && !pushed.bubbles, JSON.stringify(pushed))
let threw = false
for (const bad of [null, undefined, 7, 'x', [], { awdesk: 'nope' }, { awdesk: { voice: [1] } }, { awdesk: { voice: { volume: 'loud' } } }]) {
  try { D.parseDeskRemote(bad) } catch { threw = true }
}
check('a blob another program mangled never throws', !threw)
check('a stored volume outside 0..1 is shown inside it, never as a 150% slider',
  D.parseDeskRemote({ awdesk: { voice: { volume: 1.5 } } }).volume === 1)

// ── 2. one field per write ──────────────────────────────────────────
const portal = fakePortal({ awdesk: { version: 1, voice: { volume: 0.9, defaultVoice: 'onyx' }, actors: { 'mcp:speak': { volume: 1.4 } } }, adk: { llm: 'local' } })
const wrote = await D.writeDeskField(portal, 'voice', 'muted', true)
check('a write succeeds and returns the merged desk', wrote.ok && wrote.desk.muted === true && wrote.desk.volume === 0.9, JSON.stringify(wrote))
check('the PUT body is exactly ONE field (+ version)',
  same(portal.state.puts[0], { awdesk: { version: 1, voice: { muted: true } } }), JSON.stringify(portal.state.puts[0]))
check('fields this popup never read survive the write',
  portal.state.prefs.awdesk.voice.defaultVoice === 'onyx' && portal.state.prefs.awdesk.actors['mcp:speak'].volume === 1.4 && portal.state.prefs.adk.llm === 'local')

// ── 3. never send what the desk would drop ──────────────────────────
for (const [section, field, value] of [['voice', 'volume', 1.5], ['voice', 'volume', -0.1], ['voice', 'volume', 'abc'], ['voice', 'muted', 'yes'], ['sync', 'url', 'https://evil.invalid'], ['voice', 'endpoint', 'x']]) {
  const before = portal.state.puts.length
  const r = await D.writeDeskField(portal, section, field, value)
  check(`refuses ${section}.${field}=${JSON.stringify(value)} WITHOUT a request`, r.ok === false && portal.state.puts.length === before, JSON.stringify(r))
}
check('zero is a value, not an unset', (await D.writeDeskField(portal, 'voice', 'volume', 0)).ok && portal.state.prefs.awdesk.voice.volume === 0)

// ── 4. a 200 is not "stored" ────────────────────────────────────────
const liar = { get: async () => ({ ok: true, preferences: {} }), put: async () => ({ ok: true, preferences: { awdesk: { voice: {} } } }) }
const lied = await D.writeDeskField(liar, 'voice', 'muted', true)
check('an ok reply that did not keep the field is a FAILURE', lied.ok === false && /did not keep it/.test(lied.reason), JSON.stringify(lied))
const down = { get: async () => ({ ok: false, reason: 'not-authenticated' }), put: async () => ({ ok: false, reason: 'not-authenticated' }) }
check('signed out is reported as such, not as empty settings', (await D.readDeskRemote(down)).reason === 'not-authenticated')

// ── 4b. the portal call THROWS (fetch rejects when the network is gone) ──
const boom = () => { throw new TypeError('Failed to fetch') }
const offline = { get: async () => boom(), put: async () => boom() }
let rejected = false
let offRead = null
let offWrite = null
try { offRead = await D.readDeskRemote(offline) } catch { rejected = true }
try { offWrite = await D.writeDeskField(offline, 'voice', 'muted', true) } catch { rejected = true }
check('a rejecting portal call never escapes as a rejection', !rejected)
check('an unreachable portal on READ is {ok:false} with a reason', !!offRead && offRead.ok === false && /could not reach the portal/.test(offRead.reason), JSON.stringify(offRead))
check('an unreachable portal on WRITE is {ok:false} with a reason', !!offWrite && offWrite.ok === false && /could not reach the portal/.test(offWrite.reason), JSON.stringify(offWrite))
const syncThrow = { get: boom, put: boom }
let syncRejected = false
try { await D.readDeskRemote(syncThrow); await D.writeDeskField(syncThrow, 'voice', 'volume', 0.5) } catch { syncRejected = true }
check('a portal call that throws synchronously is caught too', !syncRejected)

// ── 5. wiring: the popup actually loads and uses it ─────────────────
const html = read('popup/popup.html')
const js = read('popup/popup.js')
const deskIdx = html.indexOf('../shared/desk-remote.js')
check('popup.html loads shared/desk-remote.js', deskIdx !== -1)
check('...AFTER portal-api.js (it needs the portal calls) and BEFORE popup.js',
  deskIdx > html.indexOf('../shared/portal-api.js') && deskIdx < html.indexOf('src="popup.js"'))
for (const id of ['desk-mute', 'desk-volume', 'desk-bubbles', 'desk-status']) {
  check(`popup.html has #${id} and popup.js uses it`, html.includes(`id="${id}"`) && js.includes(`'${id}'`))
}
check('popup.js writes through AitherDeskRemote, never putProfileSettings with a whole blob',
  js.includes('AitherDeskRemote.writeDeskField') && !/putProfileSettings\(\s*\{\s*awdesk\s*:/.test(js))
check('a failed write with a failed re-read falls back to the last stored state',
  /show\(again\.ok \? again\.desk : known\)/.test(js))

console.log(failures ? `\n${failures} FAILED` : '\nall desk-remote checks passed')
process.exit(failures ? 1 : 0)
