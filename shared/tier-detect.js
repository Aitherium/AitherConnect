/**
 * AitherConnect Tier Detection
 * ============================
 * Shared utility for detecting which connectivity tier is available.
 *
 * Tiers (in priority order):
 *   1. "genesis"   — Full AitherOS via Veil bridge proxy
 *   2. "node-only" — AitherNode standalone (HTTP, no TLS issues)
 *   3. "provider"  — BYOK: user-configured LLM provider (Anthropic/OpenAI/
 *                    OpenRouter/Ollama/Gemini), chat + local KB only
 *   4. "cloud-only"— Cloud gateway with API key
 *   5. "offline"   — Nothing reachable
 *
 * Each tier carries a `capabilities` object so UIs can hide fleet-only
 * surfaces (Themis/Shield, shell, relay, image gen, desktop launch) instead
 * of soft-failing on dead endpoints.
 */

const TierDetect = {
  /**
   * Loopback host for ALL local probes — literal v4, never the name "localhost".
   *
   * On this platform "localhost" resolves ::1 first, and the Docker port proxy
   * on ::1 does not answer: Chrome's Happy-Eyeballs sits on the dead v6 socket
   * before falling back to v4. Measured on the SAME healthy endpoint:
   * 127.0.0.1 = 26ms, localhost = 250ms via curl — and inside an extension
   * service worker the v6 stall regularly exceeds the 2s probe timeout.
   *
   * That lost race was the whole "AitherOS degraded (cloud-only)" flap: the
   * healthy Veil bridge timed out, detection fell through to genesis-direct or
   * cloud, and every bridged service went dark while the fleet was fine.
   * host_permissions already grants http://127.0.0.1/*.
   */
  LOOPBACK: "127.0.0.1",

  /** Feature availability per tier — UIs gate on these, never on tier names. */
  CAPABILITY_PRESETS: {
    genesis: {
      hasFleet: true, hasChat: true, hasLocalKb: true, hasThemis: true,
      hasShield: true, hasShell: true, hasRelay: true, hasImageGen: true,
      hasDesktopLaunch: true, hasA2A: true, hasMemoryRecall: true,
      hasFederatedSearch: true,
      hasHeadlessBrowser: true,
    },
    "node-only": {
      hasFleet: true, hasChat: true, hasLocalKb: true, hasThemis: false,
      hasShield: false, hasShell: false, hasRelay: false, hasImageGen: false,
      hasDesktopLaunch: false, hasA2A: true, hasMemoryRecall: false,
      hasFederatedSearch: false,
      hasHeadlessBrowser: true,
    },
    "cloud-only": {
      hasFleet: false, hasChat: true, hasLocalKb: true, hasThemis: false,
      hasShield: false, hasShell: false, hasRelay: false, hasImageGen: false,
      hasDesktopLaunch: false, hasA2A: true, hasMemoryRecall: false,
      hasFederatedSearch: false,
      hasHeadlessBrowser: false,
    },
    provider: {
      hasFleet: false, hasChat: true, hasLocalKb: true, hasThemis: false,
      hasShield: false, hasShell: false, hasRelay: false, hasImageGen: false,
      hasDesktopLaunch: false, hasA2A: false, hasMemoryRecall: false,
      hasFederatedSearch: false,
      hasHeadlessBrowser: false,
    },
    offline: {
      hasFleet: false, hasChat: false, hasLocalKb: true, hasThemis: false,
      hasShield: false, hasShell: false, hasRelay: false, hasImageGen: false,
      hasDesktopLaunch: false, hasA2A: false, hasMemoryRecall: false,
      hasFederatedSearch: false,
      hasHeadlessBrowser: false,
    },
  },

  /** Capabilities for a tier (offline preset for unknown tiers). */
  capabilitiesFor(tier) {
    return this.CAPABILITY_PRESETS[tier] || this.CAPABILITY_PRESETS.offline;
  },
  /**
   * Probe a URL for reachability (HTTP 2xx).
   * @param {string} url
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async probe(url, timeoutMs = 2000) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch {
      return false;
    }
  },

  /**
   * Rank of each tier, best first. Used to tell an UPGRADE from a DEMOTION.
   * Unknown tiers rank below offline so anything real beats them.
   */
  TIER_RANK: { genesis: 4, "node-only": 3, provider: 2, "cloud-only": 1, offline: 0, unknown: -1 },

  /** Consecutive demotion proposals required before a tier is actually lowered. */
  DEMOTE_STRIKES: 3,

  /**
   * Decide whether a newly-detected tier should be ADOPTED or held off.
   *
   * Upgrades apply instantly; demotions must be confirmed by consecutive
   * misses. A single timed-out probe used to demote genesis → cloud-only, and
   * because capability presets differ per tier the side panel then hid the
   * Shell/IRC/Images/Search/Notes tabs — mid-session, unmounting whatever panel
   * the user was reading. The probe was the flaky part; the fleet never moved.
   *
   * Pure and side-effect-free so it can be unit-tested; the service worker owns
   * the strike counter and just feeds it back in.
   *
   * @param {string} currentTier   tier currently in effect
   * @param {string} newTier       tier this poll proposes
   * @param {number} strikes       consecutive demotion proposals so far
   * @param {number} [required]    strikes needed to confirm a demotion
   * @returns {{adopt: boolean, strikes: number, reason: string}}
   */
  decideTierChange(currentTier, newTier, strikes = 0, required = this.DEMOTE_STRIKES) {
    const rank = (t) => (t in this.TIER_RANK ? this.TIER_RANK[t] : -1);
    if (newTier === currentTier) return { adopt: true, strikes: 0, reason: "unchanged" };
    if (rank(newTier) >= rank(currentTier)) {
      return { adopt: true, strikes: 0, reason: "upgrade" };
    }
    const next = strikes + 1;
    if (next < required) {
      return { adopt: false, strikes: next, reason: `holding (${next}/${required})` };
    }
    return { adopt: true, strikes: 0, reason: `demotion confirmed after ${next}` };
  },

  /**
   * Race candidates and resolve as soon as ONE probes healthy.
   *
   * `Promise.all` is not good enough here: it still waits out the slowest
   * candidate, so one stalled port re-imposes the very timeout the race was
   * meant to avoid. Policy is FIRST SUCCESS WINS — a candidate that answers
   * healthy soonest is by definition the one that will not stall the UI.
   * Returns null only once every candidate has failed.
   *
   * @param {Array<{url: string}>} candidates  probed concurrently
   * @param {number} timeoutMs                 per-probe timeout
   * @returns {Promise<object|null>} the winning candidate object, or null
   */
  async firstHealthy(candidates, timeoutMs = 2000) {
    if (!candidates || !candidates.length) return null;
    return new Promise((resolve) => {
      let pending = candidates.length;
      let settled = false;
      for (const c of candidates) {
        this.probe(c.url, timeoutMs).then((ok) => {
          if (ok && !settled) {
            settled = true;
            resolve(c);
          }
          if (--pending === 0 && !settled) resolve(null);
        });
      }
    });
  },

  /**
   * Auto-detect the best available connectivity tier.
   * @param {{ veilPort?: number, nodePort?: number }} ports
   * @param {string} cloudApiKey
   * @param {string} cloudGatewayUrl
   * @param {{ id?: string, apiKey?: string }|null} providerCfg  BYOK provider
   *        config from chrome.storage.local "aither-provider" (if configured)
   * @returns {Promise<{ tier: string, chatUrl: string|null, nodeUrl: string|null }>}
   */
  async detect(ports = {}, cloudApiKey = "", cloudGatewayUrl = "", providerCfg = null) {
    const veil = ports.veilPort || 3000;
    const node = ports.nodePort || 8090;
    const genesis = ports.genesisPort || 8001;
    const gateway = cloudGatewayUrl || "https://gateway.aitherium.com";
    const lo = this.LOOPBACK;

    // 1. Genesis via Veil bridge — full AitherOS. The deployed fleet maps
    //    aitheros-veil-lb to 3080; localhost:3000 is usually `npm run dev`
    //    with HMR, where every recompile RESETS in-flight SSE ("Stream
    //    interrupted: network error") and briefly 404s routes. So when the
    //    configured port is the DEFAULT (3000), prefer the stable LB first;
    //    an explicitly configured non-default port is respected first.
    //
    //    Candidates are raced CONCURRENTLY, not tried in sequence. Preference
    //    order alone is not safe: a preferred port that is merely *unhealthy*
    //    still accepts the TCP connection and then stalls, so the sequential
    //    loop paid its full timeout before ever trying the port that works.
    //    Measured on this fleet: :3080 (the "stable" LB) answered 502 after
    //    6s while :3080's alternative :3000 answered 200 in 30ms — so every
    //    detection cycle burned a 2s timeout, and under load that stall was
    //    itself enough to lose the race and demote the tier. Racing makes a
    //    dead candidate cost nothing; the preference order is kept only as
    //    the tiebreak among candidates that actually came back healthy.
    const veilCandidates =
      veil === 3000 ? [3080, 3000]
      : veil === 3080 ? [veil]
      : [veil, 3080];
    const winner = await this.firstHealthy(
      veilCandidates.map((vp) => ({ vp, url: `http://${lo}:${vp}/api/bridge/genesis/health` })),
    );
    if (winner) {
      const vp = winner.vp;
      return {
        tier: "genesis",
        chatUrl: `http://${lo}:${vp}/api/bridge/genesis`,
        nodeUrl: `http://${lo}:${vp}/api/bridge/node`,
        veilPort: vp,
      };
    }

    // 1b. Genesis DIRECT over plain HTTP — the host-mapped :8001 answers
    //     HTTP on fleet deployments, so chat works even with no Veil bridge
    //     (bridged side-services stay degraded, which still beats cloud-only).
    if (await this.probe(`http://${lo}:${genesis}/health`)) {
      return {
        tier: "genesis",
        chatUrl: `http://${lo}:${genesis}`,
        nodeUrl: null,
        direct: true,
        // No bridge answered, so there is no Veil port to hang the bridged
        // services off. Say so explicitly instead of letting recalcUrls fall
        // back to a hardcoded :3000 — pointing twelve services at a port that
        // 404s is what rendered the whole status panel "down" next to a
        // perfectly healthy Genesis.
        veilPort: null,
      };
    }

    // 2. AitherNode direct HTTP (standalone, no Docker TLS issue)
    if (await this.probe(`http://${lo}:${node}/health`)) {
      return {
        tier: "node-only",
        chatUrl: `http://${lo}:${node}`,
        nodeUrl: `http://${lo}:${node}`,
      };
    }

    // 3. BYOK provider — user configured an LLM provider key (or Ollama /
    //    the on-device WebGPU provider, which need none). No probe: the chat
    //    URL is derived from the provider registry at request time, and a
    //    dead key surfaces as an actionable 401 in chat rather than a silent
    //    tier skip. ("aither-local" is a literal id here — tier-detect must
    //    not depend on providers.js load order.)
    if (providerCfg && (providerCfg.apiKey || providerCfg.id === "ollama" || providerCfg.id === "aither-local")) {
      return {
        tier: "provider",
        chatUrl: null,
        nodeUrl: null,
        provider: providerCfg.id,
      };
    }

    // 4. Cloud gateway (requires explicit API key)
    if (cloudApiKey) {
      return {
        tier: "cloud-only",
        chatUrl: gateway,
        nodeUrl: gateway,
      };
    }

    return { tier: "offline", chatUrl: null, nodeUrl: null };
  },
};
