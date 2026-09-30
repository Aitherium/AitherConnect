/**
 * Awconnect Tier Detection
 * ============================
 * Shared utility for detecting which connectivity tier is available.
 *
 * Tiers (in priority order):
 *   1. "genesis"     — Full AitherOS via Veil bridge proxy (or Genesis direct)
 *   2. "local-agent" — the awdk daemon (`adk serve`, :9001) on this machine.
 *                      Needs no fleet, no sign-in and no key: a person who
 *                      installed awdk has a working chat here.
 *   3. "node-only"   — awnode standalone (HTTP, no TLS issues)
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
    // The awdk daemon: chat (streamed, with its own tools) and the local KB.
    // No fleet-side surfaces -- those need Genesis, and claiming them here is
    // the "Connected" lie this tier exists to end.
    "local-agent": {
      hasFleet: false, hasChat: true, hasLocalKb: true, hasThemis: false,
      hasShield: false, hasShell: false, hasRelay: false, hasImageGen: false,
      hasDesktopLaunch: false, hasA2A: true, hasMemoryRecall: false,
      hasFederatedSearch: false,
      hasHeadlessBrowser: false,
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

  /** What chat says when there is no backend at all. Actionable, and never
   *  "Connected": the old side panel greeted every user with "Connected to
   *  AitherOS" as static HTML, including the ones with nothing running. */
  OFFLINE_CHAT_MESSAGE:
    "No backend: start awdk (adk serve), sign in, or add a provider key",

  /** Honest badge labels. Capability sources (awsh, aw hub, awdesk) are
   *  deliberately absent: they are shown as surfaces, not as chat tiers. */
  TIER_LABELS: {
    genesis: "Fleet",
    "local-agent": "Local agent",
    "node-only": "awnode",
    "cloud-only": "Cloud",
    provider: "BYOK",
    offline: "Offline",
    unknown: "Detecting...",
  },

  /** Human names for the local surfaces the status strip shows. */
  SURFACE_LABELS: {
    adk: "awdk", awsh: "awsh", awhub: "aw hub", awdesk: "awdesk", awnode: "awnode",
  },

  /**
   * The chat greeting for a tier. Pure: the side panel renders exactly this.
   * @param {string} tier
   * @param {object} [caps]      capabilities from the tier-changed message
   * @param {object} [surfaces]  localSurfaces() snapshot, used when offline
   * @param {string} [provider]  BYOK provider id
   * @returns {string}
   */
  greetingFor(tier, caps = {}, surfaces = null, provider = null) {
    caps = caps || {};
    if (tier === "local-agent") {
      const v = caps.version ? ` v${caps.version}` : "";
      const n = typeof caps.toolCount === "number" ? `, ${caps.toolCount} tools` : "";
      return `Local agent (awdk${v}${n}). Ask me anything.`;
    }
    if (tier === "node-only") return "awnode. Ask me anything.";
    if (tier === "genesis") return "Fleet (AitherOS). Ask me anything.";
    if (tier === "cloud-only") return "Cloud gateway. Ask me anything.";
    if (tier === "provider") return `BYOK${provider ? ` (${provider})` : ""}. Ask me anything.`;
    if (tier === "offline") {
      const parts = surfaces && typeof surfaces === "object"
        ? Object.keys(surfaces).map((k) =>
            `${this.SURFACE_LABELS[k] || k} ${surfaces[k] && surfaces[k].up ? "up" : "down"}`)
        : [];
      return `Offline. ${this.OFFLINE_CHAT_MESSAGE}.` + (parts.length ? ` Probed: ${parts.join(", ")}.` : "");
    }
    return "Detecting a backend...";
  },

  /**
   * Map one awdk /chat/stream SSE event to what the side panel consumes.
   * awdk emits session_start, heartbeat, token {t}, tool_call, tool_result,
   * answer {answer}, error {error}, complete. Pure, so it is unit-tested.
   * @returns {{kind: "chunk"|"answer"|"error"|"tool"|"session"|"complete"|"ignore", text?: string, data?: object}}
   */
  adkEventToChat(event, data) {
    const d = data && typeof data === "object" ? data : {};
    const type = d.type || event || "message";
    if (type === "token") return { kind: "chunk", text: String(d.t || "") };
    if (type === "answer") return { kind: "answer", text: String(d.answer || "") };
    if (type === "error") return { kind: "error", text: String(d.error || "awdk error") };
    if (type === "tool_call" || type === "tool_result") return { kind: "tool", data: d };
    if (type === "session_start") return { kind: "session", data: d };
    if (type === "complete") return { kind: "complete", data: d };
    return { kind: "ignore" };
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
   * Probe a JSON /health and return the parsed body, or null. Never throws.
   * @param {string} url
   * @param {number} timeoutMs
   * @returns {Promise<object|null>}
   */
  async probeJson(url, timeoutMs = 1500) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return null;
      const body = await r.json();
      return body && typeof body === "object" ? body : null;
    } catch {
      return null;
    }
  },

  /** Where a named local surface lives (launcher map when loaded, else the
   *  fixed fallback). tier-detect must not depend on local-endpoints.js load
   *  order, so the fallback ports are repeated here. */
  async localBase(name) {
    const fallback = {
      adk: 9001, awnode: 8090, awsh: 8362, awhub: 47933, awdesk: 47931, mcpgateway: 8182,
    };
    const resolver = typeof globalThis !== "undefined" ? globalThis.AitherLocalEndpoints : null;
    if (resolver && typeof resolver.endpointFor === "function") {
      try {
        const base = await resolver.endpointFor(name);
        if (base) return String(base).replace(/\/+$/, "");
      } catch { /* fall through to the fixed port */ }
    }
    return fallback[name] ? `http://${this.LOOPBACK}:${fallback[name]}` : null;
  },

  /**
   * The awdk daemon, if it is up. Healthy means the body SAYS healthy -- a
   * 200 from some other process squatting on the port is not an agent.
   * @param {string} [adkBase]
   * @returns {Promise<object|null>} the local-agent tier result, or null
   */
  async detectLocalAgent(adkBase) {
    const base = adkBase || (await this.localBase("adk"));
    if (!base) return null;
    const health = await this.probeJson(`${base}/health`, 1500);
    if (!health || health.status !== "healthy") return null;
    const tools = health.tools && typeof health.tools === "object" ? health.tools : {};
    return {
      tier: "local-agent",
      chatUrl: base,
      nodeUrl: null,
      chatShape: "adk-sse",
      capabilities: {
        ...this.CAPABILITY_PRESETS["local-agent"],
        tools: tools.mode || null,
        toolCount: typeof tools.registered === "number" ? tools.registered : null,
        version: health.version || null,
        agent: health.agent || null,
      },
    };
  },

  /**
   * Is each local surface up? Health probes only, in parallel, no auth and no
   * Origin-sensitive call. These are CAPABILITY SOURCES shown to the person,
   * not chat tiers: awsh or the aw hub being up does not make chat work.
   * @returns {Promise<Object<string, {url: string|null, up: boolean, version?: string}>>}
   */
  async localSurfaces(names = ["adk", "awsh", "awhub", "awdesk", "awnode"]) {
    const out = {};
    await Promise.all(names.map(async (name) => {
      const base = await this.localBase(name);
      if (!base) { out[name] = { url: null, up: false }; return; }
      const body = await this.probeJson(`${base}/health`, 1500);
      out[name] = { url: base, up: !!body, ...(body && body.version ? { version: String(body.version) } : {}) };
    }));
    return out;
  },

  /**
   * Rank of each tier, best first. Used to tell an UPGRADE from a DEMOTION.
   * Unknown tiers rank below offline so anything real beats them.
   */
  TIER_RANK: { genesis: 5, "local-agent": 4, "node-only": 3, provider: 2, "cloud-only": 1, offline: 0, unknown: -1 },

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

    // The awdk probe starts NOW, concurrently with the fleet race below, so a
    // machine with no fleet pays one short timeout, not the fleet's plus awdk's.
    const localAgentP = this.detectLocalAgent(ports.adkUrl);

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
      localAgentP.catch(() => {});
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

    // 2. The awdk daemon on this machine -- a real agent with tools, no fleet.
    const localAgent = await localAgentP;
    if (localAgent) return localAgent;

    // 3. awnode direct HTTP (standalone, no Docker TLS issue). An explicit
    //    nodePort wins; otherwise the port comes from the endpoint map.
    const nodeBase = ports.nodePort
      ? `http://${lo}:${node}`
      : ((await this.localBase("awnode")) || `http://${lo}:${node}`);
    if (await this.probe(`${nodeBase}/health`)) {
      return {
        tier: "node-only",
        chatUrl: nodeBase,
        nodeUrl: nodeBase,
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
