/**
 * Genesis API Client — Decision Cards via Portal Bearer Auth
 * ===========================================================
 *
 * Authenticates to Genesis decision-card endpoints using the portal
 * session bearer token (from chrome.storage.session.aither_portal_bearer).
 *
 * Makes authenticated calls to http://localhost:8001/api/v1/decisions/*
 * (or via Veil bridge at http://localhost:3000/api/bridge/genesis/api/v1/decisions/*).
 *
 * Contract: Genesis decision-card router is the hub. Never cache credentials
 * or let credential VALUES cross the wire—only SECRET NAMES and descriptions.
 *
 * Used by popup.js (renderDecisions) and background.js (message handlers).
 */

(() => {
  "use strict";

  // ────────────────────────────────────────────────────────────────
  // Config: Genesis URLs
  // ────────────────────────────────────────────────────────────────

  // Try direct Genesis first (fastest); fall back to Veil bridge.
  // Both can be used; the direct path is preferred if available.
  const GENESIS_DIRECT_URL = "http://localhost:8001";
  const GENESIS_BRIDGE_URL = "http://localhost:3000/api/bridge/genesis";

  // Cache which URL is reachable to avoid repeated health checks
  let genesisUrl = null;
  let genesisHealthChecked = false;

  /**
   * Determine which Genesis base URL to use.
   * Tries direct Genesis first; falls back to bridge.
   * Returns null if neither is reachable.
   */
  async function detectGenesisUrl() {
    if (genesisHealthChecked && genesisUrl !== null) return genesisUrl;

    // Try direct Genesis /health
    try {
      const resp = await fetch(`${GENESIS_DIRECT_URL}/health`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok || resp.status === 204) {
        genesisHealthChecked = true;
        genesisUrl = GENESIS_DIRECT_URL;
        console.debug("[genesis-auth] using direct Genesis at", genesisUrl);
        return genesisUrl;
      }
    } catch (e) {
      console.debug("[genesis-auth] direct Genesis unreachable:", e.message);
    }

    // Try Veil bridge /health (path is /api/bridge/genesis/health)
    try {
      const resp = await fetch(`${GENESIS_BRIDGE_URL}/health`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok || resp.status === 204) {
        genesisHealthChecked = true;
        genesisUrl = GENESIS_BRIDGE_URL;
        console.debug("[genesis-auth] using Genesis via Veil bridge at", genesisUrl);
        return genesisUrl;
      }
    } catch (e) {
      console.debug("[genesis-auth] Veil bridge unreachable:", e.message);
    }

    genesisHealthChecked = true;
    genesisUrl = null;
    console.warn("[genesis-auth] no Genesis URL reachable (direct or bridge)");
    return null;
  }

  /**
   * Read the portal bearer token from chrome.storage.session.
   * Returns null if no token is stored.
   */
  async function getPortalBearer() {
    try {
      if (!chrome.storage.session) return null;
      const { aither_portal_bearer } = await chrome.storage.session.get("aither_portal_bearer");
      return aither_portal_bearer || null;
    } catch (e) {
      console.debug("[genesis-auth] could not read portal bearer:", e);
      return null;
    }
  }

  /**
   * Make an authenticated fetch call to Genesis decision-card API.
   * Automatically attaches the Bearer token if available.
   *
   * @param {string} path - API path (e.g. '/api/v1/decisions', '/api/v1/decisions/count')
   * @param {object} options - fetch options (method, body, etc.)
   * @returns {Promise<Response>} - the response object
   */
  async function genesisFetch(path, options = {}) {
    const baseUrl = await detectGenesisUrl();
    if (!baseUrl) {
      const error = new Error("Genesis endpoints unavailable — decisions service unreachable");
      error.code = "GENESIS_UNAVAILABLE";
      throw error;
    }

    const url = new URL(path, baseUrl);
    const bearer = await getPortalBearer();

    const finalOptions = { ...options };
    if (!finalOptions.headers) finalOptions.headers = {};

    if (bearer) {
      finalOptions.headers["Authorization"] = `Bearer ${bearer}`;
    } else {
      console.warn("[genesis-auth] no portal bearer token — Genesis may reject this call");
    }

    // Ensure Content-Type for JSON posts
    if (finalOptions.method?.toUpperCase() === "POST" && !finalOptions.headers["Content-Type"]) {
      finalOptions.headers["Content-Type"] = "application/json";
    }

    try {
      const resp = await fetch(url.toString(), finalOptions);
      return resp;
    } catch (e) {
      console.error(`[genesis-auth] fetch ${path} failed:`, e);
      throw e;
    }
  }

  /**
   * Convenient wrapper for GET /api/v1/decisions?status=open|closed&limit=N
   */
  async function listDecisions(status = "open", limit = 50) {
    const params = new URLSearchParams();
    if (status && status !== "all") params.append("status", status);
    if (limit) params.append("limit", limit);

    const path = `/api/v1/decisions${params.toString() ? "?" + params.toString() : ""}`;
    const resp = await genesisFetch(path);

    if (!resp.ok) {
      if (resp.status === 404) {
        const error = new Error("Decisions endpoint not found — Genesis may still be starting");
        error.code = "ENDPOINT_NOT_FOUND";
        throw error;
      }
      console.error(`[genesis-auth] listDecisions failed: HTTP ${resp.status}`);
      const errorText = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${errorText.slice(0, 100)}`);
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for GET /api/v1/decisions/count
   */
  async function getDecisionCount() {
    const resp = await genesisFetch("/api/v1/decisions/count");

    if (!resp.ok) {
      if (resp.status === 404) {
        const error = new Error("Decisions endpoint not found — Genesis may still be starting");
        error.code = "ENDPOINT_NOT_FOUND";
        throw error;
      }
      console.error(`[genesis-auth] getDecisionCount failed: HTTP ${resp.status}`);
      throw new Error(`HTTP ${resp.status}`);
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for GET /api/v1/decisions/{id}
   */
  async function getDecision(cardId) {
    const resp = await genesisFetch(`/api/v1/decisions/${encodeURIComponent(cardId)}`);

    if (!resp.ok) {
      if (resp.status === 404) return null;
      console.error(`[genesis-auth] getDecision ${cardId} failed: HTTP ${resp.status}`);
      throw new Error(`HTTP ${resp.status}`);
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for POST /api/v1/decisions/{id}/answer
   * Submits a choice to a decision card.
   *
   * @param {string} cardId - decision card ID
   * @param {string} choice - the chosen option key
   * @param {string} note - optional user note
   * @param {string} via - "awconnect" or other source tag
   */
  async function answerDecision(cardId, choice, note = "", via = "awconnect") {
    const resp = await genesisFetch(`/api/v1/decisions/${encodeURIComponent(cardId)}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, note, via }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[genesis-auth] answerDecision failed: HTTP ${resp.status}`, text);
      if (resp.status === 404) {
        const error = new Error("Decisions endpoint not found — Genesis may still be starting");
        error.code = "ENDPOINT_NOT_FOUND";
        throw error;
      }
      if (resp.status === 409) {
        return { status: "already_answered", error: "Card was already answered" };
      }
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for POST /api/v1/decisions/{id}/steer
   * Allows the user to provide additional steering text without closing the card.
   *
   * @param {string} cardId - decision card ID
   * @param {string} text - steering input from user
   */
  async function steerDecision(cardId, text = "") {
    const resp = await genesisFetch(`/api/v1/decisions/${encodeURIComponent(cardId)}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) {
      const text_err = await resp.text().catch(() => "");
      console.error(`[genesis-auth] steerDecision failed: HTTP ${resp.status}`, text_err);
      if (resp.status === 404) {
        const error = new Error("Decisions endpoint not found — Genesis may still be starting");
        error.code = "ENDPOINT_NOT_FOUND";
        throw error;
      }
      throw new Error(`HTTP ${resp.status}: ${text_err.slice(0, 100)}`);
    }

    return await resp.json();
  }

  /**
   * Convenient wrapper for POST /api/v1/decisions/{id}/cancel
   * Cancels (closes without answering) a decision card.
   */
  async function cancelDecision(cardId, note = "") {
    const resp = await genesisFetch(`/api/v1/decisions/${encodeURIComponent(cardId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[genesis-auth] cancelDecision failed: HTTP ${resp.status}`, text);
      if (resp.status === 404) {
        const error = new Error("Decisions endpoint not found — Genesis may still be starting");
        error.code = "ENDPOINT_NOT_FOUND";
        throw error;
      }
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
    }

    return await resp.json();
  }

  /**
   * Reset the cached Genesis URL (for testing or manual reconnection).
   */
  function resetGenesisDetection() {
    genesisHealthChecked = false;
    genesisUrl = null;
  }

  // ────────────────────────────────────────────────────────────────
  // Export to global scope (for use by popup.js, background.js)
  // ────────────────────────────────────────────────────────────────

  self.GenesisAuth = {
    genesisFetch,
    listDecisions,
    getDecisionCount,
    getDecision,
    answerDecision,
    steerDecision,
    cancelDecision,
    getPortalBearer,
    resetGenesisDetection,
  };
})();
