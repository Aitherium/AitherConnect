/**
 * The signed-in plane: which workspace, which cloud credential, which agents,
 * and what the badge should honestly say.
 *
 * Everything here is pure or takes its fetch/storage as an argument, so the
 * service worker, the side panel, the onboarding page and the Node tests all
 * run the same code.
 *
 *   auth record   chrome.storage.local.aither_auth (shared/auth-store.js when
 *                 loaded; read directly otherwise): {user_bearer, expires_at,
 *                 gateway_key?, user:{username, display_name}}
 *   workspaces    GET  {api}/api/me/workspaces        Bearer user_bearer
 *   link bundle   GET  {api}/v1/link/bundle           (shared/link-bundle.js)
 *   agents        GET  {api}/api/workspaces/{id}/agents, else bundle.agents
 *   cloud chat    POST {gateway}/v1/chat/completions  X-Workspace-Id header
 *
 * A provider key for "bring your own key" is NEVER held here: it is written to
 * the workspace's secrets through the web app and only its name comes back.
 * Tokens are never logged.
 */
(function (global) {
  const API_BASE = "https://api.aitherium.com";
  const GATEWAY_BASE = "https://gateway.aitherium.com";
  const WEB_APP = "https://aitherium.com/workspace";
  const AUTH_KEY = "aither_auth";
  const WS_KEY = "aither_workspace";
  const BUNDLE_TTL_MS = 15 * 60 * 1000;

  function defaultStorage() {
    const c = global.chrome;
    return c && c.storage && c.storage.local ? c.storage.local : null;
  }

  function timeout(ms) {
    return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  }

  /** The sign-in record, expiry-aware. Prefers shared/auth-store.js when loaded. */
  async function readAuth(storage) {
    if (!storage && global.AitherAuthStore && global.AitherAuthStore.get) {
      try { return await global.AitherAuthStore.get(); } catch { return null; }
    }
    const s = storage || defaultStorage();
    if (!s) return null;
    const got = await s.get(AUTH_KEY);
    const rec = got && got[AUTH_KEY];
    if (!rec || typeof rec !== "object") return null;
    if (rec.user_bearer && rec.expires_at && Date.now() >= rec.expires_at) {
      return { ...rec, user_bearer: null, expired: true };
    }
    return rec;
  }

  /**
   * The credential the cloud tier uses. A gateway key when the sign-in minted
   * one, else the user's own bearer, else a legacy hand-pasted key. The kind is
   * returned so the caller can say where it came from without printing it.
   */
  function cloudCredential(auth, settings) {
    if (auth && auth.gateway_key) return { token: auth.gateway_key, kind: "gateway_key" };
    if (auth && auth.user_bearer) return { token: auth.user_bearer, kind: "user_bearer" };
    const legacy = settings && (settings.cloudApiKey || "");
    if (legacy) return { token: legacy, kind: "settings" };
    return { token: null, kind: null };
  }

  function _list(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.workspaces)) return payload.workspaces;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return null;
  }

  function wsId(w) {
    return (w && (w.id || w.workspace_id || w.slug)) || "";
  }

  function wsName(w) {
    return (w && (w.name || w.display_name || w.slug || w.id)) || "";
  }

  /** GET /api/me/workspaces. {ok, status, workspaces} — never throws. */
  async function fetchWorkspaces({ bearer, fetchImpl, api = API_BASE, timeoutMs = 8000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    if (!bearer) return { ok: false, status: 0, error: "not signed in", workspaces: [] };
    let resp;
    try {
      resp = await doFetch(`${api.replace(/\/+$/, "")}/api/me/workspaces`, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        signal: timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, status: 0, error: `unreachable: ${(e && e.message) || e}`, workspaces: [] };
    }
    if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}`, workspaces: [] };
    let body;
    try { body = await resp.json(); } catch { return { ok: false, status: resp.status, error: "not JSON", workspaces: [] }; }
    const list = _list(body);
    if (!list) return { ok: false, status: resp.status, error: "not a workspace list", workspaces: [] };
    return { ok: true, status: resp.status, workspaces: list.filter((w) => wsId(w)) };
  }

  /**
   * One workspace is auto-selected. Several: the persisted choice if it is still
   * in the list, else a picker (a default-flagged one is pre-highlighted, never
   * silently chosen). None: nothing to select.
   */
  function chooseWorkspace(list, persistedId) {
    const ws = Array.isArray(list) ? list.filter((w) => wsId(w)) : [];
    if (!ws.length) return { mode: "none", selected: null, options: [] };
    if (ws.length === 1) return { mode: "auto", selected: ws[0], options: ws };
    const kept = persistedId && ws.find((w) => wsId(w) === persistedId);
    if (kept) return { mode: "kept", selected: kept, options: ws };
    const suggested = ws.find((w) => w.is_default || w.default || w.primary) || null;
    return { mode: "picker", selected: null, suggested, options: ws };
  }

  /**
   * What the side-panel badge says. Every non-happy state names its reason;
   * "no workspace" with no reason is the bug this replaces.
   */
  function badge({ auth, workspaces, selected } = {}) {
    const user = auth && auth.user && (auth.user.display_name || auth.user.username);
    if (!auth || (!auth.user_bearer && !auth.gateway_key)) {
      return {
        state: auth && auth.expired ? "expired" : "signed-out",
        text: auth && auth.expired ? "sign in again" : "not signed in",
        href: null,
      };
    }
    if (workspaces && !workspaces.ok) {
      const st = workspaces.status;
      if (st === 401 || st === 403) return { state: "rejected", text: "sign in again", href: null };
      return { state: "unreachable", text: st ? `cloud unreachable (${st})` : "cloud unreachable", href: null };
    }
    const list = (workspaces && workspaces.workspaces) || [];
    if (!list.length) return { state: "no-workspace", text: "no workspaces — create one", href: WEB_APP };
    if (!selected) return { state: "pick", text: `${user || "you"} · pick a workspace`, href: null };
    return { state: "ok", text: `${user || "you"} · ${wsName(selected)}`, href: null };
  }

  /** Bundle is fresh when it carries fetchedAt within the TTL. */
  function bundleFresh(bundle, now = Date.now(), ttlMs = BUNDLE_TTL_MS) {
    return Boolean(bundle && bundle.fetchedAt && now - bundle.fetchedAt < ttlMs);
  }

  /**
   * The cached bundle when fresh; otherwise refresh it from the cloud API with
   * the user's bearer. A failed refresh keeps the last good bundle.
   */
  async function ensureBundle({ linkBundle, bearer, api = API_BASE, fetchImpl, storage, now = Date.now(), ttlMs = BUNDLE_TTL_MS } = {}) {
    const lb = linkBundle || global.AitherLinkBundle;
    if (!lb) return { ok: false, error: "link bundle module not loaded", bundle: null };
    const cached = await lb.current({ storage });
    if (bundleFresh(cached, now, ttlMs)) return { ok: true, bundle: cached, cached: true };
    if (!bearer) return { ok: Boolean(cached), bundle: cached, error: cached ? undefined : "not signed in" };
    const r = await lb.refresh({ base: api, bearer, fetchImpl, storage });
    if (r.ok) return { ok: true, bundle: r.bundle, cached: false };
    return { ok: Boolean(cached), bundle: cached, error: r.error, status: r.status };
  }

  /**
   * Capabilities, sync routes and the owner-only loopback map, from the bundle.
   * Fleet presets are only a fallback for a browser that was never linked.
   */
  function fromBundle(bundle, fallbackCaps) {
    if (!bundle) return { capabilities: fallbackCaps || null, syncRoutes: null, loopback: null, source: "defaults" };
    const caps = bundle.capabilities && typeof bundle.capabilities === "object" ? bundle.capabilities : fallbackCaps || null;
    const owner = bundle.role === "owner";
    return {
      capabilities: caps,
      syncRoutes: bundle.sync || bundle.sync_routes || null,
      // The loopback endpoint map is the platform owner's and nobody else's.
      loopback: owner ? (bundle.endpoints && bundle.endpoints.loopback) || bundle.loopback || null : null,
      source: "bundle",
    };
  }

  function _agentList(payload) {
    const l = Array.isArray(payload) ? payload : payload && (payload.agents || payload.items || payload.data);
    return Array.isArray(l) ? l : [];
  }

  function normalizeAgent(a, source) {
    const id = (a && (a.id || a.agent_id || a.name)) || "";
    return id ? { id: String(id), name: String(a.display_name || a.name || id), source } : null;
  }

  /** Managed agents for the picker: workspace API first, bundle second. */
  async function listCloudAgents({ bearer, workspaceId, bundle, fetchImpl, api = API_BASE, timeoutMs = 8000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    if (bearer && workspaceId) {
      try {
        const resp = await doFetch(`${api.replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(workspaceId)}/agents`, {
          headers: { Authorization: `Bearer ${bearer}`, "X-Workspace-ID": workspaceId, Accept: "application/json" },
          signal: timeout(timeoutMs),
        });
        if (resp.ok) {
          const list = _agentList(await resp.json()).map((a) => normalizeAgent(a, "workspace")).filter(Boolean);
          if (list.length) return list;
        }
      } catch { /* fall through to the bundle */ }
    }
    return _agentList(bundle && (bundle.agents || bundle.managed_agents)).map((a) => normalizeAgent(a, "bundle")).filter(Boolean);
  }

  /** Local-agent tier: GET {adk}/agents. */
  async function listLocalAgents({ adkBase, fetchImpl, timeoutMs = 3000 } = {}) {
    const doFetch = fetchImpl || global.fetch;
    if (!adkBase) return [];
    try {
      const resp = await doFetch(`${adkBase.replace(/\/+$/, "")}/agents`, { signal: timeout(timeoutMs) });
      if (!resp.ok) return [];
      return _agentList(await resp.json()).map((a) => normalizeAgent(typeof a === "string" ? { id: a } : a, "local")).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** The cloud chat request. The credential goes in the header, never the URL. */
  function cloudChatRequest({ credential, workspaceId, messages, model, gateway = GATEWAY_BASE }) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${credential}` };
    if (workspaceId) headers["X-Workspace-ID"] = workspaceId;
    return {
      url: `${gateway.replace(/\/+$/, "")}/v1/chat/completions`,
      init: { method: "POST", headers, body: JSON.stringify({ model: model || "aither-orchestrator", messages, stream: false }) },
    };
  }

  /** Local agent chat request: POST {adk}/chat. */
  function localChatRequest({ adkBase, agent, message }) {
    return {
      url: `${adkBase.replace(/\/+$/, "")}/chat`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agent ? { message, agent } : { message }),
      },
    };
  }

  /** The text of a reply from either an OpenAI-shaped or an adk-shaped body. */
  function replyText(body) {
    if (!body || typeof body !== "object") return "";
    const c = body.choices && body.choices[0];
    if (c && c.message && typeof c.message.content === "string") return c.message.content;
    for (const k of ["response", "reply", "content", "text", "message"]) {
      if (typeof body[k] === "string") return body[k];
    }
    return "";
  }

  /**
   * The backends the first-run wizard offers: ONLY what was detected, plus
   * the ones that need nothing local (cloud, workspace key) when signed in.
   * A missing awnode is offered as an instruction, never as a choice.
   */
  function wizardBackends({ adk, awnode, signedIn, workspaceId } = {}) {
    const out = [];
    if (adk) out.push({ id: "local-agent", tier: "local-agent", label: "Local agent (awdk)", ready: true });
    if (awnode) out.push({ id: "local-model", tier: "node", label: "Local model via awnode", ready: true });
    else out.push({ id: "local-model", tier: "node", label: "Local model via awnode", ready: false, hint: "awnode serve" });
    if (signedIn && workspaceId) {
      out.push({ id: "workspace-key", tier: "cloud", label: "Workspace key (your provider key, kept in the workspace)", ready: true,
        href: `${WEB_APP}/secrets` });
    }
    if (signedIn) out.push({ id: "cloud", tier: "cloud", label: "Aitherium cloud", ready: true });
    return out;
  }

  /** Map a wizard backend id onto the existing SETTINGS.preferredTier values. */
  function preferredTierFor(backendId) {
    return { "local-agent": "local-agent", "local-model": "node", "workspace-key": "cloud", cloud: "cloud" }[backendId] || "auto";
  }

  async function persistWorkspace(ws, storage) {
    const s = storage || defaultStorage();
    if (!s) return null;
    const rec = ws ? { id: wsId(ws), name: wsName(ws), at: Date.now() } : null;
    if (rec) await s.set({ [WS_KEY]: rec });
    else await s.remove(WS_KEY);
    return rec;
  }

  async function persistedWorkspace(storage) {
    const s = storage || defaultStorage();
    if (!s) return null;
    const got = await s.get(WS_KEY);
    return (got && got[WS_KEY]) || null;
  }

  global.AitherWorkspacePlane = {
    API_BASE, GATEWAY_BASE, WEB_APP, BUNDLE_TTL_MS,
    readAuth, cloudCredential, fetchWorkspaces, chooseWorkspace, badge,
    bundleFresh, ensureBundle, fromBundle, listCloudAgents, listLocalAgents,
    cloudChatRequest, localChatRequest, replyText, wizardBackends, preferredTierFor,
    persistWorkspace, persistedWorkspace, wsId, wsName,
  };
})(typeof self !== "undefined" ? self : globalThis);
