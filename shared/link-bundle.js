/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * link-bundle.js — what this linked browser gets, by the ROLE Genesis verified.
 *
 * The extension had four sign-in paths and none of them knew who was signed
 * in: the platform owner and a stranger got the same extension. Genesis now
 * answers GET /v1/link/bundle with a bundle shaped by the caller's verified
 * role (routers/link_bundle.py): a regular user gets identity, their own
 * workspace, relay nick and sync routes; the platform owner additionally gets
 * the loopback endpoint map, vault routes and fleet control. The bundle never
 * carries a token or a secret value — only WHERE to fetch each thing with the
 * credential this extension already holds.
 *
 * This module fetches it with that credential, keeps the last good copy, and
 * answers "is this the owner?" for the UI. Rules:
 *   - never throws; a failure is { ok:false, status, error }, never a guess;
 *   - a failed refresh keeps the LAST GOOD bundle (a flaky network must not
 *     demote the owner to a stranger mid-session), but a 401/403 CLEARS it —
 *     the credential is no longer accepted, so neither is the old role;
 *   - "owner" is only ever read from a bundle the server returned.
 */

(function initLinkBundle(global) {
  "use strict";

  const STORAGE_KEY = "aither_link_bundle";
  const PATH = "/v1/link/bundle";

  function defaultStorage() {
    const area = global.chrome && global.chrome.storage && global.chrome.storage.local;
    if (!area) return null;
    return {
      get: async () => (await area.get(STORAGE_KEY))[STORAGE_KEY] || null,
      set: async (value) => area.set({ [STORAGE_KEY]: value }),
      clear: async () => area.remove(STORAGE_KEY),
    };
  }

  function isBundle(b) {
    return Boolean(b && typeof b === "object" && (b.role === "owner" || b.role === "user") && b.identity);
  }

  /**
   * GET <base>/v1/link/bundle with the given bearer.
   * @returns {Promise<{ok:true, bundle:object}|{ok:false, status:number, error:string}>}
   */
  async function refresh({ base, bearer, fetchImpl, storage, timeoutMs = 5000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    const store = storage === undefined ? defaultStorage() : storage;
    if (!base) return { ok: false, status: 0, error: "no Genesis endpoint to ask" };
    if (!bearer) return { ok: false, status: 0, error: "not signed in" };
    let resp;
    try {
      resp = await doFetch(String(base).replace(/\/+$/, "") + PATH, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, error: `unreachable: ${(e && e.message) || e}` };
    }
    if (resp.status === 401 || resp.status === 403) {
      if (store) await store.clear();
      return { ok: false, status: resp.status, error: "credential not accepted" };
    }
    if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
    let bundle;
    try {
      bundle = await resp.json();
    } catch {
      return { ok: false, status: resp.status, error: "not JSON" };
    }
    if (!isBundle(bundle)) return { ok: false, status: resp.status, error: "not a link bundle" };
    if (store) await store.set({ ...bundle, fetchedAt: Date.now() });
    return { ok: true, bundle };
  }

  /** The last good bundle, or null when this browser was never linked. */
  async function current({ storage } = {}) {
    const store = storage === undefined ? defaultStorage() : storage;
    if (!store) return null;
    const b = await store.get();
    return isBundle(b) ? b : null;
  }

  /** True only for a bundle the server marked owner. */
  function isOwner(bundle) {
    return isBundle(bundle) && bundle.role === "owner";
  }

  // ── One way to link: the aitherium.com device grant (RFC 8628) ──────────────
  // Veil's /api/auth/device/{code,token} front Identity, so the token it hands
  // back is an Identity credential Genesis accepts -- which the cloud-gateway
  // device flow's key is not. The user approves the code while signed in on
  // aitherium.com; this browser never sees a password.

  async function postJson(doFetch, url, body, timeoutMs) {
    const resp = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    let data = {};
    try {
      data = await resp.json();
    } catch {
      data = {};
    }
    return { resp, data };
  }

  // Identity itself answers the device grant (idp.aitherium.com, measured 200 --
  // but in 10.3 s on a loaded evening, so the budget is 25 s, not 10);
  // the portal's /api/auth/device/* is Veil in front of it and was down (502/503)
  // twice on the day this shipped. So ask Identity first and the portal only if
  // Identity cannot be reached -- and poll the SAME host that issued the code.
  const IDENTITY_DEFAULT = "https://idp.aitherium.com";

  function hostsFor({ identity, portal }) {
    const hosts = [];
    const idp = String(identity || IDENTITY_DEFAULT).replace(/\/+$/, "");
    hosts.push({ base: idp, code: "/auth/device/code", token: "/auth/device/token" });
    if (portal) {
      const pb = String(portal).replace(/\/+$/, "");
      hosts.push({ base: pb, code: "/api/auth/device/code", token: "/api/auth/device/token" });
    }
    return hosts;
  }

  /** Ask aitherium.com for a device code. The caller opens `approveUrl`. */
  async function startLink({ identity, portal, fetchImpl, timeoutMs = 25000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    let lastError = "no Identity or portal to ask";
    for (const h of hostsFor({ identity, portal })) {
      try {
        const { resp, data } = await postJson(doFetch, h.base + h.code, { client_name: "awconnect" }, timeoutMs);
        if (!resp.ok || typeof data.device_code !== "string") {
          lastError = data.detail || data.error || `device code: HTTP ${resp.status}`;
          continue;
        }
        return {
          ok: true,
          deviceCode: data.device_code,
          userCode: data.user_code || "",
          approveUrl: data.verification_uri_complete || data.verification_uri || "",
          interval: Number(data.interval) || 5,
          expiresIn: Number(data.expires_in) || 900,
          // The poll must go where the code came from.
          tokenUrl: h.base + h.token,
        };
      } catch (e) {
        lastError = `unreachable: ${(e && e.message) || e}`;
      }
    }
    return { ok: false, error: lastError };
  }

  /**
   * One poll. {ok:true, status:"complete", token} once approved;
   * {ok:true, status:"authorization_pending"|"slow_down", interval} while waiting;
   * {ok:false, status, error} when denied / expired / broken.
   */
  async function pollLink({ tokenUrl, portal, deviceCode, fetchImpl, timeoutMs = 25000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    const url = tokenUrl || (portal ? String(portal).replace(/\/+$/, "") + "/api/auth/device/token" : "");
    if (!url || !deviceCode) return { ok: false, status: "invalid", error: "missing token URL or device code" };
    try {
      const { resp, data } = await postJson(doFetch, url, { device_code: deviceCode }, timeoutMs);
      if (typeof data.access_token === "string" && data.access_token) {
        return { ok: true, status: "complete", token: data.access_token };
      }
      // Identity says it in `detail` (400); the portal in `status` (200).
      const said = data.status || data.detail || data.error || "";
      if (said === "authorization_pending" || said === "slow_down" || said === "pending") {
        return { ok: true, status: said === "pending" ? "authorization_pending" : said, interval: Number(data.interval) || 5 };
      }
      const why = said || `HTTP ${resp.status}`;
      return { ok: false, status: /denied/.test(why) ? "denied" : /expired/.test(why) ? "expired" : "error", error: why };
    } catch (e) {
      // A dropped poll is not a verdict: the caller keeps polling until the deadline.
      return { ok: true, status: "authorization_pending", interval: 5, transient: `${(e && e.message) || e}` };
    }
  }

  global.AitherLinkBundle = { refresh, current, isOwner, startLink, pollLink, STORAGE_KEY, PATH };
})(typeof globalThis !== "undefined" ? globalThis : self);
