/**
 * Where the local surfaces actually are this boot — asked, not assumed.
 *
 * Every local port in this extension was a HARDCODED CONSTANT:
 * `harness-auth.js` pinned `http://127.0.0.1:8362`, `genesis-auth.js` pinned
 * `localhost:8001`. That works right up until the port moves, and the port
 * does move.
 *
 * Measured 2026-09-05: awdesk could not bind its default 47831 because Windows
 * had it inside the reserved TCP exclusion range 47736-47835 — one of 107 such
 * ranges on that host. Hyper-V/WSL claims those blocks and they MOVE across
 * reboots; the same binary bound the same port successfully earlier the same
 * day. The `aitheros` launcher therefore PICKS a port that is neither reserved
 * nor busy, and publishes what it chose.
 *
 * An extension cannot read `~/.aither/connect.json`, so the launcher also
 * serves the same map at `GET /connect.json` on its own port (:8899). This
 * module asks it, and falls back to the historical constants when the launcher
 * is not running — a stranger with no launcher must keep working exactly as
 * before.
 *
 * PORTED 2026-09-06 from the twin module written into AitherConnect/ (the
 * non-shipping tree) with the fallbacks corrected to the measured values:
 *   adk    8001 -> 9001   8001 was the retired genesis LB host port, which the
 *                         dispatch ladder records as always-refusing; the adk
 *                         daemon's DEFAULT_PORT is 9001.
 *   awdesk 47831 -> 47931 the module's own header proves 47831 sits in the
 *                         Windows reserved range; the S2 rename moved the
 *                         bridge to 47931.
 * The shipping tree (awconnect/) is where this file must live: the sync lane
 * publishes awconnect/* and nothing ships from AitherConnect/.
 *
 * A failed probe returns the FALLBACK, never an empty map. Returning nothing
 * would silently disable every local feature and look identical to "the user
 * has no local surfaces", which is the failure class this whole lane exists
 * to end.
 */

(function initLocalEndpoints(global) {
  "use strict";

  // Literal v4, never the name "localhost": measured on this fleet,
  // `::1` refuses after 2120 ms while `127.0.0.1` connects in 3 ms, so a
  // client that walks to the next address pays a 2 s tax per connection and
  // one that does not simply fails.
  const LOOPBACK = "127.0.0.1";

  /** The launcher's own port. The one constant that has to stay one. */
  const LAUNCHER_PORT = 8899;

  /** What this extension believed before it could ask. Kept EXACTLY as the
   *  historical values so behaviour without a launcher is unchanged — except
   *  where the historical value is provably dead (see header). */
  const FALLBACK = Object.freeze({
    launcher: "http://" + LOOPBACK + ":" + LAUNCHER_PORT,
    awsh: "http://" + LOOPBACK + ":8362",
    // awnode is the MCP gateway (services.yaml: AitherMCPGateway). Rung 1 of
    // the dispatch ladder resolves here, so an extension that cannot find it
    // has no platform tools and no way to notice.
    awnode: "http://" + LOOPBACK + ":8182",
    adk: "http://" + LOOPBACK + ":9001",
    awdesk: "http://" + LOOPBACK + ":47931",
  });

  const TTL_MS = 30_000;
  let cache = null;
  let cachedAt = 0;

  /**
   * The endpoint map. Never throws, never returns empty.
   *
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<{endpoints: Object, source: "launcher"|"fallback"}>}
   */
  async function localEndpoints(opts) {
    const force = !!(opts && opts.force);
    if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;

    let result = { endpoints: Object.assign({}, FALLBACK), source: "fallback" };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      try {
        const res = await fetch(
          "http://" + LOOPBACK + ":" + LAUNCHER_PORT + "/connect.json",
          { signal: controller.signal, cache: "no-store" },
        );
        if (res.ok) {
          const body = await res.json();
          if (body && body.endpoints && typeof body.endpoints === "object") {
            // MERGED over the fallback, not substituted for it. The launcher
            // omits a surface it did not start, and an omission must not
            // delete a port that a separately-started surface is using.
            result = {
              endpoints: Object.assign({}, FALLBACK, body.endpoints),
              source: "launcher",
            };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // No launcher, or it is not up yet. That is an ordinary state, not an
      // error: the fallback below is what this extension has always used.
      void err;
    }
    cache = result;
    cachedAt = Date.now();
    return result;
  }

  /** One endpoint by name, with the fallback already applied. */
  async function endpointFor(name) {
    const map = await localEndpoints();
    return map.endpoints[name] || FALLBACK[name] || null;
  }

  global.AitherLocalEndpoints = {
    localEndpoints,
    endpointFor,
    FALLBACK,
    LOOPBACK,
    LAUNCHER_PORT,
    /** Testing seam: drop the cache so the next call re-probes. */
    _reset() {
      cache = null;
      cachedAt = 0;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
