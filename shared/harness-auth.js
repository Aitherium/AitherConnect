/**
 * Harness daemon (awsh, 127.0.0.1:8362): pairing + the decisions API.
 * ====================================================================
 *
 * The daemon's root bearer (~/.aither/harness_token) can spawn a coding agent
 * with filesystem access, so the extension never holds it. It PAIRS instead:
 *
 *   1. POST /pair/start -> {pair_id, code, expires_in}. The daemon accepts
 *      this only from the pinned awconnect origin on a loopback host, and
 *      raises an "Allow awconnect?" card carrying the code.
 *   2. The owner approves on the desk (the card, awdesk, or
 *      `adk harness pair approve <code>`).
 *   3. POST /pair/poll {pair_id} -> {status:"approved", token}, once.
 *
 * The token is scoped to decisions and to READING sessions and rooms; it cannot
 * drive a session. It lives in chrome.storage.local and is never logged. A
 * 401/403 drops it, and the next use pairs again.
 *
 * Every decisions surface (sidepanel, popup, background badge) goes through
 * this module. Genesis is not the decision store.
 */

(() => {
  "use strict";

  const TOKEN_KEY = "awconnect_harness_token";
  const DEFAULT_BASE = "http://127.0.0.1:8362";
  const POLL_MS = 2000;

  const deps = {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    storage: () => (typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null),
  };

  let cachedToken = null;
  let pairing = null; // the in-flight pairing promise, shared by every caller
  const listeners = new Set();
  let state = { phase: "unknown" };

  function setState(next) {
    // The badge poll asks every minute; an unchanged state is not news.
    if (next.phase === state.phase && next.code === state.code && next.error === state.error) return;
    state = next;
    for (const fn of listeners) {
      try { fn({ ...state }); } catch { /* a listener never breaks pairing */ }
    }
  }

  function onState(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  async function baseUrl() {
    const resolver = (typeof globalThis !== "undefined" && globalThis.AitherLocalEndpoints)
      || (typeof self !== "undefined" && self.AitherLocalEndpoints);
    if (!resolver) return DEFAULT_BASE;
    try {
      return (await resolver.endpointFor("awsh")) || DEFAULT_BASE;
    } catch {
      return DEFAULT_BASE;
    }
  }

  // Read from storage every time: the sidepanel, popup and service worker each
  // hold a copy of this module, and a token one of them re-paired must win.
  async function readToken() {
    const store = deps.storage();
    if (!store) return cachedToken;
    try {
      const got = await store.get(TOKEN_KEY);
      cachedToken = got?.[TOKEN_KEY] || null;
    } catch { /* keep the in-memory copy */ }
    return cachedToken;
  }

  async function saveToken(token) {
    cachedToken = token || null;
    const store = deps.storage();
    if (!store) return;
    try {
      if (token) await store.set({ [TOKEN_KEY]: token });
      else await store.remove(TOKEN_KEY);
    } catch { /* storage is best effort; the in-memory copy still works */ }
  }

  /** Drop the stored token. With ``failed``, only if it is still that token,
   *  so a stale context cannot erase a token another context just paired. */
  async function forget(failed) {
    if (failed && (await readToken()) !== failed) return;
    await saveToken(null);
    setState({ phase: "unpaired" });
  }

  async function isPaired() {
    return Boolean(await readToken());
  }

  async function postJson(path, body) {
    const url = new URL(path, await baseUrl()).toString();
    return deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  /**
   * Run the pairing flow once. Resolves {ok:true} when paired, or
   * {ok:false, phase, error}. Concurrent callers share one flow (one card).
   */
  function pair() {
    if (pairing) return pairing;
    pairing = (async () => {
      setState({ phase: "starting" });
      let started;
      try {
        const resp = await postJson("/pair/start", {});
        if (resp.status === 403) {
          const detail = await resp.text().catch(() => "");
          setState({ phase: "refused", error: "awsh refused to pair with this extension", detail });
          return { ok: false, phase: "refused" };
        }
        if (resp.status === 404) {
          setState({ phase: "unsupported", error: "awsh is too old to pair: update awdk" });
          return { ok: false, phase: "unsupported" };
        }
        if (!resp.ok) {
          setState({ phase: "error", error: `pair/start HTTP ${resp.status}` });
          return { ok: false, phase: "error" };
        }
        started = await resp.json();
      } catch (e) {
        setState({ phase: "offline", error: "awsh is not running on this machine" });
        return { ok: false, phase: "offline" };
      }
      const deadline = Date.now() + (Number(started.expires_in) || 120) * 1000;
      setState({ phase: "awaiting", code: started.code, expiresIn: started.expires_in });
      while (Date.now() < deadline) {
        await deps.sleep(POLL_MS);
        let resp;
        try {
          resp = await postJson("/pair/poll", { pair_id: started.pair_id });
        } catch {
          continue; // a blip while the owner walks to the desk is not a failure
        }
        if (resp.status === 403) {
          setState({ phase: "denied", error: "pairing was denied on the desk" });
          return { ok: false, phase: "denied" };
        }
        if (resp.status === 410) break;
        if (!resp.ok) continue;
        const body = await resp.json().catch(() => ({}));
        if (body.status === "approved" && body.token) {
          await saveToken(body.token);
          setState({ phase: "paired" });
          return { ok: true, phase: "paired" };
        }
      }
      setState({ phase: "expired", error: "the code expired before it was approved" });
      return { ok: false, phase: "expired" };
    })().finally(() => { pairing = null; });
    return pairing;
  }

  /**
   * Authenticated call to the daemon. With no token it returns a synthetic 401
   * (no request is sent). A 401/403 from the daemon drops the stored token, so
   * the next pair() starts clean.
   */
  async function daemonFetch(path, options = {}) {
    const token = await readToken();
    if (!token) {
      setState({ phase: "unpaired" });
      return new Response(JSON.stringify({ detail: "not paired" }), { status: 401 });
    }
    const url = new URL(path, await baseUrl()).toString();
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    if ((options.method || "GET").toUpperCase() === "POST" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const resp = await deps.fetch(url, { ...options, headers });
    if (resp.status === 401 || resp.status === 403) {
      if (!/\/decisions\/[^/]+\/answer$/.test(path) || resp.status === 401) {
        await forget(token);
      }
    }
    return resp;
  }

  async function listDecisions(status = "open", sessionId = "") {
    const params = new URLSearchParams();
    if (status && status !== "all") params.append("status", status);
    if (sessionId) params.append("session_id", sessionId);
    const q = params.toString();
    const resp = await daemonFetch(`/decisions${q ? "?" + q : ""}`);
    if (!resp.ok) return null;
    const body = await resp.json();
    return Array.isArray(body) ? { decisions: body } : body;
  }

  async function getDecisionCounts() {
    const resp = await daemonFetch("/decisions/count");
    return resp.ok ? resp.json() : null;
  }

  async function getDecision(cardId) {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}`);
    return resp.ok ? resp.json() : null;
  }

  async function answerDecision(cardId, choice, note = "", via = "awconnect") {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}/answer`, {
      method: "POST",
      body: JSON.stringify({ choice, note, via }),
    });
    if (resp.ok) return resp.json();
    const text = await resp.text().catch(() => "");
    if (resp.status === 409) return { status: "already_answered", error: "Card was already answered" };
    return { status: "error", code: resp.status, error: text || `HTTP ${resp.status}` };
  }

  async function cancelDecision(cardId, note = "") {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    if (resp.ok) return resp.json();
    return { status: "error", code: resp.status, error: await resp.text().catch(() => "") };
  }

  /**
   * What the pairing UI shows for a state: {text, code?, action?, label?}.
   * action "pair" means render a button that starts (or retries) pairing.
   */
  function describeState(st) {
    const phase = st?.phase || "unknown";
    switch (phase) {
      case "starting":
        return { text: "Asking awsh to pair..." };
      case "awaiting":
        return {
          text: `Approve code ${st.code} on your desk: the "Allow awconnect?" card, or run adk harness pair approve ${st.code}`,
          code: st.code,
        };
      case "paired":
        return { text: "Paired with your desk." };
      case "unknown":
      case "unpaired":
        return { text: "awconnect is not paired with your desk yet.", action: "pair", label: "Pair with desk" };
      default:
        return { text: st.error || `Pairing failed (${phase}).`, action: "pair", label: "Try again" };
    }
  }

  /** Test seam: swap fetch/sleep/storage. Not used by the extension itself. */
  function _configure(overrides = {}) {
    Object.assign(deps, overrides);
    cachedToken = null;
    pairing = null;
    state = { phase: "unknown" };
  }

  self.HarnessAuth = {
    TOKEN_KEY,
    pair,
    isPaired,
    forget,
    onState,
    getState: () => ({ ...state }),
    describeState,
    daemonFetch,
    listDecisions,
    getDecisionCounts,
    getDecision,
    answerDecision,
    cancelDecision,
    _configure,
  };
})();
