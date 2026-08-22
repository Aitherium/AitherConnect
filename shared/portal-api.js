/**
 * Portal API helpers — shared by the onboarding wizard and background worker.
 *
 * All calls go to portal.aitherium.com (or AITHER_PORTAL_URL override
 * persisted in chrome.storage.local).
 *
 * Storage layout:
 *   chrome.storage.session.aither_portal_bearer  → portal /auth bearer
 *   chrome.storage.local.aither_portal           → { url, scope, agent_id, api_key }
 */

const PORTAL_DEFAULT_URL = "https://portal.aitherium.com";

async function getPortalUrl() {
  const { aither_portal } = await chrome.storage.local.get("aither_portal");
  return (aither_portal && aither_portal.url) || PORTAL_DEFAULT_URL;
}

async function getPortalBearer() {
  if (!chrome.storage.session) return null;
  const { aither_portal_bearer } = await chrome.storage.session.get(
    "aither_portal_bearer",
  );
  return aither_portal_bearer || null;
}

async function setPortalBearer(token) {
  if (!chrome.storage.session) return;
  if (token) {
    await chrome.storage.session.set({ aither_portal_bearer: token });
  } else {
    await chrome.storage.session.remove("aither_portal_bearer");
  }
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

async function portalLogin({ email, password }) {
  const r = await portalFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    return { ok: false, error: (r.payload && r.payload.error) || `login failed (${r.status})` };
  }
  if (r.payload?.requires_2fa) {
    return { ok: false, requires_2fa: true, temp_token: r.payload.temp_token };
  }
  const token = r.payload?.access_token;
  if (!token) return { ok: false, error: "no access_token in response" };
  await setPortalBearer(token);
  await setPortalRecord({ url: await getPortalUrl(), authenticated_at: Date.now() });
  return { ok: true };
}

async function portalVerify2fa({ temp_token, code }) {
  const r = await portalFetch("/auth/verify-2fa", {
    method: "POST",
    body: JSON.stringify({ temp_token, code }),
  });
  if (!r.ok) {
    return { ok: false, error: (r.payload && r.payload.error) || `2fa failed (${r.status})` };
  }
  const token = r.payload?.access_token;
  if (!token) return { ok: false, error: "no access_token in 2fa response" };
  await setPortalBearer(token);
  return { ok: true };
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
 * One-shot quick onboard — provisions a scoped agent identity for this browser.
 * Returns the connection bundle (api_key, workspace endpoints, inference URLs).
 */
async function portalQuickOnboard({ agent_name, description }) {
  const params = new URLSearchParams({
    agent_name,
    description: description || "Browser-based Awconnect agent",
  });
  const r = await portalFetch(`/api/onboard/quick?${params.toString()}`, {
    method: "POST",
  });
  if (!r.ok) {
    return { ok: false, error: (r.payload && r.payload.error) || `onboard failed (${r.status})` };
  }
  const bundle = r.payload || {};
  await setPortalRecord({
    agent_id: bundle.agent_id,
    agent_name: bundle.agent_name || agent_name,
    api_key: bundle.api_key || null,
    scope: bundle.scope || null,
    bundle,
  });
  return { ok: true, bundle };
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
  portalLogin,
  portalVerify2fa,
  portalMe,
  portalLogout,
  portalQuickOnboard,
  fetchWorkspaceMetadata,
  mintRelayToken,
  getProfileSettings,
  putProfileSettings,
};
