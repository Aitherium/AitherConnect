/**
 * ArcContribute — opt-in bridge from the in-browser world model to the EXISTING
 * crowd-contribution surface (arc.aitherium.com/contribute).
 *
 * The gateway (/contribute/v1/observe) is Bearer-authed and the contributor
 * token is SERVER-HELD. This bridge never contains, mints, or touches a token:
 * it captures the player's raw (state, action, next_state) transitions and,
 * when the player opts in, POSTs them to a RELAY endpoint the server provides.
 * The relay (wm_relay.py) holds the token and submits each transition through
 * the existing WorldModelContributor.observe() — the same
 * quarantine/trust/rate-limit plane the fleet already rides (program ground
 * rule #1: no new trust decisions).
 *
 * Why raw transitions, not the journal: /v1/observe requires the actual grid
 * (64x64 ints in [0,15]) and a parseable non-RESET action; the journal stores
 * state HASHES. So contribution taps live moves — the raw triple is in hand at
 * play time — exactly like the shipped playground miniwm.js.
 *
 * Fail-soft by contract: a dead relay, a 4xx/5xx, or a network error never
 * breaks the game loop; the pending queue is RETAINED and the caller gets
 * {ok:false, error}. Opt-in is OFF by default, persisted via the host store.
 *
 * UMD: attaches self.ArcContribute in a browser, module.exports under node.
 * Store and fetch are injected (tests pass mocks) so the logic is node-testable.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ArcContribute = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const DEFAULT_OPT_KEY = "arc-contribute-opted-in";
  const MAX_PENDING = 500; // bounded queue — never unbounded memory in a tab

  /**
   * opts: {relayUrl, optKey, store, fetch, maxPending}
   *   relayUrl  — the SERVER boundary where the token lives (empty = offline).
   *   store     — {getItem, setItem} (window.localStorage in the tab).
   *   fetch     — fetchImpl(url, init) -> Promise<Response>.
   */
  function createContributeBridge(opts) {
    opts = opts || {};
    const relayUrl = opts.relayUrl || "";
    const optKey = opts.optKey || DEFAULT_OPT_KEY;
    const store = opts.store || (typeof localStorage !== "undefined" ? localStorage : null);
    const fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    const maxPending = opts.maxPending || MAX_PENDING;
    const fetchTimeoutMs = opts.fetchTimeoutMs || 15000; // a hung relay must not hang or lose the queue

    const pending = []; // {state, action, next_state, game?, ts}
    let optedIn = false;
    if (store) {
      try { optedIn = store.getItem(optKey) === "1"; } catch (e) { /* unreadable store */ }
    }

    /** Record a raw transition triple (always captured; flush gates on opt-in). */
    function capture(state, action, nextState, meta) {
      pending.push({
        state,
        action,
        next_state: nextState,
        game: meta && meta.game,
        ts: meta && meta.ts,
      });
      if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
    }

    function setOptIn(on) {
      optedIn = !!on;
      if (store) {
        try { store.setItem(optKey, optedIn ? "1" : "0"); } catch (e) { /* ignore */ }
      }
      return optedIn;
    }

    function isOptedIn() { return optedIn; }

    function queueLength() { return pending.length; }

    /**
     * Submit all pending transitions to the server relay. Fail-soft: any
     * failure retains the queue and returns {ok:false, error}. The response's
     * quarantine counts are surfaced verbatim (the gateway quarantines; a
     * validator promotes later).
     */
    async function flush() {
      if (!optedIn) return { ok: false, error: "not opted in" };
      if (!relayUrl) return { ok: false, error: "no relay configured (the server holds the token)" };
      if (pending.length === 0) return { ok: true, quarantined: 0, accepted: 0, rejected: 0 };
      if (!fetchImpl) return { ok: false, error: "no fetch available" };

      const batch = pending.splice(0, pending.length); // take; restore on failure
      let res;
      // Timeout guard: a relay that accepts but never responds would otherwise
      // hang flush() forever with the batch already spliced out — permanently
      // losing those transitions. Abort restores the queue.
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), fetchTimeoutMs) : null;
      try {
        res = await fetchImpl(relayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transitions: batch, client_ts: Date.now() }),
          signal: controller ? controller.signal : undefined,
        });
      } catch (e) {
        pending.unshift.apply(pending, batch); // network failure or timeout — retain for retry
        return { ok: false, error: "network: " + ((e && e.message) || e) };
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!res.ok) {
        pending.unshift.apply(pending, batch); // 4xx/5xx — retain
        return { ok: false, error: "relay " + res.status };
      }
      let data;
      try { data = await res.json(); } catch (e) { data = {}; }
      return {
        ok: true,
        quarantined: data.quarantined || 0,
        accepted: data.accepted || 0,
        rejected: data.rejected || 0,
        relay: data,
      };
    }

    return {
      capture,
      setOptIn,
      isOptedIn,
      queueLength,
      flush,
    };
  }

  return {
    createContributeBridge,
    DEFAULT_OPT_KEY,
    MAX_PENDING,
  };
});
