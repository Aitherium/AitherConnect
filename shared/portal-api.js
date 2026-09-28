/**
 * Portal API helpers — shared by the onboarding wizard and background worker.
 *
 * All calls go to api.aitherium.com (portal.aitherium.com is retired), or the
 * url override persisted in chrome.storage.local.aither_portal.
 *
 * Storage layout:
 *   chrome.storage.local.aither_auth     → the ONE sign-in record (shared/auth-store.js);
 *                                          the portal bearer is its user_bearer
 *   chrome.storage.local.aither_portal   → { url, scope, agent_id, api_key }
 *
 * Sign-in is `adk login` on this machine (picked up with no typing) or the
 * device flow in onboarding; there is no email+password form here.
 */

const PORTAL_DEFAULT_URL = "https://api.aitherium.com";

function _authStore() {
  return (typeof self !== "undefined" && self.AitherAuthStore) || null;
}

async function getPortalUrl() {
  const { aither_portal } = await chrome.storage.local.get("aither_portal");
  return (aither_portal && aither_portal.url) || PORTAL_DEFAULT_URL;
}

async function getPortalBearer() {
  const AS = _authStore();
  return AS ? AS.getUserBearer() : null;
}

async function setPortalBearer(token) {
  const AS = _authStore();
  if (AS) await AS.setUserBearer(token || null);
}

async function getPortalRecord() {
  const { aither_portal } = await chrome.storage.local.get("aither_portal");
  return aither_portal || { url: PORTAL_DEFAULT_URL };
}

async function setPortalRecord(patch) {
  const current = await getPortalRecord();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ aither_portal: next });
  return next;
}

async function clearPortalRecord() {
  await chrome.storage.local.remove("aither_portal");
  await setPortalBearer(null);
}

async function portalFetch(path, init = {}) {
  const url = (await getPortalUrl()).replace(/\/+$/, "") + path;
  const bearer = await getPortalBearer();
  const headers = new Headers(init.headers || {});
  if (bearer && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, payload };
}

async function portalMe() {
  const r = await portalFetch("/auth/me");
  if (!r.ok) return { ok: false, status: r.status, error: r.payload?.error };
  return { ok: true, user: r.payload };
}

async function portalLogout() {
  await clearPortalRecord();
  return { ok: true };
}

/**
 * Fetch the authenticated user's workspaces.
 * Returns a list of workspace objects: { id, name, avatar?, description? }
 */
async function fetchWorkspaceMetadata() {
  const r = await portalFetch("/api/me/workspaces");
  if (!r.ok) {
    return { ok: false, error: (r.payload && r.payload.error) || `fetch workspaces failed (${r.status})` };
  }
  return { ok: true, workspaces: r.payload?.workspaces || [] };
}

/**
 * Mint a relay WebSocket token from the Relay service.
 * Called before connecting to the relay WS; the token is passed as ?token=<jwt>
 * @param {string} relayBaseUrl - Relay HTTP base URL (e.g. http://localhost:3000/api/bridge/relay)
 * @param {string} portalBearer - Portal auth token (from getPortalBearer)
 * @param {string?} workspace_id - Workspace scope for the connection
 * @param {string?} tenant_id - Tenant scope for the connection
 * @returns {Promise<{ok:boolean, relay_token?:string, nick?:string, expires_at?:number, error?:string}>}
 */
async function mintRelayToken(relayBaseUrl, portalBearer, workspace_id, tenant_id) {
  if (!portalBearer) {
    return { ok: false, error: "not authenticated (no portal token)" };
  }
  try {
    const url = relayBaseUrl.replace(/\/+$/, "") + "/v1/auth/relay-token";
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${portalBearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: workspace_id || null,
        tenant_id: tenant_id || null,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await r.json().catch(() => null);
    if (!r.ok) {
      return { ok: false, error: (payload && payload.error) || `token mint failed (${r.status})` };
    }
    return {
      ok: true,
      relay_token: payload.relay_token,
      nick: payload.nick,
      expires_at: payload.expires_at,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Fetch the authenticated user's profile settings.
 * Returns preferences from the user's portal profile, or empty object if not authenticated.
 * @returns {Promise<{ok:boolean, preferences:object, reason?:string}>}
 */
async function getProfileSettings() {
  const bearer = await getPortalBearer();
  if (!bearer) {
    return { ok: false, preferences: {}, reason: "not-authenticated" };
  }
  const r = await portalFetch("/api/settings/preferences");
  if (!r.ok) {
    return { ok: false, preferences: {}, reason: r.payload?.error || `fetch failed (${r.status})` };
  }
  return { ok: true, preferences: r.payload?.preferences || {} };
}

/**
 * Update the authenticated user's profile settings (merge operation).
 * The portal server merges the provided patch with existing preferences.
 * API keys should NEVER be included in the patch (they stay local on the device).
 * @param {object} prefsPatch - Preferences patch to merge (e.g., {adk: {llm: {...}}})
 * @returns {Promise<{ok:boolean, preferences?:object, reason?:string}>}
 */
async function putProfileSettings(prefsPatch) {
  const bearer = await getPortalBearer();
  if (!bearer) {
    return { ok: false, reason: "not-authenticated" };
  }
  const r = await portalFetch("/api/settings/preferences", {
    method: "PUT",
    body: JSON.stringify({ preferences: prefsPatch }),
  });
  if (!r.ok) {
    return { ok: false, reason: r.payload?.error || `put failed (${r.status})` };
  }
  return { ok: true, preferences: r.payload?.preferences };
}

// Export to window for HTML pages, and as ES-module-style globals for the
// background service worker via importScripts.
self.AitherPortal = {
  PORTAL_DEFAULT_URL,
  getPortalUrl,
  getPortalBearer,
  setPortalBearer,
  getPortalRecord,
  setPortalRecord,
  clearPortalRecord,
  portalFetch,
  portalMe,
  portalLogout,
  fetchWorkspaceMetadata,
  mintRelayToken,
  getProfileSettings,
  putProfileSettings,
};
