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

  /** Ask aitherium.com for a device code. The caller opens `approveUrl`. */
  async function startLink({ portal, fetchImpl, timeoutMs = 10000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    if (!portal) return { ok: false, error: "no portal URL" };
    try {
      const base = String(portal).replace(/\/+$/, "");
      const { resp, data } = await postJson(doFetch, `${base}/api/auth/device/code`, { client_name: "awconnect" }, timeoutMs);
      if (!resp.ok || typeof data.device_code !== "string") {
        return { ok: false, error: data.error || `device code: HTTP ${resp.status}` };
      }
      return {
        ok: true,
        deviceCode: data.device_code,
        userCode: data.user_code || "",
        approveUrl: data.verification_uri_complete || data.verification_uri || "",
        interval: Number(data.interval) || 5,
        expiresIn: Number(data.expires_in) || 900,
      };
    } catch (e) {
      return { ok: false, error: `unreachable: ${(e && e.message) || e}` };
    }
  }

  /**
   * One poll. {ok:true, status:"complete", token} once approved;
   * {ok:true, status:"authorization_pending"|"slow_down", interval} while waiting;
   * {ok:false, status, error} when denied / expired / broken.
   */
  async function pollLink({ portal, deviceCode, fetchImpl, timeoutMs = 10000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    if (!portal || !deviceCode) return { ok: false, status: "invalid", error: "missing portal or device code" };
    try {
      const base = String(portal).replace(/\/+$/, "");
      const { resp, data } = await postJson(doFetch, `${base}/api/auth/device/token`, { device_code: deviceCode }, timeoutMs);
      if (typeof data.access_token === "string" && data.access_token) {
        return { ok: true, status: "complete", token: data.access_token };
      }
      if (resp.ok && (data.status === "authorization_pending" || data.status === "slow_down" || data.status === "pending")) {
        return { ok: true, status: data.status === "pending" ? "authorization_pending" : data.status, interval: Number(data.interval) || 5 };
      }
      const why = data.error || data.status || `HTTP ${resp.status}`;
      return { ok: false, status: /denied/.test(why) ? "denied" : /expired/.test(why) ? "expired" : "error", error: why };
    } catch (e) {
      // A dropped poll is not a verdict: the caller keeps polling until the deadline.
      return { ok: true, status: "authorization_pending", interval: 5, transient: `${(e && e.message) || e}` };
    }
  }

  global.AitherLinkBundle = { refresh, current, isOwner, startLink, pollLink, STORAGE_KEY, PATH };
})(typeof globalThis !== "undefined" ? globalThis : self);
