/* shared/oidc-pkce.js: Sign in with Aitherium (PKCE via launchWebAuthFlow).
 * Run: node tests/oidc-pkce.test.mjs   (exit 1 on failure, 0 on pass)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function load () {
  const sandbox = { AbortSignal, console, Date, URL, URLSearchParams, TextEncoder, Buffer, btoa, atob,
    crypto: webcrypto, Uint8Array, Promise, Error, JSON, Array, String, Number }
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(read('shared/extension-id.js'), sandbox)
  vm.runInNewContext(read('shared/auth-store.js'), sandbox)
  vm.runInNewContext(read('shared/oidc-pkce.js'), sandbox)
  return sandbox
}

function memStorage () {
  const data = {}
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))) },
    remove: async (k) => { delete data[k] },
  }
}

const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (claims) => `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify(claims))}.sig`
const IDP = 'https://idp.aitherium.com/identity'
const REDIRECT = 'https://hlmfknhcfhjjngckfpacgleffckpmphe.chromiumapp.org/'

let failures = 0
async function check (name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failures += 1; console.log(`  FAIL ${name}: ${e.message}`) }
}

const S = load()
const O = S.AitherOIDC

/** A fake chrome.identity + IdP. `answer(authorizeUrl)` decides the redirect. */
function fakeIdp ({ answer, tokenStatus = 200, tokenBody }) {
  const seen = { authorize: null, token: null, interactive: null }
  const identityApi = {
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: (details, cb) => {
      seen.authorize = new URL(details.url)
      seen.interactive = details.interactive
      Promise.resolve().then(() => cb(answer(seen.authorize)))
    },
  }
  const fetchImpl = async (url, init) => {
    seen.token = { url, body: new URLSearchParams(init.body), headers: init.headers }
    const q = seen.authorize.searchParams
    const body = tokenBody ? tokenBody(q) : {
      access_token: 'AT', token_type: 'Bearer', expires_in: 3600,
      id_token: jwt({ iss: IDP, aud: 'aitheros-awconnect', sub: 'u1', nonce: q.get('nonce'),
        exp: Math.floor(Date.now() / 1000) + 3600, preferred_username: 'david', name: 'David', tenant_id: 't1' }),
    }
    return { ok: tokenStatus < 300, status: tokenStatus, json: async () => body }
  }
  return { seen, identityApi, fetchImpl }
}

const okAnswer = (u) => `${REDIRECT}?code=C0DE&state=${encodeURIComponent(u.searchParams.get('state'))}`

await check('authorize URL: public client, S256 challenge, chromiumapp redirect, all scopes', async () => {
  const { verifier, challenge, method } = await O.pkcePair()
  assert.equal(method, 'S256')
  assert.ok(verifier.length >= 43 && verifier.length <= 128, 'verifier length is RFC 7636')
  const expect = createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(challenge, expect, 'challenge = BASE64URL(SHA256(verifier))')
  const u = new URL(O.buildAuthorizeUrl({ redirectUri: REDIRECT, state: 's', nonce: 'n', challenge }))
  assert.equal(u.origin + u.pathname, `${IDP}/oidc/authorize`)
  const q = u.searchParams
  assert.equal(q.get('client_id'), 'aitheros-awconnect')
  assert.equal(q.get('response_type'), 'code')
  assert.equal(q.get('redirect_uri'), REDIRECT)
  assert.equal(q.get('code_challenge_method'), 'S256')
  assert.equal(q.get('code_challenge'), challenge)
  assert.equal(q.get('scope'), 'openid profile email offline_access')
  assert.equal(q.get('prompt'), null)
  assert.ok(!u.toString().includes(verifier), 'the verifier never leaves the worker')
  assert.throws(() => O.buildAuthorizeUrl({ redirectUri: REDIRECT, state: 's', nonce: 'n' }), /missing/)
})

await check('two sign-ins never share a verifier, state or nonce', async () => {
  const a = fakeIdp({ answer: okAnswer })
  const b = fakeIdp({ answer: okAnswer })
  await O.signIn({ identityApi: a.identityApi, fetchImpl: a.fetchImpl, storage: memStorage() })
  await O.signIn({ identityApi: b.identityApi, fetchImpl: b.fetchImpl, storage: memStorage() })
  for (const k of ['state', 'nonce', 'code_challenge']) {
    assert.notEqual(a.seen.authorize.searchParams.get(k), b.seen.authorize.searchParams.get(k), k)
  }
})

await check('state mismatch is rejected and nothing is stored or exchanged', async () => {
  const st = memStorage()
  const f = fakeIdp({ answer: () => `${REDIRECT}?code=C0DE&state=attacker` })
  const r = await O.signIn({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.ok, false)
  assert.match(r.error, /state mismatch/)
  assert.equal(f.seen.token, null, 'no code exchange on a foreign response')
  assert.deepEqual(st.data, {})
  assert.throws(() => O.parseRedirect(`${REDIRECT}?error=access_denied`, 'mine'), /state mismatch/)
  assert.throws(() => O.parseRedirect(`${REDIRECT}?error=login_required&state=mine`, 'mine'), /login_required/)
  assert.throws(() => O.parseRedirect(undefined, 'mine'), /closed/)
})

await check('code exchange: form POST, no secret, carries the verifier; record matches the awdk shape', async () => {
  const st = memStorage()
  const f = fakeIdp({ answer: okAnswer })
  const r = await O.signIn({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.ok, true, r.error)
  assert.equal(f.seen.interactive, true)
  assert.equal(f.seen.token.url, `${IDP}/oidc/token`)
  assert.equal(f.seen.token.headers['Content-Type'], 'application/x-www-form-urlencoded')
  const body = f.seen.token.body
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('client_id'), 'aitheros-awconnect')
  assert.equal(body.get('redirect_uri'), REDIRECT)
  assert.equal(body.get('client_secret'), null)
  const verifier = body.get('code_verifier')
  const ch = createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(ch, f.seen.authorize.searchParams.get('code_challenge'), 'verifier proves the challenge')
  const rec = await S.AitherAuthStore.get(st)
  assert.equal(rec.source, 'oidc')
  assert.equal(rec.user_bearer, 'AT')
  assert.equal(rec.user.username, 'david')
  assert.equal(rec.user.tenant_slug, 't1')
  assert.ok(rec.expires_at > Date.now() + 3500 * 1000)
  assert.equal(await S.AitherAuthStore.getUserBearer(st), 'AT')
})

await check('token-response parser refuses a wrong nonce, audience, issuer, or a missing token', async () => {
  const good = { iss: IDP, aud: 'aitheros-awconnect', sub: 'u', nonce: 'n', exp: Math.floor(Date.now() / 1000) + 60 }
  const ok = O.parseTokenResponse({ access_token: 'a', id_token: jwt(good), expires_in: 60 }, { nonce: 'n', issuer: IDP })
  assert.equal(ok.user_bearer, 'a')
  const bad = [
    [{ access_token: 'a', id_token: jwt({ ...good, nonce: 'x' }) }, /nonce/],
    [{ access_token: 'a', id_token: jwt({ ...good, aud: 'aitheros-veil' }) }, /audience/],
    [{ access_token: 'a', id_token: jwt({ ...good, iss: 'https://evil.example' }) }, /issuer/],
    [{ access_token: 'a', id_token: jwt({ ...good, exp: 1 }) }, /expired/],
    [{ id_token: jwt(good) }, /access_token/],
    [{ access_token: 'a' }, /id_token/],
    [{ error: 'invalid_grant' }, /invalid_grant/],
  ]
  for (const [body, re] of bad) {
    assert.throws(() => O.parseTokenResponse(body, { nonce: 'n', issuer: IDP }), re)
  }
})

await check('a refused exchange stores nothing', async () => {
  const st = memStorage()
  const f = fakeIdp({ answer: okAnswer, tokenStatus: 400, tokenBody: () => ({ detail: 'Invalid or expired authorization code' }) })
  const r = await O.signIn({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.ok, false)
  assert.match(r.error, /token exchange 400/)
  assert.deepEqual(st.data, {})
})

await check('re-auth runs silently (prompt=none) 5 minutes before expiry, and not earlier', async () => {
  const st = memStorage()
  const AS = S.AitherAuthStore
  await AS.set({ user_bearer: 'old', expires_at: Date.now() + 30 * 60 * 1000, source: 'oidc', user: { username: 'david' }, gateway_key: 'gk' }, st)
  const f = fakeIdp({ answer: okAnswer })
  let r = await O.refreshIfDue({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.skipped, 'not due')
  assert.equal(f.seen.authorize, null)
  await AS.set({ user_bearer: 'old', expires_at: Date.now() + 4 * 60 * 1000, source: 'oidc', user: { username: 'david' }, gateway_key: 'gk' }, st)
  r = await O.refreshIfDue({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.ok, true, r.error)
  assert.equal(f.seen.interactive, false)
  assert.equal(f.seen.authorize.searchParams.get('prompt'), 'none')
  const rec = await AS.get(st)
  assert.equal(rec.user_bearer, 'AT')
  assert.equal(rec.gateway_key, 'gk', 'the derived gateway key survives a re-auth')
})

await check('a failed silent re-auth marks the record expired and keeps the name', async () => {
  const st = memStorage()
  const AS = S.AitherAuthStore
  await AS.set({ user_bearer: 'old', expires_at: Date.now() + 60 * 1000, source: 'oidc', user: { username: 'david' } }, st)
  const f = fakeIdp({ answer: (u) => `${REDIRECT}?error=login_required&state=${u.searchParams.get('state')}` })
  const r = await O.refreshIfDue({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.ok, false)
  assert.equal(r.expired, true)
  const rec = await AS.get(st)
  assert.equal(rec.user_bearer, null)
  assert.equal(rec.expired, true)
  assert.equal(rec.user.username, 'david')
})

await check('an awdk-sourced record is never touched by the OIDC refresher', async () => {
  const st = memStorage()
  await S.AitherAuthStore.set({ user_bearer: 'b', expires_at: Date.now() + 1000, source: 'awdk', user: { username: 'd' } }, st)
  const f = fakeIdp({ answer: okAnswer })
  const r = await O.refreshIfDue({ identityApi: f.identityApi, fetchImpl: f.fetchImpl, storage: st })
  assert.equal(r.skipped, 'not an oidc session')
  assert.equal(f.seen.authorize, null)
})

await check('source never logs a token', async () => {
  const src = read('shared/oidc-pkce.js')
  assert.ok(!/console\.\w+\([^)]*(token|verifier|bearer)/i.test(src))
})

await check('wiring: both manifests declare identity + idp/api hosts; background loads oidc-pkce', async () => {
  for (const f of ['manifest.json', 'manifest.public.json']) {
    const m = JSON.parse(read(f))
    assert.ok(m.permissions.includes('identity'), `${f}: identity permission`)
    for (const h of ['https://idp.aitherium.com/*', 'https://api.aitherium.com/*']) {
      assert.ok(m.host_permissions.includes(h), `${f}: ${h}`)
    }
  }
  const bg = read('background.js')
  assert.match(bg, /"shared\/auth-store\.js",\s*"shared\/oidc-pkce\.js"/)
  assert.match(bg, /case "auth-oidc-sign-in"/)
})

await check('onboarding: Sign in with Aitherium is the button; the gateway device flow is Advanced', async () => {
  const html = read('onboard/onboard.html')
  const js = read('onboard/onboard.js')
  assert.match(html, /id="oidc-sign-in"[^>]*>\s*Sign in with Aitherium/)
  assert.match(html, /Advanced: API key/)
  assert.match(js, /auth-oidc-sign-in/)
  for (const retired of ['portal.aitherium.com', 'veil.aitherium.com']) {
    const live = js.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
    assert.ok(!live.includes(retired), `onboard.js names ${retired}`)
  }
})

if (failures) {
  console.log(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nall oidc-pkce checks passed')
