/**
 * Onboarding logic that must be testable without a browser: local detection,
 * the passwordless sign-in (Identity device flow, with an optional emailed
 * one-tap link), and the difference between "wrong password" and "Aitherium is
 * not answering".
 *
 * WHY (owner, 2026-09-27, on the old wizard): "sign in to aitherium portal
 * doesn't even work... neither does connect to my aitheros fleet... why can't I
 * just do email / magic link + device flow auth? shouldn't the first step be to
 * download/install awdk+awsh?" Measured that day:
 *   - portal.aitherium.com/auth/* answered 503 (the portal is retiring), so the
 *     email+password form could only fail -- and said "Network error" for it;
 *   - the "fleet" probe dialled 127.0.0.1:8090, where nothing listens; the adk
 *     daemon is on :9001, the awsh harness daemon on :8362, the MCP gateway on
 *     :8182 (shared/local-endpoints.js already knew all three);
 *   - idp.aitherium.com/auth/device/code answered 200 -- the same endpoints
 *     `adk login` uses (awdk adk/cli.py _device_flow_login). No new backend.
 *
 * Every function takes `fetch` so tests drive it with a stub.
 */
(function initOnboardFlow(global) {
  "use strict";

  const IDP_DEFAULT = "https://idp.aitherium.com";
  const CLIENT_NAME = "awconnect";
  const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

  /** The one-line installers (awdk README "no-Python one-liner"; both scripts also
   *  install the `aither` shell, npm @aitherium/awsh). */
  const INSTALL = Object.freeze({
    windows: 'powershell -ExecutionPolicy ByPass -c "irm https://aitherium.com/install.ps1 | iex"',
    unix: "curl -fsSL https://aitherium.com/install.sh | sh",
  });

  const UNREACHABLE_MESSAGE =
    "Aitherium isn't answering right now (maintenance or offline). " +
    "Try again in a few minutes, or keep going with AitherOS on this computer or your own API key.";

  /** Same mapping as awdk `_resolve_identity_url`: the device-flow API lives on
   *  Identity (idp.*), not the portal frontend, for the aitherium.com topology;
   *  a localhost / sovereign URL is used as-is. */
  function identityUrlFor(url) {
    const raw = String(url || "").trim();
    if (!raw) return IDP_DEFAULT;
    let host = "";
    try { host = new URL(raw).hostname.toLowerCase(); } catch (_) { return IDP_DEFAULT; }
    if (host === "aitherium.com" || host.endsWith(".aitherium.com")) return IDP_DEFAULT;
    return raw.replace(/\/+$/, "");
  }

  function platformOf(nav) {
    const n = nav || (typeof navigator !== "undefined" ? navigator : {});
    const p = String((n.userAgentData && n.userAgentData.platform) || n.platform || n.userAgent || "");
    if (/win/i.test(p)) return "windows";
    if (/mac|darwin/i.test(p)) return "mac";
    return "linux";
  }

  function installCommand(platform) {
    return platform === "windows" ? INSTALL.windows : INSTALL.unix;
  }

  /**
   * Classify a failed call. `unreachable` = network error, timeout or a transient
   * 5xx (the portal/fleet is down or in maintenance) -- the UI says so plainly
   * instead of "Network error: Failed to fetch".
   */
  function classifyFailure({ status, error } = {}) {
    if (error || !status || TRANSIENT.has(Number(status))) {
      return { kind: "unreachable", message: UNREACHABLE_MESSAGE };
    }
    if (status === 401 || status === 403) return { kind: "refused", message: "Sign-in was refused." };
    return { kind: "error", message: `Unexpected answer from Aitherium (HTTP ${status}).` };
  }

  async function fetchJson(fetchImpl, url, init, timeoutMs) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 10000) : null;
    try {
      const res = await fetchImpl(url, Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {}));
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      return { ok: !!res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: null, error: String((err && err.message) || err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Is AitherOS on this computer? Probes the adk daemon, the awsh harness daemon
   * and the MCP gateway (endpoints from AitherLocalEndpoints, merged with the
   * launcher's map when it runs). `found` is true when any of them answers.
   */
  async function probeLocal({ fetch: fetchImpl, endpoints }) {
    const eps = endpoints || {};
    const targets = [
      ["adk", eps.adk || "http://127.0.0.1:9001"],
      ["awsh", eps.awsh || "http://127.0.0.1:8362"],
      ["mcpgateway", eps.mcpgateway || "http://127.0.0.1:8182"],
      ["awnode", eps.awnode || "http://127.0.0.1:8090"],
    ];
    const out = { found: false };
    await Promise.all(targets.map(async ([name, base]) => {
      const r = await fetchJson(fetchImpl, String(base).replace(/\/+$/, "") + "/health", { method: "GET" }, 2500);
      out[name] = { url: base, ok: r.ok, status: r.status };
      if (r.ok) out.found = true;
    }));
    return out;
  }

  /**
   * Who the local adk node is signed in as -- a NAME, never a credential
   * (awdk server.py GET /identity/whoami). Today the daemon allows only
   * *.aitherium.com page origins, so from the extension this answers 403 and we
   * return null; adopting the node's identity needs a daemon-side change
   * (recorded as a handoff), not a guess here.
   */
  async function localIdentity({ fetch: fetchImpl, adkUrl }) {
    const r = await fetchJson(fetchImpl, String(adkUrl || "http://127.0.0.1:9001").replace(/\/+$/, "") + "/identity/whoami",
      { method: "GET" }, 2500);
    if (!r.ok || !r.body || !r.body.logged_in) return null;
    return { username: r.body.username || "", display_name: r.body.display_name || r.body.username || "" };
  }

  /** Identity's advertised methods; `magic_link` false hides the email option. */
  async function authMethods({ fetch: fetchImpl, identityUrl }) {
    const r = await fetchJson(fetchImpl, identityUrl + "/auth/methods", { method: "GET" }, 8000);
    if (!r.ok || !r.body) return { reachable: r.ok || (r.status > 0 && !TRANSIENT.has(r.status)), magic_link: null };
    return { reachable: true, magic_link: r.body.magic_link !== false };
  }

  /**
   * Start the RFC 8628 device flow. With `email`, Identity also mails that
   * account a one-tap approve link (DeviceCodeRequest.email) -- the passwordless
   * "email me a link" path, finishing in THIS extension rather than a web tab.
   */
  async function startDeviceFlow({ fetch: fetchImpl, identityUrl, email }) {
    const payload = { client_name: CLIENT_NAME, scopes: "full" };
    if (email) payload.email = String(email).trim();
    const r = await fetchJson(fetchImpl, identityUrl + "/auth/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }, 15000);
    if (!r.ok || !r.body || !r.body.device_code || !r.body.user_code) {
      return Object.assign({ ok: false }, classifyFailure(r));
    }
    const b = r.body;
    return {
      ok: true,
      device_code: b.device_code,
      user_code: b.user_code,
      verification_uri: b.verification_uri || "",
      verification_uri_complete: b.verification_uri_complete || b.verification_uri || "",
      interval: Math.max(2, Number(b.interval) || 5),
      expires_in: Number(b.expires_in) || 900,
    };
  }

  /**
   * Poll until approved, expired, refused, cancelled or `timeoutMs`. Transient
   * failures keep polling (a cold IdP must not end the sign-in); only a run of
   * them past the deadline reports `unreachable`.
   */
  async function pollDeviceFlow({
    fetch: fetchImpl, identityUrl, deviceCode, interval, expiresIn, timeoutMs,
    sleep, now, isCancelled,
  }) {
    const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const clock = now || (() => Date.now());
    const cancelled = isCancelled || (() => false);
    const limit = Math.min((Number(expiresIn) || 900) * 1000, timeoutMs || Infinity);
    const deadline = clock() + limit;
    let lastFailure = null;
    while (clock() < deadline) {
      await wait((Number(interval) || 5) * 1000);
      if (cancelled()) return { ok: false, kind: "cancelled", message: "Sign-in cancelled." };
      const r = await fetchJson(fetchImpl, identityUrl + "/auth/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      }, 10000);
      if (r.ok && r.body && r.body.access_token) {
        return { ok: true, token: r.body.access_token, response: r.body };
      }
      if (r.ok) { lastFailure = null; continue; } // authorization_pending
      const detail = r.body && r.body.detail;
      if (r.status === 400 && (detail === "expired_token" || detail === "invalid_device_code")) {
        return { ok: false, kind: "expired", message: "The sign-in code expired. Start again." };
      }
      if (r.status === 400 && detail === "access_denied") {
        return { ok: false, kind: "denied", message: "Sign-in was declined." };
      }
      if (r.status === 403) return { ok: false, kind: "denied", message: "This account can't sign in yet (pending approval)." };
      lastFailure = classifyFailure(r);
    }
    if (lastFailure && lastFailure.kind === "unreachable") return Object.assign({ ok: false }, lastFailure);
    return { ok: false, kind: "expired", message: "Timed out waiting for approval. Start again." };
  }

  /** The signed-in user from Identity (/auth/me), or a classified failure. */
  async function identityMe({ fetch: fetchImpl, identityUrl, token }) {
    const r = await fetchJson(fetchImpl, identityUrl + "/auth/me", {
      method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    }, 10000);
    if (r.ok && r.body) return { ok: true, user: r.body.user || r.body };
    return Object.assign({ ok: false }, classifyFailure(r));
  }

  global.AitherOnboardFlow = {
    IDP_DEFAULT, CLIENT_NAME, INSTALL, UNREACHABLE_MESSAGE,
    identityUrlFor, platformOf, installCommand, classifyFailure,
    probeLocal, localIdentity, authMethods, startDeviceFlow, pollDeviceFlow, identityMe,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
