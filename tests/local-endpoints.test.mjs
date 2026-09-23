/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE LOCAL SURFACES ARE ASKED, NOT ASSUMED — and the asking must never break
 * a stranger who has no launcher.
 *
 * Every local port in this extension was a HARDCODED CONSTANT until the
 * awdesk port moved out from under it (47831 sat in a Windows reserved TCP
 * range; the launcher now PICKS ports and publishes them at
 * :8899/connect.json). shared/local-endpoints.js asks the launcher and falls
 * back to the constants. Three things can go wrong and each gets an arm here:
 *
 *   1. background.js forgets to import it FIRST — then every other local
 *      caller keeps dialling hardcoded constants and nothing notices.
 *   2. The fallback carries a port that is provably dead (8001 was the
 *      retired genesis LB host port; 47831 sits in the reserved range) — a
 *      "fallback" that points at a dead port is not a fallback.
 *   3. A failed probe returns EMPTY — which silently disables every local
 *      feature and looks identical to "the user has no local surfaces".
 *
 * The behavioural half runs the module in a vm sandbox with a stubbed fetch,
 * because a textual scan cannot see a merge bug or a dropped cache.
 *
 * Run: node tests/local-endpoints.test.mjs   (exit 1 on failure, 0 on pass)
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

const bg = read('background.js')
const le = read('shared/local-endpoints.js')
const ha = read('shared/harness-auth.js')

/**
 * Code only, never prose: this module's own header documents the OLD ports it
 * replaced (47831, 8001, localhost:8001) so a future reader knows why they are
 * gone — flagging the documentation of a defect as the defect is how a gate
 * gets deleted. The (?<!:) guard matters: without it the `//` inside a
 * `"http://" + LOOPBACK` literal reads as a line-comment opener and eats the
 * very code this test exists to inspect.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '')
}
const leCode = stripComments(le)

// ── 1. wiring: background imports local-endpoints FIRST ──────────────
const impIdx = bg.indexOf('importScripts("shared/local-endpoints.js"')
check('background.js imports shared/local-endpoints.js', impIdx !== -1)
const tierIdx = bg.indexOf('"shared/tier-detect.js"')
check('local-endpoints is FIRST in the import chain', impIdx !== -1 && tierIdx > impIdx)
check('harness-auth consults AitherLocalEndpoints', ha.includes('AitherLocalEndpoints') &&
  ha.includes('endpointFor("awsh")'))
check('harness-auth keeps 8362 as the fallback', ha.includes('"http://127.0.0.1:8362"'))

// ── 2. the fallback map carries live ports, never localhost ──────────
check('awdesk fallback is 47931, not the reserved 47831',
  leCode.includes('47931') && !leCode.includes('47831'))
check('adk fallback is 9001, not the retired-LB 8001',
  leCode.includes(':9001') && !/\b8001\b/.test(leCode))
check('no "localhost" literal in the code', !/localhost/.test(leCode))
check('module declares the 127.0.0.1 literal', le.includes('const LOOPBACK = "127.0.0.1"'))

// ── 3. behaviour: probe, merge, fallback, cache — in a vm sandbox ────
function sandbox(fetchImpl) {
  const calls = []
  const sb = {
    fetch: async (url, opts) => { calls.push(String(url)); return fetchImpl(url, opts) },
    setTimeout, clearTimeout, AbortController,
    console,
  }
  vm.runInNewContext(le, sb)
  return { api: sb.AitherLocalEndpoints, calls }
}

;(async () => {
  // launcher answers → merged map, source launcher, extra launcher key wins
  {
    const { api, calls } = sandbox(async (url) => ({
      ok: true,
      json: async () => ({ endpoints: { awsh: 'http://127.0.0.1:7777' } }),
    }))
    const map = await api.localEndpoints()
    check('probes the launcher at :8899/connect.json', calls.length === 1 && calls[0].includes(':8899/connect.json'))
    check('launcher answer merges over the fallback', map.source === 'launcher' &&
      map.endpoints.awsh === 'http://127.0.0.1:7777')
    check('merge keeps every fallback key', map.endpoints.awdesk === 'http://127.0.0.1:47931' &&
      map.endpoints.adk === 'http://127.0.0.1:9001' && map.endpoints.awnode === 'http://127.0.0.1:8182')
  }
  // no launcher → fallback map, never empty, never throws
  {
    const { api, calls } = sandbox(async () => { throw new Error('refused') })
    const map = await api.localEndpoints()
    check('no launcher → fallback, source fallback', map.source === 'fallback')
    check('fallback is complete (never empty)', map.endpoints.awsh === 'http://127.0.0.1:8362' &&
      map.endpoints.launcher === 'http://127.0.0.1:8899')
    check('endpointFor falls back per name', (await api.endpointFor('awdesk')) === 'http://127.0.0.1:47931')
  }
  // cache: within TTL no second probe; _reset forces one
  {
    let n = 0
    const { api, calls } = sandbox(async () => { n++; return { ok: true, json: async () => ({ endpoints: {} }) } })
    await api.localEndpoints()
    await api.localEndpoints()
    check('cached within TTL (one probe for two calls)', n === 1)
    api._reset()
    await api.localEndpoints()
    check('_reset drops the cache (second probe after reset)', n === 2 && calls.length === 2)
  }

  console.log(failures === 0 ? '\nlocal-endpoints: OK' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
})()
