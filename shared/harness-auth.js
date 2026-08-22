/**
 * Harness Daemon Authentication & API Client
 * ==========================================
 *
 * Helpers to: read ~/.aither/harness_token on first connection,
 * and make authenticated calls to 127.0.0.1:8362/decisions*
 * (and other daemon APIs).
 *
 * Used by both background.js (daemon polling) and sidepanel.js
 * (decision card UI).
 */

(() => {
  "use strict";

  // ────────────────────────────────────────────────────────────────
  // State: cached token (read once, persisted per extension session)
  // ────────────────────────────────────────────────────────────────

  let cachedToken = null;
  let tokenReadAttempted = false;

  /**
   * Read ~/.aither/harness_token via native file system access.
   * Returns null if file cannot be read or is empty.
   *
   * Note: This requires the 'nativeMessaging' permission and a
   * native host app to read the filesystem. For browser-only
   * environments, this falls back to env var AITHER_HARNESS_TOKEN
   * (passed in settings).
   *
   * For now, we rely on the daemon being accessible via basic
   * Bearer auth, which the daemon itself mints from ~/.aither/harness_token.
   */
  async function readHarnessToken() {
    if (tokenReadAttempted) return cachedToken;
    tokenReadAttempted = true;

    // Try chrome.storage.local first — harness token may have been
    // provisioned by setup or background worker.
    try {
      const stored = await chrome.storage.local.get("aither_harness_token");
      if (stored?.aither_harness_token) {
        cachedToken = stored.aither_harness_token;
        return cachedToken;
      }
    } catch (e) {
      console.debug("[harness-auth] could not read from chrome.storage.local:", e);
    }

    // Fallback: ask background worker (it may have loaded settings with a token)
    if (typeof chrome !== "undefined" && chrome.runtime) {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "get-harness-token",
        });
        if (resp?.token) {
          cachedToken = resp.token;
          return cachedToken;
        }
      } catch (e) {
        console.debug("[harness-auth] background worker has no harness token:", e);
      }
    }

    console.debug("[harness-auth] no harness token found");
    return null;
  }

  /**
   * Make an authenticated fetch call to the daemon API.
   * Automatically attaches the Bearer token if available.
   *
   * @param {string} path - API path (e.g. '/decisions', '/decisions/count')
   * @param {object} options - fetch options (method, body, etc.)
   * @returns {Promise<Response>}
   */
  async function daemonFetch(path, options = {}) {
    const baseUrl = "http://127.0.0.1:8362";
    const url = new URL(path, baseUrl);
    const token = await readHarnessToken();

    const finalOptions = { ...options };
    if (!finalOptions.headers) finalOptions.headers = {};

    if (token) {
      finalOptions.headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn("[harness-auth] no bearer token — daemon may reject this call");
    }

    // Ensure Content-Type for JSON posts
    if (finalOptions.method?.toUpperCase() === "POST" && !finalOptions.headers["Content-Type"]) {
      finalOptions.headers["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(url.toString(), finalOptions);
      return resp;
    } catch (e) {
      console.error(`[harness-auth] fetch ${path} failed:`, e);
      throw e;
    }
  }

  /**
   * Convenient wrapper for GET /decisions?status=open|all
   */
  async function listDecisions(status = "open", sessionId = "") {
    const params = new URLSearchParams();
    if (status && status !== "all") params.append("status", status);
    if (sessionId) params.append("session_id", sessionId);

    const path = `/decisions${params.toString() ? "?" + params.toString() : ""}`;
    const resp = await daemonFetch(path);

    if (!resp.ok) {
      console.error(`[harness-auth] listDecisions failed: HTTP ${resp.status}`);
      return null;
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for GET /decisions/count
   */
  async function getDecisionCounts() {
    const resp = await daemonFetch("/decisions/count");

    if (!resp.ok) {
      console.error(`[harness-auth] getDecisionCounts failed: HTTP ${resp.status}`);
      return null;
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for GET /decisions/{card_id}
   */
  async function getDecision(cardId) {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}`);

    if (!resp.ok) {
      if (resp.status === 404) return null;
      console.error(`[harness-auth] getDecision ${cardId} failed: HTTP ${resp.status}`);
      return null;
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for POST /decisions/{card_id}/answer
   */
  async function answerDecision(cardId, choice, note = "", via = "extension") {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, note, via }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[harness-auth] answerDecision failed: HTTP ${resp.status}`, text);
      if (resp.status === 409) {
        // Already answered
        return { status: "already_answered", error: "Card was already answered" };
      }
      return { status: "error", error: text };
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for POST /decisions/{card_id}/cancel
   */
  async function cancelDecision(cardId, note = "") {
    const resp = await daemonFetch(`/decisions/${encodeURIComponent(cardId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[harness-auth] cancelDecision failed: HTTP ${resp.status}`, text);
      return { status: "error", error: text };
    }

    return await resp.json();
  }

  /**
   * Set the cached token (used by background worker to provision it).
   */
  function setCachedToken(token) {
    cachedToken = token;
    if (token) {
      // Also store in chrome.storage for persistence across extension reloads
      try {
        chrome.storage.local.set({ aither_harness_token: token }).catch(() => {});
      } catch (e) {
        console.debug("[harness-auth] could not persist token to storage:", e);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Export to global scope (for use by background.js, sidepanel.js)
  // ────────────────────────────────────────────────────────────────

  self.HarnessAuth = {
    readHarnessToken,
    daemonFetch,
    listDecisions,
    getDecisionCounts,
    getDecision,
    answerDecision,
    cancelDecision,
    setCachedToken,
  };
})();
