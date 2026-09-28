/**
 * Sign in with Aitherium, for a browser that has no local awdk.
 *
 * The authorization-code flow with PKCE (S256), run in Chrome's own auth
 * window through chrome.identity.launchWebAuthFlow. The extension is a PUBLIC
 * client ("aitheros-awconnect"): it holds no secret, so the code is only
 * redeemable with the verifier that never leaves this service worker, and the
 * IdP only returns codes to https://<this extension id>.chromiumapp.org/.
 *
 * The result lands in the same record the local awdk rung writes
 * (AitherAuthStore, source 'oidc'), so every caller that reads a user bearer
 * works the same way whichever rung signed the user in.
 *
 * Staying signed in: 5 minutes before the token expires, the flow runs again
 * with interactive:false and prompt=none. That succeeds silently while the
 * user still has an Aitherium session in the browser. When it fails the
 * record is marked expired and the UI shows "Sign in again". The refresh_token
 * grant is deliberately NOT used: the token endpoint does not accept it.
 *
 * Tokens are never logged.
 */
(function (root) {
  const CLIENT_ID = "aitheros-awconnect";
  const IDP_DEFAULT = "https://idp.aitherium.com/identity";
  const SCOPES = "openid profile email offline_access";
  const REAUTH_LEAD_MS = 5 * 60 * 1000;

  function b64url(bytes) {
    let s = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    const b64 = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function cryptoImpl(c) {
    const k = c || root.crypto;
    if (!k || !k.getRandomValues || !k.subtle) throw new Error("WebCrypto unavailable");
    return k;
  }

  function randomToken(nBytes, c) {
    const buf = new Uint8Array(nBytes);
    cryptoImpl(c).getRandomValues(buf);
    return b64url(buf);
  }

  /** RFC 7636: a 43-128 char verifier and its S256 challenge. */
  async function pkcePair(c) {
    const verifier = randomToken(48, c); // 64 chars
    const digest = await cryptoImpl(c).subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)), method: "S256" };
  }

  function buildAuthorizeUrl({ idpBase, clientId, redirectUri, state, nonce, challenge, prompt }) {
    if (!redirectUri || !state || !nonce || !challenge) throw new Error("authorize: missing parameter");
    const base = (idpBase || IDP_DEFAULT).replace(/\/+$/, "");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId || CLIENT_ID,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (prompt) q.set("prompt", prompt);
    return `${base}/oidc/authorize?${q.toString()}`;
  }

  /** The URL Chrome hands back. Returns the code; throws on error or state mismatch. */
  function parseRedirect(responseUrl, expectedState) {
    if (!responseUrl) throw new Error("sign-in window closed");
    const u = new URL(responseUrl);
    const p = u.searchParams;
    if (p.get("state") !== expectedState) {
      // Checked before the error branch too: an error that does not carry our
      // state was not an answer to our request.
      throw new Error("state mismatch: the sign-in response was not for this request");
    }
    if (p.get("error")) throw new Error(`sign-in refused: ${p.get("error")}`);
    const code = p.get("code");
    if (!code) throw new Error("sign-in returned no code");
    return code;
  }

  function decodeJwtClaims(jwt) {
    const parts = String(jwt || "").split(".");
    if (parts.length !== 3) throw new Error("id_token is not a JWT");
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const text = typeof atob === "function"
      ? decodeURIComponent(Array.from(atob(padded), (ch) => "%" + ch.charCodeAt(0).toString(16).padStart(2, "0")).join(""))
      : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(text);
  }

  /**
   * Validate a token-endpoint answer and shape the auth record. The id_token
   * came straight from the token endpoint over TLS (OIDC Core 3.1.3.7), so its
   * signature is not re-checked here; issuer, audience, nonce and expiry are.
   */
  function parseTokenResponse(body, { nonce, clientId, issuer, now }) {
    const t = now || Date.now();
    if (!body || typeof body !== "object") throw new Error("token response is not JSON");
    if (body.error) throw new Error(`token refused: ${body.error}`);
    if (!body.access_token) throw new Error("token response has no access_token");
    if (!body.id_token) throw new Error("token response has no id_token");
    const c = decodeJwtClaims(body.id_token);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(clientId || CLIENT_ID)) throw new Error("id_token audience is not this extension");
    if (issuer && c.iss !== issuer) throw new Error("id_token issuer mismatch");
    if (!nonce || c.nonce !== nonce) throw new Error("id_token nonce mismatch");
    if (c.exp && c.exp * 1000 < t) throw new Error("id_token already expired");
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 3600 * 1000;
    return {
      user_bearer: body.access_token,
      expires_at: t + ttl,
      source: "oidc",
      user: {
        id: String(c.sub || ""),
        username: c.preferred_username || c.email || "",
        display_name: c.name || c.preferred_username || "",
        tenant_slug: c.tenant_id || "",
      },
    };
  }

  async function exchangeCode({ idpBase, clientId, code, verifier, redirectUri, fetchImpl }) {
    const f = fetchImpl || root.fetch;
    const base = (idpBase || IDP_DEFAULT).replace(/\/+$/, "");
    const r = await f(`${base}/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId || CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`token exchange ${r.status}${body && body.detail ? `: ${body.detail}` : ""}`);
    return body;
  }

  function launch(identityApi, details) {
    return new Promise((resolve, reject) => {
      try {
        const ret = identityApi.launchWebAuthFlow(details, (url) => {
          const err = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
          if (err) reject(new Error(err.message || "sign-in window failed"));
          else resolve(url);
        });
        if (ret && typeof ret.then === "function") ret.then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Run the whole flow once. interactive:false is the silent re-auth.
   * Returns {ok:true, record} or {ok:false, error}. Never throws.
   */
  async function signIn(opts = {}) {
    const identityApi = opts.identityApi || (root.chrome && root.chrome.identity);
    const store = opts.authStore || root.AitherAuthStore;
    const idpBase = (opts.idpBase || IDP_DEFAULT).replace(/\/+$/, "");
    const clientId = opts.clientId || CLIENT_ID;
    const interactive = opts.interactive !== false;
    try {
      if (!identityApi || !identityApi.launchWebAuthFlow) throw new Error("chrome.identity is unavailable");
      const redirectUri = identityApi.getRedirectURL();
      const { verifier, challenge } = await pkcePair(opts.crypto);
      const state = randomToken(24, opts.crypto);
      const nonce = randomToken(24, opts.crypto);
      const url = buildAuthorizeUrl({
        idpBase, clientId, redirectUri, state, nonce, challenge,
        prompt: interactive ? undefined : "none",
      });
      const responseUrl = await launch(identityApi, { url, interactive });
      const code = parseRedirect(responseUrl, state);
      const body = await exchangeCode({ idpBase, clientId, code, verifier, redirectUri, fetchImpl: opts.fetchImpl });
      const rec = parseTokenResponse(body, { nonce, clientId, issuer: idpBase, now: opts.now && opts.now() });
      const prev = store ? await store.get(opts.storage).catch(() => null) : null;
      if (prev && prev.gateway_key) rec.gateway_key = prev.gateway_key;
      const saved = store ? await store.set(rec, opts.storage) : rec;
      return { ok: true, record: saved };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  /**
   * Keep an OIDC record fresh. Due = within REAUTH_LEAD_MS of expiry. A failed
   * silent attempt marks the record expired (bearer dropped, name kept) so the
   * UI asks the user to sign in again instead of failing calls quietly.
   */
  async function refreshIfDue(opts = {}) {
    const store = opts.authStore || root.AitherAuthStore;
    if (!store) return { ok: false, error: "no auth store" };
    const now = opts.now ? opts.now() : Date.now();
    const rec = await store.get(opts.storage);
    if (!rec || rec.source !== "oidc") return { ok: true, skipped: "not an oidc session" };
    if (rec.user_bearer && rec.expires_at && rec.expires_at - now > REAUTH_LEAD_MS) {
      return { ok: true, skipped: "not due" };
    }
    const r = await signIn({ ...opts, interactive: false });
    if (r.ok) return r;
    await store.set({ ...rec, user_bearer: null, expires_at: null, expired: true }, opts.storage);
    return { ok: false, expired: true, error: r.error };
  }

  root.AitherOIDC = {
    CLIENT_ID, IDP_DEFAULT, SCOPES, REAUTH_LEAD_MS,
    pkcePair, buildAuthorizeUrl, parseRedirect, decodeJwtClaims,
    parseTokenResponse, exchangeCode, signIn, refreshIfDue,
  };
})(typeof self !== "undefined" ? self : globalThis);
