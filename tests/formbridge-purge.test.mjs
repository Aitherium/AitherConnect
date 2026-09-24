/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * FormBridge `formbridge-purge` (05-API-DESIGN: side panel → service worker → engine).
 * The message had no handler at all, so the documented owner purge path did nothing.
 * This pulls `formbridgePurge` out of background.js and runs it against stubs:
 *   - a side-panel sender purges one patient / everything, and the engine is called
 *     with the right body (`{patient_key}` / `{}`);
 *   - a content-script sender (sender.tab set: page context) is refused;
 *   - a request naming neither a patient nor all:true is refused, never read as "all";
 *   - queued (engine-down) captures for the purged patient are scrubbed from storage.
 * The side panel must actually send it (button + handler).
 *
 * Run: node tests/formbridge-purge.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`  ok   ${name}`) } else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('Awconnect — FormBridge purge message')

const bg = read('background.js')
check('background.js routes the formbridge-purge message', /case\s+"formbridge-purge"\s*:/.test(bg))

const start = bg.indexOf('async function formbridgePurge(')
check('background.js defines formbridgePurge()', start >= 0)
if (start < 0) { console.log(`\n${failures} failure(s)`); process.exit(1) }
// The function body ends at the first line that is exactly "}" after its start.
const end = bg.indexOf('\n}\n', start)
const src = bg.slice(start, end + 2)

function harness(queue) {
  const env = {
    posts: [],
    stored: null,
    formbridgeQueue: queue,
    chrome: {
      runtime: { id: 'EXT', getURL: (p) => 'chrome-extension://EXT/' + p },
      storage: { local: { set: async (o) => { env.stored = o } } },
    },
  }
  const factory = new Function('env', `
    let formbridgeQueue = env.formbridgeQueue;
    const chrome = env.chrome;
    async function formbridgeEnginePost(path, body) { env.posts.push({ path, body }); return true; }
    ${src}
    return { purge: formbridgePurge, queue: () => formbridgeQueue };
  `)
  return { env, ...factory(env) }
}

const panel = { id: 'EXT', url: 'chrome-extension://EXT/sidepanel/sidepanel.html' }
const contentScript = { id: 'EXT', url: 'http://localhost:8910/mock-ehr.html', tab: { id: 7 } }

{
  const h = harness([{ patient_key: 'A', fields: [] }, { patient_key: 'B', fields: [] }])
  const r = await h.purge({ type: 'formbridge-purge', patientKey: 'A' }, panel)
  check('side panel purges one patient', r.ok === true, JSON.stringify(r))
  check('engine gets POST /formbridge/purge {patient_key}',
    h.env.posts.length === 1 && h.env.posts[0].path === '/formbridge/purge' &&
    h.env.posts[0].body.patient_key === 'A', JSON.stringify(h.env.posts))
  check('queued captures for that patient are scrubbed',
    h.queue().length === 1 && h.queue()[0].patient_key === 'B' &&
    h.env.stored && h.env.stored['aither-formbridge-queue'].length === 1)
}
{
  const h = harness([{ patient_key: 'A' }, { patient_key: 'B' }])
  const r = await h.purge({ type: 'formbridge-purge', all: true }, panel)
  check('side panel purges everything', r.ok === true && r.queuedDropped === 2, JSON.stringify(r))
  check('purge-all sends an empty body (engine: no key = all)',
    h.env.posts.length === 1 && Object.keys(h.env.posts[0].body).length === 0)
}
{
  const h = harness([{ patient_key: 'A' }])
  const r = await h.purge({ type: 'formbridge-purge', all: true }, contentScript)
  check('content-script (page context) sender is refused', r.ok === false && h.env.posts.length === 0 && h.queue().length === 1)
}
{
  const h = harness([{ patient_key: 'A' }])
  const r = await h.purge({ type: 'formbridge-purge' }, panel)
  check('no patientKey and no all:true is refused, not read as all', r.ok === false && h.env.posts.length === 0 && h.queue().length === 1)
  const r2 = await h.purge({ type: 'formbridge-purge', all: 'yes' }, panel)
  check('all must be literally true', r2.ok === false && h.env.posts.length === 0)
}

const sp = read('sidepanel/sidepanel.js')
const html = read('sidepanel/sidepanel.html')
check('side panel has a purge button', /id="app-formbridge-purge"/.test(html))
check('side panel sends formbridge-purge', /type:\s*"formbridge-purge"/.test(sp))

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
