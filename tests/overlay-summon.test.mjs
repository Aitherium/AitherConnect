/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE OVERLAY IS SUMMONED, NOT AMBIENT.
 *
 * 2026-09-27 owner report: the overlay "always starts on web pages opened and it messes
 * with other stuff in the web page", and minimizing it left a control in the way. Causes:
 * auto-inject on every tab load, the Alt+O command named "toggle-os-overlay" in the
 * manifest but matched as "toggle-overlay" in background.js (so the only way in was
 * auto-inject), and a minimize that was forgotten on the next navigation.
 *
 * Run: node tests/overlay-summon.test.mjs   (exit 1 on failure, 0 on pass)
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

console.log('Awconnect — overlay is summoned, not ambient')

const bg = read('background.js')
const manifest = JSON.parse(read('manifest.json'))
const bridge = read('content/aither-overlay-bridge.js')
const optsHtml = read('options/options.html')
const optsJs = read('options/options.js')

check('auto-start defaults OFF', /osOverlayAutoStart:\s*false/.test(bg))
check(
  'auto-inject requires osOverlayAutoStart',
  /SETTINGS\.osOverlayAutoStart && SETTINGS\.osOverlayEnabled && !isSocial\) _xInjectPanel\(tabId, "content\/aither-overlay-bridge\.js"\)/.test(bg),
)
// Every command the manifest advertises for the overlay must have a handler that matches it.
check('manifest declares toggle-os-overlay', !!(manifest.commands && manifest.commands['toggle-os-overlay']))
check('background handles the exact manifest command name', bg.includes('command === "toggle-os-overlay"'))
check('toggle helper dismisses an existing bridge first', /async function toggleOverlayInTab[\s\S]{0,200}action: "overlay-dismiss"/.test(bg))
// AC001: a settings flag with no control is a deleted feature.
check('options renders the auto-start toggle', optsHtml.includes('id="osOverlayAutoStart"'))
check('options loads and saves auto-start', optsJs.includes('$("osOverlayAutoStart").checked = ') && optsJs.includes('osOverlayAutoStart: $("osOverlayAutoStart").checked'))
check('bridge answers overlay-dismiss', /msg\.action !== "overlay-dismiss"/.test(bridge))
check('bridge persists minimized state', /chrome\.storage\.local\.set\(\{ \[UI_KEY\]: \{ minimized/.test(bridge))
check('teardown clears the page padding it wrote', /function teardown\(\)[\s\S]{0,200}ready = false;[\s\S]{0,60}applyPagePad\(\)/.test(bridge))
check('teardown removes every control it added', /for \(const el of \[host, hint, minBtn, closeBtn, restoreBtn\]\) el\.remove\(\)/.test(bridge))

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall passed')
