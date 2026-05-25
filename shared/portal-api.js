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
    description: description || "Browser-based AitherConnect agent",
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
};
