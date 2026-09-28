/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE FIRST STEP IS "GET AITHEROS ON THIS COMPUTER", AND SIGN-IN IS PASSWORDLESS.
 *
 * Owner, 2026-09-27: "sign in to aitherium portal doesn't even work... neither
 * does connect to my aitheros fleet... why can't I just do email / magic link +
 * device flow auth? shouldn't the first step be to download/install awdk+awsh?"
 *
 * Measured that day: portal.aitherium.com/auth/* answered 503 and the form said
 * "Network error"; the fleet probe dialled :8090 where nothing listens. This test
 * pins the replacement:
 *   1. step 0 probes adk (:9001), awsh (:8362) and the gateway (:8182) and shows
 *      the one-line installer when none answers;
 *   2. sign-in is Identity's device flow (the endpoints `adk login` uses), the
 *      email option is the same flow with `email`, and there is NO password
 *      form (its /auth/login route never existed on the platform);
 *   3. a 5xx / network failure reads "unreachable (maintenance or offline)",
 *      never a generic error.
 * The behavioural half runs shared/onboard-flow.js in a vm sandbox with a stub fetch.
 *
 * Run: node tests/onboard-flow.test.mjs   (exit 1 on failure, 0 on pass)
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

const html = read('onboard/onboard.html')
const js = read('onboard/onboard.js')

// ── 1. structure: the page the owner sees ────────────────────────────
const panel0 = html.slice(html.indexOf('id="panel-0"'), html.indexOf('id="panel-byok-provider"'))
check('step 0 is "Get AitherOS on this computer"', /<h2>Get AitherOS on this computer<\/h2>/.test(panel0))
check('step 0 probes adk, awsh and the gateway',
  ['status-adk', 'status-awsh', 'status-awnode'].every((id) => panel0.includes(`id="${id}"`)))
check('step 0 has "Check again" and the installer block',
  panel0.includes('id="recheck-local0"') && panel0.includes('id="install-cmd"'))
check('BYOK stays reachable from step 0', panel0.includes('id="choice-byok"'))
check('the old three-card chooser is gone', !html.includes('choice-portal') && !html.includes('choice-fleet'))

const panel2 = html.slice(html.indexOf('id="panel-2"'), html.indexOf('id="panel-3"'))
const deviceAt = panel2.indexOf('id="device-signin"')
check('primary sign-in is the device flow button', deviceAt !== -1 && /btn primary big" id="device-signin"/.test(panel2))
check('email-me-a-link option exists', panel2.includes('id="magic-email"') && panel2.includes('id="magic-send"'))
check('no email+password form (the route does not exist)',
  !/id="login-password"|id="do-login"/.test(html) && !/portalLogin|portalVerify2fa/.test(js))
check('onboard.html loads local-endpoints + onboard-flow before onboard.js',
  html.indexOf('shared/local-endpoints.js') !== -1 &&
  html.indexOf('shared/onboard-flow.js') < html.indexOf('src="onboard.js"'))
check('onboard.js no longer dials the dead :8090 probe', !/127\.0\.0\.1:8090/.test(js))
// The BYOK key test keeps its provider "Network error"; the portal/sign-in half must not.
const signinJs = js.slice(js.indexOf('// === SIGN-IN (PASSWORDLESS FIRST) ==='), js.indexOf('function initPortalMode()'))
check('sign-in reports unreachable, not "Network error"',
  signinJs.length > 0 && !/Network error/.test(signinJs) && signinJs.includes('UNREACHABLE_MESSAGE'))

// ── 2. behaviour ─────────────────────────────────────────────────────
function load(routes) {
  const calls = []
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const handler = routes(String(url), opts)
    if (handler instanceof Error) throw handler
    const { status = 200, body = {} } = handler || { status: 404, body: {} }
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  const sb = { setTimeout, clearTimeout, AbortController, console, URL }
  sb.globalThis = sb
  vm.createContext(sb)
  vm.runInContext(read('shared/onboard-flow.js'), sb)
  return { F: sb.AitherOnboardFlow, fetch, calls }
}

async function main() {
  // identity URL mapping mirrors awdk _resolve_identity_url
  {
    const { F } = load(() => null)
    check('portal.aitherium.com -> idp', F.identityUrlFor('https://portal.aitherium.com') === 'https://idp.aitherium.com')
    check('localhost kept as-is', F.identityUrlFor('http://127.0.0.1:8112/') === 'http://127.0.0.1:8112')
    check('windows gets the PowerShell one-liner', /install\.ps1/.test(F.installCommand(F.platformOf({ platform: 'Win32' }))))
    check('mac gets the curl one-liner', /install\.sh \| sh/.test(F.installCommand(F.platformOf({ userAgentData: { platform: 'macOS' } }))))
  }

  // local detection
  {
    const { F, fetch, calls } = load((u) => u.startsWith('http://127.0.0.1:9001/health') ? { status: 200, body: { status: 'healthy' } } : new Error('ECONNREFUSED'))
    const r = await F.probeLocal({ fetch, endpoints: { adk: 'http://127.0.0.1:9001', awsh: 'http://127.0.0.1:8362', awnode: 'http://127.0.0.1:8182' } })
    check('adk answering => found', r.found === true && r.adk.ok && !r.awsh.ok && !r.awnode.ok)
    check('probes all three health endpoints', ['9001', '8362', '8182'].every((p) => calls.some((c) => c.url === `http://127.0.0.1:${p}/health`)))
    const none = load(() => new Error('ECONNREFUSED'))
    const r2 = await none.F.probeLocal({ fetch: none.fetch, endpoints: {} })
    check('nothing answering => not found (installer shown)', r2.found === false)
  }

  // device flow: start, pending, approved
  {
    let polls = 0
    const { F, fetch, calls } = load((u, o) => {
      if (u.endsWith('/auth/device/code')) return { body: { device_code: 'DC', user_code: 'ABCD-1234', verification_uri: 'https://idp.aitherium.com/link', verification_uri_complete: 'https://idp.aitherium.com/link?user_code=ABCD-1234', interval: 5, expires_in: 900 } }
      if (u.endsWith('/auth/device/token')) { polls++; return polls < 3 ? { body: { status: 'authorization_pending' } } : { body: { access_token: 'tok', token_type: 'bearer' } } }
      return null
    })
    const s = await F.startDeviceFlow({ fetch, identityUrl: 'https://idp.aitherium.com' })
    check('device flow starts against Identity /auth/device/code', s.ok && s.user_code === 'ABCD-1234' && calls[0].url === 'https://idp.aitherium.com/auth/device/code')
    const body = JSON.parse(calls[0].opts.body)
    check('client_name is awconnect, no email by default', body.client_name === 'awconnect' && !('email' in body))
    let t = 0
    const r = await F.pollDeviceFlow({ fetch, identityUrl: 'https://idp.aitherium.com', deviceCode: s.device_code, interval: s.interval, expiresIn: s.expires_in, sleep: async (ms) => { t += ms }, now: () => t })
    check('poll returns the token once approved', r.ok && r.token === 'tok' && polls === 3)
  }

  // email-me-a-link = the device flow with email
  {
    const { F, fetch, calls } = load((u) => u.endsWith('/auth/device/code') ? { body: { device_code: 'D', user_code: 'WXYZ-2345' } } : null)
    await F.startDeviceFlow({ fetch, identityUrl: 'https://idp.aitherium.com', email: ' me@example.com ' })
    check('email option sends the address to /auth/device/code', JSON.parse(calls[0].opts.body).email === 'me@example.com')
  }

  // expiry, denial, cancel, unreachable
  {
    const exp = load((u) => u.endsWith('/auth/device/token') ? { status: 400, body: { detail: 'expired_token' } } : null)
    let t = 0
    const r = await exp.F.pollDeviceFlow({ fetch: exp.fetch, identityUrl: 'x', deviceCode: 'd', interval: 5, expiresIn: 900, sleep: async (ms) => { t += ms }, now: () => t })
    check('expired code => kind expired', !r.ok && r.kind === 'expired')

    const pending = load(() => ({ body: { status: 'authorization_pending' } }))
    let t2 = 0
    const r2 = await pending.F.pollDeviceFlow({ fetch: pending.fetch, identityUrl: 'x', deviceCode: 'd', interval: 5, expiresIn: 900, timeoutMs: 60_000, sleep: async (ms) => { t2 += ms }, now: () => t2 })
    check('poll honours its timeout', !r2.ok && r2.kind === 'expired' && t2 >= 60_000 && t2 < 70_000)

    let cancelled = false
    let t3 = 0
    const r3 = await pending.F.pollDeviceFlow({ fetch: pending.fetch, identityUrl: 'x', deviceCode: 'd', interval: 5, expiresIn: 900, sleep: async (ms) => { t3 += ms; cancelled = true }, now: () => t3, isCancelled: () => cancelled })
    check('cancel stops the poll', !r3.ok && r3.kind === 'cancelled')

    const down = load(() => ({ status: 503, body: {} }))
    let t4 = 0
    const r4 = await down.F.pollDeviceFlow({ fetch: down.fetch, identityUrl: 'x', deviceCode: 'd', interval: 5, expiresIn: 30, sleep: async (ms) => { t4 += ms }, now: () => t4 })
    check('poll against a 503 IdP => unreachable', !r4.ok && r4.kind === 'unreachable')
  }

  // unreachable wording on start + methods
  {
    const dead = load(() => new Error('Failed to fetch'))
    const s = await dead.F.startDeviceFlow({ fetch: dead.fetch, identityUrl: 'https://idp.aitherium.com' })
    check('network failure => unreachable (maintenance or offline)', !s.ok && s.kind === 'unreachable' && /maintenance or offline/.test(s.message))
    const five = load(() => ({ status: 503, body: {} }))
    const s2 = await five.F.startDeviceFlow({ fetch: five.fetch, identityUrl: 'https://idp.aitherium.com' })
    check('503 => unreachable', !s2.ok && s2.kind === 'unreachable')
    const m = await five.F.authMethods({ fetch: five.fetch, identityUrl: 'x' })
    check('methods on a 503 => not reachable', m.reachable === false)
    check('401 is refused, not unreachable', five.F.classifyFailure({ status: 401 }).kind === 'refused')
  }

  // magic_link flag hides the email option
  {
    const off = load((u) => u.endsWith('/auth/methods') ? { body: { magic_link: false } } : null)
    const m = await off.F.authMethods({ fetch: off.fetch, identityUrl: 'x' })
    check('magic_link:false reported', m.reachable === true && m.magic_link === false)
  }

  // local identity: a name only, null on the daemon's origin refusal
  {
    const refused = load(() => ({ status: 403, body: { detail: 'origin not allowed for identity handoff' } }))
    check('whoami 403 => null (no guess)', (await refused.F.localIdentity({ fetch: refused.fetch, adkUrl: 'http://127.0.0.1:9001' })) === null)
    const ok = load(() => ({ body: { logged_in: true, username: 'david', display_name: 'David' } }))
    const who = await ok.F.localIdentity({ fetch: ok.fetch, adkUrl: 'http://127.0.0.1:9001' })
    check('whoami logged_in => display name', who && who.display_name === 'David')
  }

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1) }
  console.log('\nonboard-flow: all checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
