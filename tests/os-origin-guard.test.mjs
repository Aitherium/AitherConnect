/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE EXTENSION MUST STAND DOWN ON THE OS ITSELF.
 *
 * aitherium.com IS the Living OS. It renders its own dock, brain bar, node indicator and
 * sign-in. On 2026-07-31 the owner had TWO taskbars stacked in one viewport — the real one
 * and the extension's hand-rolled fallback — because `background.js` injected on every
 * http(s) tab and `aither-command-bar.js` carried an explicit comment saying it renders on
 * EVERY website. The overlay bridge was worse: it iframed aitherium.com INTO aitherium.com.
 *
 * Nothing could catch that. Both scripts load without error, the bar renders correctly, and
 * every unit test of the bar's own behaviour passes — the defect is only visible to someone
 * LOOKING at the page. So this asserts the guards textually, which is the level the bug
 * lives at.
 *
 * Run: node tests/os-origin-guard.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${name}`) } else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('Awconnect — OS-origin guards')

const bg = read('background.js')
check(
  'background.js defines IS_OS_ORIGIN',
  /const IS_OS_ORIGIN\s*=\s*\/\^https\?:/.test(bg),
)
/* This pair used to pattern-match the literal
 *   `if (IS_OS_ORIGIN.test(tab.url)) return;`
 * inside the onUpdated listener, and assert its source OFFSET came before the
 * first _xInjectPanel call. Both went red the moment the guard was hoisted into
 * a helper (`_injectableUrl`) so a settings-change SWEEP of already-open tabs
 * could reuse it — a refactor that made the guard cover MORE call sites, not
 * fewer. A test that fails when a guard gets stronger teaches people to delete
 * the test.
 *
 * So: EXECUTE the guard instead of reading it. Pull the real IS_OS_ORIGIN regex
 * and the real _injectableUrl body out of background.js and call them. This
 * survives any refactor that keeps the behaviour, and — unlike the regex — it
 * actually fails if the predicate is wrong rather than merely differently
 * spelled. The behaviour is the thing the owner saw: two taskbars in one
 * viewport on aitherium.com.
 */
const osRe = /const IS_OS_ORIGIN\s*=\s*(\/.*\/);/.exec(bg)
const injFn = /function _injectableUrl\(url\)\s*\{[\s\S]*?\n\}/.exec(bg)
check('background.js exposes IS_OS_ORIGIN and _injectableUrl', !!osRe && !!injFn,
  `IS_OS_ORIGIN=${!!osRe} _injectableUrl=${!!injFn}`)

let injectableUrl = null
if (osRe && injFn) {
  injectableUrl = new Function(
    `const IS_OS_ORIGIN = ${osRe[1]};\n${injFn[0]}\nreturn _injectableUrl;`,
  )()
}

const REFUSE = [
  'https://aitherium.com/',
  'https://aitherium.com/dashboard',
  'http://aitherium.com',
  'https://www.aitherium.com/',
  'https://aitherium.com?x=1',
  'chrome://extensions',
  'https://chromewebstore.google.com/detail/abc',
]
// A SUBdomain IS the OS too, since d49fcf949e (2026-08-08, "extension never
// double-injects on OS hosts"): portal/demo/cluster all render the real dock
// and sign-in, so injecting there stacks a second hand-rolled taskbar under
// the real one — the exact defect the guard exists to prevent. That commit
// widened BOTH implementations and left this list behind, so the suite had
// been asserting the pre-08-08 intent against post-08-08 code ever since.
REFUSE.push('https://portal.aitherium.com/workspace')
const ALLOW = [
  'https://x.com/home',
  'https://www.linkedin.com/feed/',
  'https://news.ycombinator.com/',
]
check(
  'background.js refuses to inject on the OS origin (executed)',
  !!injectableUrl && REFUSE.every((u) => injectableUrl(u) === false),
  injectableUrl ? `refused=${REFUSE.filter((u) => injectableUrl(u) === false).length}/${REFUSE.length}` : 'not extractable',
)
check(
  'background.js still injects everywhere else (the guard is not a blanket off-switch)',
  !!injectableUrl && ALLOW.every((u) => injectableUrl(u) === true),
  injectableUrl ? `allowed=${ALLOW.filter((u) => injectableUrl(u) === true).length}/${ALLOW.length}` : 'not extractable',
)
// The guard must still run BEFORE anything injects, wherever it now lives.
const guardAt = bg.indexOf('if (!_injectableUrl(url)) return;')
const injectAt = bg.indexOf('_xInjectPanel(tabId, "content/aither-overlay-bridge.js")')
check(
  'the OS-origin guard precedes the injection calls',
  guardAt > 0 && injectAt > 0 && guardAt < injectAt,
  `guard@${guardAt} inject@${injectAt}`,
)

const bar = read('content/aither-command-bar.js')
// Assert the BEHAVIOUR, not the spelling. The previous version demanded the
// literal source text `if (/^aitherium\.com$/.test(HOST)) return;`, so
// widening the guard to cover subdomains — a strictly better guard — failed
// the test. A check that pins one exact expression forbids improving the thing
// it guards, and the improvement is what gets reverted.
const barGuard = bar.match(/if \((\/[^\n]*?\/)\.test\(HOST\)\) return;/)
const barHosts = barGuard ? new Function(`return ${barGuard[1]}`)() : null
check(
  'command bar returns early on the aitherium.com family (apex + subdomains)',
  !!barHosts
    && ['aitherium.com', 'portal.aitherium.com', 'demo.aitherium.com'].every((h) => barHosts.test(h))
    && !['x.com', 'notaitherium.com', 'news.ycombinator.com'].some((h) => barHosts.test(h)),
  barGuard ? `guard=${barGuard[1]}` : 'no HOST guard found',
)
check(
  'the "renders on EVERY website" claim is gone',
  !/renders on EVERY website/.test(bar),
)
/* Twitter blue must be gone from every STYLE DECLARATION. Matching the bare hex would also
   hit the comment that explains why it was removed — and a check that forbids describing the
   bug it guards gets the comment deleted, not the bug re-fixed. So: only flag it where it
   would actually paint something. */
const BLUE_IN_STYLE = /(background|border|color|accent-color|box-shadow|fill)\s*:[^;"'`\n]*#1d9bf0/i
check(
  'no style declaration still paints Twitter blue (#1d9bf0)',
  !BLUE_IN_STYLE.test(bar),
  (bar.match(BLUE_IN_STYLE) || [''])[0],
)

const overlay = read('content/aither-overlay-bridge.js')
check(
  'overlay bridge returns early on the OS origin (no recursive frame)',
  /aitherium\\\.com\$\/\.test\(location\.hostname\)\) return;/.test(overlay),
)
// The early return must happen BEFORE __aitherOverlay is latched, or a later legitimate
// injection on a different page in the same tab would find the guard already set.
const latchAt = overlay.indexOf('window.__aitherOverlay = true')
const originGuardAt = overlay.indexOf('.test(location.hostname)) return;')
check(
  'overlay origin guard precedes the __aitherOverlay latch',
  originGuardAt > 0 && latchAt > 0 && originGuardAt < latchAt,
  `guard@${originGuardAt} latch@${latchAt}`,
)
const budget = /const READY_BUDGET_MS = (\d+)/.exec(overlay)
check(
  'overlay ready budget is long enough for a cold hydrate (>= 15s)',
  !!budget && Number(budget[1]) >= 15000,
  budget ? `${budget[1]}ms` : 'READY_BUDGET_MS not found',
)
check(
  'the ready budget re-arms on iframe load',
  /frame\.addEventListener\("load"/.test(overlay),
)

/* ── STT must not require the fleet ────────────────────────────────────────
 * The sidepanel's only dictation path used to be: record audio in the offscreen doc, ship
 * it to the fleet's AitherVoice for Whisper, get text back. That made a core feature dead
 * whenever the fleet was unreachable — away from the box, on a customer's machine, tunnel
 * down — and sent the user's voice off their device to do something the browser does
 * natively. The fleet is an UPGRADE tier, never a requirement, so the browser path must
 * come first and the ordering must stay that way. */
const panel = read('sidepanel/sidepanel.js')
check(
  'sidepanel has a browser-native SpeechRecognition path',
  /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/.test(panel),
)
const localAt = panel.indexOf('if (startLocalStt())')
const fleetAt = panel.indexOf('chrome.runtime.sendMessage({ type: "stt-start" }')
check(
  'the browser path is tried BEFORE the fleet path',
  localAt > 0 && fleetAt > 0 && localAt < fleetAt,
  `local@${localAt} fleet@${fleetAt}`,
)
check(
  'the fleet path still exists as a fallback (not deleted)',
  fleetAt > 0,
)

if (process.argv.includes('--self-test')) {
  // A checker nobody has watched fail is not a check. Prove the assertions bite by running
  // them against a mutated copy of each source.
  console.log('\nself-test (each mutation MUST be caught)')
  const mutations = [
    ['background without the guard', bg.replace('if (IS_OS_ORIGIN.test(tab.url)) return;', ''), (s) => /if \(IS_OS_ORIGIN\.test\(tab\.url\)\) return;/.test(s)],
    ['bar back on Twitter blue', bar.replace('background:rgba(34,211,238,.10)', 'background:#1d9bf0'), (s) => !BLUE_IN_STYLE.test(s)],
    ['sidepanel STT back to fleet-only', panel.replace('if (startLocalStt())', 'if (false)'), (x) => { const l = x.indexOf('if (startLocalStt())'); return l > 0 }],
    ['overlay budget back to 5s', overlay.replace(/const READY_BUDGET_MS = \d+/, 'const READY_BUDGET_MS = 5000'), (s) => { const m = /const READY_BUDGET_MS = (\d+)/.exec(s); return !!m && Number(m[1]) >= 15000 }],
  ]
  for (const [name, mutated, assertion] of mutations) {
    if (assertion(mutated)) { failures++; console.log(`  FAIL self-test: "${name}" was NOT caught`) }
    else console.log(`  ok   self-test caught: ${name}`)
  }
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
