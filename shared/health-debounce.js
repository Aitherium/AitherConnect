/**
 * Health-status debounce for Awconnect service probes.
 *
 * A single failed probe through the flaky Veil bridge used to flip a service
 * to "down" instantly, so the status panel flapped LyraWiki/Genesis UP→DOWN→UP
 * every poll and the event log spammed a line each cycle. This pure state
 * machine holds a service at its prior status until it MISSES `strikes` polls
 * in a row; any real response (200 or even an error status) clears the streak.
 *
 * Kept dependency-free and side-effect-free so it can be unit-tested and shared
 * by both the service worker (importScripts) and the sidepanel (classic script).
 */

/**
 * @param {{status?: string, fails?: number}} prev  prior state for this service
 * @param {"up"|"error"|"down"} observed             this poll's raw observation
 * @param {number} [strikes=2]                        consecutive misses before DOWN
 * @returns {{state: {status: string, fails: number}, changed: boolean, effective: string}}
 *   state     — the new persisted state to store
 *   changed   — true when the EFFECTIVE status changed (use to log an event)
 *   effective — the status to display right now (prior status while debouncing)
 */
function applyHealthDebounce(prev, observed, strikes = 2) {
  const p = prev || { status: "unknown", fails: 0 };
  const prior = p.status || "unknown";

  if (observed === "up" || observed === "error") {
    // Any real response clears the failure streak immediately.
    const effective = observed;
    return {
      state: { status: effective, fails: 0 },
      changed: prior !== effective,
      effective,
    };
  }

  // A miss — only declare DOWN after `strikes` consecutive misses.
  const fails = (p.fails || 0) + 1;
  if (fails >= strikes) {
    return {
      state: { status: "down", fails },
      changed: prior !== "down",
      effective: "down",
    };
  }
  // Not enough strikes yet — hold the prior status, do not flap.
  return {
    state: { status: prior, fails },
    changed: false,
    effective: prior,
  };
}

// Export for both runtimes: service worker (self) and Node test harness (module).
if (typeof self !== "undefined") {
  self.AitherHealthDebounce = { applyHealthDebounce };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { applyHealthDebounce };
}
