/**
 * Awconnect Background Service Worker
 * ========================================
 *
 * Rewritten to match AitherExtension (AitherAeon) patterns:
 * - Proper async sendResponse with `return true`
 * - Direct API calls to AitherMind (port 8088) for near-instant chat
 * - Federated search orchestration
 * - Health checks with alarms
 * - Proper notification routing
 * - Multi-tier connectivity: Genesis > Node-only > Cloud > Offline
 *
 * Author: AitherZero
 */

// Import shared tier detection utility and portal API
importScripts("shared/tier-detect.js", "shared/portal-api.js", "shared/health-debounce.js",
  "shared/aitherbrowser.js", "shared/social-plan.js", "shared/harness-auth.js");

// BYOK provider mode + local knowledge base (standalone, no fleet required).
// Order matters: providers/feature-hash have no deps; embeddings needs both;
// kb-db needs feature-hash + embeddings; gating needs license-verify (nacl).
// webml-mirror/models.iife.js must precede providers.js — providers.js reads
// self.AitherWebMLModels at definition time to build the on-device model list.
importScripts(
  "shared/webml-mirror/models.iife.js",
  "shared/providers.js",
  "shared/feature-hash-embed.js",
  "shared/chunker.js",
  "shared/embeddings.js",
  "shared/kb-db.js",
  "shared/vendor/nacl.min.js",
  "shared/license-verify.js",
  "shared/gating.js",
  "shared/har-crypto.js",
);

// =============================================================================
// CONSTANTS (defaults — overridden by chrome.storage.sync "aither-settings")
// =============================================================================

const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost",           // Only used for remote mode fallback
  genesisPort: 8001,
  veilPort: 3000,                        // Veil (HTTP) — the bridge proxy entry point
  pulsePort: 8081,
  mindPort: 8088,
  nodePort: 8090,                        // awnode ADK standalone port
  nexusPort: 8122,
  searchPort: 8114,
  strataPort: 8136,
  themisPort: 8791,
  bonsaiPort: 8798,                      // Bonsai Image service (FLUX.2 Klein ternary 4B)
  newswirePort: 8208,
  relayPort: 8205,
  relayUrl: "",
  relayWsUrl: "",
  deepResearchPort: 8130,                // Deep Research product (local node) web/license port
  mediaforgePort: 8200,                  // MediaForge product (local node) web/health port
  // Remote mode: when set, all service URLs derive from this single base
  // e.g. "https://aither.example.com" → genesis at /api, pulse at /pulse, etc.
  remoteUrl: "",
  apiKey: "",                            // Bearer token for remote auth
  tenantId: "",                          // Tenant scope (X-Tenant-ID header)
  projectName: "",                       // Project scope (X-Project-Name header)
  wikiProject: "",                       // LyraWiki name within the tenant (default = "default")
  workspaceId: "",                       // Workspace scope (X-Workspace-ID header)
  userId: "",                            // User identity (X-User-ID header)
  standaloneMode: false,                 // Force standalone mode (Node ADK only) [legacy]
  autoHarvest: false,                    // Auto-capture page content on visit
  workspaceKnowledge: true,              // Route KB ingests through workspace knowledge API
  // Multi-tier connectivity
  cloudApiKey: "",                       // API key for cloud gateway (aither_sk_live_* / aither_pat_*)
  cloudGatewayUrl: "https://gateway.aitherium.com",
  mcpUrl: "https://mcp.aitherium.com/mcp",  // MCP gateway (remote-only, requires auth)
  preferredTier: "auto",                 // "auto" | "genesis" | "node" | "cloud" | "provider"
  // BYOK / local knowledge base (provider API key lives in chrome.storage.local
  // "aither-provider", NOT here — sync storage roams through Google)
  ragEnabled: true,                      // Ground provider-tier chat in the local KB
  // Content scripts are no longer statically registered on *://*/* (Chrome
  // Web Store review). These opt-ins register them dynamically after the
  // user grants the all-sites permission in Options.
  textActionsAllSites: false,            // Floating selection menu on all sites
  sitePacksEnabled: false,               // Slack/GitHub/Atlassian packs (Pro)
  // Holographic OS overlay — "the page becomes the desktop". ON: the apex has
  // caught up and the full contract now holds end-to-end.
  //
  // The contract is implemented on both sides: this extension frames
  // aitherium.com/?mode=overlay, and the OS detects it, skips the boot sequence,
  // posts `os-ready`, and publishes `os-regions` (the rects of the dock and any
  // open windows) so the host clips the overlay to exactly that chrome and every
  // other pixel falls through to the page.
  //
  // Why it was OFF and why it is safe now. Measured 2026-07-31, `develop` —
  // which is what the apex publishes — contained ZERO occurrences of
  // `aither-os-overlay`: os-client.tsx had been adding that class to <html> since
  // overlay mode was written and nothing styled it, so the OS painted its full
  // OPAQUE desktop over every site, and the overlay was a full-viewport copy of
  // the homepage on top of the page.
  //
  // The transparency CSS + hit markers have since landed on develop and GitHub
  // Pages republished the apex. VERIFIED LIVE 2026-08-08 (AitherBrowser):
  //   - https://aitherium.com/?mode=overlay renders `html.aither-os-overlay`,
  //     #os-desktop-root, and ONLY chrome ([data-os-hit]: the AITHER window +
  //     dock), with `background: transparent` on html/body — the host page shows
  //     through.
  //   - the OS posts `os-ready` AND `os-regions` from inside a cross-origin
  //     iframe on example.com; the bridge reveals (opacity 1) and the command
  //     bar is removed.
  // The condition in the old comment ("verify by loading
  // https://aitherium.com/?mode=overlay and seeing through it") has been met, so
  // the gate is obsolete. aither-overlay-bridge.js now also CLIPS to os-regions,
  // so the OS chrome is live and every other pixel falls through without an
  // Alt+Space toggle.
  osOverlayEnabled: true,
  // The command bar: a full-width Aither bar injected into every page. It is
  // ALSO the only in-page driver for the X/LinkedIn social automation (see
  // content/aither-command-bar.js — PLATFORM === "x" starts the post/engage
  // loops there).
  //
  // This was flipped to `false` on 2026-07-31 alongside osOverlayEnabled,
  // reasoning "both are page injection and both are now opt-in". That was wrong
  // in two ways and cost the owner a fortnight of dead automation:
  //   1. NOTHING renders a toggle for it — grep options/, popup/, sidepanel/:
  //      zero hits. "Opt-in" with no opt-in control is just deleted, and the
  //      bar became unreachable dead code on every site including x.com.
  //   2. It is not merely cosmetic like the overlay. Turning it off ALSO
  //      stopped social automation, because the bar is the in-page driver —
  //      and the bar had already written the service worker's copy off (the
  //      xAutopostEnabled trap below). Both drivers ended up disabled and the
  //      extension posted nothing, with no error anywhere.
  // The overlay's problem was an opaque full-viewport iframe; the bar has never
  // had that failure mode, it draws one strip and offers its own hide control
  // (`aitherBarHidden`). So it ships ON, with a real toggle in options.
  // Do not flip this to false again without adding a control that can flip it back.
  commandBarEnabled: true,
};

// Live settings object — populated from storage on startup
let SETTINGS = { ...DEFAULT_SETTINGS };

// Customer self-service licensing portal (forwarded to managed launches so the
// product's gated UI deep-links the user to activation). Override via settings.
const PORTAL_URL = "https://portal.aitherium.com";

// Loopback host for every locally-constructed URL. Literal v4 ONLY — see the
// LOOPBACK note in shared/tier-detect.js: "localhost" resolves ::1 first, the
// Docker port proxy does not answer there, and the stall (250ms via curl, worse
// in a service worker) loses races against probe timeouts. Hostname ALLOWLISTS
// elsewhere in this file still accept "localhost" — this constant is only for
// URLs we build ourselves.
const LOOPBACK = "127.0.0.1";

// Setup-panel service probe budget. Deliberately generous: these endpoints sit
// behind the Veil bridge, so a probe crosses browser → bridge → docker network →
// service. Measured on a fully HEALTHY fleet: nexus 5.7s, node 2.0s, several
// others ~1s. The old 4s budget therefore reported healthy services as "down",
// which is exactly how a working stack rendered as a wall of red.
const SERVICE_PROBE_TIMEOUT_MS = 15000;
// Answered, but slowly enough to be worth showing rather than calling it fine.
const SERVICE_SLOW_MS = 2000;

// Derived URLs (recalculated after settings load)
// Default to Veil bridge proxy — avoids self-signed TLS issues in Chrome extensions
let GENESIS_URL = `http://${LOOPBACK}:3000/api/bridge/genesis`;
let GENESIS_WS = `ws://${LOOPBACK}:3000/ws/events`;
let VEIL_URL = `http://${LOOPBACK}:3000`;
let PULSE_URL = `http://${LOOPBACK}:3000/api/bridge/pulse`;
let MIND_URL = `http://${LOOPBACK}:3000/api/bridge/mind`;
let NODE_URL = `http://${LOOPBACK}:3000/api/bridge/node`;
let NEXUS_URL = `http://${LOOPBACK}:3000/api/bridge/nexus`;
let SEARCH_URL = `http://${LOOPBACK}:3000/api/bridge/search`;
let STRATA_URL = `http://${LOOPBACK}:3000/api/bridge/strata`;
let RELAY_URL = `http://${LOOPBACK}:3000/api/bridge/relay`;
let RELAY_WS = `ws://${LOOPBACK}:3000/ws/chat`;
let THEMIS_URL = `http://${LOOPBACK}:3000/api/bridge/themis`;
let NEWSWIRE_URL = `http://${LOOPBACK}:3000/api/bridge/newswire`;
let LYRAWIKI_URL = `http://${LOOPBACK}:3000/api/bridge/lyra-wiki`;
let BROWSER_URL = `http://${LOOPBACK}:3000/api/bridge/browser`;  // AitherBrowser (Playwright capture/crawl)
let BONSAI_URL = `http://${LOOPBACK}:3000/api/bridge/bonsai`;    // Bonsai Image (FLUX.2 ternary 4B)

// ── AitherBrowser bridge ─────────────────────────────────────────────────────
// The helpers live in shared/aitherbrowser.js so they can be imported by
// tests/run-tests.mjs — a service worker cannot be directly imported by a test runner.
const browserError = (resp) => AitherBrowserBridge.readError(resp);


function recalcUrls() {
  if (SETTINGS.remoteUrl) {
    // Remote/cloud mode — all services behind a reverse proxy
    const base = SETTINGS.remoteUrl.replace(/\/+$/, "");
    const wsBase = base.replace(/^http/, "ws");
    GENESIS_URL = `${base}/api`;
    GENESIS_WS = `${wsBase}/ws/events`;
    VEIL_URL = base;
    PULSE_URL = `${base}/pulse`;
    MIND_URL = `${base}/services/mind`;
    NEXUS_URL = `${base}/services/nexus`;
    SEARCH_URL = `${base}/services/search`;
    STRATA_URL = `${base}/services/strata`;
    NODE_URL = `${base}/services/node`;
    THEMIS_URL = `${base}/services/themis`;
    NEWSWIRE_URL = `${base}/services/newswire`;
    LYRAWIKI_URL = `${base}/services/lyra-wiki`;
    BROWSER_URL = `${base}/services/browser`;
    BONSAI_URL = `${base}/services/bonsai`;
    RELAY_URL = SETTINGS.relayUrl || `${base}/services/relay`;
    RELAY_WS = SETTINGS.relayWsUrl || `${wsBase}/ws/chat`;
  } else if (DETECTED_TIER === "node-only" && TIER_URLS.chatUrl) {
    // Node-only mode — direct HTTP to awnode (no TLS issue on localhost).
    //
    // awnode >= 0.2.0 is a persistent host service with an allowlisted
    // reverse-proxy plane (/proxy/{service}/...) that terminates plain HTTP
    // on loopback and forwards to the internal-CA HTTPS fleet services.
    // That means node tier is no longer chat-only: Search and Browser ride
    // through the node instead of requiring the Veil bridge.
    const nodeBase = TIER_URLS.chatUrl;
    VEIL_URL = "";   // Veil not available
    GENESIS_URL = `${nodeBase}/proxy/genesis`;  // Genesis (if up) via node proxy
    GENESIS_WS = "";          // No WS in node-only
    PULSE_URL = "";
    MIND_URL = "";
    NODE_URL = nodeBase;
    NEXUS_URL = "";
    SEARCH_URL = `${nodeBase}/proxy/search`;
    BROWSER_URL = `${nodeBase}/proxy/browser`;
    BONSAI_URL = `${nodeBase}/proxy/bonsai`;
    STRATA_URL = "";
    THEMIS_URL = "";
    NEWSWIRE_URL = "";
    LYRAWIKI_URL = "";
    RELAY_URL = SETTINGS.relayUrl || "";
    RELAY_WS = SETTINGS.relayWsUrl || "";
  } else if (DETECTED_TIER === "cloud-only" && TIER_URLS.chatUrl) {
    // Cloud-only mode — gateway.aitherium.com
    const gateway = TIER_URLS.chatUrl;
    VEIL_URL = "";
    GENESIS_URL = gateway;
    GENESIS_WS = "";
    PULSE_URL = "";
    MIND_URL = "";
    NODE_URL = gateway;
    NEXUS_URL = "";
    // Cloud-tier web search rides the gateway → genesis → AitherSearch proxy
    // (AitherSearch has no public origin). ${SEARCH_URL}/search hits the
    // worker's /search route; ${SEARCH_URL}/health hits the gateway /health.
    SEARCH_URL = gateway;
    BONSAI_URL = gateway;  // Image generation via cloud gateway
    STRATA_URL = "";
    THEMIS_URL = "";
    NEWSWIRE_URL = "";
    LYRAWIKI_URL = "";
    RELAY_URL = SETTINGS.relayUrl || "";
    RELAY_WS = SETTINGS.relayWsUrl || "";
  } else {
    // Local mode — route through Veil's bridge proxy (HTTP:3000).
    //
    // Chrome extension service workers CANNOT fetch self-signed HTTPS endpoints.
    // All AitherOS services bind HTTPS with self-signed TLS certs, which means
    // direct fetch("https://localhost:8001/...") silently fails in extensions.
    //
    // Veil (Next.js on HTTP:3000) proxies to backend services over the Docker
    // network where TLS is trusted. The bridge route accepts:
    //   http://localhost:3000/api/bridge/{service}/{path}
    //
    // Tier detection may have found the bridge on a different Veil port
    // (deployed fleet LB = 3080) or Genesis directly over plain HTTP.
    const _tierVeilPort =
      (DETECTED_TIER === "genesis" && TIER_URLS && TIER_URLS.veilPort) || SETTINGS.veilPort;
    const _genesisDirect =
      DETECTED_TIER === "genesis" && TIER_URLS && TIER_URLS.direct && TIER_URLS.chatUrl;
    const veilBase = `http://${LOOPBACK}:${_tierVeilPort}`;
    const bridge = `${veilBase}/api/bridge`;
    VEIL_URL = veilBase;
    GENESIS_URL = _genesisDirect ? TIER_URLS.chatUrl : `${bridge}/genesis`;
    GENESIS_WS = `ws://${LOOPBACK}:${_tierVeilPort}/ws/events`;  // Veil WS proxy
    PULSE_URL = `${bridge}/pulse`;
    MIND_URL = `${bridge}/mind`;
    NEXUS_URL = `${bridge}/nexus`;
    SEARCH_URL = `${bridge}/search`;
    STRATA_URL = `${bridge}/strata`;
    NODE_URL = `${bridge}/node`;
    THEMIS_URL = `${bridge}/themis`;
    NEWSWIRE_URL = `${bridge}/newswire`;
    LYRAWIKI_URL = `${bridge}/lyra-wiki`;
    RELAY_URL = SETTINGS.relayUrl || `${bridge}/relay`;
    RELAY_WS = SETTINGS.relayWsUrl || `ws://${LOOPBACK}:${_tierVeilPort}/ws/chat`;

    // Genesis-DIRECT means no Veil bridge answered, so `bridge` above points at
    // a port that isn't proxying. Blank the bridged services the way the cloud
    // branch does rather than probing a URL we know 404s — twelve services
    // reported "down" beside a healthy Genesis is a lie about the fleet, and it
    // sent the owner debugging services that were never actually asked.
    if (_genesisDirect && !(TIER_URLS && TIER_URLS.veilPort)) {
      VEIL_URL = "";
      GENESIS_WS = "";
      PULSE_URL = MIND_URL = NEXUS_URL = SEARCH_URL = STRATA_URL = "";
      NODE_URL = THEMIS_URL = NEWSWIRE_URL = LYRAWIKI_URL = BROWSER_URL = "";
      // BONSAI_URL belongs in this list too. It is reached through the Veil
      // bridge, so in genesis-direct mode (Veil down) its default still points
      // at http://127.0.0.1:3000/api/bridge/bonsai — an endpoint that cannot
      // exist in this mode. Image generation then fails and the user is told
      // "Bonsai unreachable", which is a lie: it was never configured for this
      // deployment mode. Same class as the "reported down beside a healthy
      // Genesis" comment above — a misconfiguration wearing an outage's clothes.
      BONSAI_URL = "";
      RELAY_URL = SETTINGS.relayUrl || "";
      RELAY_WS = SETTINGS.relayWsUrl || "";
    }
  }
}

/**
 * Auto-detect connectivity tier and update URLs accordingly.
 * Called on startup and every 30s via chrome.alarms.
 */
async function autoDetectTier() {
  let newTier, newUrls;

  if (SETTINGS.preferredTier && SETTINGS.preferredTier !== "auto") {
    // Manual override — force the specified tier
    const forced = SETTINGS.preferredTier;
    const veil = SETTINGS.veilPort || 3000;
    const node = SETTINGS.nodePort || 8090;
    const gateway = SETTINGS.cloudGatewayUrl || "https://gateway.aitherium.com";

    if (forced === "genesis") {
      newTier = "genesis";
      newUrls = {
        chatUrl: `http://${LOOPBACK}:${veil}/api/bridge/genesis`,
        nodeUrl: `http://${LOOPBACK}:${veil}/api/bridge/node`,
      };
    } else if (forced === "node") {
      newTier = "node-only";
      newUrls = { chatUrl: `http://${LOOPBACK}:${node}`, nodeUrl: `http://${LOOPBACK}:${node}` };
    } else if (forced === "cloud") {
      newTier = "cloud-only";
      newUrls = { chatUrl: gateway, nodeUrl: gateway };
    } else if (forced === "provider") {
      // BYOK — chat URL derives from the provider registry at request time
      newTier = providerConfigured() ? "provider" : "offline";
      newUrls = { chatUrl: null, nodeUrl: null, provider: PROVIDER_CFG?.id };
    } else {
      newTier = "offline";
      newUrls = { chatUrl: null, nodeUrl: null };
    }
  } else {
    // Auto-detect: probe Genesis (bridge, then direct HTTP) → Node → Cloud
    const result = await TierDetect.detect(
      {
        veilPort: SETTINGS.veilPort,
        nodePort: SETTINGS.nodePort,
        genesisPort: SETTINGS.genesisPort,
      },
      SETTINGS.cloudApiKey || SETTINGS.apiKey,
      SETTINGS.cloudGatewayUrl,
      PROVIDER_CFG,
    );
    newTier = result.tier;
    newUrls = {
      chatUrl: result.chatUrl,
      nodeUrl: result.nodeUrl,
      veilPort: result.veilPort,
      direct: result.direct,
    };
  }

  // ── Demotion debounce ────────────────────────────────────────────────
  // UPGRADES apply instantly; DOWNGRADES must be confirmed by consecutive
  // misses. One timed-out probe used to demote genesis → cloud-only, and
  // because capability presets differ per tier the side panel then hid the
  // Shell/IRC/Images/Search/Notes tabs — mid-session, while the owner was
  // reading search results, which vanished with the panel. The next poll
  // upgraded again and they reappeared. The probe was the flaky part; the
  // fleet never moved. Hold the better tier until it's genuinely gone.
  // The decision itself lives in TierDetect.decideTierChange so it is pure and
  // unit-tested; this function only owns the strike counter.
  const decision = TierDetect.decideTierChange(DETECTED_TIER, newTier, _tierDemoteStrikes);
  _tierDemoteStrikes = decision.strikes;
  if (!decision.adopt) {
    console.log(
      `[Awconnect] Ignoring tier demotion ${DETECTED_TIER} → ${newTier} — ${decision.reason}`,
    );
    return;  // keep the current tier, URLs, and capabilities untouched
  }
  if (decision.reason.startsWith("demotion")) {
    console.warn(`[Awconnect] Tier demotion ${DETECTED_TIER} → ${newTier}: ${decision.reason}`);
  }

  const tierChanged = newTier !== DETECTED_TIER;
  DETECTED_TIER = newTier;
  TIER_URLS = newUrls;

  // Recalculate all URL variables based on new tier
  // (only if not in remoteUrl mode, which has its own routing)
  if (!SETTINGS.remoteUrl) {
    recalcUrls();
  }

  // Update connection state. A tier is only DETECTED after its backend probed
  // reachable, so every non-offline tier is genuinely working — cloud-only means
  // the gateway answered (chat via DeepSeek works), node-only means the node is
  // up. Labeling those "degraded" read as "broken" for a tier that works fine
  // (the exact confusion an owner hit: "why is cloud-only degraded, not just
  // using deepseek"). "provider" was already treated as online for this reason;
  // extend the same truth to cloud-only and node-only. Real trouble surfaces as
  // "offline" (no tier) or a per-service DOWN event, not a blanket tier label.
  isConnected = newTier !== "offline" && newTier !== "unknown";
  aitherOSStatus = (newTier === "offline" || newTier === "unknown") ? "offline" : "online";
  updateBadge(aitherOSStatus);

  if (tierChanged) {
    console.log(`[Awconnect] Tier changed: ${DETECTED_TIER} → URLs:`, TIER_URLS);
    broadcastToSidePanel({
      type: "tier-changed",
      tier: DETECTED_TIER,
      chatUrl: TIER_URLS.chatUrl,
      nodeUrl: TIER_URLS.nodeUrl,
      capabilities: TierDetect.capabilitiesFor(DETECTED_TIER),
      provider: DETECTED_TIER === "provider" ? (PROVIDER_CFG?.id || null) : null,
    });
  }
}

/** Stable per-install id (created once, persisted). */
async function ensureInstallId() {
  let { "aither-install-id": id } = await chrome.storage.local.get("aither-install-id");
  if (!id) {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ "aither-install-id": id });
  }
  return id;
}

/** Ensure server session ID (created once, persisted for server-side continuity). */
async function ensureServerSessionId() {
  let { "aither_server_session_id": sessionId } = await chrome.storage.local.get("aither_server_session_id");
  if (!sessionId) {
    // Generate a 12-char hex ID (48 bits of entropy, more memorable than full UUID)
    sessionId = crypto.getRandomValues(new Uint8Array(6))
      .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
    await chrome.storage.local.set({ "aither_server_session_id": sessionId });
    console.log("[Awconnect] Created server session ID:", sessionId);
  }
  return sessionId;
}

/** Persist the cloud entitlement that license-verify.js reads as a tier fallback. */
async function persistEntitlement(ent) {
  try {
    await chrome.storage.local.set({
      "aither-entitlement": { ...ent, fetchedAt: Date.now() },
    });
  } catch (e) {
    console.warn("[Awconnect] Could not persist entitlement:", e);
  }
}

/**
 * Auto-pull the authenticated user's entitlement from the gateway and reflect
 * it as the Awconnect tier — "if you're signed in with a valid
 * subscription, the system just pulls it." Prefers a signed license envelope
 * (offline-capable); falls back to reflecting the /auth/me tier.
 *
 * Token preference: the gateway only trusts its own credentials, so use the
 * cloud key first, then the remote bearer, then the portal session bearer.
 * @returns {Promise<{ok:boolean, tier?:string, signed?:boolean, reason?:string}>}
 */
async function pullEntitlement() {
  const gateway = SETTINGS.cloudGatewayUrl || "https://gateway.aitherium.com";
  let token = SETTINGS.cloudApiKey || SETTINGS.apiKey || "";
  if (!token && chrome.storage.session) {
    try {
      const { aither_portal_bearer } = await chrome.storage.session.get("aither_portal_bearer");
      token = aither_portal_bearer || "";
    } catch { /* no session storage */ }
  }
  if (!token) return { ok: false, reason: "not authenticated" };

  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };

  // 1) Mint a signed envelope — durable + offline-capable (preferred).
  try {
    const installId = await ensureInstallId();
    const r = await fetch(`${gateway}/v1/connect/license`, {
      method: "POST", headers, body: JSON.stringify({ install_id: installId }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j.license_key) {
        const set = await self.AitherLicense.setLicense(j.license_key);
        if (set.ok || set.grace) {
          await persistEntitlement({ tier: j.tier, plan: j.plan, source: "subscription-signed" });
          broadcastToSidePanel({ type: "entitlement-updated", tier: j.tier });
          return { ok: true, tier: j.tier, signed: true };
        }
      }
    }
    // 501 (no signing key) or any non-2xx → fall through to reflect.
  } catch (e) {
    console.debug("[Awconnect] connect/license mint unavailable:", e.message);
  }

  // 2) Reflect the tier from /auth/me (no offline proof, but auto-updates
  //    display + gating). Try every surface we might be authenticated against:
  //    cloud gateway, remote identity, then the local Veil→identity bridge.
  //    The local bridge is the common case for a portal-cookie login where the
  //    gateway would reject the session token.
  const meUrls = [`${gateway}/v1/auth/me`];
  if (SETTINGS.remoteUrl) {
    meUrls.push(`${SETTINGS.remoteUrl.replace(/\/+$/, "")}/services/identity/auth/me`);
  }
  meUrls.push(`http://${LOOPBACK}:${SETTINGS.veilPort || 3000}/api/bridge/identity/auth/me`);

  for (const url of meUrls) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const me = await r.json();
      const tier = me.tier || me.plan;
      if (tier) {
        await persistEntitlement({
          tier: self.AitherLicense.TIER_RANK[tier] !== undefined ? tier : "pro",
          plan: me.plan, email: me.email || me.user_id, source: "subscription",
        });
        broadcastToSidePanel({ type: "entitlement-updated", tier });
        return { ok: true, tier };
      }
    } catch (e) {
      console.debug(`[Awconnect] /auth/me reflect via ${url} failed:`, e.message);
    }
  }
  return { ok: false, reason: "no entitlement resolved" };
}

/** Load settings from chrome.storage.sync and recalculate URLs. */
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get("aither-settings");
    if (stored["aither-settings"]) {
      SETTINGS = { ...DEFAULT_SETTINGS, ...stored["aither-settings"] };
      // Migrate: drop trailing slashes
      if (SETTINGS.baseUrl.endsWith('/')) {
        SETTINGS.baseUrl = SETTINGS.baseUrl.slice(0, -1);
      }
      // Migration: local mode now routes through Veil bridge (HTTP), not direct HTTPS.
      // baseUrl is only used for remote mode; local mode always uses http://localhost:veilPort.
    }
  } catch (e) {
    console.warn("[Awconnect] Could not load settings:", e);
  }
  recalcUrls();
}

/** Save current settings to chrome.storage.sync. */
async function saveSettings(newSettings) {
  SETTINGS = { ...DEFAULT_SETTINGS, ...newSettings };
  await chrome.storage.sync.set({ "aither-settings": SETTINGS });
  recalcUrls();
  // Injection is otherwise driven by tabs.onUpdated, which only fires on a
  // LOAD. Without this sweep, flipping the command bar on in options appears
  // to do nothing until every open tab is manually reloaded — which reads as
  // "the toggle is broken" and is how the feature got written off before.
  sweepInjectables().catch(() => {});
}

// ── BYOK provider config ─────────────────────────────────────────────
// Lives in chrome.storage.local (NEVER sync — API keys must not roam
// through Google's sync backend). Shape:
//   { id, apiKey, model, baseUrl?, embeddingModel? }
let PROVIDER_CFG = null;

async function loadProviderConfig() {
  try {
    const stored = await chrome.storage.local.get("aither-provider");
    PROVIDER_CFG = stored["aither-provider"] || null;
  } catch (e) {
    console.warn("[Awconnect] Could not load provider config:", e);
    PROVIDER_CFG = null;
  }
}

/** True when a usable BYOK provider is configured (Ollama and the on-device
 *  WebGPU provider need no key). */
function providerConfigured() {
  return !!(
    PROVIDER_CFG &&
    (PROVIDER_CFG.apiKey ||
      PROVIDER_CFG.id === "ollama" ||
      (self.AitherProviders && AitherProviders.getProvider(PROVIDER_CFG.id)?.local))
  );
}

// ── FormBridge (local form automation) ─────────────────────────────────────
// Pack config installed at setup: { origin, port, anchor:{selector,key_selector},
// ignore:[], self_check:[] }. Captured batches go to the LOCAL engine ONLY —
// the endpoint is hard-coded loopback; there is no remote fallback by design
// (see the FormBridge product's security model doc).

let FORMBRIDGE_CFG = null;
let DISCOVERY_CFG = null;          // { origin } when Discovery mode is on
let API_CFG = null;                // { origin } when API capture is active
let formbridgeQueue = [];          // batches awaiting a reachable local engine
let formbridgeSelectorsSeen = [];  // latest self-check report, attached to next batch
const FORMBRIDGE_QUEUE_MAX = 200;

async function loadFormbridgeConfig() {
  try {
    const stored = await chrome.storage.local.get(
      ["aither-formbridge-pack", "aither-formbridge-queue", "aither-formbridge-discovery", "aither-formbridge-api"]);
    FORMBRIDGE_CFG = stored["aither-formbridge-pack"] || null;
    DISCOVERY_CFG = stored["aither-formbridge-discovery"] || null;
    API_CFG = stored["aither-formbridge-api"] || null;
    formbridgeQueue = stored["aither-formbridge-queue"] || [];
  } catch (e) {
    console.warn("[Awconnect] Could not load formbridge config:", e);
    FORMBRIDGE_CFG = null;
    API_CFG = null;
  }
}

function formbridgeUrl(path) {
  const port = (FORMBRIDGE_CFG && FORMBRIDGE_CFG.port) || 8182;
  return `http://127.0.0.1:${port}${path}`;  // loopback only — never configurable to a remote host
}

// ── Post to X, in the browser, on the logged-in page ─────────────────────────
// Aither (the fleet) writes the tweet; this posts it in the user's own x.com tab
// using the page's own session. Nothing about the session leaves the browser —
// the extension is simply acting as the logged-in user, which the owner asked
// for. This is why it works where server-side posting (no API credits) and
// cookie export (Chrome app-bound encryption) both fail.

// Notification click routing: each notification may carry an explicit
// destination; without one, clicks fall back to the public portal. This is what
// stops EVERY toast from dumping the owner on the portal dashboard — the
// "X / Social stats toast opens workspace/dashboard" report.
const _notificationTargets = new Map();
function notifyWithTarget(id, url, props) {
  if (url) _notificationTargets.set(id, url);
  try { chrome.notifications.create(id, props); } catch { /* notifications optional */ }
}

function xNotify(msg, ok, targetUrl) {
  notifyWithTarget("aither-x-" + Date.now(), targetUrl, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: ok ? "Posted to X" : "Awconnect — X",
    message: msg,
  });
}

// Ask the fleet to write the tweet in Aither's voice. Tries the dedicated X
// composer first (worker/genesis /social/x/tick), then falls back to Aither's
// general chat brain (Genesis /chat, which IS reachable through the bridge
// today) with a fresh, rotating brief so no two posts are the same. Only if the
// whole fleet is unreachable does it use a varied local line — never a single
// hardcoded string, which is the bug the first version had.
// Compose ENTIRELY in the browser on WebGPU — instant, local, no fleet call and
// no auth. The owner's browser has a GPU; the fleet's headless one does not, and
// the fleet's shared models are frequently too saturated to compose in the ~30s a
// click can wait. Uses the same offscreen inference host as the sidepanel chat,
// but resolves with the generated text instead of streaming to a panel. First use
// downloads the model (minutes, one time); every compose after that is seconds.
// `opts.maxTokens` matters more than it looks. The default of 100 is sized for a
// tweet. The engage planner asks for JSON that CONTAINS a reply of up to 200
// characters plus the likes array — comfortably past 100 tokens — and a truncated
// answer fails `JSON.parse`, which this code reports as "no plan", which the
// caller correctly treats as "skip". So an on-device engage loop would have run,
// produced nothing, and looked exactly like the fleet being down. Give each
// caller a budget that fits what it asked for.
async function webmlComposeText(prompt, opts) {
  let requestedId = (self.AitherWebMLModels && AitherWebMLModels.DEFAULT_WEBML_MODEL_ID) || "bonsai-4b";
  try { const s = await chrome.storage.local.get(["aitherWebmlModel"]); if (s.aitherWebmlModel) requestedId = s.aitherWebmlModel; } catch { /* use default */ }
  let caps;
  try { caps = await getWebMLCapabilities(); } catch { caps = { webgpu: false }; }
  if (!caps || !caps.webgpu) return null; // no GPU here — let the caller fall through

  // FALLBACK LADDER. The default brain is bonsai-27b-text — 3.8 GB, "needs a
  // real desktop GPU (e.g., RTX 4090)". On a smaller GPU the load fails, and
  // the OLD code returned null immediately, which the caller read as "no
  // brain" and fell through to the fleet — so a free GPU that merely couldn't
  // hold 27B silently killed ALL on-device composition/engagement. Never give
  // up on the local GPU after one model: try the requested one first, then
  // step DOWN through the lighter ready models. First-load downloads can take
  // minutes on a slow pipe, so a model is only abandoned on a real error or
  // a 5-minute progress stall, never on impatience.
  const ready = (self.AitherWebMLModels?.WEBML_MODELS || [])
    .filter((m) => m.ready)
    .sort((a, b) => (b.approxDownloadMB || 0) - (a.approxDownloadMB || 0));
  const ladder = [requestedId, ...ready.map((m) => m.id).filter((id) => id !== requestedId)];

  for (const modelId of ladder) {
    const text = await webmlComposeOne(prompt, opts, modelId);
    if (text) return text;
  }
  return null;
}

// One on-device compose attempt on a specific model. Returns generated text or
// null on failure (caller steps the ladder). Releases the inference lock in
// every path so the next attempt can take the pipeline.
async function webmlComposeOne(prompt, opts, modelId) {
  const flowId = nextInferenceFlowId();
  const release = await acquireInference();
  let port;
  try { port = await getInferencePort(); }
  catch { release(); return null; }

  const text = await new Promise((resolve) => {
    let full = "";
    let done = false;
    const generateReq = {
      type: "generate",
      messages: [{ role: "user", content: prompt }],
      maxTokens: (opts && opts.maxTokens) || 100,
      temperature: (opts && opts.temperature) || 0.9,
      flowId,
    };
    let watchdog;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      port.onMessage.removeListener(onMsg);
      release();
      resolve(val);
    };
    // First load can be minutes; after that, tokens flow. Reset on every event.
    const bump = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => finish(full || null), 5 * 60 * 1000);
    };
    const onMsg = (msg) => {
      if (done || !msg || (msg.flowId !== undefined && msg.flowId !== flowId)) return;
      bump();
      if (msg.type === "ready") { _lastLoadedWebMLModelId = msg.modelId; port.postMessage(generateReq); }
      else if (msg.type === "token") { full += msg.text || ""; }
      else if (msg.type === "done") { finish((msg.text || full || "").trim() || null); }
      else if (msg.type === "error") { finish(null); }
    };
    port.onMessage.addListener(onMsg);
    bump();
    // Skip the load round-trip if this model is already warm in the offscreen doc.
    if (_lastLoadedWebMLModelId === modelId) port.postMessage(generateReq);
    else port.postMessage({ type: "load", modelId, flowId });
  });

  return text ? String(text).replace(/^["']|["']$/g, "").trim().slice(0, 275) : null;
}

// Fetch web search context for composition. Returns an object with:
// { success: boolean, error: string|null, results: [{title, url, snippet}], answer: string|null }
// On network/auth error: success=false, error=<msg>, results=[], answer=null
// On "no results": success=true, error=null, results=[], answer=null (caller can distinguish)
async function xGetSearchContext(topic) {
  const SEARCH_URL = `http://127.0.0.1:${SETTINGS.searchPort}`;
  const SEARCH_TIMEOUT_MS = 15000;

  // Build auth headers — same as composition calls.
  const searchHeaders = { "Content-Type": "application/json" };
  if (DETECTED_TIER === "cloud-only" && SETTINGS.cloudApiKey) {
    searchHeaders["Authorization"] = `Bearer ${SETTINGS.cloudApiKey}`;
    searchHeaders["X-API-Key"] = SETTINGS.cloudApiKey;
  }
  if (SETTINGS.tenantId) {
    searchHeaders["X-Tenant-ID"] = SETTINGS.tenantId;
  }
  if (SETTINGS.workspaceId) {
    searchHeaders["X-Workspace-ID"] = SETTINGS.workspaceId;
  }

  try {
    const resp = await fetch(`${SEARCH_URL}/search`, {
      method: "POST",
      headers: searchHeaders,
      body: JSON.stringify({
        query: topic,
        mode: "quick",
        limit: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    // CRITICAL: Distinguish auth errors from empty results.
    if (!resp.ok) {
      // 401/403 = auth failure; others = network/server error
      const isAuthError = resp.status === 401 || resp.status === 403;
      const msg = isAuthError
        ? `Search auth error (${resp.status})`
        : `Search failed (HTTP ${resp.status})`;
      console.warn(`[xGetSearchContext] ${msg} for "${topic}"`);
      return { success: false, error: msg, results: [], answer: null };
    }

    const data = await resp.json().catch(() => ({}));

    // Validate response shape and extract results.
    const results = (data.results && Array.isArray(data.results))
      ? data.results.map((r) => ({
          title: r.title || r.name || "(untitled)",
          url: r.url || r.link || "",
          snippet: r.snippet || r.content || "",
        }))
      : [];

    const answer = (data.answer && String(data.answer).trim()) || null;

    // Return as success even if results are empty (caller can distinguish).
    return { success: true, error: null, results, answer };
  } catch (e) {
    // Network/timeout/parsing error.
    const errorMsg = e.name === "AbortError"
      ? "Search timeout"
      : `Search error: ${e.message || String(e).slice(0, 100)}`;
    console.warn(`[xGetSearchContext] ${errorMsg} for "${topic}"`);
    return { success: false, error: errorMsg, results: [], answer: null };
  }
}

async function xComposeText(promptOverride) {
  // Config-driven brief: if the command bar / a fleet agent supplied a prompt,
  // use it (with the rotating angle appended for variety); else the built-in.
  const cfgPrompt = (promptOverride && String(promptOverride).trim()) || "";

  // Build the brief up front so the in-browser and fleet paths share it.
  const angles = [
    "a builder's note on shipping AI infrastructure that runs itself",
    "one sharp, non-obvious lesson from building autonomous agents",
    "why local-first, self-hosted AI matters, in a confident line",
    "a candid progress update from an AI platform that operates itself",
    "a contrarian take on agent autonomy worth arguing with",
  ];
  const angle = angles[Math.floor(Date.now() / 60000) % angles.length];

  // ENHANCEMENT: Try to fetch web search context to enrich the prompt.
  // This is optional — if search fails or returns empty, we compose without it.
  let searchContext = "";
  try {
    const searchTopic = cfgPrompt
      ? "latest AI infrastructure and agent autonomy"  // Generic fallback if user provided prompt
      : "AI agents autonomous systems self-hosting";
    const search = await xGetSearchContext(searchTopic);

    // Only include search results if we got them AND no auth error.
    if (search.success && search.results.length > 0) {
      const snippets = search.results
        .slice(0, 3)  // Use top 3 results
        .map((r) => `"${r.title}" (${r.url})`)
        .join("; ");
      searchContext = `\n(Current context from web: ${snippets})`;
      console.log(`[xComposeText] Enriching prompt with ${search.results.length} search results`);
    } else if (!search.success) {
      // Auth or network error — log it but don't fail the composition.
      console.warn(`[xComposeText] Search error, composing without context: ${search.error}`);
    } else {
      // Search succeeded but returned no results — that's OK, compose without context.
      console.log(`[xComposeText] No search results for "${searchTopic}", composing without context`);
    }
  } catch (e) {
    // Catch-all: if search setup itself fails, log and continue.
    console.warn(`[xComposeText] Search setup error: ${e.message}, composing without context`);
  }

  const prompt = cfgPrompt
    ? `${cfgPrompt}\n\n(Angle for variety: ${angle}. Return only the post text.)${searchContext}`
    : `Write ONE original tweet (under 260 characters) in Aither's own `
      + `voice: ${angle}. First person as Aither, an AI that runs its own `
      + `infrastructure. No hashtags, no quotes around it, no emojis unless it `
      + `genuinely lands. Return only the tweet text.${searchContext}`;

  // 1) PRIMARY: compose in the browser on WebGPU — instant and local. This is the
  //    answer to "why is it too slow": no fleet round-trip, no saturated shared
  //    model. Real Aither text, written on the owner's own GPU.
  try {
    const local = await webmlComposeText(prompt);
    if (local && local.trim()) return local.trim();
  } catch { /* GPU missing or load failed — fall through to the fleet brain */ }

  // 2) FALLBACK (machines without WebGPU): Aither's chat brain via Genesis /chat.
  //    Real text too, just slower when the fleet's models are cold/saturated.
  for (const url of [`${GENESIS_URL}/chat`, `${GENESIS_URL}/api/chat`]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: prompt, stream: false }),
        signal: AbortSignal.timeout(45000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d && (d.response || d.answer || d.text || d.message || d.content
        || (d.choices && d.choices[0] && (d.choices[0].text
          || (d.choices[0].message && d.choices[0].message.content))));
      if (t && String(t).trim()) {
        return String(t).trim().replace(/^["']|["']$/g, "").slice(0, 275);
      }
    } catch { /* try next */ }
  }

  // NO FALLBACK. If Aither did not write it, we do not post. Returning null makes
  // the caller SKIP the post rather than publish canned/templated text.
  return null;
}

// ── Image Generation (Bonsai Image service) ──────────────────────────────────
// Generates an image using Bonsai Image (FLUX.2 Klein ternary 4B) and returns
// base64-encoded PNG. On failure (Bonsai unreachable, timeout, bad response),
// returns null and logs the error — HONEST DEGRADATION — so the text post still
// goes out without the image rather than failing silently.
async function xGenerateImage(text) {
  // NOT CONFIGURED is a different fact from NOT REACHABLE, and conflating them
  // sends the owner to debug a service that was never wired for this tier.
  // Every other tier-optional service guards this way (see the BROWSER_URL
  // checks); image generation was the one that just let the fetch fail and
  // reported it as an outage.
  if (!BONSAI_URL) {
    console.warn("[x-autopost] Bonsai Image not configured for this tier — posting text-only (NOT an outage)");
    return null;
  }
  // Derive image prompt from post text (max 60 chars for diversity)
  const imagePrompt = `A visual representation of: ${text.slice(0, 60)}. Professional, modern, clean design.`;

  const payload = {
    prompt: imagePrompt,
    negative_prompt: "",
    width: 1024,
    height: 576,
    num_images: 1,
    seed: Math.floor(Math.random() * 1000000),
  };

  try {
    const resp = await fetch(`${BONSAI_URL}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Caller-Type": "PLATFORM",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.warn(
        `[xGenerateImage] HTTP ${resp.status} from Bonsai Image: ${errorText.slice(0, 200)}`
      );
      return null;
    }

    const data = await resp.json().catch(() => ({}));
    const images = data.images || [];

    if (!images.length) {
      console.warn("[xGenerateImage] Bonsai Image returned no images in response");
      return null;
    }

    // Bonsai returns bare base64, no data: prefix
    return images[0];
  } catch (e) {
    const msg = e.name === "AbortError"
      ? "timeout (30s)"
      : `${e.message || String(e).slice(0, 100)}`;
    console.warn(`[xGenerateImage] Failed to generate image: ${msg}. Post will continue as text-only.`);
    return null;
  }
}

// Route a free-form ask to the SELECTED backend and RETURN the text. Powers the
// Aither-OS taskbar's chat + quick-ask on every website. On-device uses the
// WebGPU host (no auth, no fleet); the others are OpenAI-compatible endpoints or
// genesis /chat over the local bridge.
async function askAither(prompt, backend) {
  backend = backend || "aither-local";
  if (backend === "aither-local") {
    const t = await webmlComposeText(prompt);
    if (t) return t;
    throw new Error("On-device model isn't ready yet (still downloading?)");
  }
  const routes = {
    "aither-genesis": [{ url: `${GENESIS_URL}/chat`, kind: "genesis" }, { url: `${GENESIS_URL}/api/chat`, kind: "genesis" }],
    "aither-node":    [{ url: `${NODE_URL}/chat`, kind: "genesis" }, { url: "http://127.0.0.1:8090/v1/chat/completions", kind: "openai" }],
    "aither-gateway": [{ url: "https://gateway.aitherium.com/v1/chat/completions", kind: "openai" }],
    "aither-mcp":     [{ url: "https://mcp.aitherium.com/v1/chat/completions", kind: "openai" }],
  }[backend] || [];
  const hdrs = { "Content-Type": "application/json", ...authHeaders() };
  let lastErr = "no route configured";
  for (const r of routes) {
    try {
      const body = r.kind === "openai"
        ? { model: "auto", messages: [{ role: "user", content: prompt }], stream: false }
        : { message: prompt, stream: false };
      const resp = await fetch(r.url, {
        method: "POST", headers: hdrs, body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      const d = await resp.json().catch(() => ({}));
      const t = d.response || d.answer || d.text || d.message || d.content
        || (d.choices && d.choices[0] && ((d.choices[0].message && d.choices[0].message.content) || d.choices[0].text));
      if (t && String(t).trim()) return String(t).trim();
      lastErr = d.error || d.detail || `HTTP ${resp.status}`;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(`${backend}: ${lastErr}`);
}

// Runs IN the page (MAIN world). Fills x.com's composer via execCommand (which
// the Draft.js editor treats as real input), attaches an image if provided,
// and clicks Post. Returns a verdict with result.attached indicating whether
// an image was successfully attached.
//
// Parameters:
//   text: the post text (required)
//   imageBase64: base64-encoded PNG image (optional; if omitted, text-only post)
function AITHER_X_PAGE_POSTER(text, imageBase64) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function waitFor(sels, ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el) return el;
        }
        await sleep(200);
      }
      return null;
    }

    // Helper to attach image via file input simulation
    async function attachImage(base64Png) {
      if (!base64Png || typeof base64Png !== "string" || base64Png.length < 100) {
        console.warn("[AITHER_X_PAGE_POSTER] Invalid base64 image data, skipping image attachment");
        return false;
      }

      try {
        // Find the file input (X's media upload button)
        // X.com uses input[type="file"] with various data-testids
        const fileInputs = document.querySelectorAll('input[type="file"]');
        if (!fileInputs.length) {
          console.warn("[AITHER_X_PAGE_POSTER] No file input found, skipping image attachment");
          return false;
        }

        // Convert base64 to blob
        const binaryString = atob(base64Png);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "image/png" });

        // Create a File object
        const file = new File([blob], "aither-post.png", { type: "image/png" });

        // Set the file on the input (this doesn't trigger upload yet)
        const fileInput = fileInputs[0];
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // Trigger change event (X listens to this)
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);

        // Wait for X's UI to process the upload
        await sleep(3000);

        return true;
      } catch (e) {
        console.warn(`[AITHER_X_PAGE_POSTER] Image attachment failed: ${e.message}`);
        return false;
      }
    }

    try {
      const composer = await waitFor(
        ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
        12000
      );
      if (!composer) { resolve({ ok: false, reason: "no_composer", url: location.href, attached: false }); return; }
      composer.focus();
      // Clear any leftover draft FIRST. A stale tick's text would otherwise be
      // APPENDED to this post (the tweet goes out doubled) and the composer is
      // left holding text again — the exact "stays typed, ready to post again"
      // the owner keeps hitting. This also stops a slow click from double-typing.
      try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); await sleep(150); } catch {}
      document.execCommand("insertText", false, text);
      await sleep(900);

      // Attempt image attachment if provided
      let attached = false;
      if (imageBase64) {
        attached = await attachImage(imageBase64);
        if (attached) {
          console.log("[AITHER_X_PAGE_POSTER] Image attached successfully");
        } else {
          console.log("[AITHER_X_PAGE_POSTER] Image attachment failed, continuing with text-only post");
        }
        await sleep(2000);  // Wait for image processing
      }

      const btnSel = ['button[data-testid="tweetButton"]', 'button[data-testid="tweetButtonInline"]'];
      let btn = null;
      for (let i = 0; i < 25; i++) {
        btn = btnSel.map((s) => document.querySelector(s)).find(Boolean);
        if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") break;
        await sleep(200);
      }
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") {
        resolve({ ok: false, reason: "post_button_disabled", attached }); return;
      }
      btn.click();
      // Do NOT trust the click. A post is real only when the composer clears
      // (modal closed / route changed) or X confirms with a toast. Poll for
      // either; if neither appears, wipe the composer so it can never sit
      // "ready to post again" — and report the truth instead of a fake success.
      let cleared = false, confirmed = false;
      for (let i = 0; i < 40; i++) { // up to ~8s
        await sleep(200);
        const boxAfter = document.querySelector('div[data-testid="tweetTextarea_0"]');
        cleared = !boxAfter || (boxAfter.innerText || "").trim().length === 0;
        confirmed = cleared || Array.from(document.querySelectorAll('[data-testid="toast"], div[role="status"]'))
          .some((n) => /sent|posted|shared/i.test(n.innerText || ""));
        if (confirmed) break;
      }
      const wipe = () => {
        const b = document.querySelector('div[data-testid="tweetTextarea_0"]');
        if (!b || (b.innerText || "").trim().length === 0) return;
        b.focus();
        try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch {}
      };
      if (!confirmed) {
        wipe();
        const dup = Array.from(document.querySelectorAll('div[role="alert"], [data-testid="toast"]'))
          .some((n) => /already said that|duplicate/i.test(n.innerText || ""));
        resolve({ ok: false, reason: dup ? "duplicate" : "composer_not_cleared", attached }); return;
      }
      // Confirmed posted. If the composer is somehow still holding the text
      // (X's "post another" flow keeps the editor as a draft), clear it so a
      // second click cannot double-post.
      if (!cleared) {
        const b = document.querySelector('div[data-testid="tweetTextarea_0"]');
        if (b && (b.innerText || "").trim().length > 0) {
          b.focus();
          try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch {}
        }
      }
      resolve({ ok: true, cleared, attached });
    } catch (e) {
      resolve({ ok: false, reason: "exception", error: String(e).slice(0, 200), attached: false });
    }
  });
}

async function xPostInTab(tabId, text, imageBase64) {
  // Bring the tab to the compose surface so the composer definitely exists.
  try {
    await chrome.tabs.update(tabId, { url: "https://x.com/compose/post" });
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 7000);
      chrome.tabs.onUpdated.addListener(function l(id, ch) {
        if (id === tabId && ch.status === "complete") {
          clearTimeout(to);
          chrome.tabs.onUpdated.removeListener(l);
          resolve();
        }
      });
    });
    await new Promise((r) => setTimeout(r, 1200));
  } catch { /* proceed; the composer may already be present */ }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", args: [text, imageBase64], func: AITHER_X_PAGE_POSTER,
    });
    return res?.result || { ok: false, reason: "no_result", attached: false };
  } catch (e) {
    return { ok: false, reason: "inject_failed", error: String(e).slice(0, 200), attached: false };
  }
}

async function xComposeAndPost(tab) {
  if (!tab || !tab.id) { xNotify("Open x.com in a tab first.", false); return { ok: false }; }
  xNotify("Aither is writing a post…", true);
  const text = await xComposeText();
  if (!text) {
    xNotify("Aither could not write a post. Try again in a moment.", false);
    return { ok: false };
  }

  // Generate an image for the post (optional; if it fails, we still post the text)
  xNotify("Generating image…", true);
  const imageBase64 = await xGenerateImage(text);
  if (imageBase64) {
    xNotify("Image ready. Posting…", true);
  } else {
    xNotify("Image generation skipped. Posting text-only…", true);
  }

  const result = await xPostInTab(tab.id, text, imageBase64);
  if (result.ok) {
    const mediaNote = result.attached ? " with image" : "";
    xNotify(`Posted: “${text.slice(0, 80)}”${mediaNote}`, true);
    await xLogActivity({ type: "post", text: text.slice(0, 200), image: !!result.attached });
  } else {
    xNotify(`Post failed (${result.reason || result.error}). Make sure you're on x.com and logged in.`, false);
  }
  // Tell the fleet how it went (best-effort; the extension is the source of truth).
  try {
    await fetch(`${GENESIS_URL}/social/x/posted`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: result.ok, text, image: result.attached, result }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* fire-and-forget */ }
  return result;
}

// ── Engage on the feed: read → Aither decides → like/reply, in the logged-in
//    tab. Growth comes from engagement, not just broadcasting. Budgets + human
//    pacing keep it under X's anti-spam radar. ──────────────────────────────

// Page fn (MAIN world): read the visible home-feed tweets.
function AITHER_X_READ_FEED(limit) {
  const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, limit);
  return arts.map((a, idx) => {
    const link = Array.from(a.querySelectorAll('a[href*="/status/"]'))
      .map((x) => x.getAttribute("href")).find(Boolean) || "";
    const m = link.match(/\/([^/]+)\/status\/(\d+)/);
    const textEl = a.querySelector('div[data-testid="tweetText"]');
    const liked = !!a.querySelector('button[data-testid="unlike"]');
    return {
      idx,
      handle: m ? m[1] : null,
      id: m ? m[2] : null,
      text: textEl ? (textEl.innerText || "").slice(0, 280) : "",
      liked,
    };
  }).filter((t) => t.id && t.text && !t.liked);
}

// Page fn (MAIN world): execute an engagement plan (likes + one reply) with
// human-like pauses. plan = { likes:[idx...], reply:{idx,text}|null }.
function AITHER_X_DO_ENGAGE(plan) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const arts = () => Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const done = { liked: 0, replied: false, errors: [] };
    for (const idx of (plan.likes || [])) {
      try {
        const a = arts()[idx];
        const btn = a && a.querySelector('button[data-testid="like"]');
        if (btn) { btn.click(); done.liked++; await sleep(1500 + Math.random() * 2500); }
      } catch (e) { done.errors.push("like" + idx); }
    }
    if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
      try {
        const a = arts()[plan.reply.idx];
        const rb = a && a.querySelector('button[data-testid="reply"]');
        if (rb) {
          rb.click();
          await sleep(2200);
          const box = document.querySelector('div[data-testid="tweetTextarea_0"]');
          if (box) {
            box.focus();
            document.execCommand("insertText", false, plan.reply.text);
            await sleep(1000);
            let pb = document.querySelector('button[data-testid="tweetButton"]');
            for (let i = 0; i < 25 && (!pb || pb.disabled || pb.getAttribute("aria-disabled") === "true"); i++) {
              await sleep(200); pb = document.querySelector('button[data-testid="tweetButton"]');
            }
            if (pb && !pb.disabled && pb.getAttribute("aria-disabled") !== "true") {
              pb.click(); done.replied = true; await sleep(2500);
            }
          }
        }
      } catch (e) { done.errors.push("reply"); }
    }
    resolve(done);
  });
}

// Aither decides what to engage with. One /chat call over the feed → a JSON plan.
// Budgets are enforced here regardless of what the model returns.
async function xEngagePlan(feed, promptOverride) {
  const summary = feed.map((t) => `[${t.idx}] @${t.handle}: ${t.text.slice(0, 180)}`).join("\n");
  // The command bar's strategy dialog lets the owner edit the engage brief and
  // sends it as `social-engage-plan {feed, prompt}` — but this function's
  // signature was `(feed)`, so the second argument was dropped on the floor.
  // Editing the strategy appeared to save (it does persist to storage) and then
  // changed nothing about what Aither actually did. Same shape as every other
  // defect in this file: a configured control wired to nothing.
  const brief = (promptOverride && String(promptOverride).trim()) || "";
  const rules = "\n\nReturn ONLY JSON: "
    + '{"likes":[idx,...],"reply":{"idx":N,"text":"..."}} or with "reply":null.';
  const prompt = brief
    ? `You are Aither, engaging on X. Current feed:\n${summary}\n\n${brief}${rules}`
    : "You are Aither, engaging on X to grow an audience around AI "
      + "infrastructure, agents, and building in public. Current feed:\n" + summary
      + "\n\nChoose up to 3 tweets to LIKE (genuinely relevant to AI/infra/agents/"
      + "building) and optionally ONE to REPLY to with a short, real, non-spammy "
      + "reply in Aither's first-person voice (under 200 chars, no hashtags, adds "
      + "something)." + rules;
  // Parse + clamp a model answer into a plan, or null if it isn't one.
  const parse = (text) => {
    const plan = self.AitherSocialPlan.extractJsonObject(text);
    if (!plan) return null;
    const valid = new Set(feed.map((f) => f.idx));
    plan.likes = (plan.likes || []).filter((i) => valid.has(i)).slice(0, 3);
    if (!plan.reply || !plan.reply.text || !valid.has(plan.reply.idx)) plan.reply = null;
    else plan.reply.text = String(plan.reply.text).slice(0, 260);
    return plan;
  };

  // 1) PRIMARY: the on-device WebGPU brain — same path xComposeText uses.
  //    This planner used to be fleet-ONLY, which is why the owner saw posts but
  //    never replies: with the fleet unreachable every tick fell through to the
  //    canned branch below, which likes two arbitrary tweets and replies to
  //    nothing. Engagement looked alive and the reply loop had never once run.
  //    Autonomy cannot be contingent on the fleet — during the Podman migration
  //    there IS no fleet, and Aither still has to run its own accounts.
  try {
    // Lower temperature than the poster: this answer has to be parseable JSON,
    // not interesting prose. 320 tokens fits likes + a 200-char reply with room.
    const local = await webmlComposeText(prompt, { maxTokens: 320, temperature: 0.4 });
    const plan = parse(local);
    if (plan) return plan;
  } catch { /* no WebGPU / model still loading — try the fleet */ }

  // 2) FALLBACK: Aither's chat brain via Genesis, when the fleet is up.
  for (const url of [`${GENESIS_URL}/chat`, `${GENESIS_URL}/api/chat`]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: prompt, stream: false }),
        signal: AbortSignal.timeout(45000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d && (d.response || d.answer || d.text || d.message || d.content);
      const plan = parse(t);
      if (plan) return plan;
    } catch { /* try next */ }
  }

  // NO CANNED FALLBACK — matching xComposeText's "if Aither did not write it, we
  // do not post". Liking two arbitrary tweets because no model answered is not
  // engagement, it is noise on the owner's account that also disguises a total
  // brain outage as a working loop. Skip the tick and say so.
  return null;
}

// ── Who drives X automation: this service worker, or an in-page command bar? ──
//
// Both can run post/engage loops, and running both double-posts. The bar used to
// resolve that by writing `xAutopostEnabled:false, xEngageEnabled:false` — the
// USER's kill switch — into storage. That write is permanent, so once the bar
// stopped injecting (commandBarEnabled defaulted false with no UI), the service
// worker went on obeying a kill switch nobody had set. Both drivers off, no
// error, no log line: the account posted nothing for weeks and every surface
// still said "enabled".
//
// A lease fixes the shape of the bug, not just this instance: the bar renews
// `xPageDriverAt` once a minute while it is alive, and the claim EXPIRES. If the
// bar goes away for any reason — disabled, crashed, tab closed, feature deleted —
// the service worker resumes on its own. Nothing has to remember to clean up.
const X_PAGE_DRIVER_TTL_MS = 5 * 60 * 1000; // 5× the 60s renew interval

/** One-time repair of a kill switch poisoned by the old command-bar write.
 *
 *  We cannot ask storage who wrote a `false`. What we can use is the signature:
 *  the bar always wrote BOTH keys false in a single set(), and at the time this
 *  ran there was no user control for either key at all — options/options.html's
 *  "Social Automation (X)" section was added in the same change as this repair,
 *  and content/x-control-panel.js, which has such toggles, is never injected by
 *  anything. So on any profile predating that section, an exact both-false pair
 *  can only have come from the bar. We clear it exactly once, marked by
 *  `xKillSwitchRepairedAt`, so a deliberate later opt-out is never overridden.
 *  A user who genuinely disabled both gets them re-enabled a single time — visible,
 *  reversible, and strictly better than automation that is dead forever in silence. */
let _xKillSwitchRepaired = false;
async function repairXKillSwitch() {
  if (_xKillSwitchRepaired) return;
  _xKillSwitchRepaired = true;
  try {
    const s = await chrome.storage.local.get([
      "xAutopostEnabled", "xEngageEnabled", "xKillSwitchRepairedAt",
    ]);
    if (s.xKillSwitchRepairedAt) return;              // already done on this profile
    if (s.xAutopostEnabled === false && s.xEngageEnabled === false) {
      await chrome.storage.local.remove(["xAutopostEnabled", "xEngageEnabled"]);
      console.warn(
        "[Awconnect] Cleared an X kill switch written by the old command-bar " +
        "coordination path — post/engage were both disabled with no user action. " +
        "Re-disable from the on-page bar or options if that was intentional.",
      );
      xNotify("X automation re-enabled (cleared a stale internal kill switch)", true);
    }
    await chrome.storage.local.set({ xKillSwitchRepairedAt: Date.now() });
  } catch (e) {
    // Could not read storage -> could not judge. Allow a retry on the next tick
    // rather than recording a repair that never happened.
    _xKillSwitchRepaired = false;
    console.debug("[Awconnect] kill-switch repair deferred:", e);
  }
}

/** True when an in-page command bar is currently driving X automation, so this
 *  tick should stand down to avoid double-posting. */
async function xPageDriverActive() {
  try {
    const s = await chrome.storage.local.get(["xPageDriverAt"]);
    return !!(s.xPageDriverAt && Date.now() - s.xPageDriverAt < X_PAGE_DRIVER_TTL_MS);
  } catch {
    return false; // cannot confirm a driver -> drive it ourselves
  }
}

// ── Identity ────────────────────────────────────────────────────────────────
//
// resolveIdentity()/applyIdentity() were inline inside the message switch, which
// meant the ONLY way the extension ever learned who you are was a human clicking
// "Sign in" in the side panel's Setup tab. The portal cookie could be sitting in
// this very browser the whole time and nothing looked at it. They are functions
// now so install, startup and a portal login can all drive them.

/** Find a credential and resolve the caller's identity.
 *  Never throws for an auth failure — returns {ok:false, ...} instead. */
async function resolveIdentity() {
  // 1. Find a token: settings API key > cloud gateway key > portal cookie.
  //    cloudApiKey is the credential pullEntitlement() uses (gateway-issued
  //    aither_sk_*/aither_pat_*) — omitting it here meant a cloud-authenticated
  //    user resolved a tier but never an identity, and the badge sat at
  //    "no workspace" forever (the sidepanel refuses to apply `unverified`
  //    cached identities, so nothing ever escaped it).
  let token = SETTINGS.apiKey || SETTINGS.cloudApiKey || null;
  let source = token ? (SETTINGS.apiKey ? "settings" : "cloud-key") : null;

  if (!token) {
    for (const domain of ["portal.aitherium.com", "demo.aitherium.com", ".aitherium.com"]) {
      try {
        const cookie = await chrome.cookies.get({ url: `https://${domain.replace(/^\./, "")}`, name: "aither_auth_token" });
        if (cookie?.value) {
          token = cookie.value;
          source = `cookie:${domain}`;
          break;
        }
      } catch { /* no cookie access */ }
    }
  }

  // Publish the discovered credential as the PORTAL BEARER.
  //
  // Without this the cookie path resolved an identity and then dropped the
  // token on the floor: `aither_portal_bearer` was written ONLY by the
  // in-extension email+password login (portal-api.js portalLogin /
  // portalVerify2fa). A user signed in at portal.aitherium.com in this very
  // browser therefore had every portal API call go out with NO Authorization
  // header — extension fetches are cross-origin to the portal, so the cookie
  // is never attached either. Three symptoms, one cause:
  //   * /api/me/workspaces  -> 401 -> empty list -> "no workspace"
  //   * mintRelayToken()    -> "not authenticated" -> IRC/relay never connects
  //   * pullEntitlement()   -> "not authenticated" -> owner stuck on tier Free
  if (token) {
    try { await self.AitherPortal.setPortalBearer(token); } catch { /* no session storage */ }
  }

  // Track WHY a verify failed so a transient outage isn't reported as a
  // logout: 401/403 = token actually rejected (truly logged out);
  // network error / timeout / 5xx = verifier unreachable (still signed in).
  let authRejected = false;

  // 2. If we have a token, call /auth/me — walk EVERY surface we might be
  //    authenticated against, exactly the set pullEntitlement() already walks.
  //    The old code only tried the LOCAL Veil bridge (127.0.0.1:3000) when
  //    remoteUrl was empty, so a cloud user with no local dev server never
  //    resolved an identity: /auth/me was unreachable, the fallback returned a
  //    cached identity flagged `unverified`, and the sidepanel's `!unverified`
  //    guard dropped it — tier showed (pullEntitlement hits the gateway) while
  //    the badge stayed "no workspace". First surface that answers 200 wins.
  if (token) {
    const meUrls = [];
    if (SETTINGS.remoteUrl) meUrls.push(`${SETTINGS.remoteUrl.replace(/\/+$/, "")}/api/bridge/identity/auth/me`);
    meUrls.push(`http://${LOOPBACK}:${SETTINGS.veilPort}/api/bridge/identity/auth/me`);
    // The canonical cloud surface. The portal's OWN /api/me/profile accepts the
    // aither_auth_token as a Bearer (getAuthHeaders forwards it) and proxies to
    // Identity's real path — /identity/auth/me — which the generic
    // /api/bridge/identity/auth/me catch-all does NOT (it maps to
    // getServiceUrl('identity')/auth/me, missing the /identity prefix, and
    // 401s on every call; verified live 2026-08-08).
    meUrls.push("https://portal.aitherium.com/api/me/profile");
    for (const identityUrl of meUrls) {
      try {
        const resp = await fetch(identityUrl, {
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          signal: AbortSignal.timeout(6000),
        });
        if (resp.ok) {
          return { ok: true, source, identity: await resp.json(), token };
        }
        if (resp.status === 401 || resp.status === 403) {
          authRejected = true;  // credentials genuinely invalid/expired
        }
        // 5xx / 429 / other → leave authRejected false (transient) and try next surface
      } catch (e) {
        console.debug("[Awconnect] Identity surface unreachable:", identityUrl, e.message);
      }
    }
  }

  // 3. Probe local Genesis for an AitherShell session (~/.aither/auth.json)
  try {
    const localUrl = SETTINGS.remoteUrl
      ? `${SETTINGS.remoteUrl}/api/auth/local-session`
      : `http://${LOOPBACK}:${SETTINGS.veilPort}/api/bridge/genesis/auth/local-session`;
    const localResp = await fetch(localUrl, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (localResp.ok) {
      const session = await localResp.json();
      if (session.authenticated && session.user) {
        return { ok: true, source: "local-genesis", identity: session.user, token: null };
      }
    }
  } catch (e) {
    console.debug("[Awconnect] Local session probe failed:", e.message);
  }

  // 4. Couldn't verify. If we have a usable token/credentials AND the failure
  //    was transient (NOT a 401/403 rejection), the user is still signed in —
  //    the verifier was just unreachable. Return the stored identity with an
  //    `unverified` flag so the UI keeps the session instead of flipping to
  //    "Not authenticated".
  const haveStored = !!(token || SETTINGS.userId || SETTINGS.cloudApiKey);
  if (haveStored && !authRejected) {
    const _slug = (SETTINGS.tenantId || "").replace(/^tnt_/, "");
    return {
      ok: true,
      unverified: true,
      source: "cached",
      token: token || null,
      identity: {
        username: SETTINGS.userId || "",
        display_name: SETTINGS.userId || "",
        tenant_id: SETTINGS.tenantId || "",
        tenant_slug: _slug,
        workspace_id: SETTINGS.workspaceId || "",
        workspace_slug: SETTINGS.workspaceId || "",
      },
    };
  }

  return {
    ok: false,
    authRejected,
    error: authRejected
      ? "Your session expired or was rejected. Sign in again at portal.aitherium.com."
      : "Not authenticated. Log in at portal.aitherium.com or run `aither login`.",
  };
}

/** Ask the portal which workspaces this caller belongs to, and pick one.
 *
 *  `/auth/me` answers WHO you are; on this platform it does not always carry a
 *  workspace, and a platform admin/owner is exactly the shape that comes back
 *  with a tenant and no workspace binding. applyIdentity() used to just skip the
 *  field in that case, so the badge read "no workspace" for the owner of the
 *  platform while every underlying call was perfectly authenticated. The
 *  workspace list has its own endpoint — ask it. */
async function resolveDefaultWorkspace() {
  try {
    const res = await self.AitherPortal.fetchWorkspaceMetadata();
    if (!res || !res.ok || !Array.isArray(res.workspaces) || !res.workspaces.length) return null;
    const list = res.workspaces;
    // Prefer an explicitly default/primary workspace, then one matching the
    // active tenant, then simply the first the backend returned.
    const slug = (SETTINGS.tenantId || "").replace(/^tnt_/, "");
    const pick = list.find(w => w.is_default || w.default || w.primary)
      || (slug && list.find(w => w.tenant_slug === slug || w.tenant_id === SETTINGS.tenantId))
      || list[0];
    return pick || null;
  } catch (e) {
    console.debug("[Awconnect] workspace lookup failed:", e.message);
    return null;
  }
}

/** Write a resolved identity into settings. Returns {ok, applied}. */
async function applyIdentity(identity, token) {
  if (!identity) return { ok: false, error: "no identity" };
  const updates = {};
  if (identity.tenant_id) updates.tenantId = identity.tenant_id;
  // Workspace: prefer workspace_id/slug from /auth/me or the local session.
  if (identity.workspace_id) {
    updates.workspaceId = identity.workspace_id;
  } else if (identity.workspace_slug) {
    updates.workspaceId = identity.workspace_slug;
  }
  if (identity.username) updates.userId = identity.username;
  // Also accept email as userId fallback (local session may have email but not username)
  if (!updates.userId && identity.email) updates.userId = identity.email;
  if (token && !SETTINGS.apiKey) updates.apiKey = token;

  // Publish the bearer BEFORE the workspace lookup — that call needs it.
  if (token) {
    try { await self.AitherPortal.setPortalBearer(token); } catch { /* no session storage */ }
  }
  // Still no workspace? Ask the portal rather than leaving the badge empty.
  if (!updates.workspaceId && !SETTINGS.workspaceId) {
    const ws = await resolveDefaultWorkspace();
    if (ws) {
      updates.workspaceId = ws.id || ws.workspace_id || ws.slug || "";
      if (!updates.tenantId && (ws.tenant_id || ws.tenantId)) {
        updates.tenantId = ws.tenant_id || ws.tenantId;
      }
    }
  }

  await saveSettings({ ...SETTINGS, ...updates });
  // Persist the scopes this user may switch to (from /auth/me).
  try {
    const meta = identity.metadata || {};
    await chrome.storage.local.set({
      "aither-scopes": {
        allowed: identity.allowed_tenants || [],
        owns: meta.owns_tenants || [],
        current: identity.tenant_slug || identity.tenant_id || "",
        defaultScope: meta.default_scope || "",
        updatedAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn("[Awconnect] Could not persist scopes:", e);
  }
  setTimeout(() => { connectToGenesis(); checkHealth(); }, 500);
  // Now that we're authenticated, pull the subscription tier automatically.
  pullEntitlement().catch(() => {});
  // Tell every live OS overlay iframe who just signed in — it cannot see the
  // portal session cookie (cross-site iframe), so the taskbar would sit at
  // "sign in" forever without this handoff.
  broadcastIdentityToOverlays();
  return { ok: true, applied: updates };
}

/** Cheap, sync snapshot of the current identity from settings — no network.
 *  This is what applyIdentity() persists, so it is the OS taskbar's source of
 *  truth for "who am I". */
function buildIdentityFromSettings() {
  const slug = (SETTINGS.tenantId || "").replace(/^tnt_/, "");
  return {
    username: SETTINGS.userId || "",
    display_name: SETTINGS.userId || "",
    tenant_id: SETTINGS.tenantId || "",
    tenant_slug: slug,
    workspace_id: SETTINGS.workspaceId || "",
    workspace_slug: SETTINGS.workspaceId || "",
    verified: !!(SETTINGS.userId || SETTINGS.tenantId || SETTINGS.workspaceId),
  };
}

/** Push the current identity into every tab running the AitherOS overlay so the
 *  OS taskbar (aitherium.com/?mode=overlay iframe) reflects who is signed in.
 *  The iframe is cross-site, so background.js — which CAN resolve the portal
 *  session — is the identity broker; the overlay bridge relays the postMessage. */
async function broadcastIdentityToOverlays() {
  const identity = buildIdentityFromSettings();
  if (!identity.verified) return;
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id) continue;
      try { await chrome.tabs.sendMessage(t.id, { action: "os-identity", identity }); }
      catch { /* no overlay listener on this tab */ }
    }
  } catch { /* tabs permission unavailable */ }
}

/** Resolve + apply in one shot, but only when the stored scope is INCOMPLETE.
 *
 *  The old guard lived in the side panel and read
 *  `if (!settings.tenantId && !settings.userId)`. The badge, 4000 lines away,
 *  renders "no workspace" unless `tenantId || workspaceId` is set. Those two
 *  conditions disagree, and the gap between them is a real state: a userId with
 *  no tenant and no workspace. In it, the guard says "already configured, skip"
 *  and the badge says "no workspace" — permanently, on every launch, with no way
 *  out but the manual Sign-in button. That is the state the owner was stuck in.
 *  Resolve whenever the scope is incomplete, not whenever it is empty. */
async function autoResolveIdentity(reason) {
  try {
    if (SETTINGS.tenantId && SETTINGS.workspaceId && SETTINGS.userId) return null;
    const result = await resolveIdentity();
    if (result?.ok && result.identity && !result.unverified) {
      const applied = await applyIdentity(result.identity, result.token);
      console.log(`[Awconnect] identity auto-resolved (${reason}) via ${result.source}:`, applied.applied);
      return applied;
    }
    return null;
  } catch (e) {
    console.debug("[Awconnect] auto identity resolve failed:", e.message);
    return null;
  }
}

// ── Tenant apps ─────────────────────────────────────────────────────────────
//
// The Apps grid used to be a 35-entry array typed by hand into sidepanel.js. It
// had no relationship to what this tenant actually has: it listed apps that were
// never deployed here and could not list an app the owner deployed yesterday.
// That is what "the app selection is completely random" means — it is not a
// ranking bug, there was simply no query. Genesis owns the real answer:
//   GET /apps/deployments  — what this tenant is RUNNING (tenant_apps.py:818)
//   GET /apps/catalog      — what it COULD install         (tenant_apps.py:779)
// Both are scoped by the X-Tenant-ID / X-Workspace-ID headers authHeaders()
// already sends, which is why this had to wait on the identity fix above: with
// no workspace resolved, these return another tenant's view or nothing at all.

// The registry's `icon` is a Lucide icon NAME, not a glyph — measured against
// live genesis /apps/catalog, which returns e.g. {"slug":"demiurge","icon":"code"}.
// The grid renders the field verbatim, so passing it through would print the
// word "code" where the icon goes on every card.
//
// This map used to cover 20 generic names picked without checking what the
// catalog actually contains, and matched only 4 of the 18 real app manifests
// (aitherium/brain, demiurge/code, jgames/wrench, shell/terminal) — the other
// 14 fell through to the puzzle-piece fallback below, which is why the grid
// was mostly green puzzle pieces regardless of icon field even being present.
// Every entry here was copied from the platform's actual app-manifest catalog
// (grepped the icon field across every real manifest) — the real vocabulary,
// not a guess. Keep this in step when a new manifest introduces an icon name
// this map doesn't have; the fallback below is a stopgap, not a design choice.
const _APP_ICON_BY_NAME = {
  archive: "🗄️", "bar-chart-3": "📊", "book-open": "📖", "book-text": "📚",
  bot: "🤖", box: "📦", brain: "🧠", briefcase: "💼", calculator: "🧮",
  camera: "📷", castle: "🏰", chart: "📈", chat: "💬", cloud: "☁️",
  code: "💻", "code-2": "💻", compass: "🧭", cpu: "🖥️", "credit-card": "💳",
  crown: "👑", database: "🗄️", eye: "👁️", "file-text": "📄", film: "🎬",
  fingerprint: "🔏", "flask-conical": "⚗️", flask: "⚗️", "git-branch": "🌿",
  globe: "🌐", "graduation-cap": "🎓", grid: "▦", "hard-drive": "💽",
  "hard-hat": "👷", image: "🖼️", "key-round": "🔑", landmark: "🏛️",
  leaf: "🍃", library: "📚", link: "🔗", lock: "🔒", mail: "✉️",
  calendar: "📅", megaphone: "📣", mic: "🎙️", network: "🕸️",
  palette: "🎨", "scan-eye": "👁️", search: "🔍", server: "🖥️",
  settings: "⚙️", shield: "🛡️", "shield-check": "🛡️", "shopping-bag": "🛍️",
  sparkles: "✨", star: "⭐", store: "🏪", terminal: "⌨️",
  book: "📚", robot: "🤖", video: "🎬", file: "📁", wrench: "🔧",
  users: "👥", zap: "⚡",
};
function _appIcon(raw, installed) {
  const v = raw.icon;
  if (typeof v === "string" && v) {
    // Anything non-ASCII is already a glyph — pass it through untouched.
    if (/[^\x00-\x7F]/.test(v)) return v;
    const mapped = _APP_ICON_BY_NAME[v.toLowerCase()];
    if (mapped) return mapped;
  }
  return installed ? "📦" : "🧩";
}

/** Normalise one backend record into the shape the Apps grid renders.
 *
 * Route priority, most-real-first:
 *   1. subdomain_url  — the product's OWN dedicated domain (tenant_apps.py sets
 *      this from manifest.subdomain, e.g. "https://garg.aitherium.com"). This is
 *      the one field that is guaranteed to actually resolve for a hosted
 *      product; it was never read before, so a card would take the LESS
 *      reliable endpoint_url even when a real subdomain existed.
 *   2. veil_route     — set only for deployment_mode:"embedded" apps, which
 *      really do live at a path inside the current Veil instance.
 *   3. endpoint_url    — genesis's computed portal-relative URL
 *      (https://portal.aitherium.com/apps/<slug>). Absolute, but only correct
 *      if the portal actually serves a generic embed route for this slug —
 *      unverified per-app, so it ranks below the two routes above.
 * If NONE of those exist, the app has no real destination — most commonly a
 * deployment_mode:"local" workspace (runs via `aither serve --workspace` on
 * someone's own machine) surfaced identically to an always-on hosted product.
 * Synthesizing a fake `/apps/<slug>` route here used to paper over that: the
 * card looked like every other app and 404'd/refused-to-connect on click with
 * no explanation. route is now null in that case — see isAppOpenable() in the
 * side panel, which the grid uses to badge these honestly instead of hiding
 * the failure behind a normal-looking tile. */
function _normalizeTenantApp(raw, installed) {
  const slug = raw.slug || raw.app_slug || raw.id || raw.name;
  if (!slug) return null;
  const route = raw.subdomain_url || raw.veil_route || raw.route || raw.endpoint_url || null;
  return {
    id: String(slug),
    name: raw.display_name || raw.name || String(slug),
    icon: _appIcon(raw, installed),
    route,
    localOnly: raw.deployment_mode === "local",
    category: raw.category || "tenant",
    desc: raw.description || raw.desc || (installed ? "Deployed in this workspace" : "Available to install"),
    status: raw.status === "beta" ? "beta" : "stable",
    installed: !!installed,
    source: "registry",
  };
}

/** Fetch this tenant's deployed + installable apps.
 *
 *  Returns {ok:true, apps, degraded:false} on a real answer, or
 *  {ok:false, error} when the registry could not be reached. It does NOT
 *  silently return an empty list on failure: the caller must be able to tell
 *  "this tenant has no apps" apart from "I could not ask", because those render
 *  identically and the second one is what makes a grid look random. */
async function listTenantApps() {
  const base = GENESIS_URL;               // veil bridge -> genesis
  const headers = authHeaders();
  const get = async (path) => {
    const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    const body = await r.json();
    return Array.isArray(body) ? body : (body.items || body.apps || body.deployments || []);
  };

  // Deployments are the ones that matter; the catalog is a bonus. A catalog
  // failure must not lose the deployed list, so they settle independently.
  const [dep, cat] = await Promise.allSettled([get("/apps/deployments"), get("/apps/catalog")]);
  if (dep.status === "rejected" && cat.status === "rejected") {
    return { ok: false, error: `app registry unreachable: ${dep.reason?.message || "unknown"}` };
  }

  const apps = [];
  const seen = new Set();
  for (const [res, installed] of [[dep, true], [cat, false]]) {
    if (res.status !== "fulfilled") continue;
    for (const raw of res.value) {
      const app = _normalizeTenantApp(raw, installed);
      if (!app || seen.has(app.id)) continue;   // a deployed app wins over its catalog twin
      seen.add(app.id);
      apps.push(app);
    }
  }
  return {
    ok: true,
    apps,
    // True when we got a partial answer — surfaced in the UI rather than hidden.
    degraded: dep.status === "rejected" || cat.status === "rejected",
    deployedFailed: dep.status === "rejected",
  };
}

/** (Re)create the X automation alarms.
 *
 *  Called from BOTH onInstalled and onStartup. It used to live only in
 *  onInstalled: alarms do survive a browser restart, so that mostly worked —
 *  but "mostly" is the wrong guarantee for the thing that decides whether the
 *  account posts at all. If the alarm set is ever lost (profile copy, storage
 *  eviction, a disable/enable cycle that skips onInstalled) nothing recreates
 *  it and the automation is dead until a reinstall, with every UI still
 *  reporting "enabled". `chrome.alarms.create` on an existing name just
 *  rewrites it, so calling this repeatedly is free. */
async function ensureXAlarms() {
  const s = await chrome.storage.local.get([
    "xAutopostIntervalMin", "xEngageIntervalMin", "xDiscoverIntervalMin",
  ]);
  const postMins = Number(s.xAutopostIntervalMin) || 180; // ~8/day default
  chrome.alarms.create("x-autopost", { periodInMinutes: postMins, delayInMinutes: 1 });
  // Engagement runs more often than posting — that's where growth comes from.
  const engMins = Number(s.xEngageIntervalMin) || 60; // hourly default
  chrome.alarms.create("x-engage", { periodInMinutes: engMins, delayInMinutes: 3 });
  // Discovery: search topics, follow accounts, engage beyond the home feed.
  const discMins = Number(s.xDiscoverIntervalMin) || 150; // ~every 2.5h
  chrome.alarms.create("x-discover", { periodInMinutes: discMins, delayInMinutes: 5 });
  // Daily digest: roll up the day's activity + follower trend into one notice.
  chrome.alarms.create("x-daily-summary", { periodInMinutes: 1440, delayInMinutes: 10 });
  // LinkedIn mirrors X — autonomous post/engage/discover, so the account runs
  // even when no linkedin tab is open. The on-page bar (liPageDriverAt lease)
  // drives instead when it is present; same model as X.
  const liPostMins = Number(s.liAutopostIntervalMin) || 360;
  chrome.alarms.create("li-autopost", { periodInMinutes: liPostMins, delayInMinutes: 2 });
  const liEngMins = Number(s.liEngageIntervalMin) || 120;
  chrome.alarms.create("li-engage", { periodInMinutes: liEngMins, delayInMinutes: 4 });
  const liDiscMins = Number(s.liDiscoverIntervalMin) || 240;
  chrome.alarms.create("li-discover", { periodInMinutes: liDiscMins, delayInMinutes: 6 });
}

async function xEngageTick(force) {
  try {
    await repairXKillSwitch();
    const s = await chrome.storage.local.get(["xEngageEnabled"]);
    if (s.xEngageEnabled === false) return; // kill switch (user intent only)
    // The on-page bar has the wheel — UNLESS the bar itself handed us the work
    // (its page had no feed, e.g. a profile tab, and it asked us to run).
    if (!force && await xPageDriverActive()) return;
    let tabs = await chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] });
    let tab = tabs && tabs[0];
    if (!tab) tab = await chrome.tabs.create({ url: "https://x.com/home", active: false });
    else await chrome.tabs.update(tab.id, { url: "https://x.com/home" });
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 7000);
      chrome.tabs.onUpdated.addListener(function l(id, ch) {
        if (id === tab.id && ch.status === "complete") {
          clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); resolve();
        }
      });
    });
    await new Promise((r) => setTimeout(r, 2500));
    // Scroll the feed a few times before reading. Engagement used to see only
    // the ~10-15 posts rendered on load, so it kept picking from the same top
    // slice every hour — shallow and repetitive by construction. Loading a few
    // screens down surfaces newer candidates.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: () => new Promise((resolve) => {
          const el = document.querySelector('div[data-testid="primaryColumn"], main') || document.scrollingElement || document.documentElement;
          let n = 0;
          const step = () => { if (n++ >= 3) { resolve(true); return; } try { el.scrollTop += 1800; } catch { /* non-scroller */ } setTimeout(step, 1600); };
          step();
        }),
      });
    } catch { /* scroll is best-effort */ }
    const [{ result: feed } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_READ_FEED, args: [15],
    });
    if (!feed || !feed.length) return;
    const plan = await xEngagePlan(feed);
    if (!plan) {
      // Neither the on-device model nor the fleet produced a plan. Skipping is
      // correct — but skipping SILENTLY is how this loop looked healthy for weeks
      // while never replying to anything. Make a brain outage visible.
      console.warn("[Awconnect] x-engage skipped: no model produced a plan "
        + "(on-device WebGPU unavailable and fleet unreachable)");
      xNotify("X engage skipped — no brain available (on-device model not ready, fleet unreachable)", false);
      return;
    }
    const [{ result: done } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_DO_ENGAGE, args: [plan],
    });
    if (done && (done.liked || done.replied)) {
      xNotify(`Engaged: ${done.liked} likes${done.replied ? " + 1 reply" : ""}`, true);
      await xLogActivity({ type: "engage", liked: done.liked || 0, replied: done.replied ? 1 : 0, source: "home" });
    }
  } catch (e) {
    console.debug("[Awconnect] x-engage tick failed:", e);
  }
}

// ── Discovery: seek out AI/infra accounts and conversations beyond the home
//    feed. Rotates search topics → follows relevant accounts → engages topic
//    tweets. This is how the audience actually grows. ─────────────────────────

const AITHER_X_TOPICS = [
  "AI agents", "LLM infrastructure", "self-hosted AI", "autonomous agents",
  "AI automation", "open source AI", "MLOps", "local LLM", "AI infrastructure",
  "building AI products",
];

// Page fn (MAIN world): read user cells from a people-search page.
function AITHER_X_READ_SEARCH_USERS(limit) {
  const cells = Array.from(document.querySelectorAll('[data-testid="UserCell"]')).slice(0, limit);
  return cells.map((c, idx) => {
    const href = Array.from(c.querySelectorAll('a[href^="/"]'))
      .map((a) => a.getAttribute("href"))
      .find((h) => h && h.length > 1 && !h.includes("/i/") && !h.includes("/status/"));
    const handle = href ? href.replace(/^\//, "").split("/")[0] : null;
    const following = !!c.querySelector('button[data-testid$="-unfollow"]');
    const followBtn = c.querySelector('button[data-testid$="-follow"]');
    return {
      idx, handle,
      canFollow: !!followBtn && !following,
      text: (c.innerText || "").replace(/\s+/g, " ").slice(0, 220),
    };
  }).filter((u) => u.handle && u.canFollow);
}

// Page fn (MAIN world): follow the selected user cells, human-paced.
function AITHER_X_DO_FOLLOW(plan) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cells = () => Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
    const done = { followed: 0, errors: [] };
    for (const idx of (plan.follow || [])) {
      try {
        const c = cells()[idx];
        const btn = c && c.querySelector('button[data-testid$="-follow"]');
        if (btn) { btn.click(); done.followed++; await sleep(2500 + Math.random() * 3500); }
      } catch (e) { done.errors.push("follow" + idx); }
    }
    resolve(done);
  });
}

// Aither picks which discovered accounts are worth following (relevance only —
// no follow-for-follow spam). Budget enforced client-side.
async function xDiscoverPlan(users, maxFollows) {
  const summary = users.map((u) => `[${u.idx}] @${u.handle}: ${u.text.slice(0, 140)}`).join("\n");
  // PER-ACCOUNT VERDICT WITH A REASON, not "pick up to N".
  //
  // Measured on the real model 2026-08-02 (Bonsai-4B Q1_0 on the 5090, 24 tok/s):
  // the old "Pick up to N genuinely relevant accounts ... NOT engagement-farmers"
  // returned {"follow":[0,1,2]} — following a candidate literally described as
  // "follow4follow crypto signals". Handed a shortlist and a budget, a small
  // model returns the shortlist. The same model asked to judge EACH account and
  // say WHY got all four right, including `follow:false` for both the botfarm and
  // an NFT shill, with correct reasoning for each.
  //
  // That is not cosmetic: this is the loop that FOLLOWS people, capped at 15/day,
  // and indiscriminate following is what X flags. A prompt that rubber-stamps the
  // shortlist is only marginally better than the blind fallback that was removed.
  const prompt = "You are Aither, growing an audience around AI infrastructure, "
    + "agents, and building in public.\n\nJudge EACH account below. For each, "
    + "decide follow true/false.\nfollow=true ONLY for real builders, researchers "
    + "or tools in AI/infra/agents.\nfollow=false for engagement-farmers "
    + "(follow4follow, 'like and RT'), crypto/NFT shills, and anything unrelated.\n\n"
    + "Accounts:\n" + summary
    + "\n\nReturn ONLY JSON, one entry per account, in order:\n"
    + '{"verdicts":[{"idx":0,"follow":true,"why":"..."},...]}';
  const parse = (text) => {
    const plan = self.AitherSocialPlan.extractJsonObject(text);
    if (!plan) return null;
    const valid = new Set(users.map((u) => u.idx));
    // Verdict shape is what we now ask for; the flat {"follow":[...]} is still
    // accepted because a model that ignores the format should degrade to the old
    // behaviour rather than to "no plan at all" (which skips the whole tick).
    if (Array.isArray(plan.verdicts)) {
      plan.follow = plan.verdicts
        .filter((v) => v && v.follow === true && valid.has(v.idx))
        .map((v) => v.idx);
    }
    plan.follow = (plan.follow || []).filter((i) => valid.has(i)).slice(0, maxFollows);
    return plan;
  };

  // On-device brain first — same reason as xEngagePlan: the fleet is not a
  // prerequisite for Aither running its own accounts. Low temperature because
  // this answer has to parse, not read well.
  try {
    // Budget: 95 tokens per verdict (idx + follow + a one-line `why`), cap 1200.
    //
    // Sized against the candidate count, never a flat number, because truncation
    // here fails QUIETLY in the worst way: the extractor falls back to the first
    // COMPLETE inner object -- a single {"idx":0,"follow":true,"why":...} -- which
    // has no verdicts array, so `plan.follow` resolves to [] and discovery follows
    // nobody, on every tick, forever. Fail-closed (good) and invisible (not good).
    //
    // 95 comes from FIVE captured answers on the real model (Bonsai-4B Q1_0,
    // 2026-08-02), not an estimate. Per-verdict cost varied 39-61 tokens across
    // them; the worst was 1460 chars for 6 verdicts. An earlier coefficient of 65
    // was derived from the single SMALLEST sample (39 tok/verdict) and looked like
    // 1.66x headroom while really having 1.29x -- and it TRUNCATED outright at 15
    // candidates. Sampling once and calling it measured is how that happened.
    const local = await webmlComposeText(prompt, {
      maxTokens: Math.min(1200, 120 + users.length * 95),
      temperature: 0.3,
    });
    const plan = parse(local);
    if (plan) return plan;
  } catch { /* no WebGPU / model loading — try the fleet */ }

  for (const url of [`${GENESIS_URL}/chat`, `${GENESIS_URL}/api/chat`]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: prompt, stream: false }),
        signal: AbortSignal.timeout(45000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d && (d.response || d.answer || d.text || d.message || d.content);
      const plan = parse(t);
      if (plan) return plan;
    } catch { /* try next */ }
  }

  // NO BLIND FALLBACK. This used to `return { follow: users.slice(0, maxFollows) }`
  // — follow the first N accounts a search returned, with no judgement at all,
  // up to the 15/day cap. That is not "degraded discovery", it is the exact
  // behaviour X flags as aggressive following, aimed at whoever happened to rank
  // first for a topic query. It would have run on every tick that could not
  // reach the fleet, which during the Podman migration is every tick.
  // The prompt's whole job is "NOT engagement-farmers, NOT unrelated"; with no
  // model there is nothing to enforce that, so follow nobody.
  return null;
}

// Daily follow budget (X flags aggressive following hard). Resets each day.
async function xFollowBudget() {
  const today = new Date().toISOString().slice(0, 10);
  const s = await chrome.storage.local.get(["xFollowDate", "xFollowsToday", "xFollowDailyCap"]);
  const cap = Number(s.xFollowDailyCap) || 15;
  const used = s.xFollowDate === today ? (Number(s.xFollowsToday) || 0) : 0;
  return { remaining: Math.max(0, cap - used), today, used };
}
async function xRecordFollows(n, today, used) {
  await chrome.storage.local.set({ xFollowDate: today, xFollowsToday: used + n });
}

async function _xLoadTab(url) {
  let tabs = await chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] });
  let tab = tabs && tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url, active: false });
  else await chrome.tabs.update(tab.id, { url });
  await new Promise((resolve) => {
    const to = setTimeout(resolve, 8000);
    chrome.tabs.onUpdated.addListener(function l(id, ch) {
      if (id === tab.id && ch.status === "complete") {
        clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); resolve();
      }
    });
  });
  await new Promise((r) => setTimeout(r, 2800));
  return tab;
}

async function xDiscoverTick() {
  try {
    const s = await chrome.storage.local.get(["xDiscoverEnabled", "xDiscoverTopicIdx"]);
    if (s.xDiscoverEnabled === false) return; // kill switch
    const topic = AITHER_X_TOPICS[(Number(s.xDiscoverTopicIdx) || 0) % AITHER_X_TOPICS.length];
    await chrome.storage.local.set({
      xDiscoverTopicIdx: ((Number(s.xDiscoverTopicIdx) || 0) + 1) % AITHER_X_TOPICS.length,
    });
    const q = encodeURIComponent(topic);

    // 1) People search → follow relevant accounts (within the daily budget).
    const budget = await xFollowBudget();
    if (budget.remaining > 0) {
      const tab = await _xLoadTab(`https://x.com/search?q=${q}&src=typed_query&f=user`);
      const [{ result: users } = {}] = await chrome.scripting.executeScript({
        // 6, not 15. Every candidate costs a full verdict+reason in the model's
        // answer, and the per-tick follow cap is 3 — judging 15 to pick at most 3
        // spends ~1000 tokens to reach the same decision, and risks truncating the
        // answer into "follow nobody". Discovery rotates topics each tick, so a
        // narrower slice per tick still covers the space.
        target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_READ_SEARCH_USERS, args: [6],
      });
      if (users && users.length) {
        const perTick = Math.min(3, budget.remaining);
        const plan = await xDiscoverPlan(users, perTick);
        if (!plan) {
          // No brain -> no judgement about who is worth following. Skip only the
          // FOLLOW step (step 2's topic engagement below is independent and has
          // its own brain check); following anyway is what gets an account
          // flagged, and a blind follow is not a degraded version of a judged
          // one, it is a different and worse action.
          console.warn(`[Awconnect] x-discover: no plan for "${topic}" `
            + "(on-device model unavailable and fleet unreachable) — followed nobody");
        } else {
          const [{ result: done } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_DO_FOLLOW, args: [plan],
          });
          if (done && done.followed) {
            await xRecordFollows(done.followed, budget.today, budget.used);
            xNotify(`Followed ${done.followed} in “${topic}”`, true);
            await xLogActivity({ type: "follow", count: done.followed, topic });
          }
        }
      }
    }

    // 2) Latest tweets for the topic → like/reply (reuses the engagement path).
    const tab2 = await _xLoadTab(`https://x.com/search?q=${q}&src=typed_query&f=live`);
    const [{ result: feed } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab2.id }, world: "MAIN", func: AITHER_X_READ_FEED, args: [15],
    });
    if (feed && feed.length) {
      const plan = await xEngagePlan(feed);
      // xEngagePlan returns null when no model answered. Passing that straight
      // into the injected function would reach `plan.likes` in the page and
      // throw inside a MAIN-world script, where the failure is invisible to
      // this try/catch's usual reporting.
      if (!plan) {
        console.warn(`[Awconnect] x-discover: no engage plan for "${topic}" `
          + "(no brain available) — engaged nothing");
      } else {
        const [{ result: done } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab2.id }, world: "MAIN", func: AITHER_X_DO_ENGAGE, args: [plan],
        });
        if (done && (done.liked || done.replied)) {
          xNotify(`“${topic}”: ${done.liked} likes${done.replied ? " + reply" : ""}`, true);
          await xLogActivity({ type: "engage", liked: done.liked || 0, replied: done.replied ? 1 : 0, source: "discover", topic });
        }
      }
    }
  } catch (e) {
    console.debug("[Awconnect] x-discover tick failed:", e);
  }
}

// ── LinkedIn autonomous automation (mirrors the X loops) ─────────────────────
// LinkedIn used to be bar-only: if no linkedin.com tab was open, NOTHING ran and
// the account sat silent until a human opened a tab. These SW ticks open a tab
// when none exists and drive post/engage/discover through their own page
// functions, exactly like X. The on-page bar claims `liPageDriverAt` when it is
// present and drives instead (its own scheduler already runs engage + post).

const AITHER_LI_TOPICS = [
  "AI agents", "LLM infrastructure", "self-hosted AI", "autonomous agents",
  "AI automation", "open source AI", "MLOps", "enterprise AI", "machine learning platform",
];

async function liPageDriverActive() {
  try {
    const s = await chrome.storage.local.get(["liPageDriverAt"]);
    return !!(s.liPageDriverAt && Date.now() - s.liPageDriverAt < X_PAGE_DRIVER_TTL_MS);
  } catch { return false; }
}

// Page fn (MAIN world): read LinkedIn feed updates (button-anchored like the bar).
function AITHER_LI_READ_FEED(limit) {
  const likeButtons = () => Array.from(document.querySelectorAll("button")).filter((b) => {
    const l = (b.getAttribute("aria-label") || "").toLowerCase();
    return b.getAttribute("aria-pressed") !== "true" && (l.startsWith("like") || l.startsWith("react like"));
  });
  const container = (btn) => { let p = btn; for (let i = 0; i < 16 && p; i++) { p = p.parentElement; if (!p) break; const c = (p.className || "").toString(); if ((p.getAttribute && p.getAttribute("data-urn")) || /feed-shared-update|fie-impression|update-v2|occludable/.test(c)) return p; } return btn.closest('[role="article"], article') || btn.parentElement; };
  const out = [];
  const b = likeButtons();
  for (let i = 0; i < b.length && out.length < (limit || 15); i++) {
    const p = container(b[i]);
    const t = ((p && p.innerText) || "").replace(/\s+/g, " ").trim();
    if (t.length > 25) out.push({ idx: i, id: i, handle: null, text: t.slice(0, 300) });
  }
  return out;
}

// Page fn (MAIN world): execute a LinkedIn engagement plan (likes + one reply).
function AITHER_LI_DO_ENGAGE(plan) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const likeButtons = () => Array.from(document.querySelectorAll("button")).filter((b) => {
      const l = (b.getAttribute("aria-label") || "").toLowerCase();
      return b.getAttribute("aria-pressed") !== "true" && (l.startsWith("like") || l.startsWith("react like"));
    });
    const container = (btn) => { let p = btn; for (let i = 0; i < 16 && p; i++) { p = p.parentElement; if (!p) break; const c = (p.className || "").toString(); if ((p.getAttribute && p.getAttribute("data-urn")) || /feed-shared-update|fie-impression|update-v2|occludable/.test(c)) return p; } return btn.closest('[role="article"], article') || btn.parentElement; };
    const done = { liked: 0, replied: false, errors: [] };
    const b = likeButtons();
    for (const idx of (plan.likes || [])) {
      try { if (b[idx]) { b[idx].click(); done.liked++; await sleep(1800 + Math.random() * 2500); } } catch (e) { done.errors.push("like" + idx); }
    }
    if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
      try {
        const p = b[plan.reply.idx] && container(b[plan.reply.idx]);
        const cb = p && Array.from(p.querySelectorAll("button")).find((x) => /comment/i.test(x.getAttribute("aria-label") || ""));
        if (cb) {
          cb.click(); await sleep(2200);
          const box = document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
          if (box) {
            box.focus(); document.execCommand("insertText", false, plan.reply.text); await sleep(1200);
            let pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]');
            for (let i = 0; i < 25 && (!pb || pb.disabled); i++) { await sleep(200); pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]'); }
            if (pb && !pb.disabled) { pb.click(); done.replied = true; await sleep(2000); }
          }
        }
      } catch (e) { done.errors.push("reply"); }
    }
    resolve(done);
  });
}

// Page fn (MAIN world): open the LinkedIn share box, type, Post, and verify the
// box closed. Same clear-before-type + verify-after-click contract as the X
// poster, so a stale draft is never appended and the composer is never left
// loaded ready to double-post.
function AITHER_LI_PAGE_POSTER(text) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wait = async (sels, ms) => { const end = Date.now() + ms; while (Date.now() < end) { for (const s of sels) { const e = document.querySelector(s); if (e) return e; } await sleep(250); } return null; };
    try {
      const st = await wait(['button.share-box-feed-entry__trigger', 'button[class*="share-box-feed-entry"]'], 8000);
      if (st) st.click();
      const box = await wait(['.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'], 10000);
      if (!box) { resolve({ ok: false, reason: "no_composer" }); return; }
      box.focus();
      try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); await sleep(150); } catch {}
      document.execCommand("insertText", false, text); await sleep(1200);
      let pb = await wait(['button.share-actions__primary-action', 'button[class*="share-actions__primary"]'], 5000);
      for (let i = 0; i < 20 && (!pb || pb.disabled); i++) { await sleep(250); pb = document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]'); }
      if (!pb || pb.disabled) { resolve({ ok: false, reason: "post_button_disabled" }); return; }
      pb.click();
      // Verify the post actually landed: the share box closes on success.
      let confirmed = false;
      for (let i = 0; i < 32; i++) { // up to ~8s
        await sleep(250);
        const editorGone = !document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
        const boxGone = !document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]');
        if (editorGone || boxGone) { confirmed = true; break; }
      }
      if (!confirmed) {
        const bx = document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
        if (bx) { bx.focus(); try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch {} }
        resolve({ ok: false, reason: "composer_not_cleared" }); return;
      }
      resolve({ ok: true });
    } catch (e) {
      resolve({ ok: false, reason: "exception", error: String(e).slice(0, 200) });
    }
  });
}

// Page fn (MAIN world): read LinkedIn people-search result cells + follow status.
function AITHER_LI_READ_SEARCH_USERS(limit) {
  const cells = Array.from(document.querySelectorAll('li.entity-result, div.entity-result__content')).slice(0, limit);
  return cells.map((c, idx) => {
    const followBtn = Array.from(c.querySelectorAll("button")).find((b) => /^follow/i.test((b.getAttribute("aria-label") || "").trim()));
    const unfollowBtn = Array.from(c.querySelectorAll("button")).find((b) => /^unfollow/i.test((b.getAttribute("aria-label") || "").trim()));
    return {
      idx,
      handle: null,
      canFollow: !!followBtn && !unfollowBtn,
      text: (c.innerText || "").replace(/\s+/g, " ").slice(0, 220),
    };
  }).filter((u) => u.canFollow);
}

// Page fn (MAIN world): follow the selected LinkedIn people-search cells, paced.
function AITHER_LI_DO_FOLLOW(plan) {
  return new Promise(async (resolve) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cells = () => Array.from(document.querySelectorAll('li.entity-result, div.entity-result__content'));
    const done = { followed: 0, errors: [] };
    for (const idx of (plan.follow || [])) {
      try {
        const c = cells()[idx];
        const btn = c && Array.from(c.querySelectorAll("button")).find((b) => /^follow/i.test((b.getAttribute("aria-label") || "").trim()));
        if (btn) { btn.click(); done.followed++; await sleep(2500 + Math.random() * 3500); }
      } catch (e) { done.errors.push("follow" + idx); }
    }
    resolve(done);
  });
}

async function _liLoadTab(url) {
  let tabs = await chrome.tabs.query({ url: ["*://linkedin.com/*", "*://www.linkedin.com/*"] });
  let tab = tabs && tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url, active: false });
  else await chrome.tabs.update(tab.id, { url });
  await new Promise((resolve) => {
    const to = setTimeout(resolve, 8000);
    chrome.tabs.onUpdated.addListener(function l(id, ch) {
      if (id === tab.id && ch.status === "complete") { clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); resolve(); }
    });
  });
  await new Promise((r) => setTimeout(r, 2800));
  return tab;
}

async function liStrategy() {
  try {
    const s = await chrome.storage.local.get(["socialStrategy"]);
    return (s.socialStrategy && s.socialStrategy.linkedin) || {};
  } catch { return {}; }
}
async function liFollowBudget() {
  const today = new Date().toISOString().slice(0, 10);
  const s = await chrome.storage.local.get(["liFollowDate", "liFollowsToday", "liFollowDailyCap"]);
  const cap = Number(s.liFollowDailyCap) || 10;
  const used = s.liFollowDate === today ? (Number(s.liFollowsToday) || 0) : 0;
  return { remaining: Math.max(0, cap - used), today, used };
}
async function liRecordFollows(n, today, used) {
  await chrome.storage.local.set({ liFollowDate: today, liFollowsToday: used + n });
}

async function liAutopostTick() {
  try {
    const s = await chrome.storage.local.get(["liAutopostEnabled"]);
    if (s.liAutopostEnabled === false) return; // kill switch (user intent only)
    if (await liPageDriverActive()) return;     // the on-page bar has the wheel
    const st = await liStrategy();
    const prompt = (st.post && st.post.prompt)
      || "Write ONE professional LinkedIn post (2-4 short lines) in Aither's voice about AI infrastructure or building autonomous systems. No hashtags. Return only the post.";
    const text = await xComposeText(prompt);
    if (!text) { xNotify("LinkedIn: Aither could not write a post", false); return; }
    const tab = await _liLoadTab("https://www.linkedin.com/feed/");
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_LI_PAGE_POSTER, args: [text],
    });
    if (result && result.ok) {
      xNotify("LinkedIn posted", true);
      await xLogActivity({ platform: "linkedin", type: "post", text: text.slice(0, 200) });
    } else {
      xNotify("LinkedIn post failed: " + ((result && result.reason) || "unknown"), false);
    }
  } catch (e) {
    console.debug("[Awconnect] li-autopost tick failed:", e);
  }
}

async function liEngageTick() {
  try {
    const s = await chrome.storage.local.get(["liEngageEnabled"]);
    if (s.liEngageEnabled === false) return;
    if (await liPageDriverActive()) return;
    const tab = await _liLoadTab("https://www.linkedin.com/feed/");
    const [{ result: feed } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_LI_READ_FEED, args: [15],
    });
    if (!feed || !feed.length) return;
    const st = await liStrategy();
    const plan = await xEngagePlan(feed, (st.engage && st.engage.prompt) || "");
    if (!plan) {
      console.warn("[Awconnect] li-engage skipped: no model produced a plan "
        + "(on-device WebGPU unavailable and fleet unreachable)");
      return;
    }
    const [{ result: done } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_LI_DO_ENGAGE, args: [plan],
    });
    if (done && (done.liked || done.replied)) {
      xNotify(`LinkedIn engaged: ${done.liked} likes${done.replied ? " + reply" : ""}`, true);
      await xLogActivity({ platform: "linkedin", type: "engage", liked: done.liked || 0, replied: done.replied ? 1 : 0 });
    }
  } catch (e) {
    console.debug("[Awconnect] li-engage tick failed:", e);
  }
}

async function liDiscoverTick() {
  try {
    const s = await chrome.storage.local.get(["liDiscoverEnabled", "liDiscoverTopicIdx"]);
    if (s.liDiscoverEnabled === false) return; // kill switch
    if (await liPageDriverActive()) return;
    const topic = AITHER_LI_TOPICS[(Number(s.liDiscoverTopicIdx) || 0) % AITHER_LI_TOPICS.length];
    await chrome.storage.local.set({ liDiscoverTopicIdx: ((Number(s.liDiscoverTopicIdx) || 0) + 1) % AITHER_LI_TOPICS.length });
    const q = encodeURIComponent(topic);
    const budget = await liFollowBudget();
    if (budget.remaining > 0) {
      const tab = await _liLoadTab(`https://www.linkedin.com/search/results/people/?keywords=${q}`);
      const [{ result: users } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", func: AITHER_LI_READ_SEARCH_USERS, args: [6],
      });
      if (users && users.length) {
        const perTick = Math.min(3, budget.remaining);
        const plan = await xDiscoverPlan(users, perTick);
        if (plan) {
          const [{ result: done } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN", func: AITHER_LI_DO_FOLLOW, args: [plan],
          });
          if (done && done.followed) {
            await liRecordFollows(done.followed, budget.today, budget.used);
            xNotify(`LinkedIn followed ${done.followed} in “${topic}”`, true);
            await xLogActivity({ platform: "linkedin", type: "follow", count: done.followed, topic });
          }
        }
      }
    }
  } catch (e) {
    console.debug("[Awconnect] li-discover tick failed:", e);
  }
}

// ── Activity log + daily engagement summary ──────────────────────────────────
// Every autonomous action is logged; a once-a-day digest rolls it up alongside
// the follower-count trend so growth is visible at a glance.

async function xLogActivity(entry) {
  try {
    const s = await chrome.storage.local.get(["xActivityLog"]);
    const log = Array.isArray(s.xActivityLog) ? s.xActivityLog : [];
    log.push({ t: Date.now(), ...entry });
    while (log.length > 1000) log.shift(); // ~weeks of history
    await chrome.storage.local.set({ xActivityLog: log });
  } catch { /* logging must never break an action */ }
}

function _xParseCount(raw) {
  if (raw == null) return null;
  const m = String(raw).replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([KMB]?)/i);
  if (!m) return null;
  const mult = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

function AITHER_X_READ_HANDLE() {
  const el = document.querySelector('button[data-testid="SideNav_AccountSwitcher_Button"]');
  const m = (el ? el.innerText : "").match(/@([A-Za-z0-9_]{1,15})/);
  return m ? m[1] : null;
}
function AITHER_X_READ_FOLLOWERS() {
  const pick = (suf) => {
    const a = document.querySelector(`a[href$="${suf}"]`);
    if (!a) return null;
    const span = a.querySelector("span[title]");
    return span ? span.getAttribute("title") : (a.innerText || "").split("\n")[0];
  };
  return pick("/verified_followers") || pick("/followers");
}

async function xTrackFollowers() {
  try {
    const tab = await _xLoadTab("https://x.com/home");
    const [{ result: handle } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_READ_HANDLE, args: [],
    });
    if (!handle) return null;
    const tab2 = await _xLoadTab(`https://x.com/${handle}`);
    const [{ result: raw } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab2.id }, world: "MAIN", func: AITHER_X_READ_FOLLOWERS, args: [],
    });
    const count = _xParseCount(raw);
    if (count == null) return null;
    const today = new Date().toISOString().slice(0, 10);
    const s = await chrome.storage.local.get(["xFollowerHistory"]);
    const hist = Array.isArray(s.xFollowerHistory) ? s.xFollowerHistory : [];
    const row = hist.find((h) => h.date === today);
    if (row) row.count = count; else hist.push({ date: today, count });
    while (hist.length > 90) hist.shift();
    await chrome.storage.local.set({ xFollowerHistory: hist, xHandle: handle });
    return { handle, count };
  } catch { return null; }
}

async function xDailySummary() {
  const s = await chrome.storage.local.get(["xActivityLog", "xFollowerHistory", "xHandle"]);
  const today = new Date().toISOString().slice(0, 10);
  const startOfDay = new Date(today).getTime();
  const log = (s.xActivityLog || []).filter((e) => e.t >= startOfDay);
  const sum = (type, field) => log.filter((e) => e.type === type).reduce((n, e) => n + (e[field] || 0), 0);
  const posts = log.filter((e) => e.type === "post").length;
  const likes = sum("engage", "liked");
  const replies = sum("engage", "replied");
  const follows = sum("follow", "count");
  const hist = s.xFollowerHistory || [];
  const todayF = hist.find((h) => h.date === today);
  const prevF = hist.filter((h) => h.date < today).slice(-1)[0];
  let followerLine = "";
  if (todayF) {
    const delta = prevF ? todayF.count - prevF.count : null;
    followerLine = `\nFollowers: ${todayF.count}` + (delta != null ? ` (${delta >= 0 ? "+" : ""}${delta} today)` : "");
  }
  const text = `Today on X @${s.xHandle || "?"}\n`
    + `Posts ${posts} · Likes ${likes} · Replies ${replies} · Follows ${follows}`
    + followerLine;
  return { posts, likes, replies, follows, followers: todayF ? todayF.count : null, text };
}

// Last X daily summary, cached so a sidepanel opened by the toast click (which
// happens AFTER the broadcast above) can still pull it. Without this, clicking
// the "X stats" notification landed on a fresh sidepanel that had missed the
// broadcast and had nothing to show — the panel's default Chat view.
let _lastXDailySummary = null;

async function xDailySummaryTick() {
  await xTrackFollowers();          // refresh today's follower count first
  const sum = await xDailySummary();
  _lastXDailySummary = sum;
  // Route the click to the extension's OWN X/social surface (the side panel),
  // not the portal dashboard — that is what the owner keeps getting dumped on.
  xNotify(sum.text, true, chrome.runtime.getURL("sidepanel/sidepanel.html"));
  await xLogActivity({ type: "summary", detail: sum.text });
  broadcastToSidePanel({ type: "x-daily-summary", summary: sum });
}

// Read THIS browser's own x.com cookies and hand them to the fleet's
// verify-and-store endpoint. The account's session is used to post as itself;
// no password is ever read or sent. Loopback bridge only — the cookies never
// leave the machine except to the local worker/genesis endpoint.
async function xSessionSync() {
  let cookies;
  try {
    // Both hosts: some session cookies are set on x.com, some on twitter.com.
    const [a, b] = await Promise.all([
      chrome.cookies.getAll({ domain: "x.com" }),
      chrome.cookies.getAll({ domain: "twitter.com" }),
    ]);
    cookies = [...(a || []), ...(b || [])];
  } catch (e) {
    return { ok: false, error: `could not read x.com cookies: ${e.message}` };
  }

  const names = new Set(cookies.map((c) => c.name));
  if (!names.has("auth_token") || !names.has("ct0")) {
    return {
      ok: false,
      error: "Not logged in to x.com in this browser (missing auth_token/ct0). " +
             "Log in to x.com in this Chrome profile, then Sync again.",
    };
  }

  // chrome.cookies shape -> what the importer expects. Keep it minimal; the
  // server normalises the rest. Never log values.
  const payload = {
    cookies: cookies.map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      expirationDate: c.expirationDate,
    })),
  };

  // AUTOMATIC — hand the cookies to the local adk-daemon (:9001). It's loopback-
  // trusted and runs AS THE OWNER, so it seeds the fleet session with the owner's
  // own credentials: no bearer from the extension, no download, no manual
  // `adk x-session import`. This is the path the owner asked for — it "just works"
  // because awdk is already running and authenticated.
  // The daemon's agent-server port varies per `adk up` (9001, 8080, …), so probe
  // a few with a quick health check, then POST to the live one.
  const daemonPorts = [9001, 8080, 8090, 9000, 8188];
  for (const p of daemonPorts) {
    const base = `http://127.0.0.1:${p}`;
    let alive = false;
    try { const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) }); alive = h.ok; } catch { alive = false; }
    if (!alive) continue;
    try {
      const r = await fetch(`${base}/x-session/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: payload.cookies }),
        signal: AbortSignal.timeout(120000),
      });
      if (r.status === 404) continue; // alive but not the adk-daemon — keep looking
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) return { ok: true, handle: d.handle, cookieCount: names.size, via: "adk-daemon" };
      // The daemon answered but the import failed — surface that, don't fall to a download.
      return { ok: false, error: (d.error || d.reason || `daemon HTTP ${r.status}`), via: "adk-daemon" };
    } catch { /* timed out / refused — try the next port */ }
  }

  // Robust bootstrap fallback: write the session to a file so it can be seeded
  // with `adk x-session import --state x_session_state.json`, which authenticates
  // as the HOST OWNER and does NOT depend on the extension's portal identity
  // (that varies by how the owner signed in — cloud cookie vs local vs SPA
  // localStorage — and is why the bridge path is unreliable). MV3 service workers
  // have no URL.createObjectURL, so use a data: URL. Cookie values live only on
  // the user's own machine (this extension + the Downloads file).
  async function saveStateFile() {
    try {
      const json = JSON.stringify({ cookies: payload.cookies, origins: [] });
      const dataUrl = "data:application/json;base64," +
        btoa(unescape(encodeURIComponent(json)));
      await chrome.downloads.download({
        url: dataUrl, filename: "x_session_state.json", saveAs: false,
      });
      return true;
    } catch { return false; }
  }

  // The import endpoint authorizes the OWNER (genesis requires caller.can_execute)
  // — attach the same portal bearer the extension uses for every other
  // authenticated fleet call (see harUpload). WITHOUT it genesis returns
  // 403 "Insufficient permissions" and the sync silently no-ops, which is the
  // exact reason "nothing automates": the session never gets seeded.
  // The cached portal bearer lives in chrome.storage.session, which Chrome WIPES
  // on every extension reload — so right after a reload it's empty even though the
  // owner is signed in, and the sync would falsely report "not signed in". Fall
  // back to deriving it LIVE from the portal auth cookie (the same source
  // resolve-identity uses), then re-cache it.
  let bearer = await AitherPortal.getPortalBearer();
  if (!bearer) {
    for (const domain of ["portal.aitherium.com", "demo.aitherium.com", "aitherium.com"]) {
      try {
        const c = await chrome.cookies.get({ url: `https://${domain}`, name: "aither_auth_token" });
        if (c && c.value) {
          bearer = c.value;
          try { await AitherPortal.setPortalBearer(bearer); } catch { /* no session storage */ }
          break;
        }
      } catch { /* no cookie access for this domain */ }
    }
  }
  if (!bearer) {
    const dl = await saveStateFile();
    return {
      ok: false,
      downloaded: dl,
      error: dl
        ? `Saved x_session_state.json to your Downloads (${names.size} cookies) — the operator seeds it with 'adk x-session import'.`
        : "Not signed in to portal in this browser, and could not save the session file.",
      needsManualImport: true,
      cookieCount: names.size,
    };
  }
  const authHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${bearer}`,
  };

  // Prefer the Veil bridge to genesis; fall back to the node bridge. Both mount
  // /social/x/import-session once Genesis serves the route.
  const targets = [
    `${GENESIS_URL}/social/x/import-session`,
    `${NODE_URL}/social/x/import-session`,
  ];
  let lastErr = "no bridge reachable";
  for (const url of targets) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000), // verification opens a real browser
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        return { ok: true, handle: data.handle, cookieCount: names.size };
      }
      lastErr = (data && (data.error || data.reason)) || `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
  }
  // The bridge didn't accept it (auth varies by how the owner signed in). Fall
  // back to the file: `adk x-session import` seeds it with the host owner's
  // credentials. Cookie values live only on the user's own machine.
  const dl = await saveStateFile();
  return {
    ok: false,
    downloaded: dl,
    error: dl
      ? `Saved x_session_state.json to your Downloads (${names.size} cookies) — the operator seeds it with 'adk x-session import'.`
      : `Bridge failed (${lastErr}) and could not save the session file.`,
    needsManualImport: true,
    cookieCount: names.size,
  };
}

// POST to a live FormBridge engine, probing candidate ports (discovery can run
// before any pack/port is configured). Loopback only.
async function formbridgeEnginePost(path, body) {
  const cfgPort = (FORMBRIDGE_CFG && FORMBRIDGE_CFG.port) || null;
  const seen = new Set();
  for (const p of [cfgPort, 18182, 8182]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      const r = await fetch(`http://127.0.0.1:${p}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(2500),
      });
      if (r.ok) return true;
    } catch { /* try next */ }
  }
  return false;
}

async function formbridgeForward(batch) {
  const body = { ...batch };
  if (formbridgeSelectorsSeen.length) {
    body.seen_selectors = formbridgeSelectorsSeen;
    formbridgeSelectorsSeen = [];
  }
  const resp = await fetch(formbridgeUrl("/formbridge/capture"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`engine returned ${resp.status}`);
  return resp.json();
}

async function formbridgeDrainQueue() {
  while (formbridgeQueue.length) {
    const batch = formbridgeQueue[0];
    try {
      await formbridgeForward(batch);
      formbridgeQueue.shift();
    } catch {
      break;  // engine still down — keep the queue, retry on next capture/warm-up
    }
  }
  try {
    await chrome.storage.local.set({ "aither-formbridge-queue": formbridgeQueue });
  } catch { /* best-effort persistence */ }
}

// Pick up settings changed in the Options page WITHOUT a service-worker restart
// (previously the API key / URLs went stale until the worker recycled).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes["aither-settings"]) {
    loadSettings().then(() => syncRegisteredContentScripts());
  }
  if (area === "local" && changes["aither-provider"]) {
    loadProviderConfig().then(() => autoDetectTier());
  }
  if (area === "sync" && changes["aither-license"]) {
    // Tier change can unlock/revoke auto-harvest + site packs
    syncRegisteredContentScripts();
  }
  if (area === "local" && (changes["aither-formbridge-pack"] || changes["aither-formbridge-discovery"] || changes["aither-formbridge-api"])) {
    loadFormbridgeConfig().then(() => syncRegisteredContentScripts());
  }
});

/**
 * Ensure content script is injected in the given tab.
 * After extension reload/update, existing tabs lose their content scripts.
 * This injects agent-extractor.js on-demand so scans work without a page reload.
 */
async function ensureContentScript(tabId) {
  // Probe for THIS script BY NAME, not with a generic "ping".
  //
  // content/text-actions.js also answers `{action:"ping"}`. So the old probe was
  // satisfied by whichever content script happened to be loaded, concluded the
  // extractor was already present, and skipped injecting it. Every subsequent
  // `extract-*-context` then reached a tab with no extractor and came back as
  // "Page extraction failed" — a message that blames the PAGE, when the real
  // cause was that the extractor had never been injected. Themis reported
  // exactly this on a normal reddit.com article.
  const isExtractorLoaded = async () => {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: "ping-extractor" });
      return Boolean(r && r.script === "agent-extractor");
    } catch {
      return false;
    }
  };

  if (await isExtractorLoaded()) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/agent-extractor.js"],
  });

  // Poll for readiness rather than sleeping a fixed 100ms: on a heavy page the
  // listener is not always registered that fast, and the fixed wait turned a
  // merely slow page into the same misleading "extraction failed".
  for (let i = 0; i < 20; i++) {
    if (await isExtractorLoaded()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("extractor did not become ready after injection");
}

/**
 * Dynamic content-script registration.
 *
 * v3.0.0 removed all static content_scripts from the manifest (the all-sites
 * entries were the biggest Chrome Web Store review liability). Capture still
 * works with zero grants via context menus (selectionText / executeScript on
 * activeTab); the always-on enhancers below come back only after the user
 * opts in AND grants the matching host permission in Options.
 */
async function syncRegisteredContentScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;

  const wanted = [];
  let allSites = false;
  try {
    allSites = await chrome.permissions.contains({ origins: ["*://*/*"] });
  } catch { /* permissions API unavailable */ }

  if (allSites && SETTINGS.textActionsAllSites) {
    wanted.push({
      id: "aither-text-actions",
      matches: ["*://*/*"],
      js: ["content/text-actions.js"],
      runAt: "document_idle",
    });
  }

  if (allSites && SETTINGS.autoHarvest) {
    let gate = { allowed: false };
    try { gate = await AitherGating.checkGate("auto_harvest"); } catch { /* free */ }
    if (gate.allowed) {
      wanted.push(
        {
          id: "aither-harvester",
          matches: ["*://*/*"],
          js: ["content/harvester.js"],
          runAt: "document_idle",
        },
        {
          id: "aither-agent-extractor",
          matches: ["*://*/*"],
          js: ["content/agent-extractor.js"],
          runAt: "document_idle",
        },
      );
    }
  }

  // FormBridge (vertical pack): value capture for EXACTLY the pack's origin.
  // Requires an installed pack config (with the mandatory anchor) AND the
  // user-granted host permission for that one origin. Never broad-matched.
  if (FORMBRIDGE_CFG && FORMBRIDGE_CFG.origin && FORMBRIDGE_CFG.anchor && FORMBRIDGE_CFG.anchor.selector) {
    // Chrome match patterns CANNOT contain a port — a port-less pattern matches
    // all ports on the host. So a pack origin like http://localhost:8910 must
    // register as http://localhost/* (still covered by the manifest's
    // http://localhost/* grant). Real EHR origins have no port → unchanged.
    let fbOrigin;
    try {
      const u = new URL(FORMBRIDGE_CFG.origin);
      fbOrigin = `${u.protocol}//${u.hostname}/*`;
    } catch {
      fbOrigin = `${FORMBRIDGE_CFG.origin.replace(/:\d+/, "").replace(/\/$/, "")}/*`;
    }
    let has = false;
    try { has = await chrome.permissions.contains({ origins: [fbOrigin] }); } catch { /* skip */ }
    if (has) {
      wanted.push({
        id: "aither-formbridge",
        matches: [fbOrigin],
        js: ["content/value-capture.js"],
        runAt: "document_idle",
      });
    }
  }

  // FormBridge Discovery: scrape DOM fields + intercept the EHR's own JSON
  // (MAIN world) to build a pack's selectors. ONLY when Discovery mode is on.
  if (DISCOVERY_CFG && DISCOVERY_CFG.origin) {
    let dOrigin;
    try {
      const u = new URL(DISCOVERY_CFG.origin);
      dOrigin = `${u.protocol}//${u.hostname}/*`;
    } catch {
      dOrigin = `${DISCOVERY_CFG.origin.replace(/:\d+/, "").replace(/\/$/, "")}/*`;
    }
    let dHas = false;
    try { dHas = await chrome.permissions.contains({ origins: [dOrigin] }); } catch { /* skip */ }
    if (dHas) {
      // MAIN-world interceptor must load before the page's scripts use fetch.
      wanted.push({
        id: "aither-discovery-net", matches: [dOrigin],
        js: ["content/discovery-net.js"], runAt: "document_start", world: "MAIN",
      });
      wanted.push({
        id: "aither-discovery", matches: [dOrigin],
        js: ["content/discovery.js"], runAt: "document_idle",
      });
    }
  }

  // FormBridge API Capture: intercept the EHR's own JSON/RTF responses
  // (MAIN world) to extract data via the API_CFG.source.api map. ONLY when
  // an API-capture pack is active for this origin.
  if (API_CFG && API_CFG.origin) {
    let aOrigin;
    try {
      const u = new URL(API_CFG.origin);
      aOrigin = `${u.protocol}//${u.hostname}/*`;
    } catch {
      aOrigin = `${API_CFG.origin.replace(/:\d+/, "").replace(/\/$/, "")}/*`;
    }
    let aHas = false;
    try { aHas = await chrome.permissions.contains({ origins: [aOrigin] }); } catch { /* skip */ }
    if (aHas) {
      // MAIN-world interceptor must load before the page's scripts use fetch.
      wanted.push({
        id: "aither-api-capture-net", matches: [aOrigin],
        js: ["content/api-capture-net.js"], runAt: "document_start", world: "MAIN",
      });
      wanted.push({
        id: "aither-api-capture", matches: [aOrigin],
        js: ["content/api-capture.js"], runAt: "document_idle",
      });
    }
  }

  // Site packs (Pro): per-site enhancers, each behind its own host grant
  if (SETTINGS.sitePacksEnabled) {
    let gate = { allowed: false };
    try { gate = await AitherGating.checkGate("site_packs"); } catch { /* free */ }
    if (gate.allowed) {
      const packs = [
        { id: "aither-pack-slack", origins: ["https://*.slack.com/*"], matches: ["https://*.slack.com/*"], js: ["content/slack.js"] },
        { id: "aither-pack-atlassian", origins: ["https://*.atlassian.net/*"], matches: ["https://*.atlassian.net/wiki/*", "https://*.atlassian.net/jira/*"], js: ["content/atlassian.js"] },
        { id: "aither-pack-github", origins: ["https://github.com/*"], matches: ["https://github.com/*"], js: ["content/github.js"] },
      ];
      for (const p of packs) {
        let has = false;
        try { has = await chrome.permissions.contains({ origins: p.origins }); } catch { /* skip */ }
        if (has) {
          wanted.push({ id: p.id, matches: p.matches, js: p.js, runAt: "document_idle" });
        }
      }
    }
  }

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ours = existing.map((s) => s.id).filter((id) => id.startsWith("aither-"));
    if (ours.length) {
      await chrome.scripting.unregisterContentScripts({ ids: ours });
    }
    if (wanted.length) {
      await chrome.scripting.registerContentScripts(wanted);
    }
    console.log(`[Awconnect] Registered content scripts: ${wanted.map((w) => w.id).join(", ") || "(none)"}`);
  } catch (e) {
    console.warn("[Awconnect] Content-script registration failed:", e.message);
  }
}

/** Return auth headers if an API key is configured. */
function authHeaders() {
  const h = {
    "Content-Type": "application/json",
    "X-Caller-Type": "PLATFORM",  // Local extension = full platform access
  };
  if (SETTINGS.apiKey) {
    h.Authorization = `Bearer ${SETTINGS.apiKey}`;
  }
  // Project & tenant scope — propagated to awnode/Genesis
  if (SETTINGS.tenantId) {
    h["X-Tenant-ID"] = SETTINGS.tenantId;
  }
  if (SETTINGS.projectName) {
    h["X-Project-Name"] = SETTINGS.projectName;
  }
  if (SETTINGS.workspaceId) {
    h["X-Workspace-ID"] = SETTINGS.workspaceId;
  }
  if (SETTINGS.userId) {
    h["X-User-ID"] = SETTINGS.userId;
  }
  return h;
}

/**
 * MANAGED install rung: apply a marketplace listing to the caller's bound
 * agent via Genesis POST /v1/agent/binding/apply-pack (license-gated
 * server-side; auto-triggers a managed twin re-sync when needed).
 *
 * Returns a sendResponse-shaped object on a DEFINITIVE outcome:
 *   { action: "applied", ... }          — pack applied to the bound agent
 *   { action: "license-required", ... } — paid pack the caller doesn't own;
 *                                         carries the portal checkout deep-link
 * Returns null on anything else (no genesis reach, unknown pack, no binding,
 * auth failure) so the caller falls through to the copyable-command rung —
 * never a fake success.
 */
/**
 * Marketplace install resolution ladder — shared by the sidepanel message
 * handler AND the portal's external-message handoff. First rung that
 * succeeds wins; every failure falls through, never fakes an outcome:
 *   git → { action: "open-url" } for the UI to open in a tab.
 *   1. SOVEREIGN — local awnode /packs/install (bundled adk packs
 *      install fully in-browser; registry packs 404 → next rung).
 *   2. MANAGED — Genesis /v1/agent/binding/apply-pack (license-gated;
 *      403 license_required → { action: "license-required" } with the
 *      portal checkout deep-link).
 *   3. FALLBACK — { action: "show-command" } with the copyable
 *      `adk install pack/<id>` command (the extension can't shell out).
 */
async function marketplaceInstall(itemId, install) {
  install = install || {};
  if (install.method === "git" && install.url) {
    return { ok: true, action: "open-url", url: install.url };
  }
  const command = install.command || `adk install pack/${itemId}`;
  // Rung 1 — sovereign: bundled adk packs install on the local node.
  let nodeSaidNotBundled = false;
  if (install.method === "adk") {
    const nodeBase = (DETECTED_TIER === "node-only" && TIER_URLS.nodeUrl)
      ? TIER_URLS.nodeUrl
      : `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
    try {
      const resp = await fetch(`${nodeBase}/packs/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ pack: itemId }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const result = await resp.json().catch(() => ({}));
        return {
          ok: true, action: "installed", result,
          note: result.note || (result.reloaded ? "tools loaded" : null),
        };
      }
      // 404 = not a bundled pack → managed rung (expected, not an error).
      // Remember it: adk's CLI can only install bundled packs too,
      // so for a confirmed-non-bundled pack the command is a dead end.
      nodeSaidNotBundled = resp.status === 404;
    } catch { /* node not running / no endpoint — fall through */ }
  }
  // Rung 2 — managed: apply the pack to the caller's bound agent.
  const applied = await tryApplyPackManaged(itemId);
  if (applied) return applied;
  // Rung 3 — portal handoff. On the cloud/off-box tier the gateway has no
  // apply-pack route, so rung 2 can't reach genesis directly. Rather
  // than dead-ending on a command, hand off to the portal, where a logged-in
  // user applies the pack to their agent with their own session (the portal
  // marketplace honors ?listing=<id>). This closes the off-box install path
  // WITHOUT a cross-tenant perimeter auth change on the edge.
  if (itemId) {
    const portal = (SETTINGS.portalUrl || "https://portal.aitherium.com").replace(/\/+$/, "");
    return {
      ok: true,
      action: "apply-on-portal",
      applyUrl: `${portal}/portal/marketplace?listing=${encodeURIComponent(itemId)}`,
      command,
      note: install.method === "adk" && nodeSaidNotBundled
        ? "Not bundled locally — apply it to your hosted agent on the portal."
        : "Apply this pack to your agent on the portal (signed-in session).",
    };
  }
  // Rung 4 — last resort for adk items with no id: the copyable command.
  if (install.method === "adk") {
    return { ok: true, action: "show-command", command };
  }
  return { ok: false, error: `Unsupported install method: ${install.method || "none"}` };
}

async function tryApplyPackManaged(listingId) {
  if (!listingId || !GENESIS_URL) return null;
  try {
    const resp = await fetch(`${GENESIS_URL}/v1/agent/binding/apply-pack`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ listing_id: listingId }),
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) {
      const result = await resp.json().catch(() => ({}));
      return {
        ok: true,
        action: "applied",
        result,
        note: result.managed_resync === "triggered"
          ? "applied — hosted agent re-sync started"
          : (result.managed_resync === "needed" ? "applied — sync your agent to activate" : null),
      };
    }
    if (resp.status === 403) {
      // Distinguish the purchase→use seam (license_required) from a plain
      // auth failure: only the former gets the checkout deep-link.
      const err = await resp.json().catch(() => ({}));
      const detail = (err && typeof err.detail === "object") ? err.detail : err;
      if (detail && detail.error === "license_required") {
        const portal = SETTINGS.portalUrl || "https://portal.aitherium.com";
        return {
          ok: true,
          action: "license-required",
          listingId,
          checkoutUrl: `${portal.replace(/\/+$/, "")}/portal/marketplace?listing=${encodeURIComponent(listingId)}`,
          hint: detail.hint || "Purchase this pack on the portal, then install again.",
        };
      }
      return null; // ordinary authz failure — fall through, don't fake an outcome
    }
    return null; // 404 unknown/non-applicable pack, 400 no binding, 5xx → fall through
  } catch {
    return null; // genesis unreachable on this tier — fall through
  }
}

const RECONNECT_INTERVAL_MS = 30000;  // WS reconnect — 30s (WS is best-effort, polling is primary)
const SEARCH_TIMEOUT_MS = 22000;  // AitherSearch does live web fetch + LLM answer
                                  // (~9-16s measured, slower via the cloud→genesis
                                  // proxy); 10s spuriously timed out real searches.

// =============================================================================
// STATE
// =============================================================================

let genesisSocket = null;
let isConnected = false;
let reconnectTimer = null;
let aitherOSStatus = "unknown";
let connectedApps = new Map();

// Multi-tier connectivity state
let DETECTED_TIER = "unknown";   // "genesis" | "node-only" | "cloud-only" | "offline" | "unknown"
let TIER_URLS = {};              // { chatUrl, nodeUrl } from TierDetect
let _tierDemoteStrikes = 0;      // consecutive polls proposing a WORSE tier (see autoDetectTier)

// Agent context bridge state
let agentContextCache = new Map();  // tabId -> last extracted context
const CONTEXT_CACHE_TTL_MS = 60000; // 1 minute staleness window

// AitherRelay IRC state
let relaySocket = null;
let relayConnected = false;
let relayReconnectTimer = null;
let relayNick = null;
let relayToken = null;           // JWT for authenticated WS connection
let relayWorkspaceId = null;    // Current workspace scope
let relayTenantId = null;       // Current tenant scope
let relayTokenExpiry = null;    // Token expiration timestamp

// =============================================================================
// CTA ENGINE — ADAPTER BOOTSTRAP
// =============================================================================

/**
 * Bootstrap CTA adapters on service worker startup.
 *
 * Loads bundled adapters from adapters/index.json + each adapter JSON,
 * optionally fetches remote adapters from the fleet registry, merges them,
 * stores in chrome.storage.local, and dynamically registers content scripts
 * for each adapter's match patterns.
 */
async function bootstrapCtaAdapters() {
  const bundledAdapters = [];

  try {
    // Load bundled adapters
    const indexUrl = chrome.runtime.getURL("adapters/index.json");
    const indexResp = await fetch(indexUrl);
    if (indexResp.ok) {
      const index = await indexResp.json();
      if (Array.isArray(index.adapters)) {
        for (const id of index.adapters) {
          try {
            const url = chrome.runtime.getURL(`adapters/${id}.json`);
            const resp = await fetch(url);
            if (resp.ok) {
              const adapter = await resp.json();
              bundledAdapters.push(adapter);
            }
          } catch {
            /* adapter fetch failed — skip */
          }
        }
      }
    }
  } catch {
    /* index fetch failed — use empty bundled list */
  }

  let remoteAdapters = [];
  try {
    // OPTIONALLY fetch remote adapters from the fleet registry
    const CTA_ADAPTER_REGISTRY_URL = "https://portal.aitherium.com/api/cta/adapters";
    const remoteResp = await fetch(CTA_ADAPTER_REGISTRY_URL, { timeout: 5000 });
    if (remoteResp.ok) {
      const data = await remoteResp.json();
      remoteAdapters = Array.isArray(data.adapters) ? data.adapters : [];
    }
  } catch {
    /* remote fetch failed or timed out — use empty remote list */
  }

  // Merge bundled + remote adapters
  const allAdapters = [...bundledAdapters, ...remoteAdapters];

  // Store in chrome.storage.local so the content script can fetch them
  try {
    await chrome.storage.local.set({ "aither-cta-adapters": allAdapters });
  } catch {
    /* storage write failed */
  }

  // Dynamically register content scripts for each adapter's match patterns
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;

  for (const adapter of allAdapters) {
    const adapterId = adapter.id || "unknown";
    const scriptId = `aither-cta-${adapterId}`;
    const matches = adapter.match || [];

    // Unregister first (avoid dupes)
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    } catch {
      /* not registered yet — fine */
    }

    // Register the engine for this adapter's match patterns
    if (matches.length > 0) {
      try {
        await chrome.scripting.registerContentScripts([
          {
            id: scriptId,
            matches,
            js: ["content/cta-engine.js"],
            runAt: "document_idle",
          },
        ]);
      } catch {
        /* registration failed for this adapter — continue with others */
      }
    }
  }
}

// =============================================================================
// LIFECYCLE
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[Awconnect] Extension installed/updated", details && details.reason);

  // Load connection settings from storage before anything else
  await loadSettings();
  await loadProviderConfig();

  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // First-run onboarding wizard: portal sign-in + mode selection + provision.
  // Only fires on fresh install (not browser updates of the extension), and
  // only if the user hasn't already completed it.
  try {
    if (details && details.reason === "install") {
      const { aither_onboarded_at } = await chrome.storage.local.get(
        "aither_onboarded_at",
      );
      if (!aither_onboarded_at) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("onboard/onboard.html"),
        });
      }
    }
  } catch (e) {
    console.warn("[Awconnect] onboard tab open failed:", e);
  }

  // Context menus — parent menu for text actions
  chrome.contextMenus.create({
    id: "aither-parent",
    title: "Awconnect",
    contexts: ["selection", "page"],
  });

  // Post to X — only on x.com/twitter.com. Aither writes the tweet; the
  // extension posts it in THIS logged-in tab (no cookies leave the browser).
  chrome.contextMenus.create({
    id: "aither-x-post",
    parentId: "aither-parent",
    title: "𝕏  Post to X (Aither writes it)",
    contexts: ["page"],
    documentUrlPatterns: ["*://x.com/*", "*://twitter.com/*"],
  });

  // Text selection actions (nested under parent)
  chrome.contextMenus.create({
    id: "action-analyze",
    parentId: "aither-parent",
    title: 'Analyze: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "action-summarize",
    parentId: "aither-parent",
    title: 'Summarize: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "action-explain",
    parentId: "aither-parent",
    title: 'Explain: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "action-review",
    parentId: "aither-parent",
    title: 'Review: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "action-extract",
    parentId: "aither-parent",
    title: 'Extract key info: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-sep-1",
    parentId: "aither-parent",
    type: "separator",
    contexts: ["selection", "page"],
  });

  chrome.contextMenus.create({
    id: "aither-search",
    parentId: "aither-parent",
    title: 'Search AitherOS: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-ingest",
    parentId: "aither-parent",
    title: "Send to Knowledge Base",
    contexts: ["page", "selection"],
  });

  chrome.contextMenus.create({
    id: "aither-screenshot",
    parentId: "aither-parent",
    title: "Analyze this page (screenshot)",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "aither-sep-2",
    parentId: "aither-parent",
    type: "separator",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "themis-scan",
    parentId: "aither-parent",
    title: "Scan Page with Themis (Consumer Advocacy)",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "shield-scan",
    parentId: "aither-parent",
    title: "Shield Scan (Security Threats)",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "aither-sep-3",
    parentId: "aither-parent",
    type: "separator",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-remember",
    parentId: "aither-parent",
    title: 'Remember: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-recall",
    parentId: "aither-parent",
    title: 'Recall related memories: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-forge",
    parentId: "aither-parent",
    title: 'Send to Forge agent: "%s"',
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aither-wiki-capture",
    parentId: "aither-parent",
    title: "Capture page to LyraWiki",
    contexts: ["page", "selection"],
  });

  chrome.contextMenus.create({
    id: "aither-wiki-ask",
    parentId: "aither-parent",
    title: 'Ask LyraWiki: "%s"',
    contexts: ["selection"],
  });

  // Periodic health check + tier detection + decisions polling
  chrome.alarms.create("health-check", { periodInMinutes: 0.5 });
  chrome.alarms.create("tier-check", { periodInMinutes: 0.5 });
  chrome.alarms.create("decisions-poll", { periodInMinutes: 1 });

  await ensureXAlarms();

  await autoDetectTier();
  await syncRegisteredContentScripts();
  await bootstrapCtaAdapters();
  await checkHealth();
  connectToGenesis();
  pullEntitlement().catch(() => {});
  sweepInjectables().catch(() => {});
  autoResolveIdentity("install").catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[Awconnect] Browser started, reconnecting...");
  await loadSettings();
  await loadProviderConfig();
  await autoDetectTier();
  await bootstrapCtaAdapters();
  await ensureXAlarms();
  connectToGenesis();
  checkHealth();
  pullEntitlement().catch(() => {});
  sweepInjectables().catch(() => {});
  autoResolveIdentity("startup").catch(() => {});
});

// Signing in at portal.aitherium.com should be enough — the extension can read
// that cookie and never did unless a human clicked "Sign in" in the Setup tab.
// This closes the loop: log into the portal in this browser and the workspace
// badge fills in by itself.
chrome.cookies.onChanged.addListener((info) => {
  if (info.removed || info.cookie?.name !== "aither_auth_token") return;
  if (!/(^|\.)aitherium\.com$/.test((info.cookie.domain || "").replace(/^\./, ""))) return;
  autoResolveIdentity("portal-login").catch(() => {});
});

// Clean up connectedApps when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  connectedApps.delete(tabId);
  agentContextCache.delete(tabId);
});

// =============================================================================
// GENESIS WEBSOCKET (best-effort — Chrome blocks wss:// to self-signed certs)
// =============================================================================

let _wsBackoff = 30000;
const _wsMaxBackoff = 300000; // 5 min max

function connectToGenesis() {
  if (genesisSocket && genesisSocket.readyState === WebSocket.OPEN) return;

  // In local bridge mode, WS goes through Veil which only proxies /ws/chat,
  // not /ws/events. Skip WS — HTTP polling in checkHealth() handles connectivity.
  if (!SETTINGS.remoteUrl) {
    return;
  }

  try {
    genesisSocket = new WebSocket(GENESIS_WS);

    genesisSocket.onopen = () => {
      console.log("[Awconnect] Connected to Genesis WS");
      isConnected = true;
      updateBadge("online");
      clearTimeout(reconnectTimer);
      _wsBackoff = 30000; // reset backoff on success
    };

    genesisSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleGenesisEvent(data);
      } catch (e) {
        console.debug("[Awconnect] Non-JSON WS message:", event.data);
      }
    };

    genesisSocket.onclose = () => {
      genesisSocket = null;
      // Don't set isConnected=false here — polling will handle status
      scheduleReconnect();
    };

    genesisSocket.onerror = () => {
      genesisSocket = null;
      // Silent — Chrome can't do wss:// to self-signed certs
      // Connectivity is tracked via HTTP polling in checkHealth()
      scheduleReconnect();
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToGenesis();
  }, _wsBackoff);
  // Exponential backoff — don't spam if WS can never connect
  _wsBackoff = Math.min(_wsBackoff * 1.5, _wsMaxBackoff);
}

function handleGenesisEvent(data) {
  const eventType = data.type || data.event_type || "";

  // Autonomous X post — the fleet (a routine / Aither) tells the extension to
  // post, and it posts in THIS logged-in browser. This is what makes it
  // hands-off: no right-click. Aither writes the text (xComposeText); an
  // optional data.text overrides. Finds an open x.com tab or opens one.
  if (eventType === "x_post_request" || eventType === "social.x.post") {
    (async () => {
      try {
        let tabs = await chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] });
        let tab = tabs && tabs[0];
        if (!tab) {
          tab = await chrome.tabs.create({ url: "https://x.com/compose/post", active: false });
        }
        await xComposeAndPost(tab);
      } catch (e) {
        console.debug("[Awconnect] x_post_request failed:", e);
      }
    })();
    return;
  }

  // Agent context request — an AitherOS agent is asking for browser context
  if (eventType === "agent_context_request") {
    handleAgentContextRequest(data);
    return;
  }

  if (eventType === "notification" || eventType === "alert") {
    const inner = data.data || data;
    chrome.notifications.create(`aither-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: inner.title || "AitherOS",
      message: inner.message || "",
      priority: 2,
    });
  }

  // Forward to side panel
  broadcastToSidePanel({ type: "genesis-event", data });
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT CONTEXT BRIDGE
// ═══════════════════════════════════════════════════════════════════════

async function handleAgentContextRequest(request) {
  const requestId = request.request_id || crypto.randomUUID();
  const options = request.options || {};

  try {
    const ctx = await extractActiveTabContext(options);
    sendAgentContextResponse(requestId, ctx);
  } catch (e) {
    sendAgentContextResponse(requestId, null, e.message);
  }
}

async function extractActiveTabContext(options = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  // Check cache first unless force refresh requested
  if (!options.force_refresh) {
    const cached = agentContextCache.get(tab.id);
    if (cached && (Date.now() - cached.extracted_at) < CONTEXT_CACHE_TTL_MS) {
      return { ...cached.context, from_cache: true };
    }
  }

  // Inject content script if missing (after extension reload/update)
  await ensureContentScript(tab.id);

  const response = await chrome.tabs.sendMessage(tab.id, {
    action: "extract-agent-context",
    options: {
      include_text: options.include_text !== false,
      max_text: options.max_text || 30000,
    },
  });

  if (!response?.success) {
    throw new Error(response?.error || "Extraction failed");
  }

  // Add a compact summary for quick context (don't send all structured data by default)
  let summary = response.context.title ? `${response.context.title} (${response.context.url})` : response.context.url;

  // Append main content preview if available
  if (response.context.structure && response.context.structure.main_content) {
    summary += `\n\nMain content preview: ${response.context.structure.main_content.text_preview?.slice(0, 500) || "(no text)"}`;
  }

  // Append key headings
  if (response.context.structure && response.context.structure.headings && response.context.structure.headings.length > 0) {
    const headingTexts = response.context.structure.headings.slice(0, 5).map(h => `• ${h.text}`).join("\n");
    summary += `\n\nPage structure:\n${headingTexts}`;
  }

  // Add agent tools hint
  summary += `\n\n[Agent tools available: read-page, read-page-html, screenshot, find-on-page]`;

  // Cache the full context but return with the compact summary attached
  agentContextCache.set(tab.id, {
    context: response.context,
    extracted_at: Date.now(),
  });

  return {
    ...response.context,
    compact_summary: summary,
    available_tools: ["read-page", "read-page-html", "screenshot", "find-on-page"],
  };
}

async function extractAllTabsContext(options = {}) {
  const tabs = await chrome.tabs.query({});
  const results = [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "extract-agent-context",
        options: { include_text: false },
      });
      if (response?.success) {
        results.push({ tab_id: tab.id, ...response.context });
      }
    } catch { /* tab doesn't have content script */ }
  }

  return results;
}

function sendAgentContextResponse(requestId, context, error = null) {
  if (!genesisSocket || genesisSocket.readyState !== WebSocket.OPEN) return;

  genesisSocket.send(JSON.stringify({
    type: "agent_context_response",
    request_id: requestId,
    success: !error,
    context: context,
    error: error,
    source: "aither-connect-extension",
    timestamp: new Date().toISOString(),
  }));
}

// Push context to Genesis on tab change (agents always have fresh context)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!isConnected) return;
  // Flush dwell for the page being left BEFORE anything async — an await here
  // would attribute the old page's time to the new one.
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    ambientSwitchTo(activeInfo.tabId, tab.url, tab.title);
  } catch { /* tab vanished */ }
  try {
    const ctx = await extractActiveTabContext({ include_text: false });
    pushContextToGenesis(ctx, "tab_activated");
  } catch { /* tab not ready yet */ }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.active || !isConnected) return;
  ambientSwitchTo(tabId, tab.url, tab.title);
  // Small delay to let page finish rendering
  setTimeout(async () => {
    try {
      const ctx = await extractActiveTabContext({ include_text: false });
      pushContextToGenesis(ctx, "page_loaded");
    } catch { /* content script not ready */ }
  }, 1500);
});

function pushContextToGenesis(context, trigger) {
  if (genesisSocket && genesisSocket.readyState === WebSocket.OPEN) {
    genesisSocket.send(JSON.stringify({
      type: "browser_context_push",
      trigger,
      context,
      source: "aither-connect-extension",
      timestamp: new Date().toISOString(),
    }));
  } else {
    pushContextToGenesisRest(context, trigger);
  }
}

// Push to Genesis REST endpoint (fallback when WS is down)
async function pushContextToGenesisRest(context, trigger) {
  try {
    await fetch(`${GENESIS_URL}/browser/agent-context/push`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...context,
        trigger,
        source: "aither-connect-extension",
      }),
    });
  } catch { /* Genesis offline */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// AMBIENT EXPERTISE SENSOR
// ═══════════════════════════════════════════════════════════════════════════
// Makes the agent an expert on what you're actually reading. The pushes above
// fire on EVERY tab switch and carry no text — good for "what is on screen
// right now", useless as a signal of interest. This sensor instead measures
// DWELL, and only when you have genuinely stayed on a page does it send the
// page text to Genesis /ambient/observe, which decides whether to research it.
//
// Dwell is accumulated on transitions rather than by polling, because an MV3
// service worker is suspended aggressively — a setInterval here silently stops
// running after ~30s of idle and the sensor would look wired and be dead. The
// alarm exists only to flush the tab you are still sitting on.

const AMBIENT_ALARM = "aither-ambient-tick";
const AMBIENT_MIN_DWELL_MS = 20_000;   // below this, don't even ask the server
const AMBIENT_RESEND_MS = 10 * 60_000; // per-URL client-side cooldown
const AMBIENT_MAX_TEXT = 12_000;

let ambientCurrent = null;             // { tabId, url, title, since }
const ambientDwell = new Map();        // url -> accumulated ms
const ambientLastSent = new Map();     // url -> timestamp

function ambientEnabled() {
  // Opt-out lives with the other settings; default ON only when connected.
  return isConnected && SETTINGS.ambientExpertise !== false;
}

/** Fold the time spent on the current page into its running total. */
function ambientAccumulate() {
  if (!ambientCurrent) return;
  const elapsed = Date.now() - ambientCurrent.since;
  if (elapsed > 0 && elapsed < 60 * 60_000) {
    const prev = ambientDwell.get(ambientCurrent.url) || 0;
    ambientDwell.set(ambientCurrent.url, prev + elapsed);
  }
  ambientCurrent.since = Date.now();
}

function ambientSwitchTo(tabId, url, title) {
  ambientAccumulate();
  if (!url || !/^https?:/i.test(url)) {
    ambientCurrent = null;
    return;
  }
  ambientCurrent = { tabId, url, title: title || "", since: Date.now() };
}

/** Send an observation if this page has earned one. */
async function ambientMaybeObserve() {
  if (!ambientEnabled() || !ambientCurrent) return;
  ambientAccumulate();

  const url = ambientCurrent.url;
  const dwellMs = ambientDwell.get(url) || 0;
  if (dwellMs < AMBIENT_MIN_DWELL_MS) return;

  const lastSent = ambientLastSent.get(url) || 0;
  if (Date.now() - lastSent < AMBIENT_RESEND_MS) return;
  ambientLastSent.set(url, Date.now());

  try {
    // Text is fetched ONLY at this point — a page you glanced at never has
    // its content read, let alone sent anywhere.
    const ctx = await extractActiveTabContext({ include_text: true });
    const text = (ctx && (ctx.text_content ||
      (ctx.structure && ctx.structure.main_content &&
        ctx.structure.main_content.text_preview))) || "";

    const resp = await fetch(`${GENESIS_URL}/ambient/observe`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        surface: "browser",
        locator: url,
        title: (ctx && ctx.title) || ambientCurrent.title || "",
        excerpt: text.slice(0, AMBIENT_MAX_TEXT),
        dwell_ms: Math.round(dwellMs),
        metadata: { site: (ctx && ctx.opengraph && ctx.opengraph["og:site_name"]) || "" },
      }),
    });

    if (!resp.ok) {
      console.warn(`[Awconnect] ambient observe -> HTTP ${resp.status}`);
      return;
    }
    const result = await resp.json();
    if (result.salient) {
      console.info(`[Awconnect] ambient: researching "${url}" — ${result.reason}`);
    }
    ambientBroadcastBrief(url, result);
  } catch (e) {
    console.warn("[Awconnect] ambient observe failed:", e.message);
  }
}

/** Tell the UI when expertise on the current page is ready. */
function ambientBroadcastBrief(url, result) {
  if (!result || !result.brief) return;
  chrome.runtime.sendMessage({
    type: "ambient-brief",
    url,
    topic: result.topic,
    brief: result.brief,
  }).catch(() => { /* no listener open — the brief is still fetchable */ });
}

/** Fetch accumulated expertise for a page (used by the command bar). */
async function ambientFetchBrief(url) {
  try {
    const qs = new URLSearchParams({ locator: url, surface: "browser" });
    const resp = await fetch(`${GENESIS_URL}/ambient/brief?${qs}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return { available: false, reason: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

chrome.alarms.create(AMBIENT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AMBIENT_ALARM) ambientMaybeObserve();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (ambientCurrent && ambientCurrent.tabId === tabId) {
    ambientAccumulate();
    ambientCurrent = null;
  }
});

// Leaving the browser entirely stops the clock — otherwise a page left open
// overnight would look like the most interesting thing you have ever read.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    ambientAccumulate();
    ambientCurrent = null;
  }
});

// Push to Strata for ingestion/training
async function pushContextToStrata(context) {
  try {
    await fetch(`${STRATA_URL}/api/v1/ingest/browser-context`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...context,
        ingestion_type: "agent_structured",
        timestamp: new Date().toISOString(),
      }),
    });
  } catch { /* Strata offline */ }
}

// =============================================================================
// AITHERRELAY IRC — WebSocket bridge to Relay
// =============================================================================

/**
 * Mint a relay token before connecting to the WS.
 * Per contract: authenticate via existing identity-verification path (portal bearer).
 */
async function mintRelayTokenBeforeConnect(workspaceId, tenantId) {
  const bearer = await AitherPortal.getPortalBearer();
  if (!bearer) {
    console.debug("[Awconnect] No portal token — relay auth skipped");
    return null;
  }

  const result = await AitherPortal.mintRelayToken(
    RELAY_URL,
    bearer,
    workspaceId,
    tenantId
  );
  if (result.ok) {
    relayToken = result.relay_token;
    relayTokenExpiry = result.expires_at;
    return result.relay_token;
  } else {
    console.warn("[Awconnect] Relay token mint failed:", result.error);
    return null;
  }
}

function connectToRelay(nick, workspaceId, tenantId) {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) return;
  if (!nick) return;
  relayNick = nick;
  relayWorkspaceId = workspaceId || null;
  relayTenantId = tenantId || null;

  // Mint a token before opening the WS
  mintRelayTokenBeforeConnect(workspaceId, tenantId).then((token) => {
    if (!token) {
      console.warn("[Awconnect] Cannot connect to Relay without a token");
      broadcastToSidePanel({ type: "relay-status", connected: false, error: "auth_required" });
      return;
    }

    try {
      // Open WS with token as query parameter
      const wsUrl = `${RELAY_WS}${RELAY_WS.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
      relaySocket = new WebSocket(wsUrl);

      relaySocket.onopen = () => {
        console.log("[Awconnect] Connected to AitherRelay (authenticated)");
        relayConnected = true;
        // NICK↔IDENTITY PARITY (2026-07-31): the relay is the single authority
        // on an authenticated nick and 403s a join whose nick does not match
        // the token identity. We mint a real token above, so sending a
        // client-supplied nick could only ever match by luck — and the join
        // rejection was invisible: `relayConnected` is set on socket OPEN,
        // before the join is acknowledged, so the side panel said "connected"
        // while the user was in no channel at all. Omit the nick and let the
        // relay derive it from the token (same as AitherShell and awdk).
        relaySocket.send(JSON.stringify({
          type: "join",
          channel: "#general",
          workspace_id: relayWorkspaceId,
          is_agent: false,
        }));
        broadcastToSidePanel({ type: "relay-status", connected: true, nick: relayNick });
      };

      relaySocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Adopt the nick the RELAY assigned. Without this the side panel
          // keeps displaying the locally-guessed nick, which is the one the
          // server just declined to use — the user would see a name nobody
          // else in the channel sees.
          if (data && data.type === "join" && data.nick
              && data.channel === "#general" && data.nick !== relayNick) {
            relayNick = data.nick;
            broadcastToSidePanel({
              type: "relay-status", connected: true, nick: relayNick,
            });
          }
          broadcastToSidePanel({ type: "relay-message", data });
        } catch { /* ignore malformed */ }
      };

      relaySocket.onclose = (event) => {
        console.log("[Awconnect] Relay WS closed", { code: event.code, reason: event.reason });
        relayConnected = false;
        // Close code 4401 = invalid token
        if (event.code === 4401) {
          relayToken = null;
          broadcastToSidePanel({ type: "relay-status", connected: false, error: "auth_invalid" });
          console.warn("[Awconnect] Relay auth token invalid (4401) — re-authentication required");
        } else {
          broadcastToSidePanel({ type: "relay-status", connected: false });
          scheduleRelayReconnect();
        }
      };

      relaySocket.onerror = (event) => {
        console.debug("[Awconnect] Relay WS error:", event);
        relayConnected = false;
      };
    } catch (e) {
      console.debug("[Awconnect] Could not connect to Relay:", e);
      scheduleRelayReconnect();
    }
  }).catch((e) => {
    console.debug("[Awconnect] Relay token mint async error:", e);
    scheduleRelayReconnect();
  });
}

function scheduleRelayReconnect() {
  if (relayReconnectTimer) return;
  relayReconnectTimer = setTimeout(() => {
    relayReconnectTimer = null;
    if (relayNick) connectToRelay(relayNick, relayWorkspaceId, relayTenantId);
  }, RECONNECT_INTERVAL_MS);
}

function sendRelayMessage(data) {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    relaySocket.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "health-check") {
    await checkHealth();
    // Piggyback on the existing 30s cadence rather than adding another alarm.
    // checkHealth() calls updateBadge(), so refreshing after it keeps a pending
    // card count from being overwritten by the ambient health badge.
    await refreshAccessRequestBadge();
  }
  if (alarm.name === "tier-check") {
    await autoDetectTier();
  }
  if (alarm.name === "x-autopost") {
    await xAutopostTick();
  }
  if (alarm.name === "x-engage") {
    await xEngageTick();
  }
  if (alarm.name === "x-discover") {
    await xDiscoverTick();
  }
  if (alarm.name === "x-daily-summary") {
    await xDailySummaryTick();
  }
  if (alarm.name === "li-autopost") {
    await liAutopostTick();
  }
  if (alarm.name === "li-engage") {
    await liEngageTick();
  }
  if (alarm.name === "li-discover") {
    await liDiscoverTick();
  }
  if (alarm.name === "decisions-poll") {
    await decisionsPollTick();
  }
});

// Inject the on-page growth control panel whenever an x.com tab finishes loading.
// The panel guards against double-injection itself, so re-firing is harmless.
/* The Living OS's own origins. Matched against the TAB URL, so a page merely LINKING to
   aitherium.com is unaffected. Kept as one regex shared by every injection site — the
   command bar and the overlay bridge must agree about what "the OS" is, or one of them
   renders on top of the real dock while the other correctly stands down. */
// The whole aitherium.com family is the OS: apex (Living Desktop) plus every
// subdomain that serves the same Veil app — portal, demo, tunnel, veil — all
// render the real dock. Injection on ANY of them stacked a second taskbar.
const IS_OS_ORIGIN = /^https?:\/\/(www\.)?([a-z0-9-]+\.)*aitherium\.com(\/|$|\?|#)/;

function _xInjectPanel(tabId, file) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
  }).catch(() => { /* not a supported tab / no host permission yet — ignore */ });
}
/** Can this tab URL host our page injections at all? */
function _injectableUrl(url) {
  // Only http(s) pages can host a content script; browser UI, the web stores and
  // extension pages can't (executeScript throws there and is caught).
  if (!url || !/^https?:\/\//.test(url)) return false;
  if (/^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com)/.test(url)) return false;
  // NEVER ON THE OS ITSELF. aitherium.com IS the Living OS — it already renders the real
  // dock, brain bar and sign-in. Injecting here gave the owner TWO taskbars stacked at the
  // bottom of the same viewport, the extension's hand-rolled one under the real one, and
  // the overlay bridge additionally iframed aitherium.com INTO aitherium.com. The whole
  // point of both scripts is to bring the OS to pages that are NOT the OS.
  if (IS_OS_ORIGIN.test(url)) return false;
  return true;
}

/** Inject whatever the current settings call for into one tab. Both scripts
 *  guard against double-injection themselves, so re-firing is harmless. */
function injectInto(tabId, url) {
  if (!_injectableUrl(url)) return;
  // Social surfaces (x/twitter/linkedin) keep the COMMAND BAR as their driver,
  // not the overlay. The overlay's os-ready handler removes the command bar,
  // but on those hosts the bar is the only in-page post/engage surface and its
  // xPageDriverAt lease suppresses the service worker's autopost — removing it
  // would silently kill automation (the lease keeps renewing from the bar's
  // closures even after the DOM node is gone). So the overlay serves general
  // pages; the bar serves social pages; never both stacked.
  let isSocial = false;
  try { const h = new URL(url).hostname.replace(/^www\./, ""); isSocial = /(^|\.)(x\.com|twitter\.com|linkedin\.com)$/.test(h); } catch { /* unparseable */ }
  // The REAL AitherOS (overlay iframe) is the taskbar on every NON-SOCIAL page —
  // the owner wants the Living OS dock, not the hand-rolled bar. The command bar
  // is the post/engage DRIVER on social surfaces only, docked above the real
  // dock. (Re-enabled 2026-08-08 12:35 after a crash investigation: the crash
  // was the overlay revealing the FULL opaque OS before any clip existed; the
  // bridge now reveals only once os-regions clip it.)
  //
  // `&& !isSocial` is NOT redundant with the bridge's own social guard (AC011,
  // AC009d). Two reasons the belt matters as much as the braces: the bridge is
  // also injected from the context-menu and toggle-overlay paths that never
  // reach this function, so its guard is the only thing standing there — and a
  // guard that is the ONLY copy is one edit from being deleted as dead code by
  // someone who reads this line and concludes social is already excluded here.
  // The failure it prevents is silent: the overlay's os-ready handler removes
  // the command bar, whose xPageDriverAt lease keeps renewing from its closures
  // even after the DOM node is gone, so social automation stops with nothing
  // logged and every surface still reporting enabled.
  if (SETTINGS.osOverlayEnabled && !isSocial) _xInjectPanel(tabId, "content/aither-overlay-bridge.js");
  if (SETTINGS.commandBarEnabled && isSocial) _xInjectPanel(tabId, "content/aither-command-bar.js");
}

/** Inject into every ALREADY-OPEN tab.
 *
 *  tabs.onUpdated only fires on a load, so without this every tab open at the
 *  moment the extension installs, updates, or has its settings changed stays
 *  bare until the user reloads it. On x.com that is not cosmetic: the bar is
 *  the in-page driver for post/engage, so an un-swept tab is an automation
 *  that silently never runs. */
async function sweepInjectables() {
  if (!SETTINGS.commandBarEnabled && !SETTINGS.osOverlayEnabled) return;
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) {
      if (t.id != null) injectInto(t.id, t.url);
    }
  } catch (e) {
    console.debug("[Awconnect] injectable sweep failed:", e);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab) return;
  // The Aither OS taskbar renders on EVERY website — the page becomes the desktop.
  // X/LinkedIn additionally light up the social automation inside the same bar.
  injectInto(tabId, tab.url);
});

// ─────────────────────────────────────────────────────────────────
// DECISIONS POLLING
// ─────────────────────────────────────────────────────────────────

/**
 * Poll the harness daemon for decision counts and update the action button badge.
 * Runs every 1 minute via chrome.alarms.
 */
async function decisionsPollTick() {
  try {
    if (!self.HarnessAuth) return;
    const counts = await self.HarnessAuth.getDecisionCounts();
    if (!counts || !counts.open) return;

    const badgeCount = Math.max(0, counts.open);
    if (badgeCount > 0) {
      // Set action button badge text
      chrome.action.setBadgeText({ text: String(badgeCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // red
      // Broadcast to sidepanel so it can refresh its display
      broadcastToSidePanel({
        type: "decisions-count-update",
        counts: counts,
      });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.debug("[Awconnect] decisions-poll tick failed:", e);
  }
}

// Autonomous X post on the timer. Kill switch: chrome.storage.local
// xAutopostEnabled (default TRUE — the owner asked for hands-off). Only posts
// when an x.com tab is available (opens one if none), and lets xComposeText
// write fresh text each time.
async function xAutopostTick() {
  try {
    await repairXKillSwitch();
    const s = await chrome.storage.local.get(["xAutopostEnabled"]);
    if (s.xAutopostEnabled === false) return; // explicit kill switch (user intent only)
    if (await xPageDriverActive()) return;    // the on-page command bar has the wheel
    let tabs = await chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] });
    let tab = tabs && tabs[0];
    if (!tab) {
      tab = await chrome.tabs.create({ url: "https://x.com/compose/post", active: false });
    }
    await xComposeAndPost(tab);
  } catch (e) {
    console.debug("[Awconnect] x-autopost tick failed:", e);
  }
}

// Per-endpoint health state for the debounce (see checkHealth). A service must
// miss HEALTH_DOWN_STRIKES polls in a row before it's reported DOWN.
const _healthState = {};
const HEALTH_DOWN_STRIKES = 2;

async function checkHealth() {
  // Non-fleet tiers (cloud-only, node-only, provider) don't have Veil/Pulse to
  // probe — their fleet URLs are empty strings, so the probes below would always
  // "fail" and flap the badge to degraded/offline on a tier that actually works.
  // Tier detection already confirmed the backend is reachable, so reflect that:
  // a detected non-fleet tier is online. (This is what made an owner see
  // "cloud-only degraded" flapping while DeepSeek chat worked fine.)
  if (["cloud-only", "node-only", "provider"].includes(DETECTED_TIER)) {
    aitherOSStatus = "online";
    isConnected = true;
    updateBadge("online");
    broadcastToSidePanel({ type: "health-update", healthy: true, status: "online", services: {} });
    return;
  }

  // Try multiple endpoints — Genesis HTTP often takes 10s+ to respond after boot
  // while the ecosystem (Gateway, Pulse, Veil) comes up faster.
  //
  // In local mode all URLs route through Veil's bridge proxy (HTTP:3000),
  // so these fetches actually hit http://localhost:3000/api/bridge/genesis/health etc.
  // which Veil forwards over the Docker network with proper TLS.

  const endpoints = [
    { name: "veil",     url: `${VEIL_URL}/api/health`, tier: "degraded" },
    { name: "genesis",  url: `${GENESIS_URL}/health`,  tier: "online" },
    { name: "pulse",    url: `${PULSE_URL}/health`,    tier: "online" },
  ];

  const serviceStatus = {};
  let bestTier = "offline";

  const debounce = self.AitherHealthDebounce.applyHealthDebounce;
  const checks = endpoints.map(async (ep) => {
    const prev = _healthState[ep.name];
    let observed;
    try {
      const resp = await fetch(ep.url, { signal: AbortSignal.timeout(4000) });
      observed = resp.ok ? "up" : "error";
    } catch {
      observed = "down";
    }
    // Debounce: hold prior status until HEALTH_DOWN_STRIKES consecutive misses,
    // so one slow probe through the flaky Veil bridge doesn't flap the badge.
    const { state, effective } = debounce(prev, observed, HEALTH_DOWN_STRIKES);
    _healthState[ep.name] = state;
    serviceStatus[ep.name] = effective === "up" ? "up" : (effective === "error" ? "error" : "down");
    return effective === "up" ? ep.tier : null;
  });

  const results = await Promise.allSettled(checks);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      if (r.value === "online") { bestTier = "online"; break; }
      if (r.value === "degraded" && bestTier !== "online") bestTier = "degraded";
    }
  }

  aitherOSStatus = bestTier;
  isConnected = bestTier === "online";
  updateBadge(bestTier);

  // If any core service is up, try to establish Genesis WS (it may be up but HTTP slow)
  if (bestTier !== "offline" && !isConnected) {
    connectToGenesis();
  }

  // Broadcast health to side panel
  broadcastToSidePanel({
    type: "health-update",
    healthy: bestTier === "online",
    status: bestTier,
    services: serviceStatus,
  });
}

// Pending A2A permission cards. These OUTRANK the health badge: a card means a
// federated agent is blocked right now waiting on a human, which is actionable,
// whereas "ecosystem online" is ambient. Kept in a variable so the two badge
// writers cooperate instead of overwriting each other.
let ACCESS_CARDS_PENDING = 0;
let LAST_ECOSYSTEM_STATUS = "offline";

function updateBadge(status) {
  if (status) LAST_ECOSYSTEM_STATUS = status;
  const colors = {
    online: "#22c55e",
    offline: "#6b7280",
    degraded: "#f59e0b",
  };
  const text = {
    online: "",
    offline: "OFF",
    degraded: "!",
  };
  if (ACCESS_CARDS_PENDING > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#06b6d4" });
    chrome.action.setBadgeText({ text: String(ACCESS_CARDS_PENDING) });
    return;
  }
  const s = status || LAST_ECOSYSTEM_STATUS;
  chrome.action.setBadgeBackgroundColor({ color: colors[s] || "#6b7280" });
  chrome.action.setBadgeText({ text: text[s] || "" });
}

/** Base origin for platform API calls: the remote portal, else local Veil. */
function accessBase() {
  if (SETTINGS.remoteUrl) return String(SETTINGS.remoteUrl).replace(/\/+$/, "");
  if (VEIL_URL) return VEIL_URL.replace(/\/+$/, "");
  return `http://${LOOPBACK}:${SETTINGS.veilPort || 3000}`;
}

/** Refresh the pending-card count on the toolbar badge. */
async function refreshAccessRequestBadge() {
  try {
    const res = await fetch(`${accessBase()}/api/notifications?limit=50`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      // Signed out or unreachable: show NO count rather than a stale one. A
      // number that outlives its source reads as "someone is still waiting"
      // long after the cards were decided elsewhere.
      ACCESS_CARDS_PENDING = 0;
      updateBadge();
      return;
    }
    const data = await res.json();
    ACCESS_CARDS_PENDING = (data.notifications || []).filter(
      (n) => n.access_request_id && n.status !== "action" && !n.dismissed
    ).length;
  } catch {
    ACCESS_CARDS_PENDING = 0;
  }
  updateBadge();
}

// =============================================================================
// BROADCAST TO SIDE PANEL
// =============================================================================

function broadcastToSidePanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // No listeners — side panel not open. That's fine.
  });
}

// =============================================================================
// OMNIBOX
// =============================================================================

chrome.omnibox.onInputEntered.addListener((text) => {
  const url = `${VEIL_URL}/chat?q=${encodeURIComponent(text)}&mode=federated`;
  chrome.tabs.create({ url });
});

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "analyze-selection" && tab?.id) {
    // Get the selected text from the active tab
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || "",
    });
    const selectedText = result?.result;
    if (selectedText) {
      if (chrome.sidePanel) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      setTimeout(() => {
        broadcastToSidePanel({
          type: "ANALYZE_TEXT",
          text: selectedText,
          source: tab.url || "",
        });
      }, 300);
    } else {
      // No selection — just open the side panel
      if (chrome.sidePanel) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    }
  }
  if (command === "toggle-overlay" && tab?.id) {
    // Browser-level shortcut (works even when the OS iframe has focus, unlike the
    // page's Alt+` handler which dies the moment keystrokes go to the cross-origin
    // frame). The overlay bridge listens for this and flips interact/pass-through.
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "toggle-overlay-interactive" });
    } catch { /* no bridge on this tab (not injected, or overlay removed) */ }
  }
});

// =============================================================================
// CONTEXT MENUS
// =============================================================================

// Context menu action → prompt mapping
const CONTEXT_MENU_PROMPTS = {
  "action-analyze":   "Analyze this text in detail. Identify key themes, arguments, claims, and any notable patterns or issues:",
  "action-summarize": "Provide a concise summary of the following text, capturing the key points:",
  "action-explain":   "Explain this text in simple, clear terms. Break down any complex concepts:",
  "action-review":    "Review this text for accuracy, clarity, tone, and potential issues. Provide constructive feedback:",
  "action-extract":   "Extract all key facts, data points, names, dates, and actionable items from this text:",
};

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "aither-x-post") {
    await xComposeAndPost(tab);
    return;
  }

  // Text action buttons (analyze, summarize, explain, review, extract)
  if (CONTEXT_MENU_PROMPTS[info.menuItemId]) {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    const actionMsg = {
      type: "TEXT_ACTION",
      action: info.menuItemId.replace("action-", ""),
      prompt: CONTEXT_MENU_PROMPTS[info.menuItemId],
      text: info.selectionText,
      source: tab?.url || "",
      title: tab?.title || "",
    };
    _pendingSidePanelMsg = actionMsg;
    setTimeout(() => broadcastToSidePanel(actionMsg), 800);
    setTimeout(() => broadcastToSidePanel(actionMsg), 2000);
    return;
  }

  if (info.menuItemId === "aither-search") {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    setTimeout(() => {
      broadcastToSidePanel({
        type: "SEARCH_TEXT",
        text: info.selectionText,
        source: tab?.url || "",
      });
    }, 300);
  }

  if (info.menuItemId === "aither-ingest") {
    // Save selection — or the whole page when nothing is selected. The
    // context-menu click grants activeTab, so executeScript works with no
    // standing host permission (this is the zero-grant capture path the
    // Chrome Web Store build relies on).
    let content = info.selectionText || "";
    if (!content && tab?.id) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => (document.body ? document.body.innerText.slice(0, 100000) : ""),
        });
        content = result || "";
      } catch (_) { /* restricted page (chrome://, store, PDFs) */ }
    }
    knowledgeIngest({
      content,
      source: tab?.url || "",
      title: tab?.title || "",
      tags: ["context-menu", "browser-capture"],
      collection: "browser",
      metadata: { url: tab?.url, captured_via: "context-menu" },
    }).then((r) => {
      chrome.notifications.create(`aither-kb-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Awconnect",
        message: `Saved to Knowledge Base (${r.chunkCount} chunk${r.chunkCount === 1 ? "" : "s"})`,
        priority: 1,
      });
    }).catch((e) => {
      chrome.notifications.create(`aither-kb-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Awconnect",
        message: `Save failed: ${e.message}`,
        priority: 1,
      });
    });
  }

  if (info.menuItemId === "aither-wiki-capture") {
    // Capture the selection, or the full page text when nothing is selected,
    // into the active tenant's LyraWiki.
    let content = info.selectionText || "";
    if (!content && tab?.id) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body ? document.body.innerText.slice(0, 100000) : "",
        });
        content = result || "";
      } catch (_) { /* restricted page */ }
    }
    knowledgeIngest({
      content,
      source: tab?.url || "",
      title: tab?.title || "",
      tags: ["context-menu", "lyra-wiki", "browser-capture"],
      collection: "browser",
      metadata: { url: tab?.url, captured_via: "context-menu" },
    }).then(() => {
      chrome.notifications.create(`aither-wiki-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "LyraWiki",
        message: "Captured to your wiki",
        priority: 1,
      });
    }).catch(() => {});
  }

  if (info.menuItemId === "aither-wiki-ask" && info.selectionText) {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    const askMsg = { type: "WIKI_ASK_UI", question: info.selectionText };
    _pendingSidePanelMsg = askMsg;
    setTimeout(() => broadcastToSidePanel(askMsg), 800);
    setTimeout(() => broadcastToSidePanel(askMsg), 2000);
  }

  if (info.menuItemId === "themis-scan") {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    setTimeout(() => {
      broadcastToSidePanel({ type: "THEMIS_SCAN_PAGE" });
    }, 500);
  }

  if (info.menuItemId === "shield-scan") {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    setTimeout(() => {
      broadcastToSidePanel({ type: "SHIELD_SCAN_PAGE" });
    }, 500);
  }

  if (info.menuItemId === "aither-screenshot" && tab?.id) {
    // Capture visible tab and send screenshot to sidepanel for vision analysis
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      if (chrome.sidePanel) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      const screenshotMsg = {
        type: "SCREENSHOT_ANALYZE",
        image: dataUrl,
        source: tab.url || "",
        title: tab.title || "",
      };
      _pendingSidePanelMsg = screenshotMsg;
      setTimeout(() => broadcastToSidePanel(screenshotMsg), 800);
      setTimeout(() => broadcastToSidePanel(screenshotMsg), 2000);
    } catch (err) {
      console.error("[Awconnect] Screenshot capture failed:", err);
    }
  }

  if (info.menuItemId === "aither-remember" && info.selectionText) {
    // Full KB pipeline instead of just memory
    knowledgeIngest({
      content: info.selectionText,
      source: tab?.url || "",
      title: tab?.title || "",
      tags: ["context-menu", "remember"],
      collection: "browser",
    }).catch(() => {});
    chrome.notifications.create(`aither-remember-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Awconnect",
      message: "Remembered and saved to Knowledge Base",
      priority: 1,
    });
  }

  if (info.menuItemId === "aither-recall" && info.selectionText) {
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    chrome.runtime.sendMessage({ type: "memory-recall", query: info.selectionText });
  }

  if (info.menuItemId === "aither-forge" && info.selectionText) {
    chrome.runtime.sendMessage({
      type: "forge-dispatch",
      task: info.selectionText,
      agent: "demiurge",
      pageUrl: tab?.url || "",
      pageTitle: tab?.title || "",
    });
  }
});

// =============================================================================
// MESSAGE ROUTING
//
// Every async handler MUST:
//   1. Call sendResponse() in both success AND error paths
//   2. Return true to keep the message channel alive
// =============================================================================

// =============================================================================
// HAR SESSION CAPTURE
// -----------------------------------------------------------------------------
// A consented, user-initiated capture of the active tab's fetch/XHR traffic,
// assembled into a HAR 1.2 log and uploaded EITHER to the user's own encrypted
// workspace document vault (Genesis /v1/documents/upload) OR sealed to Aitherium
// (NaCl box → /v1/har-intake) so we can build automations/integrations from it.
//
// Auth: uses the PORTAL bearer only (Authorization header). It deliberately does
// NOT send X-Tenant-ID / X-User-ID — Genesis resolves identity cryptographically
// by introspecting the opaque bearer (JWTValidationMiddleware Strategy 3), so no
// spoofable identity header is involved. The upload targets the portal's Veil
// bridge (portal.aitherium.com/api/bridge/genesis/...).
// =============================================================================

const HAR_MAX_ENTRIES = 5000;
const HAR_MAX_BYTES = 40 * 1024 * 1024; // 40 MB accumulated body budget

const harCapture = {
  active: false,
  tabId: null,
  redact: true,
  startedAt: null,
  pageUrl: "",
  entries: [],
  bytes: 0,
  truncated: false,
  lastLog: null, // assembled on stop, consumed by har-upload
};

async function harInject(tabId, redact) {
  // MAIN-world config first, then the recorder (MAIN) + relay (ISOLATED). All
  // frames so iframed apps are captured too. Failures per-frame are tolerated.
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: (r) => { window.__aitherHarConfig = { redact: r }; },
      args: [redact !== false],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      files: ["content/har-recorder.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/har-relay.js"],
    });
    return true;
  } catch (e) {
    console.warn("[Awconnect] HAR inject failed:", e.message);
    return false;
  }
}

// Re-inject on same-tab navigation while a capture is active so multi-page
// flows keep recording (the page world resets on navigation).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (harCapture.active && tabId === harCapture.tabId && changeInfo.status === "loading") {
    harInject(tabId, harCapture.redact);
  }
});

async function harStart(tabId, redact) {
  harCapture.active = true;
  harCapture.tabId = tabId;
  harCapture.redact = redact !== false;
  harCapture.startedAt = new Date().toISOString();
  harCapture.entries = [];
  harCapture.bytes = 0;
  harCapture.truncated = false;
  harCapture.lastLog = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
  harCapture.pageUrl = (tab && tab.url) || "";
  const ok = await harInject(tabId, harCapture.redact);
  return { ok, sessionStartedAt: harCapture.startedAt };
}

function harAccumulate(entry) {
  if (!harCapture.active) return;
  if (harCapture.entries.length >= HAR_MAX_ENTRIES || harCapture.bytes >= HAR_MAX_BYTES) {
    harCapture.truncated = true;
    return; // silently drop past the cap; UI surfaces `truncated`
  }
  const sz = (entry && entry.response && entry.response.content && entry.response.content.size) || 0;
  harCapture.entries.push(entry);
  harCapture.bytes += sz;
}

function harStop() {
  harCapture.active = false;
  const log = {
    log: {
      version: "1.2",
      creator: { name: "Awconnect", version: chrome.runtime.getManifest().version },
      pages: [],
      entries: harCapture.entries,
      _aither: {
        redacted: harCapture.redact,
        truncated: harCapture.truncated,
        started_at: harCapture.startedAt,
        stopped_at: new Date().toISOString(),
        origin_url: harCapture.pageUrl,
        entry_count: harCapture.entries.length,
      },
    },
  };
  harCapture.lastLog = log;
  return {
    ok: true,
    entryCount: harCapture.entries.length,
    bytes: harCapture.bytes,
    truncated: harCapture.truncated,
  };
}

/**
 * Upload the last-captured HAR.
 * @param {"workspace"|"aitherium"} destination
 */
async function harUpload(destination) {
  if (!harCapture.lastLog) {
    return { ok: false, error: "no capture to upload — start and stop a capture first" };
  }
  const bearer = await AitherPortal.getPortalBearer();
  if (!bearer) {
    return { ok: false, error: "not signed in — open Settings and sign in to portal.aitherium.com first" };
  }
  const base = (await AitherPortal.getPortalUrl()).replace(/\/+$/, "");

  let blob, filename, path, sealed = false;
  if (destination === "aitherium") {
    try {
      const s = await self.AitherHarCrypto.sealHar(harCapture.lastLog, base);
      blob = s.blob; filename = s.filename; sealed = true;
    } catch (e) {
      return { ok: false, error: `could not encrypt for Aitherium: ${e.message}` };
    }
    path = "/api/bridge/genesis/v1/har-intake";
  } else {
    const host = (() => { try { return new URL(harCapture.pageUrl).hostname; } catch { return "session"; } })();
    blob = new Blob([JSON.stringify(harCapture.lastLog)], { type: "application/json" });
    filename = `${host}-${Date.now()}.har`;
    path = "/api/bridge/genesis/v1/documents/upload";
  }

  try {
    const fd = new FormData();
    fd.append("file", blob, filename);
    if (destination === "aitherium") {
      // Plaintext provenance for the owner inbox index (the sealed blob is opaque
      // server-side, so these hints are how the owner sees what/where/how-much).
      let originHost = "";
      try { originHost = new URL(harCapture.pageUrl).origin; } catch { /* leave blank */ }
      fd.append("origin_host", originHost);
      fd.append("entry_count", String((harCapture.lastLog?.log?.entries || []).length));
      fd.append("redacted", harCapture.redact ? "true" : "false");
    }
    const res = await fetch(base + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` }, // NO identity headers — introspected server-side
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: (payload && (payload.detail || payload.error)) || `upload failed (${res.status})` };
    }
    // Workspace endpoint returns doc_id; har-intake returns id — normalize.
    return { ok: true, sealed, destination, doc_id: payload && (payload.doc_id || payload.id), filename };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Vision (Roboflow) — accept only localhost inference servers so the handler
// can never be used as a generic authenticated-fetch proxy by page content.
function visionLocalUrl(raw) {
  try {
    const u = new URL(String(raw || `http://${LOOPBACK}:9001`));
    if (!/^https?:$/.test(u.protocol)) return "";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "";
    return u.origin;
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ── Room relay ──────────────────────────────────────────────────────────
    // The side panel is a PAGE, so its fetch to the harness daemon is subject to
    // CORS, and chrome-extension:// is not in the daemon's allowlist. That list is
    // deliberately narrow: the daemon spawns coding agents with filesystem access,
    // so widening it to admit every extension is the wrong trade.
    //
    // A service worker with host_permissions is not subject to page CORS, so the
    // panel asks US to fetch instead. Nothing about the daemon's posture changes.
    //
    // Note the panel's old error branch tested `resp.status === 0` — a CORS failure
    // REJECTS the promise and never yields a response, so that branch could not run
    // and the real cause was invisible.
    case "room-fetch":
      (async () => {
        try {
          const resp = await fetch(message.url, {
            method: message.method || "GET",
            headers: message.headers || {},
          });
          const text = await resp.text();
          sendResponse({ ok: resp.ok, status: resp.status, body: text });
        } catch (e) {
          // Name the failure. A silent one here reads as "the room is empty".
          sendResponse({ ok: false, status: 0, error: String((e && e.message) || e) });
        }
      })();
      return true;

    // ── Aither-OS taskbar: chat/ask via the selected backend, backend
    //    persistence, and open-in-tab for launcher apps that refuse to frame ──
    case "ask-aither":
      (async () => {
        try { sendResponse({ text: await askAither(message.prompt, message.backend) }); }
        catch (e) { sendResponse({ error: String((e && e.message) || e) }); }
      })();
      return true;
    case "set-backend":
      try { chrome.storage.local.set({ aitherBackend: message.backend }); } catch { /* noop */ }
      sendResponse({ ok: true });
      return false;
    case "set-webml-model":
      try { chrome.storage.local.set({ aitherWebmlModel: message.modelId }); } catch { /* noop */ }
      sendResponse({ ok: true });
      return false;
    case "probe-node":
      // Detect a local awnode / adk daemon (same ports aitherium.com's dock
      // watches). Runs in the SW so host_permissions bypass the page's CORS.
      (async () => {
        for (const u of ["http://127.0.0.1:8090", "http://127.0.0.1:8000", "http://127.0.0.1:9001", "http://127.0.0.1:8080"]) {
          try { const r = await fetch(`${u}/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) { sendResponse({ online: true, baseUrl: u }); return; } } catch { /* next */ }
        }
        sendResponse({ online: false });
      })();
      return true;
    case "open-tab":
      if (message.url) { try { chrome.tabs.create({ url: message.url }); } catch { /* noop */ } }
      sendResponse({ ok: true });
      return false;
    case "open-options":
      try { chrome.runtime.openOptionsPage(); } catch { /* noop */ }
      sendResponse({ ok: true });
      return false;
    case "sidepanel-ready":
      // The sidepanel just opened (often from an X-stats toast click). Hand it
      // the last X daily summary so it can land on the Events panel showing
      // actual stats instead of the default Chat view. `null` means no summary
      // has run yet this SW lifetime — the panel just stays on its default.
      sendResponse({ xDailySummary: _lastXDailySummary || null });
      return false;
    case "os-identity-request":
      // The OS overlay iframe (aitherium.com/?mode=overlay) asks who is signed in.
      // It cannot see the portal session cookie (cross-site context), so the
      // bridge relays this here. Serve the last applied identity from settings
      // (cheap, no network); if there is ANY credential — an API key, a cloud
      // key, OR a portal session cookie (the common case: signed in at
      // portal.aitherium.com) — resolve once and cache it before answering.
      // The OLD guard only resolved on apiKey/cloudApiKey, so a cookie-only
      // user got an empty identity, which the OS read as "signed out" and
      // WIPED the session its native verify had just set.
      (async () => {
        try {
          let identity = buildIdentityFromSettings();
          if (!identity.verified) {
            let hasCredential = !!(SETTINGS.apiKey || SETTINGS.cloudApiKey);
            if (!hasCredential) {
              for (const domain of ["portal.aitherium.com", "demo.aitherium.com", ".aitherium.com"]) {
                try {
                  const c = await chrome.cookies.get({ url: `https://${domain.replace(/^\./, "")}`, name: "aither_auth_token" });
                  if (c?.value) { hasCredential = true; break; }
                } catch { /* no cookie access */ }
              }
            }
            if (hasCredential) {
              const r = await resolveIdentity();
              if (r && r.ok && r.identity && !r.unverified) {
                await applyIdentity(r.identity, r.token);
                identity = buildIdentityFromSettings();
              }
            }
          }
          // null (not an empty identity) when unresolved, so the overlay bridge
          // skips posting and the OS keeps whatever its native verify found.
          sendResponse({ identity: identity.verified ? identity : null });
        } catch (e) {
          sendResponse({ identity: null });
        }
      })();
      return true;
    /* Ported 2026-09-01 from the stale AitherConnect/ tree, where the fix for the
       2026-08-19 'signed in but AitherShell says Authentication required' report
       landed and never reached this — the SHIPPING — copy. Without this case the OS
       overlay's os-token-request is never answered and getHostToken() is null forever. */
    case "os-token-request":
      /* THE OVERLAY IS SIGNED IN AND CANNOT PROVE IT.
       *
       * `os-identity-request` above resolves WHO you are so the taskbar can say
       * "david". It deliberately returns no credential, so the OS could display
       * an identity it had no way to USE — which is exactly the owner's
       * 2026-08-19 report: signed in, and AitherShell answering "Authentication
       * required".
       *
       * The cause is not a bug in the OS. `aither_auth_token` is SameSite=Lax
       * (AitherVeil/src/lib/auth-cookie.ts), and in the overlay the top-level
       * site is whatever page you are on — youtube.com, github.com — so the OS
       * iframe is a THIRD-PARTY context and Chrome correctly never sends the
       * cookie. Measured the same day: portal answers 401 with
       * {"error":"Authentication required"} for a cookieless call, which is
       * verbatim the banner the shell displayed. Every authenticated surface in
       * the overlay fails this way, together, and none of them can say why.
       *
       * So relay a BEARER the OS can attach explicitly. Not a cookie policy
       * change: flipping the platform to SameSite=None would fix the overlay by
       * weakening CSRF posture on every surface, and this needs neither.
       *
       * The token goes out over postMessage with targetOrigin pinned to the OS
       * origin (see aither-overlay-bridge.js), so the host page cannot read it.
       * Never log the value. */
      (async () => {
        try {
          let token = null;
          try { token = await self.AitherPortal.getPortalBearer(); } catch { /* no session storage */ }
          if (!token) {
            // Fall back to the session cookie itself. Same domain list and same
            // order as os-identity-request, so the two channels cannot disagree
            // about which session is current.
            for (const domain of ["portal.aitherium.com", "demo.aitherium.com", ".aitherium.com"]) {
              try {
                const c = await chrome.cookies.get({ url: `https://${domain.replace(/^\./, "")}`, name: "aither_auth_token" });
                if (c?.value) { token = c.value; break; }
              } catch { /* no cookie access */ }
            }
          }
          // null, never "" — an empty string reads as a token to a truthiness
          // check on the far side and produces `Authorization: Bearer `, which
          // 401s in a way that looks like an expired session rather than an
          // absent one.
          sendResponse({ token: token || null });
        } catch {
          sendResponse({ token: null });
        }
      })();
      return true;
    case "inject-overlay":
    case "toggle-overlay":
      // Inject the AitherOS holographic overlay (transparent iframe of the real
      // aitherium.com Living OS) into the calling tab. Renders once aitherium.com
      // serves the frame-ancestors header for this extension. "toggle-overlay" is
      // the popup/options alias (ported from the origin lineage 2026-08-09).
      (async () => {
        try {
          // The popup/options send from an extension page, so sender.tab is
          // undefined there — resolve the active tab as the target in that case.
          let tid = sender && sender.tab && sender.tab.id;
          if (tid == null) {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            tid = active && active.id;
          }
          if (tid == null) { sendResponse({ ok: false, error: "no active tab" }); return; }
          await chrome.scripting.executeScript({ target: { tabId: tid }, files: ["content/aither-overlay-bridge.js"] });
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    case "fleet-sync":
      // The Living OS's PIM sync seam (notes → AitherOne, events → Chronos). The static
      // apex cannot run its /api routes, so the OS posts sync ops through portal-bridge
      // and this fetches the fleet-served portal — which DOES run those routes — with the
      // user's session cookie (host permission covers it; no CORS wall in a background
      // fetch). EXACT op → {method, path} allowlist: a caller can never name a path.
      // Failures return verbatim (owner rule: no silent fallbacks) — a down fleet is a
      // loud {ok:false}, never a cheerful no-op. (Ported from the origin lineage.)
      (async () => {
        const FLEET_SYNC_OPS = {
          "notes-list":   { method: "GET",  path: "/api/platform/one/notes" },
          "notes-create": { method: "POST", path: "/api/platform/one/notes" },
          "notes-update": { method: "PUT",  path: "/api/platform/one/notes" },
          "event-create": { method: "POST", path: "/api/chronos/v1/calendar/events" },
        };
        const op = FLEET_SYNC_OPS[message.op];
        if (!op) { sendResponse({ ok: false, error: `unknown fleet-sync op: ${String(message.op)}` }); return; }
        const portal = (SETTINGS.portalUrl || "https://portal.aitherium.com").replace(/\/+$/, "");
        try {
          const init = {
            method: op.method,
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(30000),
          };
          if (op.method !== "GET" && message.body !== undefined) init.body = JSON.stringify(message.body);
          const res = await fetch(`${portal}${op.path}`, init);
          const json = await res.json().catch(() => null);
          sendResponse({ ok: res.ok, status: res.status, json });
        } catch (e) {
          sendResponse({ ok: false, status: 0, error: `fleet unreachable: ${String((e && e.message) || e)}` });
        }
      })();
      return true;
    case "daemon-onboard":
      // Proxy onboarding requests to the local adk-daemon (port probe + request).
      // EXACT allowlist (not a prefix) so this can never proxy an arbitrary daemon path.
      (async () => {
        const { method, path } = message;
        const ALLOWED = ["/onboard/status", "/onboard/sync", "/onboard/enroll"];
        if (!ALLOWED.includes(path)) {
          sendResponse({ ok: false, error: "invalid path" });
          return;
        }
        const ports = ["http://127.0.0.1:9001", "http://127.0.0.1:8080", "http://127.0.0.1:8090", "http://127.0.0.1:9000", "http://127.0.0.1:8188"];
        for (const base of ports) {
          try {
            // Quick health check (2.5s timeout)
            const healthRes = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
            if (!healthRes.ok) continue;
            // Found it — make the actual request (120s timeout for enroll which is slow)
            const res = await fetch(`${base}${path}`, {
              method: method || "GET",
              headers: { "Content-Type": "application/json" },
              body: method === "POST" ? JSON.stringify({}) : undefined,
              signal: AbortSignal.timeout(120000),
            });
            if (res.status === 404) continue; // next port
            const data = await res.json();
            sendResponse({ ok: res.ok, status: res.status, data });
            return;
          } catch (e) {
            // Continue to next port
          }
        }
        sendResponse({ ok: false, error: "no local daemon (run: adk up)" });
      })();
      return true;
    case "daemon-call":
      // The OS overlay calling this machine's local brain: adk / awnode /
      // a bare llama-server. Relayed HERE and nowhere else, for one reason —
      // the daemon's CORS allowlist deliberately does not admit arbitrary
      // origins (it spawns coding agents with filesystem access), and a service
      // worker with host_permissions is not subject to page CORS or to Chrome's
      // Local Network Access gate. The overlay iframe is a third-party frame
      // and loses on both counts, which is why Veil's own use-local-node
      // reports "no node" in the overlay while a node is running.
      //
      // EXACT path allowlist, never a prefix: a prefix on a loopback proxy is
      // an SSRF surface pointed at the owner's own machine, and `/v1/*` would
      // admit whatever the daemon adds next without anyone re-reading this.
      // Method is pinned per path too — a GET-only route reached by POST is a
      // different operation.
      (async () => {
        const ALLOWED = {
          "GET /health": true,           // liveness
          "GET /info": true,             // which agent/model is loaded
          "GET /v1/models": true,        // the served menu (NOT liveness — a
                                         // model listed here can still hang)
          "POST /v1/chat/completions": true,  // local inference
          "GET /tools": true,            // what this machine can do
          "POST /tools/call": true,      // do it
        };
        const method = String(message.method || "GET").toUpperCase();
        const path = String(message.path || "");
        if (!ALLOWED[`${method} ${path}`]) {
          sendResponse({ ok: false, error: `path not allowed: ${method} ${path}` });
          return;
        }
        // Same probe order the overlay's node discovery uses, so "online" and
        // "callable" can never disagree about WHICH node they mean.
        const bases = ["http://127.0.0.1:8090", "http://127.0.0.1:8000", "http://127.0.0.1:9001", "http://127.0.0.1:8080"];
        for (const base of bases) {
          try {
            const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
            if (!health.ok) continue;
            const res = await fetch(`${base}${path}`, {
              method,
              headers: { "Content-Type": "application/json" },
              body: method === "POST" ? JSON.stringify(message.body || {}) : undefined,
              // Local generation on a laptop CPU is genuinely slow; a short
              // timeout here reads to the user as "the local model is broken".
              signal: AbortSignal.timeout(method === "POST" ? 180000 : 15000),
            });
            if (res.status === 404) continue;   // alive, but not the node serving this route
            const data = await res.json().catch(() => null);
            sendResponse({ ok: res.ok, status: res.status, data, baseUrl: base });
            return;
          } catch (e) {
            // Name the last failure rather than collapsing every cause into
            // "no daemon" — a node that is UP but timed out mid-generation is a
            // different problem from one that was never running.
            var lastErr = String((e && e.message) || e);   // eslint-disable-line no-var
          }
        }
        sendResponse({ ok: false, error: lastErr ? `local node unreachable: ${lastErr}` : "no local node (run: adk up)" });
      })();
      return true;
    case "site-adapter":
      // Serve the declarative adapter for a host to the overlay bridge.
      //
      // Read HERE and not in the page, deliberately. Content scripts can only
      // fetch chrome-extension:// resources that `web_accessible_resources`
      // exposes to that origin, and widening that to every site would publish
      // our adapter files -- selectors, action names, session notes -- to any
      // page that cares to look. The service worker can always read its own
      // package, so the data reaches the overlay without becoming public.
      (async () => {
        try {
          const host = String(message.host || "").replace(/^www\./, "");
          if (!host) { sendResponse({ ok: false, error: "no host" }); return; }
          const idx = await (await fetch(chrome.runtime.getURL("adapters/index.json"))).json();
          for (const id of (idx.adapters || [])) {
            const a = await (await fetch(chrome.runtime.getURL(`adapters/${id}.json`))).json();
            const hit = (a.match || []).some((pat) => {
              // Glob -> regex on the HOST+PATH, anchored. A substring test would
              // let evil-discord.com.attacker.net match the discord adapter.
              const rx = new RegExp("^" + pat.split("*").map((lit) => lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
              return rx.test(message.url || `https://${host}/`);
            });
            if (hit) { sendResponse({ ok: true, adapter: a }); return; }
          }
          sendResponse({ ok: true, adapter: null });   // no adapter is a normal answer
        } catch (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
        }
      })();
      return true;
    case "os-compose":
      // On-device composition for the overlay, through the SAME Bonsai ladder the
      // X automation uses (webmlComposeText): requested model first, then DOWN
      // through the lighter ready models, so a GPU that merely cannot hold 27B
      // still composes instead of silently reporting "no brain".
      //
      // Distinguishes "no GPU here" from "the model failed" -- the caller needs
      // that difference to decide between falling back to the fleet and telling
      // the user their machine cannot do this. A bare null conflates them, which
      // is how on-device composition silently stopped once before.
      (async () => {
        try {
          const caps = await getWebMLCapabilities().catch(() => ({ webgpu: false }));
          if (!caps || !caps.webgpu) {
            sendResponse({ ok: false, reason: "no-webgpu", error: "this browser/GPU cannot run the on-device brain" });
            return;
          }
          const text = await webmlComposeText(String(message.prompt || ""), {
            maxTokens: Math.min(Number(message.maxTokens) || 200, 512),
            temperature: typeof message.temperature === "number" ? message.temperature : 0.5,
          });
          if (!text) { sendResponse({ ok: false, reason: "model-failed", error: "every on-device model in the ladder failed to produce text" }); return; }
          sendResponse({ ok: true, text });
        } catch (e) {
          sendResponse({ ok: false, reason: "error", error: String((e && e.message) || e) });
        }
      })();
      return true;
    case "inject-machine-panel":
      // Inject the machine onboarding console panel into the calling tab.
      (async () => {
        try {
          const tid = sender && sender.tab && sender.tab.id;
          if (tid == null) { sendResponse({ ok: false, error: "no tab" }); return; }
          await chrome.scripting.executeScript({ target: { tabId: tid }, files: ["content/aither-machine-panel.js"] });
          // Trigger the panel to open
          await chrome.scripting.executeScript({
            target: { tabId: tid },
            function: () => {
              if (window.__openMachinePanel) {
                window.__openMachinePanel();
              }
            },
          });
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    case "daemon-backup":
      // Proxy backup requests to the local adk-daemon (port probe + request).
      // EXACT allowlist (not a prefix) so this can never proxy an arbitrary daemon path.
      (async () => {
        const { method, path, body } = message;
        const ALLOWED = ["/backup/config", "/backup/status", "/backup/now", "/backup/list", "/backup/restore"];
        if (!ALLOWED.includes(path)) {
          sendResponse({ ok: false, error: "invalid path" });
          return;
        }
        const ports = ["http://127.0.0.1:9001", "http://127.0.0.1:8080", "http://127.0.0.1:8090", "http://127.0.0.1:9000", "http://127.0.0.1:8188"];
        for (const base of ports) {
          try {
            // Quick health check (2.5s timeout)
            const healthRes = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
            if (!healthRes.ok) continue;
            // Found it — make the actual request (120s timeout for backup which is slow)
            const res = await fetch(`${base}${path}`, {
              method: method || "GET",
              headers: { "Content-Type": "application/json" },
              body: method === "POST" ? JSON.stringify(body || {}) : undefined,
              signal: AbortSignal.timeout(120000),
            });
            if (res.status === 404) continue; // next port
            const data = await res.json();
            sendResponse({ ok: res.ok, status: res.status, data });
            return;
          } catch (e) {
            // Continue to next port
          }
        }
        sendResponse({ ok: false, error: "no local daemon (run: adk up)" });
      })();
      return true;
    case "inject-backups-panel":
      // Inject the zero-knowledge backups panel into the calling tab.
      (async () => {
        try {
          const tid = sender && sender.tab && sender.tab.id;
          if (tid == null) { sendResponse({ ok: false, error: "no tab" }); return; }
          await chrome.scripting.executeScript({ target: { tabId: tid }, files: ["content/aither-backups-panel.js"] });
          // Trigger the panel to open
          await chrome.scripting.executeScript({
            target: { tabId: tid },
            function: () => {
              if (window.__openBackupsPanel) {
                window.__openBackupsPanel();
              }
            },
          });
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    case "open-sidepanel": {
      // Open Edge's NATIVE side panel — the real Awconnect chat/relay client,
      // fully functional. Called synchronously so the content-script click's user
      // gesture is preserved (sidePanel.open requires one).
      const wid = sender && sender.tab && sender.tab.windowId;
      const tid = sender && sender.tab && sender.tab.id;
      // Edge often drops the user-gesture across the message hop, so sidePanel.open
      // rejects. Fall back to opening the SAME chat client in a tab — always works.
      const openTab = () => { try { chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html") }); } catch { /* noop */ } };
      let opening;
      try {
        opening = wid != null ? chrome.sidePanel.open({ windowId: wid })
          : (tid != null ? chrome.sidePanel.open({ tabId: tid }) : Promise.reject(new Error("no tab")));
      } catch (e) { opening = Promise.reject(e); }
      Promise.resolve(opening).then(() => sendResponse({ ok: true, via: "sidepanel" }))
        .catch(() => { openTab(); sendResponse({ ok: true, via: "tab" }); });
      return true;
    }

    // ── HAR capture: start / stop / status / upload / stream entry ──────
    case "har-capture-start":
      (async () => {
        try {
          let tabId = message.tabId;
          if (!tabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = tab && tab.id;
          }
          if (!tabId) { sendResponse({ ok: false, error: "no active tab" }); return; }
          sendResponse(await harStart(tabId, message.redact));
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
      })();
      return true;

    case "har-entry":
      harAccumulate(message.entry);
      return false; // fire-and-forget from the isolated relay

    case "har-capture-status":
      sendResponse({
        ok: true, active: harCapture.active,
        entryCount: harCapture.entries.length, bytes: harCapture.bytes,
        truncated: harCapture.truncated, hasCapture: !!harCapture.lastLog,
      });
      return false;

    case "har-capture-stop":
      sendResponse(harStop());
      return false;

    case "har-upload":
      (async () => { sendResponse(await harUpload(message.destination)); })();
      return true;

    // ── X session sync: hand THIS browser's own logged-in x.com session to the
    //    fleet so Aither can post as the account, without anyone re-entering a
    //    password. The extension already has the `cookies` permission and the
    //    user explicitly clicks "Sync" in the sidepanel — that consent is what
    //    makes reading these cookies legitimate (an external process prising
    //    open Chrome's cookie store would not be). Cookies never touch a remote
    //    host: they go straight to the loopback bridge, which forwards to the
    //    worker's verify-and-store endpoint. ──────────────────────────────────
    case "x-session-sync":
      (async () => { sendResponse(await xSessionSync()); })();
      return true;

    // On-demand growth summary for the popup/sidepanel (no waiting for the digest).
    case "x-summary":
      (async () => { sendResponse(await xDailySummary()); })();
      return true;

    // Brain services for on-page platform agents (LinkedIn, future socials).
    // The agent does the DOM actions itself; these only supply Aither's text +
    // decisions + logging, reusing the platform-agnostic helpers.
    case "social-compose":
      (async () => { sendResponse({ text: await xComposeText(message.prompt) }); })();
      return true;
    case "social-engage-plan":
      (async () => {
        try { sendResponse({ plan: await xEngagePlan(message.feed || [], message.prompt) }); }
        catch (e) { sendResponse({ plan: null, error: String(e) }); }
      })();
      return true;
    // The fleet agents (or the command bar) pushed a new strategy — persist it so
    // every loop reads the updated schedule/prompts/topics next tick.
    case "social-strategy-changed":
      (async () => {
        try { if (message.strategy) await chrome.storage.local.set({ socialStrategy: message.strategy }); sendResponse({ ok: true }); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
      })();
      return true;
    case "social-log":
      (async () => {
        try { await xLogActivity({ platform: message.platform, ...(message.entry || {}) }); sendResponse({ ok: true }); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
      })();
      return true;
    case "social-config":
      (async () => {
        const s = await chrome.storage.local.get([
          "liEngageIntervalMin", "liAutopostIntervalMin",
          "liEngageEnabled", "liAutopostEnabled",
        ]);
        sendResponse(s);
      })();
      return true;

    // Current on/off state of each loop (for the panel's toggles).
    case "x-state":
      (async () => {
        const s = await chrome.storage.local.get([
          "xAutopostEnabled", "xEngageEnabled", "xDiscoverEnabled",
        ]);
        sendResponse({ flags: s });
      })();
      return true;

    // Flip a loop on/off from the on-page panel.
    case "x-toggle":
      (async () => {
        try {
          if (message.key) {
            await chrome.storage.local.set({ [message.key]: !!message.enabled });
          }
          sendResponse({ ok: true, key: message.key, enabled: !!message.enabled });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
      })();
      return true;

    // Manual triggers so the owner can fire a loop now instead of on the timer.
    case "x-run-now":
      (async () => {
        try {
          const which = message.which;
          if (which === "post") await xAutopostTick();
          else if (which === "engage") await xEngageTick(message.force);
          else if (which === "discover") await xDiscoverTick();
          else if (which === "summary") await xDailySummaryTick();
          sendResponse({ ok: true, ran: which });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
      })();
      return true;

    // ── Vision: local Roboflow inference server (sidepanel Vision tab) ──
    // Localhost-only by policy: serverUrl is validated to 127.0.0.1/localhost
    // so this cannot be repurposed as a generic fetch proxy. Workflow images
    // are passed as URLs and fetched by the inference SERVER, not by us.
    case "vision-status":
      (async () => {
        try {
          const base = visionLocalUrl(message.serverUrl);
          if (!base) { sendResponse({ ok: true, up: false, error: "server URL must be localhost" }); return; }
          let r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
          if (!r || !r.ok) r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
          sendResponse({ ok: true, up: !!(r && r.ok) });
        } catch (e) { sendResponse({ ok: true, up: false, error: e.message }); }
      })();
      return true;

    case "vision-workflow-test":
      (async () => {
        try {
          const base = visionLocalUrl(message.serverUrl);
          if (!base) { sendResponse({ ok: false, error: "server URL must be localhost" }); return; }
          const ws = String(message.workspace || "").trim();
          const wf = String(message.workflowId || "asset-pipeline").trim();
          if (!/^[\w\-]+$/.test(ws) || !/^[\w\-]+$/.test(wf)) {
            sendResponse({ ok: false, error: "invalid workspace/workflow id" }); return;
          }
          const r = await fetch(`${base}/infer/workflows/${ws}/${wf}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inputs: { image: { type: "url", value: String(message.imageUrl || "") } } }),
            signal: AbortSignal.timeout(120000),
          });
          if (!r.ok) { sendResponse({ ok: false, error: `workflow HTTP ${r.status}` }); return; }
          const data = await r.json().catch(() => ({}));
          let outputs = data.outputs || data;
          if (Array.isArray(outputs) && outputs.length) outputs = outputs[0];
          if (outputs && typeof outputs === "object") {
            for (const k of Object.keys(outputs)) {
              if (k.toLowerCase().includes("image")) outputs[k] = "<image omitted>";
            }
          }
          sendResponse({ ok: true, outputs });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
      })();
      return true;

    // ════════════════════════════════════════════════════════════════════
    // AGENT TOOLS — Page context extraction for in-conversation use
    // ════════════════════════════════════════════════════════════════════
    // These tools let the agent read and search the active tab mid-conversation.
    // They always return explicit errors when the page is unscannable.

    case "read-page":
      // Get structured page summary (title, URL, headings, text preview, links)
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab available" });
            return;
          }

          // Check if page is unscannable
          if (!tab.url || /^(chrome|edge|extension):\/\//.test(tab.url)) {
            sendResponse({
              success: false,
              error: `Cannot read this page: ${tab.url}. Chrome/extension pages are not scannable.`,
            });
            return;
          }

          if (tab.url.endsWith(".pdf")) {
            sendResponse({
              success: false,
              error: `Cannot read PDF pages. Use your PDF reader's text extraction instead.`,
            });
            return;
          }

          // Ensure content script is loaded
          await ensureContentScript(tab.id);

          // Extract summary from page
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "read-page-summary",
          });

          if (!response?.success) {
            sendResponse({
              success: false,
              error: response?.error || "Page extraction failed",
            });
            return;
          }

          sendResponse({ success: true, summary: response.summary });
        } catch (e) {
          sendResponse({
            success: false,
            error: `Could not read page: ${e.message}`,
          });
        }
      })();
      return true;

    case "read-page-html":
      // Get raw HTML for a CSS selector or the document
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab available" });
            return;
          }

          // Check if page is unscannable
          if (!tab.url || /^(chrome|edge|extension):\/\//.test(tab.url)) {
            sendResponse({
              success: false,
              error: `Cannot read this page: ${tab.url}. Chrome/extension pages are not scannable.`,
            });
            return;
          }

          if (tab.url.endsWith(".pdf")) {
            sendResponse({
              success: false,
              error: `Cannot read PDF pages. Use your PDF reader's text extraction instead.`,
            });
            return;
          }

          // Ensure content script is loaded
          await ensureContentScript(tab.id);

          // Extract HTML
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "read-page-html",
            selector: message.selector || null,
            max_chars: message.max_chars || 50000,
          });

          if (!response?.success) {
            sendResponse({
              success: false,
              error: response?.error || "HTML extraction failed",
            });
            return;
          }

          sendResponse(response);
        } catch (e) {
          sendResponse({
            success: false,
            error: `Could not extract HTML: ${e.message}`,
          });
        }
      })();
      return true;

    case "screenshot":
      // Capture a screenshot of the active tab for vision analysis
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab available" });
            return;
          }

          // Check if page is unscannable
          if (!tab.url || /^(chrome|edge|extension):\/\//.test(tab.url)) {
            sendResponse({
              success: false,
              error: `Cannot screenshot this page: ${tab.url}. Chrome/extension pages are not scannable.`,
            });
            return;
          }

          // PDF: we can screenshot but it will be the PDF viewer
          const [dataUrl, windowInfo] = await Promise.all([
            chrome.tabs.captureVisibleTab(tab.windowId, { format: "png", quality: 90 }),
            chrome.windows.get(tab.windowId),
          ]);

          sendResponse({
            success: true,
            screenshot: dataUrl,
            url: tab.url,
            title: tab.title,
            width: windowInfo.width,
            height: windowInfo.height,
          });
        } catch (e) {
          sendResponse({
            success: false,
            error: `Could not capture screenshot: ${e.message}`,
          });
        }
      })();
      return true;

    case "find-on-page":
      // Search page for text or elements matching a query
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab available" });
            return;
          }

          // Check if page is unscannable
          if (!tab.url || /^(chrome|edge|extension):\/\//.test(tab.url)) {
            sendResponse({
              success: false,
              error: `Cannot search this page: ${tab.url}. Chrome/extension pages are not scannable.`,
            });
            return;
          }

          if (tab.url.endsWith(".pdf")) {
            sendResponse({
              success: false,
              error: `Cannot search PDF pages. Use your PDF reader's search instead.`,
            });
            return;
          }

          // Ensure content script is loaded
          await ensureContentScript(tab.id);

          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "find-on-page",
            query: message.query,
            type: message.type || "text",
          });

          if (!response?.success) {
            sendResponse({
              success: false,
              error: response?.error || "Search failed",
            });
            return;
          }

          sendResponse(response);
        } catch (e) {
          sendResponse({
            success: false,
            error: `Could not search page: ${e.message}`,
          });
        }
      })();
      return true;

    // ── LyraWiki: ask the tenant's wiki, with citations ──────────────
    case "WIKI_ASK":
      (async () => {
        if (!LYRAWIKI_URL) {
          sendResponse({ success: false, error: "LyraWiki not available in this tier" });
          return;
        }
        try {
          const resp = await fetch(`${LYRAWIKI_URL}/query`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              question: message.question || message.text || "",
              tenant_id: SETTINGS.tenantId || "default",
              project: SETTINGS.wikiProject || SETTINGS.projectName || "default",
              depth: message.depth || "normal",
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (!resp.ok) {
            sendResponse({ success: false, error: `LyraWiki ${resp.status}` });
            return;
          }
          sendResponse({ success: true, result: await resp.json() });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    // ── LyraWiki: capture the current page/selection into the wiki ───
    case "WIKI_INGEST":
      (async () => {
        const result = await knowledgeIngest({
          content: message.content || "",
          source: message.source || "",
          title: message.title || "",
          tags: ["browser-capture", "lyra-wiki"],
          metadata: message.metadata || {},
        });
        sendResponse({ success: true, result });
      })();
      return true;

    // ── AitherShell (browser shell): session lifecycle + streamed chat ──
    // Uses Genesis /shell/session/* + /chat/stream + /chat/steer, broadcasting
    // on a dedicated "shell-event" channel so it never collides with the Chat tab.
    case "shell-session-start":
      (async () => {
        try {
          const r = await fetch(`${GENESIS_URL}/shell/session/start`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ client_type: message.client_type || "browser", user_id: SETTINGS.userId || "", username: SETTINGS.username || "browser" }),
            signal: AbortSignal.timeout(8000),
          });
          const data = await r.json().catch(() => ({}));
          sendResponse({ ok: r.ok, session_id: data.session_id });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
      })();
      return true;

    case "shell-heartbeat":
      (async () => {
        try {
          const r = await fetch(`${GENESIS_URL}/shell/session/heartbeat`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ session_id: message.session_id }),
            signal: AbortSignal.timeout(8000),
          });
          const data = await r.json().catch(() => ({}));
          sendResponse({ ok: r.ok && data.status !== "error" });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
      })();
      return true;

    case "shell-session-end":
      (async () => {
        try {
          await fetch(`${GENESIS_URL}/shell/session/end`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ session_id: message.session_id }),
            signal: AbortSignal.timeout(5000),
          });
        } catch { /* best-effort */ }
        sendResponse({ ok: true });
      })();
      return true;

    case "shell-steer":
      (async () => {
        try {
          const r = await fetch(`${GENESIS_URL}/chat/steer`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ session_id: message.session_id, message: message.message || "", action: message.action || "append" }),
            signal: AbortSignal.timeout(8000),
          });
          sendResponse({ ok: r.ok });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
      })();
      return true;

    case "shell-stream":
      (async () => {
        try {
          const r = await fetch(`${GENESIS_URL}/chat/stream`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({
              message: message.message || "",
              session_id: message.session_id,
              context: message.context || { source: "browser-extension-shell" },
            }),
            signal: AbortSignal.timeout(180000),
          });
          if (!r.ok || !r.body) {
            broadcastToSidePanel({ type: "shell-event", event: "error", data: { error: `Genesis ${r.status}` } });
            sendResponse({ streaming: false, error: `HTTP ${r.status}` });
            return;
          }
          sendResponse({ streaming: true });
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replace(/\r\n/g, "\n");
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              let currentEvent = "message";
              let dataLine = null;
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
                else if (line.startsWith("data: ")) dataLine = line.slice(6);
              }
              if (dataLine == null) continue;
              let data;
              try { data = JSON.parse(dataLine); } catch { data = { raw: dataLine }; }
              broadcastToSidePanel({ type: "shell-event", event: data.type || currentEvent, data });
            }
          }
          broadcastToSidePanel({ type: "shell-event", event: "complete", data: { type: "complete" } });
        } catch (e) {
          broadcastToSidePanel({ type: "shell-event", event: "error", data: { error: e.message } });
        }
      })();
      return true;

    // ── Chat (tier-aware: Genesis SSE / Node OpenAI / Cloud OpenAI) ──
    case "chat":
      (async () => {
        const tier = DETECTED_TIER;

        // ── Node-only / Cloud-only / BYOK provider: OpenAI-compat SSE ──
        if (tier === "node-only" || tier === "cloud-only" || tier === "provider") {
          let requestUrl, hdrs, openaiBody;
          let modelLabel = "auto";
          let citations = [];

          if (tier === "provider") {
            // BYOK — build the request from the provider registry
            if (!providerConfigured()) {
              const msg = "No AI provider configured — open extension Options and add a provider API key.";
              broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: msg } });
              sendResponse({ success: false, error: msg });
              return;
            }
            const providerDef = AitherProviders.getProvider(PROVIDER_CFG.id);
            if (!providerDef) {
              sendResponse({ success: false, error: `Unknown provider '${PROVIDER_CFG.id}'` });
              return;
            }
            // On-device (WebGPU) provider — no HTTP request; dispatch to the
            // offscreen inference host over a Port and re-emit chat-events.
            if (providerDef.local) {
              await handleLocalChat(message, providerDef, sendResponse);
              return;
            }
            const model = PROVIDER_CFG.model || providerDef.models?.[0]?.id || "auto";
            modelLabel = `${providerDef.name || PROVIDER_CFG.id}: ${model}`;

            // RAG: ground the reply in the local knowledge base (token-capped)
            const messages = [];
            if (SETTINGS.ragEnabled !== false) {
              try {
                const hits = await AitherKbDb.search(message.text, PROVIDER_CFG, 5);
                if (hits && hits.length) {
                  const MAX_CTX_CHARS = 4000; // ~1000 tokens
                  let used = 0;
                  const parts = [];
                  for (const h of hits) {
                    const text = (h.chunk?.text || "").slice(0, MAX_CTX_CHARS - used);
                    if (!text) break;
                    used += text.length;
                    parts.push(`[${parts.length + 1}] ${h.doc?.title || "Untitled"} (${h.doc?.url || h.doc?.source || "local"}):\n${text}`);
                    citations.push({
                      docId: h.doc?.id, title: h.doc?.title || "Untitled",
                      url: h.doc?.url || "", score: h.score,
                    });
                    if (used >= MAX_CTX_CHARS) break;
                  }
                  if (parts.length) {
                    messages.push({
                      role: "system",
                      content: "Context from the user's local knowledge base (cite by [n] when used):\n\n" + parts.join("\n\n"),
                    });
                    broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
                      stage: "rag", message: `Grounding with ${parts.length} knowledge-base passage(s)`,
                    }});
                  }
                }
              } catch (e) {
                console.debug("[Awconnect] KB retrieval skipped:", e.message);
              }
            }
            messages.push({ role: "user", content: message.text });

            const req = AitherProviders.buildChatRequest(PROVIDER_CFG.id, {
              model,
              messages,
              stream: true,
              maxTokens: 2048,
              apiKey: PROVIDER_CFG.apiKey,
              baseUrlOverride: PROVIDER_CFG.baseUrl,
            });
            if (req.error) {
              broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: req.error } });
              sendResponse({ success: false, error: req.error });
              return;
            }
            requestUrl = req.url;
            hdrs = req.headers;
            openaiBody = req.body;
          } else {
            // Node / Cloud — existing fleet OpenAI-compat path
            const chatUrl = TIER_URLS.chatUrl;
            if (!chatUrl) {
              sendResponse({ success: false, error: "No chat endpoint available" });
              return;
            }
            requestUrl = `${chatUrl}/v1/chat/completions`;

            // Ensure server session ID for continuity (cloud and node-only tiers)
            const serverSessionId = await ensureServerSessionId();

            openaiBody = {
              model: "auto",
              messages: [{ role: "user", content: message.text }],
              stream: true,
              max_tokens: 2048,
              session_id: serverSessionId,  // Pass session ID for server-side continuity
            };

            hdrs = { "Content-Type": "application/json" };
            // Cloud tier needs auth headers
            if (tier === "cloud-only") {
              const key = SETTINGS.cloudApiKey; // gateway-issued creds only — portal session tokens 401 here
              if (key) {
                hdrs["Authorization"] = `Bearer ${key}`;
                hdrs["X-API-Key"] = key;
              } else {
                const msg = "Cloud Gateway needs its own credential — open extension Options and click 'Connect Cloud Gateway' (portal sign-in doesn't cover the gateway).";
                broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: msg } });
                sendResponse({ success: false, error: msg });
                return;
              }
            }
            // Propagate tenant/workspace headers
            if (SETTINGS.tenantId) hdrs["X-Tenant-ID"] = SETTINGS.tenantId;
            if (SETTINGS.workspaceId) hdrs["X-Workspace-ID"] = SETTINGS.workspaceId;
            if (SETTINGS.userId) hdrs["X-User-ID"] = SETTINGS.userId;
          }

          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
            stage: "stream",
            message: tier === "provider" ? `Connecting to ${modelLabel}...`
              : `Connecting to ${tier === "node-only" ? "awnode" : "Cloud Gateway"}...`,
          }});

          try {
            const resp = await fetch(requestUrl, {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(openaiBody),
              signal: AbortSignal.timeout(120000),
            });

            if (!resp.ok) {
              const errText = await resp.text().catch(() => resp.statusText);
              // BYOK provider errors are actionable key/model problems, not
              // tier problems — surface them precisely, no re-detect churn.
              if (tier === "provider") {
                let errMsg;
                if (resp.status === 401 || resp.status === 403) {
                  errMsg = `${modelLabel} rejected the API key (${resp.status}) — re-check it in extension Options.`;
                } else if (resp.status === 404 || resp.status === 400) {
                  errMsg = `${modelLabel} returned ${resp.status}: ${errText.slice(0, 200)} — the model name may be wrong (set it in Options).`;
                } else if (resp.status === 429) {
                  errMsg = `${modelLabel} rate-limited the request (429) — wait a moment or check your provider plan.`;
                } else {
                  errMsg = `${modelLabel} returned ${resp.status}: ${errText.slice(0, 200)}`;
                }
                broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: errMsg } });
                sendResponse({ success: false, error: errMsg });
                return;
              }
              // On auth failure or server error, re-detect tier — genesis may be available now
              let _redetectedTier = tier;
              if (resp.status === 401 || resp.status === 403 || resp.status >= 500) {
                console.debug(`[Awconnect] ${tier} returned ${resp.status}, re-detecting tier...`);
                await autoDetectTier();
                _redetectedTier = DETECTED_TIER;
              }
              let errMsg = `${tier} returned ${resp.status}: ${errText.slice(0, 200)}`;
              if (tier === "cloud-only" && (resp.status === 401 || resp.status === 403)) {
                errMsg += (_redetectedTier !== "cloud-only" && _redetectedTier !== "offline")
                  ? ` — switched back to ${_redetectedTier}; send your message again`
                  : " — key expired or invalid; re-run 'Connect Cloud Gateway' in extension Options";
              }
              broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: errMsg } });
              sendResponse({ success: false, error: errMsg });
              return;
            }

            sendResponse({ success: true, streaming: true });

            // Parse OpenAI SSE format: data: {"choices":[{"delta":{"content":"..."}}]}
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullContent = "";
            let returnedSessionId = null;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop();

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;

                try {
                  const data = JSON.parse(payload);
                  // Capture session_id if returned by server
                  if (data.session_id && !returnedSessionId) {
                    returnedSessionId = data.session_id;
                  }
                  const delta = data.choices?.[0]?.delta?.content || "";
                  if (delta) {
                    fullContent += delta;
                    broadcastToSidePanel({ type: "chat-event", event: "chunk", data: { content: delta } });
                  }
                } catch { /* skip malformed SSE lines */ }
              }
            }

            // Update local session_id if server returned a different one
            if (returnedSessionId && returnedSessionId !== serverSessionId) {
              await chrome.storage.local.set({ "aither_server_session_id": returnedSessionId });
              console.log("[Awconnect] Updated session ID to:", returnedSessionId);
              // Broadcast to sidepanel so UI can update
              broadcastToSidePanel({ type: "session-updated", session_id: returnedSessionId });
            }

            broadcastToSidePanel({ type: "chat-event", event: "complete", data: {
              type: "complete", content: fullContent,
              model: tier === "provider" ? modelLabel : "auto",
              artifacts: [],
              session_id: returnedSessionId || serverSessionId,
              ...(citations.length ? { citations } : {}),
            }});
            return;
          } catch (err) {
            console.debug(`[Awconnect] ${tier} chat failed:`, err.message);
            if (tier === "provider") {
              // 'Failed to fetch' from a provider = CORS/permission/network —
              // point at the likely fixes instead of re-detecting tiers.
              const hint = /failed to fetch/i.test(err.message)
                ? " — likely a permission or CORS block. Grant the provider's host permission in Options; for Ollama set OLLAMA_ORIGINS (see Options → help)."
                : "";
              const errMsg = `${modelLabel} request failed: ${err.message}${hint}`;
              broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: errMsg } });
              sendResponse({ success: false, error: errMsg });
              return;
            }
            // On failure, re-detect tier and report error
            autoDetectTier();
            broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: `${tier} chat failed: ${err.message}` } });
            sendResponse({ success: false, error: err.message });
            return;
          }
        }

        // ── Genesis tier: SSE via /agent, fallback to /chat (original logic) ──
        // Ensure server session ID for continuity (genesis tier)
        const serverSessionId = await ensureServerSessionId();
        const chatBody = {
          message: message.text,
          context: message.context || { source: "browser-extension" },
          session_id: serverSessionId,  // Pass session ID for server-side continuity
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.agent ? { agent: message.agent } : {}),
          ...(message.prefer_cloud_model ? { prefer_cloud_model: message.prefer_cloud_model } : {}),
        };
        let streamingStarted = false;
        let gotCompleteEvent = false;

        // Try SSE streaming via /agent first (real-time events).
        // NOTE: no short AbortSignal here — agentic SSE sessions legitimately
        // run for many minutes; a fetch-level timeout would abort mid-stream.
        // The 30-min ceiling is a stuck-connection backstop only.
        let agentFallbackReason = "SSE unavailable";
        try {
          const resp = await fetch(`${GENESIS_URL}/agent`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(chatBody),
            signal: AbortSignal.timeout(1800000),
          });

          if (resp.ok && (resp.headers.get("content-type") || "").includes("text/event-stream") && resp.body) {
            streamingStarted = true;
            broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "stream", message: "SSE stream connected" } });
            sendResponse({ success: true, streaming: true });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let returnedSessionId = null;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop(); // keep incomplete line in buffer

              let currentEvent = "message";
              for (const line of lines) {
                if (line.startsWith("event: ")) {
                  currentEvent = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  if (currentEvent === "complete") gotCompleteEvent = true;
                  try {
                    const data = JSON.parse(line.slice(6));
                    // Capture session_id if returned by server
                    if (data.session_id && !returnedSessionId) {
                      returnedSessionId = data.session_id;
                    }
                    broadcastToSidePanel({ type: "chat-event", event: currentEvent, data });
                  } catch {
                    broadcastToSidePanel({ type: "chat-event", event: currentEvent, data: { raw: line.slice(6) } });
                  }
                }
              }
            }

            // Update local session_id if server returned a different one
            if (returnedSessionId && returnedSessionId !== serverSessionId) {
              await chrome.storage.local.set({ "aither_server_session_id": returnedSessionId });
              console.log("[Awconnect] Updated session ID to:", returnedSessionId);
              // Broadcast to sidepanel so UI can update
              broadcastToSidePanel({ type: "session-updated", session_id: returnedSessionId });
            }

            // SSE stream ended — ensure sidepanel gets a complete event
            if (!gotCompleteEvent) {
              broadcastToSidePanel({ type: "chat-event", event: "complete", data: {
                type: "complete", content: "", model: "auto", artifacts: [], session_id: returnedSessionId || serverSessionId,
              }});
            }
            return;
          }

          // Non-OK or non-SSE response — capture the REAL reason so a 403
          // (e.g. caller-type downgrade) is visible instead of a generic
          // "SSE unavailable" (this exact silence hid a Veil middleware bug).
          const errBody = await resp.text().catch(() => "");
          agentFallbackReason = `/agent ${resp.status}: ${errBody.slice(0, 160) || "non-SSE response"}`;
          console.warn(`[Awconnect] ${agentFallbackReason} — falling back to /chat`);
        } catch (streamErr) {
          agentFallbackReason = `/agent failed: ${streamErr.message}`;
          console.debug("[Awconnect] /agent stream failed, falling back:", streamErr.message);
          // If streaming was started, tell the sidepanel it errored
          if (streamingStarted) {
            broadcastToSidePanel({ type: "chat-event", event: "error", data: {
              error: `Stream interrupted: ${streamErr.message}`,
            }});
          }
        }

        // Fallback: non-streaming /chat — broadcast pipeline traces for visibility
        broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "fallback", message: `${agentFallbackReason} — using /chat` } });
        // /chat is non-streaming: ping the sidepanel every 30s so its stall
        // watchdog (resets on any event) doesn't false-fire on long requests.
        const keepalive = setInterval(() => {
          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "waiting", message: "Still processing (non-streaming /chat)..." } });
        }, 30000);
        try {
          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "request", message: "Sending to Genesis /chat" } });
          const resp = await fetch(`${GENESIS_URL}/chat`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(chatBody),
            signal: AbortSignal.timeout(300000),
          });
          if (!resp.ok) {
            broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: `Genesis returned ${resp.status}` } });
            if (!streamingStarted) sendResponse({ success: false, error: `Genesis returned ${resp.status}` });
            return;
          }
          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "response", message: "Received response" } });
          const data = await resp.json();
          const content = data.response || data.message || data.reply || "";
          broadcastToSidePanel({ type: "chat-event", event: "complete", data: {
            type: "complete", content, model: data.model_used || "auto",
            artifacts: (data.artifacts?.length ? data.artifacts : data.metadata?.artifacts) || [],
          }});
          if (!streamingStarted) sendResponse({ success: true, ...data });
        } catch (e) {
          broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: e.message } });
          if (!streamingStarted) sendResponse({ success: false, error: e.message });
        } finally {
          clearInterval(keepalive);
        }
      })();
      return true; // ← keeps channel open for async response

    // ── Speculative prewarm from typing pause — fire-and-forget ─────
    case "search-prewarm": {
      const pq = (message.query || "").trim();
      if (pq && SEARCH_URL) {
        const prewarmHeaders = { "Content-Type": "application/json" };
        if (DETECTED_TIER === "cloud-only" && SETTINGS.cloudApiKey) {
          prewarmHeaders["Authorization"] = `Bearer ${SETTINGS.cloudApiKey}`;
          prewarmHeaders["X-API-Key"] = SETTINGS.cloudApiKey;
        }
        fetch(`${SEARCH_URL}/search/fast`, {
          method: "POST",
          headers: prewarmHeaders,
          body: JSON.stringify({ query: pq, deadline_ms: 2500, min_results: 3 }),
          signal: AbortSignal.timeout(6000),
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }

    // ── Federated Search ────────────────────────────────────────────
    case "federated-search":
      performFederatedSearch(message.query, message.options || {})
        .then((results) => sendResponse(results))
        .catch((e) => sendResponse({ results: [], error: e.message }));
      return true;

    // ── Harvest data from content scripts ───────────────────────────
    case "HARVEST_DATA":
      console.log(`[Awconnect] Harvest from ${sender.url}`);
      knowledgeIngest({
        content: message.content,
        source: sender.url || message.source || "generic_web",
        title: message.metadata?.title || "Auto-harvested page",
        tags: ["auto-harvest", "browser-capture"],
        collection: "browser",
        metadata: { ...message.metadata, harvested: true },
      })
        .then((r) => sendResponse({ ok: true, success: true, ...r }))
        .catch(() => sendResponse({ ok: false, success: false }));
      return true;

    // ── AitherBrowser — host-side Playwright capture/crawl ─────────
    // Rides the awnode proxy plane in node tier, the Veil bridge in
    // genesis tier. Unavailable in cloud/provider tiers (BROWSER_URL = "").
    case "browser-status":
      (async () => {
        if (!BROWSER_URL) {
          sendResponse({ ok: false, available: false, error: "AitherBrowser not reachable in this tier" });
          return;
        }
        try {
          const resp = await fetch(`${BROWSER_URL}/health`, {
            signal: AbortSignal.timeout(5000), headers: authHeaders(),
          });
          const data = resp.ok ? await resp.json() : {};
          sendResponse({ ok: resp.ok, available: resp.ok, detail: data });
        } catch (e) {
          sendResponse({ ok: false, available: false, error: String(e) });
        }
      })();
      return true;

    case "browser-capture":
      // Capture a URL server-side (real Chromium, no tab needed) and
      // optionally ingest the extracted text into the knowledge base.
      (async () => {
        if (!BROWSER_URL) {
          sendResponse({ ok: false, error: "AitherBrowser not reachable in this tier" });
          return;
        }
        try {
          const resp = await fetch(`${BROWSER_URL}/browse`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            // Default is OBEY. The override is deliberate and the service logs
            // the reason, so it must travel with one. See shared/aitherbrowser.js.
            body: JSON.stringify(AitherBrowserBridge.buildBrowsePayload(message)),
            signal: AbortSignal.timeout(90000),
          });
          if (!resp.ok) {
            sendResponse(await browserError(resp));
            return;
          }
          const data = await resp.json();
          let ingested = false;
          if (message.ingest && data.content) {
            try {
              await knowledgeIngest({
                content: data.content,
                source: message.url,
                title: data.title || message.url,
                tags: ["aitherbrowser", "server-capture"],
                collection: "browser",
                metadata: { engine: data.engine || "playwright", captured_via: "aitherbrowser" },
              });
              ingested = true;
            } catch { /* capture still succeeded — report ingest failure via flag */ }
          }
          sendResponse({
            ok: true,
            title: data.title || "",
            content: data.content || "",
            screenshot: data.screenshot || null,
            url: data.url || message.url,
            ingested,
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;

    case "browser-crawl":
      // BFS same-domain crawl via AitherBrowser; returns per-page text.
      (async () => {
        if (!BROWSER_URL) {
          sendResponse({ ok: false, error: "AitherBrowser not reachable in this tier" });
          return;
        }
        try {
          const resp = await fetch(`${BROWSER_URL}/crawl`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(AitherBrowserBridge.buildCrawlPayload(message)),
            signal: AbortSignal.timeout(300000),
          });
          if (!resp.ok) {
            sendResponse(await browserError(resp));
            return;
          }
          const data = await resp.json();

          // Ingest the crawl into the KB. Without this, "crawl a docs site into
          // my knowledge base" — the entire reason to crawl server-side rather
          // than open 25 tabs — was left for the caller to loop, and no caller
          // did. Each page is its own KB entry so search returns the right page,
          // not one giant blob. Loop lives in shared/aitherbrowser.js.
          const ingestReport = message.ingest
            ? await AitherBrowserBridge.ingestPages(data.pages, knowledgeIngest, {
                collection: message.collection,
                seed: message.url,
              })
            : { ingested: 0, ingestFailures: 0, ingestFailureDetail: [] };
          sendResponse({ ok: true, ...data, ...ingestReport });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;

    // ── IRC Relay — connect / send / join ────────────────────────
    case "relay-connect":
      connectToRelay(message.nick, message.workspaceId, message.tenantId);
      sendResponse({ ok: true });
      break;

    case "relay-send":
      sendResponse({ ok: sendRelayMessage(message.data) });
      break;

    case "relay-disconnect":
      if (relaySocket) relaySocket.close();
      relayNick = null;
      relayConnected = false;
      sendResponse({ ok: true });
      break;

    // ── Notes sync — push/pull via Veil API → Strata ────────────
    case "sync-notes-push":
      (async () => {
        // Scope notes by tenant/user for multi-workspace isolation
        const notesPath = SETTINGS.tenantId && SETTINGS.userId
          ? `sync/user-notes/${SETTINGS.tenantId}/${SETTINGS.userId}`
          : "sync/user-notes";
        const noteHeaders = { "Content-Type": "application/json" };
        if (SETTINGS.tenantId) noteHeaders["X-Tenant-ID"] = SETTINGS.tenantId;
        if (SETTINGS.userId) noteHeaders["X-User-ID"] = SETTINGS.userId;
        if (SETTINGS.workspaceId) noteHeaders["X-Workspace-ID"] = SETTINGS.workspaceId;

        try {
          const resp = await fetch(`${VEIL_URL}/api/sync-notes`, {
            method: "POST",
            headers: noteHeaders,
            body: JSON.stringify({
              content: message.content,
              source: message.source || "aither-connect",
              updated_at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(8000),
          });
          const data = await resp.json();
          sendResponse({ ok: data.ok || false, synced: data.synced || false });
        } catch (e) {
          // Fallback: try Strata directly if Veil is down
          try {
            const resp = await fetch(`${STRATA_URL}/write`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                path: notesPath,
                content: JSON.stringify({
                  content: message.content,
                  source: message.source || "aither-connect",
                  updated_at: new Date().toISOString(),
                  version: 1,
                }),
                tier: "HOT",
                metadata: { type: "user-notes", source: "aither-connect", tenant_id: SETTINGS.tenantId || "" },
              }),
              signal: AbortSignal.timeout(5000),
            });
            sendResponse({ ok: resp.ok, synced: resp.ok, via: "strata-direct" });
          } catch (strataErr) {
            sendResponse({ ok: false, synced: false, offline: true, error: strataErr.message || e.message });
          }
        }
      })();
      return true;

    case "sync-notes-pull":
      (async () => {
        // Build tenant-scoped path matching the push path
        const pullPath = SETTINGS.tenantId && SETTINGS.userId
          ? `sync/user-notes/${SETTINGS.tenantId}/${SETTINGS.userId}`
          : "sync/user-notes";
        const pullHeaders = {};
        if (SETTINGS.tenantId) pullHeaders["X-Tenant-ID"] = SETTINGS.tenantId;
        if (SETTINGS.userId) pullHeaders["X-User-ID"] = SETTINGS.userId;
        if (SETTINGS.workspaceId) pullHeaders["X-Workspace-ID"] = SETTINGS.workspaceId;

        try {
          const resp = await fetch(`${VEIL_URL}/api/sync-notes`, {
            headers: pullHeaders,
            signal: AbortSignal.timeout(8000),
          });
          const data = await resp.json();
          sendResponse(data);
        } catch (e) {
          // Fallback: try Strata directly with tenant-scoped path
          try {
            const resp = await fetch(`${STRATA_URL}/read?path=${encodeURIComponent(pullPath)}`, {
              signal: AbortSignal.timeout(5000),
            });
            if (resp.ok) {
              const raw = await resp.json();
              let payload;
              try { payload = JSON.parse(raw.content); } catch { payload = { content: raw.content }; }
              sendResponse({
                content: payload.content || "",
                updated_at: payload.updated_at || null,
                synced: true,
                via: "strata-direct",
              });
            } else {
              sendResponse({ content: "", synced: false, offline: true });
            }
          } catch (strataErr) {
            sendResponse({ content: "", synced: false, offline: true, error: strataErr.message || e.message });
          }
        }
      })();
      return true;

    // ── Notes → KB ingestion (save note as knowledge base document) ──
    case "save-note-to-kb":
      (async () => {
        try {
          const { baseId, content, title } = message;
          const resp = await fetch(
            `${GENESIS_URL}/api/knowledge-rag/bases/${encodeURIComponent(baseId)}/ingest`,
            {
              method: "POST",
              headers: authHeaders(),  // include auth + tenant/workspace scoping
              body: JSON.stringify({
                documents: [{
                  content,
                  title: title || `Browser note ${new Date().toISOString().slice(0, 10)}`,
                  source: "aither-connect-notes",
                }],
              }),
              signal: AbortSignal.timeout(15000),
            }
          );
          const data = await resp.json();
          sendResponse({ ok: resp.ok, ...data });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Notes → Portal sync via federation service (port 8094) ──
    case "sync-notes-portal":
      (async () => {
        try {
          const connectUrl = SETTINGS.remoteUrl
            ? `${SETTINGS.remoteUrl}/services/connect/api/ingest`
            : `http://${LOOPBACK}:${SETTINGS.veilPort}/api/bridge/connect/api/ingest`;
          const resp = await fetch(connectUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: message.content,
              source: "browser-notes",
              metadata: {
                user_id: SETTINGS.userId || "",
                tenant_id: SETTINGS.tenantId || "",
                timestamp: new Date().toISOString(),
              },
            }),
            signal: AbortSignal.timeout(10000),
          });
          const data = await resp.json();
          sendResponse({ ok: resp.ok, ...data });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Agent context extraction ────────────────────────────────
    case "agent-context":
      extractActiveTabContext(message.options || {})
        .then((ctx) => sendResponse({ success: true, context: ctx }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    // ── Themis page analysis (consumer advocacy) ─────────────────
    case "themis-analyze-page":
      (async () => {
        try {
          // Extract full page context with consumer signals
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab" });
            return;
          }

          // Inject content script if missing (after extension reload/update)
          try {
            await ensureContentScript(tab.id);
          } catch (injectErr) {
            // Truly unscannable page (chrome://, PDF, extension page)
            sendResponse({ success: false, error: `Cannot scan this page type (${tab.url?.split(":")[0]}://)` });
            return;
          }

          let extraction;
          try {
            extraction = await chrome.tabs.sendMessage(tab.id, {
              action: "extract-themis-context",
            });
          } catch (extractErr) {
            sendResponse({ success: false, error: `Page extraction failed: ${extractErr.message.slice(0, 80)}` });
            return;
          }

          if (!extraction?.success) {
            sendResponse({ success: false, error: extraction?.error || "Page extraction failed" });
            return;
          }

          const ctx = extraction.context;

          // Send to Themis via Genesis proxy
          let resp;
          try {
            resp = await fetch(`${GENESIS_URL}/browser/themis/analyze-page`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: ctx.url,
                title: ctx.title,
                text_content: ctx.text_content || "",
                json_ld: ctx.json_ld || null,
                opengraph: ctx.opengraph || null,
                structure: ctx.structure || null,
                forms: ctx.forms || null,
                meta: ctx.meta || null,
                consumer_signals: ctx.consumer_signals || null,
                include_news_context: true,
              }),
              signal: AbortSignal.timeout(65000),
            });
          } catch (fetchErr) {
            // Network-level failure — Genesis unreachable
            const isAbort = fetchErr.name === "AbortError" || fetchErr.name === "TimeoutError";
            const msg = isAbort
              ? "Genesis timed out — Themis analysis may be taking too long"
              : `Cannot reach Genesis at ${GENESIS_URL} — is AitherOS running?`;
            sendResponse({ success: false, error: msg });
            return;
          }

          if (!resp.ok) {
            const text = await resp.text().catch(() => resp.statusText);
            // Parse JSON detail from FastAPI HTTPException if possible
            let detail = text.slice(0, 200);
            try { const j = JSON.parse(text); if (j.detail) detail = j.detail; } catch {}
            const hint = resp.status === 503 ? " — start Themis: docker compose --profile agents up -d aither-themis" : "";
            sendResponse({ success: false, error: `(${resp.status})${hint}: ${detail}` });
            return;
          }

          const analysis = await resp.json();
          sendResponse({ success: true, analysis });
        } catch (e) {
          sendResponse({ success: false, error: e.message || "Unknown error" });
        }
      })();
      return true;

    // ── Themis quick scan (consumer signals only, no backend) ────
    case "themis-quick-scan":
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab" });
            return;
          }
          await ensureContentScript(tab.id);
          const extraction = await chrome.tabs.sendMessage(tab.id, {
            action: "extract-consumer-signals",
          });
          sendResponse({
            success: extraction?.success || false,
            signals: extraction?.signals || {},
            url: tab.url,
            title: tab.title,
          });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    // ── Shield full scan (security threats via Sentry + Bastion) ─────
    case "shield-scan-page":
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab" });
            return;
          }

          // Inject content script if missing (after extension reload/update)
          try {
            await ensureContentScript(tab.id);
          } catch (injectErr) {
            sendResponse({ success: false, error: `Cannot scan this page type (${tab.url?.split(":")[0]}://)` });
            return;
          }

          // Extract security signals + page context from content script
          let extraction;
          try {
            extraction = await chrome.tabs.sendMessage(tab.id, {
              action: "extract-shield-context",
            });
          } catch (extractErr) {
            sendResponse({ success: false, error: `Security extraction failed: ${extractErr.message.slice(0, 80)}` });
            return;
          }

          if (!extraction?.success) {
            sendResponse({ success: false, error: extraction?.error || "Security extraction failed" });
            return;
          }

          const ctx = extraction.context;
          const secSignals = ctx.security_signals || {};

          // Send to Themis via Genesis proxy (aggregates Bastion + Sentry + Sentinel)
          let resp;
          try {
            resp = await fetch(`${GENESIS_URL}/browser/themis/security-scan`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: ctx.url || tab.url,
                title: ctx.title || tab.title,
                text_content: ctx.text_content || "",
                security_signals: secSignals,
                page_source_excerpt: "",  // We don't send raw HTML for privacy
                include_sentry: true,
                include_bastion: true,
              }),
              signal: AbortSignal.timeout(65000),
            });
          } catch (fetchErr) {
            const isAbort = fetchErr.name === "AbortError" || fetchErr.name === "TimeoutError";
            const msg = isAbort
              ? "Genesis timed out — Shield scan may be taking too long"
              : `Cannot reach Genesis at ${GENESIS_URL} — is AitherOS running?`;
            sendResponse({ success: false, error: msg });
            return;
          }

          if (!resp.ok) {
            const text = await resp.text().catch(() => resp.statusText);
            let detail = text.slice(0, 200);
            try { const j = JSON.parse(text); if (j.detail) detail = j.detail; } catch {}
            const hint = resp.status === 503 ? " — start Themis: docker compose --profile agents up -d aither-themis" : "";
            sendResponse({ success: false, error: `(${resp.status})${hint}: ${detail}` });
            return;
          }

          const analysis = await resp.json();
          sendResponse({ success: true, analysis });
        } catch (e) {
          sendResponse({ success: false, error: e.message || "Unknown error" });
        }
      })();
      return true;

    // ── Shield quick scan (client-side only, no backend) ─────────────
    case "shield-quick-scan":
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ success: false, error: "No active tab" });
            return;
          }
          await ensureContentScript(tab.id);
          const extraction = await chrome.tabs.sendMessage(tab.id, {
            action: "extract-security-signals",
          });
          sendResponse({
            success: extraction?.success || false,
            signals: extraction?.signals || {},
            url: tab.url,
            title: tab.title,
          });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    case "agent-context-all-tabs":
      extractAllTabsContext(message.options || {})
        .then((tabs) => sendResponse({ success: true, tabs }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "agent-context-push":
      extractActiveTabContext(message.options || { include_text: true })
        .then((ctx) => {
          pushContextToGenesis(ctx, "manual_push");
          pushContextToStrata(ctx);
          sendResponse({ success: true });
        })
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    // ── Ambient Expertise ──────────────────────────────────────────
    // "What does the agent already know about this page?"
    case "ambient-brief":
      (async () => {
        const url = message.url || (ambientCurrent && ambientCurrent.url) || "";
        if (!url) {
          sendResponse({ available: false, reason: "no active page" });
          return;
        }
        sendResponse(await ambientFetchBrief(url));
      })();
      return true;

    // Force an observation now instead of waiting for dwell to accrue.
    case "ambient-learn-this":
      (async () => {
        ambientLastSent.delete((ambientCurrent && ambientCurrent.url) || "");
        if (ambientCurrent) {
          ambientDwell.set(ambientCurrent.url, AMBIENT_MIN_DWELL_MS);
        }
        await ambientMaybeObserve();
        sendResponse({ success: true });
      })();
      return true;

    // ── MCP Tool Discovery ─────────────────────────────────────────
    case "list-tools":
      (async () => {
        const mapTools = (arr) => (arr || []).map(t => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || t.input_schema || {},
        }));
        // Fetch that turns an AbortSignal timeout into a clear, actionable error
        // instead of the opaque "signal timed out" the Tools tab was showing.
        // Returns { ok: bool, data?: any, status?: number, error?: string }
        const fetchJson = async (url, opts, budgetMs, label) => {
          try {
            const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(budgetMs) });
            if (resp.status === 401) {
              // Reachable but unauthenticated — return a distinct error
              return { ok: false, status: 401, error: `${label} returned HTTP 401 (unauthenticated)` };
            }
            if (!resp.ok) {
              return { ok: false, status: resp.status, error: `${label} returned HTTP ${resp.status}` };
            }
            const data = await resp.json();
            return { ok: true, data };
          } catch (err) {
            if (err.name === "TimeoutError" || /timed out/i.test(err.message || "")) {
              return { ok: false, error: `${label} timed out after ${Math.round(budgetMs / 1000)}s` };
            }
            // Network error, DNS failure, etc.
            return { ok: false, error: err.message || String(err) };
          }
        };

        const tier = DETECTED_TIER;
        // awnode is the always-on host service that Claude Code + awdk
        // also use. When it's reachable, list ITS tools first (one source of
        // truth) — regardless of tier — via /mcp/tools on the persistent server.
        const nodeBase = (tier === "node-only" && TIER_URLS.nodeUrl)
          ? TIER_URLS.nodeUrl
          : `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
        try {
          const result = await fetchJson(`${nodeBase}/mcp/tools`, {}, 20000, "awnode");
          if (result.ok) {
            const tools = mapTools(result.data.tools);
            if (tools.length) {
              sendResponse({ ok: true, tools, tier: "node", source: "awnode" });
              return;
            }
            // node up but zero tools — fall through to the configured MCP path below
          }
        } catch (_nodeErr) {
          // Fallback to configured mcpUrl or tier-based approach
        }

        // Try the configured SETTINGS.mcpUrl if it's been set and is reachable.
        // This allows users to point to a custom MCP endpoint (e.g., mcp.aitherium.com
        // for cloud access, or a self-hosted gateway).
        if (SETTINGS.mcpUrl) {
          const result = await fetchJson(
            `${SETTINGS.mcpUrl}`,
            { headers: authHeaders() },
            20000,
            "Configured MCP endpoint",
          );
          if (result.ok) {
            const tools = mapTools(result.data.tools || result.data);
            if (tools.length) {
              sendResponse({ ok: true, tools, tier: "mcp-configured", source: "mcpUrl" });
              return;
            }
            // Configured endpoint returned 0 tools — fall through to tier-based
          } else if (result.status === 401) {
            // Endpoint is reachable but unauthenticated. Report this distinctly
            // so the user knows the URL is valid but lacks credentials.
            sendResponse({
              ok: false, tools: [],
              error: result.error + " — configure cloudApiKey in settings if required",
            });
            return;
          }
          // If SETTINGS.mcpUrl is configured but unreachable or times out,
          // fall through to tier-based approach as fallback.
        }

        try {
          let tools = [];
          if (tier === "genesis") {
            // Genesis exposes 1500+ platform tools at GET /tools (the a2a router
            // has only /parallel /call /fleet — /a2a/tools 404s, which surfaced
            // as "no tools"). Enumeration measured ~36s live, so the budget must
            // clear it (was 25s → timed out every call).
            const result = await fetchJson(
              `${GENESIS_URL}/tools`, { headers: authHeaders() }, 45000, "Genesis",
            );
            if (!result.ok) throw new Error(result.error);
            tools = mapTools(result.data.tools || result.data);
          } else if (tier === "cloud-only") {
            const key = SETTINGS.cloudApiKey; // gateway-issued creds only — portal session tokens 401 here
            const hdrs = { "Content-Type": "application/json" };
            if (key) { hdrs["Authorization"] = `Bearer ${key}`; hdrs["X-API-Key"] = key; }
            const result = await fetchJson(
              `${TIER_URLS.nodeUrl}/v1/mcp/tools`, { headers: hdrs }, 20000, "Cloud gateway",
            );
            if (!result.ok) throw new Error(result.error);
            tools = mapTools(result.data.tools || result.data);
          } else {
            // node-only tier but the node had 0 tools, or an unknown tier
            sendResponse({
              ok: false, tools: [],
              error: "awnode is running but exposed no tools — start a backend "
                + "(Genesis, Ollama, or Bonsai) so platform tools become available.",
            });
            return;
          }
          sendResponse({ ok: true, tools, tier });
        } catch (e) {
          sendResponse({ ok: false, tools: [], error: e.message });
        }
      })();
      return true;

    // ── Marketplace: browse the unified catalog ──────────────────────
    // Agent packs, skill packs, tool packs, apps, tools, plugins, extensions
    // from AitherMarketplace (:8260) with the SERVER-SIDE fail-closed
    // entitlement gate. Per-tier reach:
    //   genesis → Veil native route /api/marketplace/unified/browse
    //   node    → node proxy /proxy/marketplace/v1/marketplace/unified/browse
    //   cloud   → gateway /v1/marketplace/unified/browse
    // The extension NEVER filters entitlement itself — it renders what the
    // gated endpoint returns (gated items simply don't come back).
    case "marketplace-browse":
      (async () => {
        const tier = DETECTED_TIER;
        const qs = new URLSearchParams();
        if (message.kind) qs.set("kind", message.kind);
        if (message.q) qs.set("q", message.q);
        if (message.source) qs.set("source", message.source);
        qs.set("limit", String(message.limit || 50));
        qs.set("offset", String(message.offset || 0));

        let url, hdrs = { "Accept": "application/json", ...authHeaders() };
        if (tier === "node-only") {
          const nodeBase = TIER_URLS.nodeUrl || `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
          url = `${nodeBase}/proxy/marketplace/v1/marketplace/unified/browse?${qs}`;
        } else if (tier === "cloud-only") {
          const key = SETTINGS.cloudApiKey;
          if (key) { hdrs["Authorization"] = `Bearer ${key}`; hdrs["X-API-Key"] = key; }
          url = `${(SETTINGS.cloudGatewayUrl || "https://gateway.aitherium.com").replace(/\/+$/, "")}/v1/marketplace/unified/browse?${qs}`;
        } else {
          // genesis tier (or default) — the native Veil API route
          const veil = VEIL_URL || `http://${LOOPBACK}:${SETTINGS.veilPort || 3000}`;
          url = `${veil}/api/marketplace/unified/browse?${qs}`;
        }

        try {
          const resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(15000) });
          if (!resp.ok) {
            sendResponse({ ok: false, items: [], error: `Marketplace HTTP ${resp.status}`, tier });
            return;
          }
          const data = await resp.json();
          const items = Array.isArray(data.items) ? data.items : [];

          // Data-driven installed state: ask the local node which packs it has
          // (replaces the old hardcoded per-pack probes). Best-effort — if no
          // node is running, nothing is marked installed.
          let installedSet = new Set();
          try {
            const nodeBase = (tier === "node-only" && TIER_URLS.nodeUrl)
              ? TIER_URLS.nodeUrl
              : `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
            const pi = await fetch(`${nodeBase}/packs/installed`, { signal: AbortSignal.timeout(4000) });
            if (pi.ok) {
              const pj = await pi.json();
              installedSet = new Set([...(pj.installed || [])]);
            }
          } catch { /* no node — leave installed state empty */ }

          for (const it of items) {
            it.installed = installedSet.has(it.id);
          }

          sendResponse({ ok: true, items, total: data.total || 0, tier });
        } catch (e) {
          const msg = /timed out|Timeout/i.test(e.message || "")
            ? "Marketplace request timed out"
            : (e.message || "Marketplace unreachable");
          sendResponse({ ok: false, items: [], error: msg, tier });
        }
      })();
      return true;

    // ── Marketplace: install a pack ──────────────────────────────────
    // Resolution ladder (first rung that succeeds wins, fail-closed):
    //   git → return the URL for the UI to open in a tab.
    //   1. SOVEREIGN: local awnode /packs/install (bundled adk packs
    //      install fully in-browser; 404 for registry packs → next rung).
    //   2. MANAGED: Genesis POST /v1/agent/binding/apply-pack — applies the
    //      pack to the caller's BOUND agent (skill overlay / tool grant /
    //      agent swap) with the server-side license gate. A 403
    //      license_required surfaces the portal checkout deep-link instead
    //      of silently failing. Reached via the tier's GENESIS_URL (Veil
    //      bridge / node proxy /proxy/genesis / cloud gateway).
    //   3. FALLBACK: the copyable `adk install pack/<id>` command
    //      (the extension can't shell out).
    case "marketplace-install":
      (async () => {
        sendResponse(await marketplaceInstall(message.itemId || "", message.install || {}));
      })();
      return true;

    // ── MCP Tool Execution ──────────────────────────────────────────
    case "call-tool":
      (async () => {
        try {
          const tier = DETECTED_TIER;
          const { name, arguments: args } = message;
          let result = null;

          if (tier === "genesis") {
            // Genesis: POST /a2a/call
            const resp = await fetch(`${GENESIS_URL}/a2a/call`, {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({ tool: name, arguments: args }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) result = await resp.json();
            else throw new Error(`Genesis returned ${resp.status}`);
          } else if (tier === "node-only") {
            // Node: POST /mcp with JSON-RPC tools/call
            const resp = await fetch(`${TIER_URLS.nodeUrl}/mcp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name, arguments: args },
                id: 2,
              }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const data = await resp.json();
              result = data.result || data;
            } else {
              throw new Error(`Node returned ${resp.status}`);
            }
          } else if (tier === "cloud-only") {
            // Cloud: POST /v1/mcp/call with auth
            const key = SETTINGS.cloudApiKey; // gateway-issued creds only — portal session tokens 401 here
            const hdrs = { "Content-Type": "application/json" };
            if (key) { hdrs["Authorization"] = `Bearer ${key}`; hdrs["X-API-Key"] = key; }
            const resp = await fetch(`${TIER_URLS.nodeUrl}/v1/mcp/call`, {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name, arguments: args },
                id: 2,
              }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const data = await resp.json();
              result = data.result || data;
            } else {
              throw new Error(`Cloud returned ${resp.status}`);
            }
          } else {
            throw new Error("No service tier available");
          }

          sendResponse({ ok: true, result, tier });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Get current tier ────────────────────────────────────────────
    case "get-tier":
      sendResponse({
        ok: true,
        tier: DETECTED_TIER,
        chatUrl: TIER_URLS.chatUrl,
        nodeUrl: TIER_URLS.nodeUrl,
        preferredTier: SETTINGS.preferredTier,
      });
      break;

    // ── Get status ──────────────────────────────────────────────
    case "get-status":
      sendResponse({
        connected: isConnected,
        status: aitherOSStatus,
        tier: DETECTED_TIER,
        relayConnected,
        relayNick,
        connectedApps: Array.from(connectedApps.entries()),
        agentContextCacheSize: agentContextCache.size,
      });
      break;

    // ── Deploy AitherOS ─────────────────────────────────────────────
    case "deploy-aitheros":
      checkHealth()
        .then(() => {
          if (aitherOSStatus === "online") {
            sendResponse({ success: true, message: "AitherOS is already running" });
          } else {
            sendResponse({
              success: false,
              message: "AitherOS not detected. Run: docker compose -f docker-compose.aitheros.yml up -d",
            });
          }
        })
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    // ── Content script registration ─────────────────────────────────
    case "content-script-ready":
      if (sender.tab) {
        connectedApps.set(sender.tab.id, {
          app: message.app,
          domain: message.domain,
          sessionValid: message.sessionValid,
        });
        broadcastToSidePanel({
          type: "app-connected",
          app: message.app,
          domain: message.domain,
        });
      }
      sendResponse({ ok: true });
      break;

    // ── Open dashboard ──────────────────────────────────────────────
    case "open-dashboard":
      // The DASHBOARD, not the Veil root. These two cases were byte-identical, so
      // the toolbar's "Veil" and "Dashboard" buttons opened the same page and one
      // of them was decoration. /dashboard is a real route (app/dashboard/page.tsx)
      // and is what the extension's own app list points "dashboard" at.
      chrome.tabs.create({ url: `${VEIL_URL.replace(/\/+$/, "")}/dashboard` });
      sendResponse({ ok: true });
      break;

    // ── Ecosystem launchers ─────────────────────────────────────────
    case "open-veil-local":
      chrome.tabs.create({ url: VEIL_URL });
      sendResponse({ ok: true });
      break;

    case "open-veil-cloud":
      chrome.tabs.create({ url: "https://demo.aitherium.com" });
      sendResponse({ ok: true });
      break;

    case "open-sidepanel":
      (async () => {
        try {
          if (chrome.sidePanel) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
              await chrome.sidePanel.open({ tabId: tab.id });
            }
          }
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "launch-desktop":
      // AitherDesktop is a native PyQt6 app — browsers can't launch local processes.
      // Route: Extension → Native Launcher (localhost:8299) → subprocess.Popen
      // The launcher runs on the HOST (not Docker) and can spawn the desktop app.
      // Genesis runs in Docker so it CANNOT launch native GUI processes.
      (async () => {
        const LAUNCHER_PORT = 8299;

        // Try native launcher FIRST (runs on host, can spawn processes)
        try {
          const launchBody = { mode: "overlay" };
          if (SETTINGS.tenantId || SETTINGS.workspaceId || SETTINGS.userId) {
            launchBody.tenant = {
              tenant_id: SETTINGS.tenantId || "",
              workspace_id: SETTINGS.workspaceId || "",
              user_id: SETTINGS.userId || "",
            };
          }
          const resp = await fetch(`http://127.0.0.1:${LAUNCHER_PORT}/launch`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(launchBody),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.ok) {
              sendResponse({ ok: true, message: data.message || "AitherDesktop launching via native launcher" });
              return;
            }
            // Launcher reached but launch failed
            sendResponse({ ok: false, message: data.message || "Launch failed" });
            return;
          }
        } catch { /* Launcher not running */ }

        // Fallback: Try Veil proxy (proxies to launcher via host.docker.internal)
        try {
          const resp = await fetch(`${VEIL_URL}/api/desktop/launch`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ action: "launch", mode: "overlay" }),
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.ok) {
              sendResponse({ ok: true, message: data.message || "AitherDesktop launching via Veil proxy" });
              return;
            }
          }
        } catch { /* Veil not available */ }

        // Fallback: Try Genesis directly (works if Genesis runs natively, not Docker)
        try {
          const resp = await fetch(`${GENESIS_URL}/api/desktop/launch`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(launchBody),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.ok) {
              sendResponse({ ok: true, message: data.message || "AitherDesktop launching via Genesis" });
              return;
            }
          }
        } catch { /* Genesis offline or in Docker */ }

        sendResponse({
          ok: false,
          message: "Cannot launch AitherDesktop — the native launcher must be running.\n" +
                   "Start launcher: python -m aither_desktop.launcher\n" +
                   "Manual launch: python -m aither_desktop",
        });
      })();
      return true;

    // ── Access requests (A2A permission cards) ──────────────────────
    // Federated agents that get refused raise a permission card and stay
    // blocked until a human decides. The card lives on the platform, and the
    // portal tray + `adk approvals` resolve the SAME ones — deciding here
    // clears them there.
    //
    // Auth is the operator's own portal SESSION (credentials: "include"), NOT
    // a key: the fleet internal key gates the gateway routes and must never
    // ship inside an extension. Veil attaches it server-side after checking
    // the session is admin.
    case "get-access-requests":
      (async () => {
        try {
          const res = await fetch(`${accessBase()}/api/notifications?limit=50`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok) {
            sendResponse({ ok: false, status: res.status, error: `HTTP ${res.status}` });
            return;
          }
          const data = await res.json();
          // Only cards — every other notification is an FYI, not a decision.
          const cards = (data.notifications || []).filter(
            (n) => n.access_request_id && n.status !== "action" && !n.dismissed
          );
          sendResponse({ ok: true, cards, authed: data.auth !== false });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
      })();
      return true;

    case "decide-access-request":
      (async () => {
        try {
          const res = await fetch(
            `${accessBase()}/api/notifications/${encodeURIComponent(msg.id)}/action`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: msg.decision }),
            }
          );
          const data = await res.json().catch(() => null);
          // Surface WHY on refusal. A 403 (not the owner) and a 409 (already
          // decided) are answers, not outages — reporting a generic failure
          // would send the operator chasing a broken service.
          if (!res.ok) {
            const detail = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
            sendResponse({
              ok: false,
              status: res.status,
              error: typeof detail === "string" ? detail : JSON.stringify(detail),
            });
            return;
          }
          sendResponse({ ok: true, result: data || {} });
          refreshAccessRequestBadge();
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
      })();
      return true;

    // ── Ecosystem status (detailed) ─────────────────────────────────
    case "get-ecosystem-status":
      (async () => {
        // In local mode these URLs go through the Veil bridge proxy,
        // so they'll reach the HTTPS backends without cert issues.
        const veilBase = SETTINGS.remoteUrl ? VEIL_URL : `http://${LOOPBACK}:${SETTINGS.veilPort}`;
        const services = [
          { name: "Veil",     url: `${veilBase}/api/health`, port: SETTINGS.veilPort },
          { name: "Genesis",  url: `${GENESIS_URL}/health`,  port: SETTINGS.genesisPort },
          { name: "Pulse",    url: `${PULSE_URL}/health`,    port: SETTINGS.pulsePort },
          { name: "Mind",     url: `${MIND_URL}/health`,     port: SETTINGS.mindPort },
          { name: "Strata",   url: `${STRATA_URL}/health`,   port: SETTINGS.strataPort },
        ];

        const results = await Promise.allSettled(
          services.map(async (svc) => {
            try {
              const resp = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
              return { ...svc, status: resp.ok ? "up" : "error" };
            } catch {
              return { ...svc, status: "down" };
            }
          })
        );

        const statuses = results.map(r => r.status === "fulfilled" ? r.value : { name: "unknown", status: "down", error: r.reason?.message });
        sendResponse({
          ok: true,
          services: statuses,
          wsConnected: isConnected,
          overallStatus: aitherOSStatus,
          relayConnected,
        });
      })();
      return true;

    // ── Full environment scan for Setup panel ──────────────────────
    case "get-environment":
      (async () => {
        const checks = [
          { id: "genesis",  name: "Genesis",              url: `${GENESIS_URL}/health` },
          { id: "node",     name: "awnode",           url: `${NODE_URL}/health` },
          { id: "veil",     name: "AitherVeil",           url: `${VEIL_URL}/api/health` },
          { id: "lyra",     name: "LyraWiki",             url: `${LYRAWIKI_URL}/health` },
          { id: "pulse",    name: "Pulse",                url: `${PULSE_URL}/health` },
          { id: "mind",     name: "Mind",                 url: `${MIND_URL}/health` },
          { id: "strata",   name: "Strata",               url: `${STRATA_URL}/health` },
          { id: "nexus",    name: "Nexus",                url: `${NEXUS_URL}/health` },
          { id: "search",   name: "AitherSearch",         url: `${SEARCH_URL}/health` },
          { id: "browser",  name: "AitherBrowser",        url: `${BROWSER_URL}/health` },
          { id: "bonsai",   name: "Bonsai-27B (local)",   url: `${NODE_URL || `http://${LOOPBACK}:` + (SETTINGS.nodePort || 8090)}/proxy/bonsai/health` },
          // No Ollama row: this platform deploys llama.cpp (the Bonsai lanes,
          // probed above via the node proxy) + vLLM/MicroScheduler — Ollama is
          // not part of the stack, and a permanent red "unreachable" row for
          // software we never ship read as a fleet outage (owner, 2026-08-09).
          // BYO Ollama users still get it probed IF they set a base URL in
          // options (kept optional: refused = "not installed", gray).
          ...(SETTINGS.ollamaUrl
            ? [{ id: "ollama", name: "Ollama (BYO)", url: `${String(SETTINGS.ollamaUrl).replace(/\/+$/, "")}/api/tags`, optional: true }]
            : []),
          // Ride the DETECTED bridge, not a hardcoded :3000 — on this fleet the
          // bridge is the LB on 3080 and the pinned port made vLLM read "down"
          // while MicroScheduler was serving normally.
          { id: "vllm",     name: "vLLM",                 url: VEIL_URL ? `${VEIL_URL}/api/bridge/microscheduler/health` : "" },
          { id: "portal",   name: "portal.aitherium.com", url: "https://portal.aitherium.com/api/health" },
        ];

        // Probe with BOUNDED CONCURRENCY, not all at once.
        //
        // Chrome allows ~6 concurrent connections PER HOST. Ten of these checks
        // target the same origin (the bridge on 127.0.0.1:3000), so firing all
        // fourteen at once put four-plus of them in the browser's connection
        // QUEUE — and AbortSignal.timeout() starts counting at fetch() call time,
        // not at connect time. A queued probe therefore burned its entire 15s
        // budget waiting for a socket and reported "no answer in 15s" for a
        // service that answers in 20ms.
        //
        // That is not hypothetical: measured 2026-07-29, Mind/LyraWiki/Nexus/
        // AitherSearch/Strata/vLLM all rendered "no answer in 15s" in the Setup
        // panel while curl got 200 from every one of them in <30ms. The tell was
        // that the only two checks which PASSED off-origin — Ollama (:11434) and
        // portal.aitherium.com — have their own connection pools. One genuinely
        // slow upstream (the nexus bridge route sat on a socket for 15.9s) is
        // enough to starve every probe behind it.
        //
        // With a pool, a waiting probe has not STARTED, so its clock has not
        // started either: each service is now measured, not the queue in front
        // of it. Cap of 4 leaves headroom on the 6-socket budget for the
        // sidepanel's own traffic.
        const PROBE_CONCURRENCY = 4;
        const results = await (async (items, limit, worker) => {
          const out = new Array(items.length);
          let next = 0;
          const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
            for (let i = next++; i < items.length; i = next++) {
              try {
                out[i] = { status: "fulfilled", value: await worker(items[i]) };
              } catch (reason) {
                out[i] = { status: "rejected", reason };
              }
            }
          });
          await Promise.all(runners);
          return out;
        })(checks, PROBE_CONCURRENCY, async (svc) => {
            // A blank URL means "this tier does not route that service" (cloud
            // tier, or genesis-direct with no bridge). Probing it would fetch a
            // RELATIVE "/health" against the extension origin and report a
            // confident "down" for a service nobody asked about.
            if (!svc.url || /^\/|^undefined|:null\b/.test(svc.url)) {
              return { ...svc, status: "n/a", detail: "not routed in this tier" };
            }
            // 4s was far too tight for this fleet. Measured live against a
            // fully healthy stack: nexus 5.7s, node 2.0s, mind/search/strata
            // ~1s — all behind the Veil bridge, several hops from the browser.
            // Every one of them reported "down" while answering 200, which is
            // how a working fleet came to render as a wall of red.
            const _t0 = Date.now();
            try {
              const resp = await fetch(svc.url, {
                signal: AbortSignal.timeout(SERVICE_PROBE_TIMEOUT_MS),
                headers: authHeaders(),
              });
              const ms = Date.now() - _t0;
              let detail = "";
              if (resp.ok) {
                try {
                  const d = await resp.json();
                  detail = d.version || d.status || d.model_count || "";
                } catch { /* not JSON */ }
              }
              // A 404 from the BRIDGE is the bridge saying "I have no route for
              // that name" — a wiring gap to fix in Veil, not a dead service.
              // Rendering it as an error made a missing probe route read as an
              // outage (2026-08-09).
              if (resp.status === 404 && svc.url.includes("/api/bridge/")) {
                return { ...svc, status: "n/a", detail: "no bridge probe route", ms };
              }
              // Surface slowness as slowness. A service answering in 5s is a
              // latency problem to chase, not a dead one to restart.
              const slow = resp.ok && ms >= SERVICE_SLOW_MS;
              return {
                ...svc,
                status: resp.ok ? (slow ? "slow" : "up") : "error",
                detail: String(detail || (resp.ok ? "" : `HTTP ${resp.status}`)),
                ms,
              };
            } catch (e) {
              const ms = Date.now() - _t0;
              // A timeout is NOT proof of death — it is proof we stopped
              // waiting. Say which one happened so the two are never conflated.
              const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
              // An OPTIONAL service refusing the connection is simply absent —
              // "not installed", gray, never a red row.
              if (!timedOut && svc.optional) {
                return { ...svc, status: "n/a", detail: "not installed", ms };
              }
              return {
                ...svc,
                status: timedOut ? "timeout" : "down",
                detail: timedOut ? `no answer in ${Math.round(ms / 1000)}s` : "unreachable",
                ms,
              };
            }
        });

        // Index the fallback — the old `checks[0]` mislabelled ANY rejected
        // probe as Genesis, so one thrown error could paint Genesis down.
        const services = results.map((r, i) =>
          r.status === "fulfilled" ? r.value : { ...checks[i], status: "down", detail: "" });
        let scopes = null;
        try {
          scopes = (await chrome.storage.local.get("aither-scopes"))["aither-scopes"] || null;
        } catch { /* no storage */ }
        sendResponse({
          ok: true,
          services,
          settings: {
            tenantId: SETTINGS.tenantId,
            workspaceId: SETTINGS.workspaceId,
            userId: SETTINGS.userId,
            projectName: SETTINGS.projectName,
            remoteUrl: SETTINGS.remoteUrl,
            autoHarvest: SETTINGS.autoHarvest,
            workspaceKnowledge: SETTINGS.workspaceKnowledge,
          },
          authed: !!(SETTINGS.userId || SETTINGS.cloudApiKey || SETTINGS.apiKey),
          scopes,
          wsConnected: isConnected,
          relayConnected,
        });
      })();
      return true;

    // ── Resolve identity from auth token (cookie or settings) ──
    case "resolve-identity":
      resolveIdentity().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
      return true;

    // ── Auto-apply resolved identity to settings ──
    case "apply-identity":
      applyIdentity(message.identity, message.token)
        .then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
      return true;

    // ── The tenant's REAL apps (deployed + installable) ──
    case "list-tenant-apps":
      listTenantApps().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
      return true;


    // ── Switch the active workspace/tenant scope ──
    // Follows the platform convention tenant_id = `tnt_{slug}` (ACTA
    // _tenant_id_from_auth). Updates the X-Tenant-ID/X-Workspace-ID headers
    // sent on every request, then re-pulls entitlement for the new scope.
    case "set-scope":
      (async () => {
        try {
          const slug = (message.slug || "").trim();
          if (!slug) { sendResponse({ ok: false, error: "no slug" }); return; }
          const tenantId = slug.startsWith("tnt_") ? slug : `tnt_${slug}`;
          await saveSettings({
            ...SETTINGS,
            tenantId,
            workspaceId: message.workspaceId || slug,
          });
          try {
            const scopes = (await chrome.storage.local.get("aither-scopes"))["aither-scopes"] || {};
            scopes.current = slug;
            await chrome.storage.local.set({ "aither-scopes": scopes });
          } catch { /* no storage */ }
          setTimeout(() => { connectToGenesis(); checkHealth(); }, 300);
          pullEntitlement().catch(() => {});
          broadcastToSidePanel({ type: "scope-changed", slug, tenantId });
          sendResponse({ ok: true, tenantId, slug });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Pull the authenticated user's entitlement/tier on demand ──
    case "pull-entitlement":
      (async () => {
        try {
          sendResponse(await pullEntitlement());
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Cloud Gateway device flow (RFC 8628) ────────────────────────
    // The gateway only accepts ITS OWN credentials (JWT / aither_sk_live_*).
    // Portal session tokens 401 — so cloud auth must come from this flow
    // (or a manually pasted key), never from the portal cookie.
    case "cloud-device-connect":
      (async () => {
        try {
          const gateway = SETTINGS.cloudGatewayUrl || "https://gateway.aitherium.com";
          const r = await fetch(`${gateway}/v1/auth/device/code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "Awconnect" }),
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) throw new Error(`device/code returned ${r.status}`);
          const dc = await r.json();
          const approveUrl = dc.verification_uri_complete || dc.verification_uri;
          if (approveUrl) chrome.tabs.create({ url: approveUrl });
          sendResponse({
            ok: true, device_code: dc.device_code, user_code: dc.user_code,
            interval: dc.interval || 5, expires_in: dc.expires_in || 900,
          });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "cloud-device-poll":
      (async () => {
        try {
          const gateway = SETTINGS.cloudGatewayUrl || "https://gateway.aitherium.com";
          const r = await fetch(`${gateway}/v1/auth/device/poll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: message.device_code }),
            signal: AbortSignal.timeout(10000),
          });
          const data = await r.json().catch(() => ({}));
          if (data.api_key) {
            // The flow returns a 24h JWT — exchange it for a durable
            // aither_sk_live_* key so the user isn't re-authing daily.
            let durable = "";
            try {
              const kr = await fetch(`${gateway}/v1/auth/api-key`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${data.api_key}` },
                body: JSON.stringify({ name: "Awconnect" }),
                signal: AbortSignal.timeout(10000),
              });
              if (kr.ok) durable = (await kr.json())?.api_key || "";
            } catch { /* fall back to the session JWT */ }
            await saveSettings({ ...SETTINGS, cloudApiKey: durable || data.api_key });
            await autoDetectTier();
            sendResponse({ ok: true, status: "complete", email: data.email || "",
                           tier: data.tier || "", durable: !!durable });
            return;
          }
          sendResponse({ ok: true, status: data.status || data.error || "authorization_pending" });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Connection Settings ─────────────────────────────────────────
    case "get-settings":
      (async () => {
        let licenseTier = "free";
        try { licenseTier = await AitherGating.getTier(); } catch { /* gating optional */ }
        sendResponse({
          ok: true,
          settings: { ...SETTINGS },
          tier: DETECTED_TIER,
          capabilities: TierDetect.capabilitiesFor(DETECTED_TIER),
          // Provider config with the key masked — UIs that need to EDIT the
          // key read chrome.storage.local "aither-provider" directly.
          provider: PROVIDER_CFG
            ? { ...PROVIDER_CFG, apiKey: PROVIDER_CFG.apiKey ? "********" : "" }
            : null,
          licenseTier,
        });
      })();
      return true;

    case "get-harness-token":
      // Sidepanel or other clients request the cached harness token.
      // Used by sidepanel.js to make authenticated daemon calls.
      (async () => {
        const token = await self.HarnessAuth.readHarnessToken();
        sendResponse({ token: token || null });
      })();
      return true;

    case "list-decisions":
      // Popup/sidepanel requests open decision cards from Genesis.
      (async () => {
        try {
          if (!self.GenesisAuth) {
            sendResponse({ ok: false, error: "GenesisAuth not available" });
            return;
          }
          const decisions = await self.GenesisAuth.listDecisions('open');
          if (!decisions) {
            sendResponse({ ok: false, error: "Failed to fetch decisions" });
            return;
          }
          sendResponse({ ok: true, decisions });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;

    case "answer-decision":
      // Popup/sidepanel submits an answer to a decision card.
      (async () => {
        try {
          if (!self.GenesisAuth) {
            sendResponse({ ok: false, error: "GenesisAuth not available" });
            return;
          }
          const result = await self.GenesisAuth.answerDecision(
            message.cardId,
            message.choice,
            message.note || "",
            message.via || "awconnect"
          );
          if (!result || result.status === 'error') {
            sendResponse({ ok: false, error: result?.error || "Failed to answer" });
            return;
          }
          sendResponse({ ok: true, result });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;

    // ── BYOK provider key validation (Options "Test Key" button) ────
    case "provider-test":
      (async () => {
        try {
          const cfg = message.provider || {};
          const def = AitherProviders.getProvider(cfg.id);
          if (!def) {
            sendResponse({ ok: false, error: `Unknown provider '${cfg.id}'` });
            return;
          }
          // On-device provider: "test" = WebGPU capability probe, no network.
          if (def.local) {
            const caps = await getWebMLCapabilities();
            if (caps.webgpu) {
              const extras = [caps.adapter, caps.f16 ? "f16" : null, caps.subgroups ? "subgroups" : null]
                .filter(Boolean).join(", ");
              sendResponse({ ok: true, success: true, result: `WebGPU available${extras ? ` (${extras})` : ""}`, detail: caps });
            } else {
              sendResponse({ ok: false, success: false, error: "WebGPU not available — requires Chrome 124+ and a supported GPU.", detail: caps });
            }
            return;
          }
          const req = AitherProviders.buildTestRequest(cfg.id, {
            apiKey: cfg.apiKey,
            model: cfg.model,
            baseUrlOverride: cfg.baseUrl,
          });
          if (req.error) {
            sendResponse({ ok: false, error: req.error });
            return;
          }
          const t0 = Date.now();
          const resp = await fetch(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(req.body),
            signal: AbortSignal.timeout(15000),
          });
          const ms = Date.now() - t0;
          if (resp.ok) {
            sendResponse({ ok: true, result: `Connected (${resp.status}, ${ms}ms)` });
          } else if (resp.status === 401 || resp.status === 403) {
            sendResponse({ ok: false, error: `Invalid API key (${resp.status})` });
          } else if (resp.status === 404 || resp.status === 400) {
            const body = await resp.text().catch(() => "");
            sendResponse({ ok: false, error: `Reachable, but model/request rejected (${resp.status}): ${body.slice(0, 160)}` });
          } else {
            sendResponse({ ok: false, error: `Provider returned ${resp.status}` });
          }
        } catch (e) {
          const hint = /failed to fetch/i.test(e.message)
            ? (message.provider?.id === "ollama"
              ? " — is Ollama running, and is OLLAMA_ORIGINS set? (see Options help)"
              : " — host permission missing or CORS blocked; grant the provider permission when prompted.")
            : "";
          sendResponse({ ok: false, error: `${e.message}${hint}` });
        }
      })();
      return true;

    // ── On-device WebGPU: capability probe (options UI) ─────────────
    case "webml-capability":
      (async () => {
        try {
          const caps = await getWebMLCapabilities();
          sendResponse({ ok: true, caps });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, caps: { webgpu: false } });
        }
      })();
      return true;

    // ── On-device WebGPU: model preload (options "Download now") ────
    case "webml-preload":
      (async () => {
        const modelId = message.modelId;
        const row = self.AitherWebMLModels?.getWebMLModel?.(modelId);
        if (!row) {
          sendResponse({ ok: false, error: `Unknown model '${modelId}'` });
          return;
        }
        if (row.ready !== true) {
          sendResponse({ ok: false, error: `${row.label} is summoning soon — runtime not yet landed` });
          return;
        }
        // Serialize against a concurrent chat/preload on the shared singleton
        // pipeline, and tag this flow so our listeners react only to its own
        // progress/ready/error — not another flow's (which would double-load or
        // reject this download on an unrelated error).
        const flowId = nextInferenceFlowId();
        const release = await acquireInference();
        let port;
        try {
          port = await getInferencePort();
        } catch (e) {
          release();
          sendResponse({ ok: false, error: e.message });
          return;
        }
        const relayProgress = (msg) => {
          if (msg.flowId !== undefined && msg.flowId !== flowId) return;
          if (msg.type === "progress") {
            chrome.runtime.sendMessage({
              type: "webml-progress", modelId,
              file: msg.file, progress: msg.progress, loaded: msg.loaded, total: msg.total,
            }).catch(() => { /* no listener (options closed) */ });
          }
        };
        port.onMessage.addListener(relayProgress);
        try {
          // NOTE: portRPC's 15s default is far too short for a ~900 MB
          // first download — wait up to 30 minutes, reject on error.
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              port.onMessage.removeListener(onMsg);
              reject(new Error("Model download timed out (30 min)"));
            }, 30 * 60 * 1000);
            function onMsg(msg) {
              if (msg.flowId !== undefined && msg.flowId !== flowId) return;
              if (msg.type === "ready" && msg.modelId === modelId) {
                clearTimeout(timer);
                port.onMessage.removeListener(onMsg);
                resolve();
              } else if (msg.type === "error") {
                clearTimeout(timer);
                port.onMessage.removeListener(onMsg);
                reject(new Error(msg.message));
              }
            }
            port.onMessage.addListener(onMsg);
            port.postMessage({ type: "load", modelId, flowId });
          });
          _lastLoadedWebMLModelId = modelId;
          await markWebMLDownloaded(modelId);
          chrome.runtime.sendMessage({ type: "webml-progress", modelId, done: true }).catch(() => {});
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        } finally {
          port.onMessage.removeListener(relayProgress);
          release();
        }
      })();
      return true;

    // ── Local knowledge base: search + stats (sidepanel/quick UIs) ──
    case "kb-search":
      (async () => {
        try {
          const results = await AitherKbDb.search(message.query || "", PROVIDER_CFG, message.topK || 5);
          sendResponse({ ok: true, results });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, results: [] });
        }
      })();
      return true;

    case "kb-stats":
      (async () => {
        try {
          const stats = await AitherKbDb.stats();
          const usage = await AitherKbDb.estimateUsage();
          let quota = { allowed: true, limit: null, remaining: null, tier: "free" };
          try { quota = await AitherGating.checkKbQuota(stats.docCount); } catch { /* gating optional */ }
          sendResponse({ ok: true, stats, usage, quota });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── FormBridge: capture batches from value-capture.js → local engine ──
    case "form-capture":
      (async () => {
        const batch = message.batch;
        if (!batch || !batch.patient_key || !Array.isArray(batch.fields)) {
          sendResponse({ ok: false, error: "malformed capture batch" });
          return;
        }
        try {
          await formbridgeForward(batch);
          // Engine reachable — opportunistically drain anything queued earlier.
          if (formbridgeQueue.length) await formbridgeDrainQueue();
          sendResponse({ ok: true });
        } catch {
          formbridgeQueue.push(batch);
          if (formbridgeQueue.length > FORMBRIDGE_QUEUE_MAX) {
            formbridgeQueue = formbridgeQueue.slice(-FORMBRIDGE_QUEUE_MAX);
          }
          try {
            await chrome.storage.local.set({ "aither-formbridge-queue": formbridgeQueue });
          } catch { /* best-effort */ }
          sendResponse({ ok: false, queued: true, pending: formbridgeQueue.length });
        }
      })();
      return true;

    case "form-capture-selfcheck":
      formbridgeSelectorsSeen = message.seen_selectors || [];
      sendResponse({ ok: true });
      return false;

    // API Capture: forward a captured API response to the local engine for extraction.
    case "form-capture-api":
      (async () => {
        const { url, body, rtf, source_origin } = message;
        try {
          await formbridgeEnginePost("/formbridge/capture-api", {
            url, body, rtf, source_origin,
          });
          sendResponse({ ok: true });
        } catch (e) {
          console.debug("[Awconnect] API capture forward failed:", e.message);
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // Discovery: forward a scraped field inventory (DOM + API) to the local engine.
    case "form-discover":
      (async () => {
        await formbridgeEnginePost("/formbridge/discover", {
          origin: message.origin, dom: message.dom || [], api: message.api || [],
        });
        sendResponse({ ok: true });
      })();
      return true;

    // Fetch the browser capture config from a live engine so the side panel can
    // set up auto-capture in one click (the "Enable capture" button).
    case "formbridge-capture-config":
      (async () => {
        const cfgPort = (FORMBRIDGE_CFG && FORMBRIDGE_CFG.port) || null;
        const candidates = [];
        for (const p of [cfgPort, 18182, 8182]) {
          if (p && !candidates.includes(p)) candidates.push(p);
        }
        for (const p of candidates) {
          try {
            const resp = await fetch(`http://127.0.0.1:${p}/formbridge/capture-config`, { signal: AbortSignal.timeout(1500) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && Array.isArray(data.packs) && data.packs.length) {
                sendResponse({ ok: true, port: p, packs: data.packs });
                return;
              }
            }
          } catch { /* try next candidate */ }
        }
        sendResponse({ ok: false, error: "no FormBridge engine/pack found" });
      })();
      return true;

    case "formbridge-status":
      (async () => {
        // Discover a live FormBridge engine: try the pack-configured port, then
        // common demo/default ports. This lets the FormBridge app appear in
        // Awconnect whenever an engine is running locally — no exact-seed
        // dance required. Only a real FormBridge engine (health has packs/pypdf)
        // counts, so the Docker gateway on 8182 is correctly ignored.
        const cfgPort = (FORMBRIDGE_CFG && FORMBRIDGE_CFG.port) || null;
        const candidates = [];
        for (const p of [cfgPort, 18182, 8182]) {
          if (p && !candidates.includes(p)) candidates.push(p);
        }
        let nodeUp = false, health = null, livePort = cfgPort || 8182;
        for (const p of candidates) {
          try {
            const resp = await fetch(`http://127.0.0.1:${p}/formbridge/health`, { signal: AbortSignal.timeout(1500) });
            if (resp.ok) {
              const h = await resp.json();
              if (h && (h.packs || h.pypdf !== undefined)) {  // a genuine FormBridge engine
                nodeUp = true; health = h; livePort = p; break;
              }
            }
          } catch { /* try next candidate */ }
        }
        sendResponse({
          ok: true,
          nodeUp,
          captureConfigured: !!(FORMBRIDGE_CFG && FORMBRIDGE_CFG.origin),
          origin: FORMBRIDGE_CFG ? FORMBRIDGE_CFG.origin : null,
          engineUrl: `http://127.0.0.1:${livePort}`,
          port: livePort,
          pendingQueue: formbridgeQueue.length,
          health,
        });
      })();
      return true;

    // ── Deep Research product discovery + license read ───────────────────
    // Mirrors formbridge-status: probe loopback for a locally-running Deep
    // Research node and read its GET /api/license so Awconnect can reflect
    // the gated-vs-active state BEFORE the user opens the app. Gated on the
    // response carrying sku === "deep-research" so an unrelated 8130 listener
    // is ignored (the formbridge packs/pypdf precedent).
    case "deep-research-status":
      (async () => {
        const cfgPort = SETTINGS.deepResearchPort || 8130;
        const candidates = [];
        for (const p of [cfgPort, 8130]) {
          if (p && !candidates.includes(p)) candidates.push(p);
        }
        let nodeUp = false, license = null, livePort = cfgPort;
        for (const p of candidates) {
          try {
            const resp = await fetch(`http://127.0.0.1:${p}/api/license`, { signal: AbortSignal.timeout(1500) });
            if (resp.ok) {
              const lic = await resp.json();
              if (lic && lic.sku === "deep-research") {  // a genuine Deep Research node
                nodeUp = true; license = lic; livePort = p; break;
              }
            }
          } catch { /* try next candidate */ }
        }
        sendResponse({
          ok: true,
          nodeUp,
          engineUrl: `http://127.0.0.1:${livePort}`,
          port: livePort,
          license,
        });
      })();
      return true;

    // ── MediaForge product (local node) detection ────────────────────────
    // Probe /health for service === "media-forge" so an unrelated 8200 listener
    // (e.g. a vLLM worker) is ignored — the deep-research sku precedent.
    case "mediaforge-status":
      (async () => {
        const cfgPort = SETTINGS.mediaforgePort || 8200;
        const candidates = [];
        for (const p of [cfgPort, 8200]) {
          if (p && !candidates.includes(p)) candidates.push(p);
        }
        let nodeUp = false, health = null, license = null, livePort = cfgPort;
        for (const p of candidates) {
          try {
            const resp = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
            if (resp.ok) {
              const h = await resp.json();
              if (h && h.service === "media-forge") {  // a genuine MediaForge node
                nodeUp = true; health = h; livePort = p;
                // also pull the entitlement state so the card can gate (like deep-research)
                try {
                  const lr = await fetch(`http://127.0.0.1:${p}/api/license`, { signal: AbortSignal.timeout(1500) });
                  if (lr.ok) { const lj = await lr.json(); if (lj && lj.sku === "media-forge") license = lj; }
                } catch { /* license endpoint optional */ }
                break;
              }
            }
          } catch { /* try next candidate */ }
        }
        sendResponse({
          ok: true,
          nodeUp,
          engineUrl: `http://127.0.0.1:${livePort}`,
          port: livePort,
          health,
          license,
        });
      })();
      return true;

    // ── Managed launch of the Deep Research product ──────────────────────
    // A browser extension cannot mutate a running process's environment, so
    // MANAGED mode (AITHER_DEEP_RESEARCH_LICENSED=1) is established at spawn by
    // the host-side native launcher — exactly like launch-desktop. We forward
    // ONLY the managed flag + portal url; the host already holds the user's
    // synced license (AITHER_LICENSE_KEY / ~/.aither/license.json) which
    // awdk's is_pack_available() reads. NEVER pass a license/signing key.
    case "launch-deep-research":
      (async () => {
        const LAUNCHER_PORT = 8299;
        const env = {
          AITHER_DEEP_RESEARCH_LICENSED: "1",
          AITHER_PORTAL_URL: SETTINGS.portalUrl || PORTAL_URL,
        };
        // Never let the browser claim the INTERNAL dogfood tenant ("aitherium" =>
        // unrestricted INTERNAL tier). The host already holds the user's real synced
        // license; entitlement comes from there, not from a browser-supplied slug.
        if (SETTINGS.tenantId && String(SETTINGS.tenantId).trim().toLowerCase() !== "aitherium") {
          env.AITHER_TENANT_SLUG = SETTINGS.tenantId;
        }
        const launchBody = { product: "deep-research", env };
        try {
          const resp = await fetch(`http://127.0.0.1:${LAUNCHER_PORT}/launch`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(launchBody),
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.ok) {
              sendResponse({ ok: true, message: data.message || "Deep Research launching (managed) via native launcher" });
              return;
            }
            sendResponse({ ok: false, message: data.message || "Launch failed" });
            return;
          }
        } catch { /* Launcher not running */ }
        sendResponse({
          ok: false,
          message: "Cannot launch Deep Research (managed) — the native launcher must be running on the host.",
        });
      })();
      return true;

    // ── Re-evaluate dynamic content-script registration (Options toggles) ──
    case "sync-content-scripts":
      (async () => {
        await loadSettings();
        await loadFormbridgeConfig();   // else syncRegister runs with a null cfg
        await syncRegisteredContentScripts();           // and UNREGISTERS capture
        sendResponse({ ok: true });
      })();
      return true;

    case "save-settings":
      (async () => {
        try {
          await saveSettings(message.settings || {});
          // Reconnect WebSockets with new URLs
          if (genesisSocket) { genesisSocket.close(); }
          if (relaySocket) { relaySocket.close(); }
          await autoDetectTier();
          setTimeout(() => { connectToGenesis(); checkHealth(); }, 500);
          sendResponse({ ok: true, settings: { ...SETTINGS } });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "reset-settings":
      (async () => {
        try {
          await saveSettings({ ...DEFAULT_SETTINGS });
          if (genesisSocket) { genesisSocket.close(); }
          await autoDetectTier();
          setTimeout(() => { connectToGenesis(); checkHealth(); }, 500);
          sendResponse({ ok: true, settings: { ...SETTINGS } });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Text action from content script floating menu ───────────
    case "text-action":
      (async () => {
        try {
          // Open side panel
          let tabId = sender.tab ? sender.tab.id : null;
          if (!tabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = tab?.id;
          }
          if (chrome.sidePanel && tabId) {
            await chrome.sidePanel.open({ tabId: tabId });
          }
          // Give the side panel a moment to open, then send the action
          setTimeout(() => {
            broadcastToSidePanel({
              type: "TEXT_ACTION",
              action: message.action,
              prompt: message.prompt,
              text: message.text,
              source: message.source || "",
              title: message.title || "",
            });
          }, 300);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Forge dispatch (agent task execution) ──────────────────
    case "forge-dispatch":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/forge/dispatch`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              task: message.task,
              parent_agent: "system",
              agent: message.agent || "demiurge",
              effort: message.effort || 5,
              context: {
                page_url: message.pageUrl || "",
                page_title: message.pageTitle || "",
                source: "aither-connect-extension",
              },
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => resp.statusText);
            sendResponse({ success: false, error: `Genesis returned ${resp.status}: ${errText.slice(0, 200)}` });
            chrome.notifications.create(`forge-error-${Date.now()}`, {
              type: "basic",
              iconUrl: "icons/icon128.png",
              title: "Forge Dispatch",
              message: `Error: Genesis ${resp.status}. Is the fleet running?`,
              priority: 2,
            });
            return;
          }
          const result = await resp.json();
          const sessionId = result.session_id || result.id;

          if (!sessionId) {
            sendResponse({ success: false, error: "No session_id in response" });
            return;
          }

          // Notify user with session ID
          chrome.notifications.create(`forge-dispatched-${Date.now()}`, {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: "Forge Dispatch",
            message: `Task sent to Demiurge (Session: ${sessionId.slice(0, 8)})`,
            priority: 1,
          });

          // Open the forge workspace in a new tab with the session parameter
          const forgeUrl = `${VEIL_URL}/workspace/forge?session=${encodeURIComponent(sessionId)}`;
          chrome.tabs.create({ url: forgeUrl });

          broadcastToSidePanel({ type: "forge-result", data: result });
          sendResponse({ success: true, data: result, session_id: sessionId });
        } catch (e) {
          const isOffline = e.name === "TypeError" && /failed to fetch/i.test(e.message);
          sendResponse({ success: false, error: e.message, offline: isOffline });
          chrome.notifications.create(`forge-error-${Date.now()}`, {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: "Forge Dispatch",
            message: isOffline ? "Fleet offline. Is AitherOS running?" : `Error: ${e.message.slice(0, 60)}`,
            priority: 2,
          });
        }
      })();
      return true;

    // ── Memory store (remember content) ──────────────────────
    case "memory-store":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/memory/remember`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ text: message.content, source: "browser-extension", tags: message.tags || [] }),
          });
          const result = await resp.json();
          // Also ingest to knowledge base for persistent storage
          knowledgeIngest({
            content: message.content,
            source: "browser-memory",
            tags: message.tags || [],
          }).catch(() => {});
          sendResponse({ success: resp.ok, data: result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    // ── Knowledge base ingest (full KB pipeline) ─────────────
    case "knowledge-ingest":
      (async () => {
        try {
          const result = await knowledgeIngest({
            content: message.content,
            source: message.source || "browser-extension",
            title: message.title || "",
            tags: message.tags || [],
            collection: message.collection || "browser",
            metadata: message.metadata || {},
          });
          sendResponse({ success: true, data: result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    // ── Memory recall (query memories) ───────────────────────
    case "memory-recall":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/memory/recall`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ query: message.query, limit: message.limit || 5 }),
          });
          const result = await resp.json();
          broadcastToSidePanel({ type: "memory-results", data: result });
          sendResponse({ success: resp.ok, data: result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    // ── STT via offscreen document (Port-based, no broadcast) ──
    case "stt-start":
      (async () => {
        try {
          const port = await getOffscreenPort();
          const result = await portRPC(port, "start-recording", "recording-started");
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "stt-stop":
      (async () => {
        try {
          const port = await getOffscreenPort();
          const rec = await portRPC(port, "stop-recording", "recording-stopped", {}, 35000);
          if (!rec?.ok) {
            sendResponse({ ok: false, error: rec?.error || "Recording failed" });
            return;
          }
          console.log("[Awconnect] Got audio from offscreen, b64 length:", (rec.audio_base64 || "").length);
          const result = await transcribeWithRetry(rec.audio_base64, "recording.webm");
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Mic recording via recorder tab (legacy fallback) ──
    case "start-recording":
      (async () => {
        try {
          await chrome.tabs.create({
            url: chrome.runtime.getURL("recorder/recorder.html"),
            active: true,
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // STT: transcribe base64 audio via bridge → AitherVoice Whisper (with retry)
    case "transcribe-audio":
      (async () => {
        const result = await transcribeWithRetry(message.audio_base64, message.filename || "recording.webm");
        sendResponse(result);
      })();
      return true;

    // Audio recorded in tab → relay to sidepanel for STT transcription
    case "recorder-result":
      (async () => {
        try {
          // Broadcast to sidepanel
          broadcastToSidePanel({
            type: "recorder-audio",
            audio_base64: message.audio_base64,
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "content-list-decks":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/content/decks`, { headers: authHeaders() });
          sendResponse(await resp.json());
        } catch (e) { sendResponse({ error: e.message }); }
      })();
      return true;

    case "content-get-deck":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/content/decks/${message.slug}`, { headers: authHeaders() });
          sendResponse(await resp.json());
        } catch (e) { sendResponse({ error: e.message }); }
      })();
      return true;

    case "content-save-deck":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/content/decks/${message.slug}`, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify(message.deck),
          });
          sendResponse(await resp.json());
        } catch (e) { sendResponse({ error: e.message }); }
      })();
      return true;

    case "content-transform":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/content/transform`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify(message.params),
          });
          sendResponse(await resp.json());
        } catch (e) { sendResponse({ error: e.message }); }
      })();
      return true;

    case "content-from-selection":
      (async () => {
        try {
          const resp = await fetch(`${GENESIS_URL}/content/decks/${message.slug}/blocks`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ slide_index: message.slideIndex || 0, element: message.element }),
          });
          sendResponse(await resp.json());
        } catch (e) { sendResponse({ error: e.message }); }
      })();
      return true;

    // ── FormBridge PREFILL: fill form from package (CTA portal or API) ───
    case "cta-prefill":
      (async () => {
        try {
          const pkg = message.package;
          if (!pkg || !pkg.url || !pkg.origin || !Array.isArray(pkg.fields)) {
            sendResponse({
              ok: false,
              error: "Invalid prefill package: missing url, origin, or fields",
            });
            return;
          }

          // Request permission for the target origin if not already granted.
          const permissionGranted = await chrome.permissions.contains({
            origins: [pkg.origin + "/*"],
          });
          let havePerm = permissionGranted;
          if (!havePerm) {
            try {
              havePerm = await chrome.permissions.request({
                origins: [pkg.origin + "/*"],
              });
            } catch (e) {
              console.debug(
                "[Awconnect] Permission request for",
                pkg.origin,
                "failed:",
                e.message
              );
            }
          }

          if (!havePerm) {
            sendResponse({
              ok: false,
              error:
                "User denied permission to prefill on " +
                pkg.origin +
                ". Form prefill requires site-specific host permission.",
            });
            return;
          }

          // Create a new tab with the form URL.
          const tab = await chrome.tabs.create({ url: pkg.url });
          if (!tab || !tab.id) {
            sendResponse({ ok: false, error: "Failed to create tab" });
            return;
          }

          // Wait for the tab to finish loading, then inject the prefill script.
          const tabId = tab.id;
          const loadListener = (changedTabId, changeInfo) => {
            if (changedTabId !== tabId || changeInfo.status !== "complete") return;
            chrome.tabs.onUpdated.removeListener(loadListener);

            // Set the package in a global before injecting the script.
            chrome.scripting
              .executeScript({
                target: { tabId },
                func: (prefillPkg) => {
                  window.__aitherPrefillPkg = prefillPkg;
                },
                args: [pkg],
              })
              .then(() => {
                // Now inject the formbridge-prefill.js content script.
                return chrome.scripting.executeScript({
                  target: { tabId },
                  files: ["content/formbridge-prefill.js"],
                });
              })
              .then(() => {
                console.debug("[Awconnect] FormBridge prefill injected in tab", tabId);
              })
              .catch((e) => {
                console.debug(
                  "[Awconnect] FormBridge prefill injection failed:",
                  e.message
                );
              });
          };

          chrome.tabs.onUpdated.addListener(loadListener);
          sendResponse({ ok: true, tabId, message: "Form opened, prefilling…" });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    default:
      console.debug("[Awconnect] Unknown message type:", message.type);
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }
});

// ── External messages (portal.aitherium.com) ──────────────────────────────
// Accept a small allowlist of request types from portal.aitherium.com and
// sibling subdomains (*.aitherium.com), ONLY after origin validation:
//   cta-prefill          — FormBridge form prefill handoff
//   marketplace-install  — portal listing "Install via Awconnect" button
//   aitherconnect-ping   — presence probe so portal pages can gate their UI
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Whitelist: only accept from aitherium.com and its subdomains. Validate the
  // ORIGIN, never the full URL: sender.url carries a path (…/cta/fill) so an
  // end-anchored full-URL match would reject every real portal message. The
  // suffix pattern requires the host to BE aitherium.com or end with
  // ".aitherium.com" — so a look-alike sibling like "evil-aitherium.com"
  // (no dot before "aitherium") is rejected. (The manifest's externally_connectable
  // already restricts callers to *.aitherium.com; this is defense-in-depth.)
  let senderOrigin = sender.origin || "";
  if (!senderOrigin && sender.url) {
    try {
      senderOrigin = new URL(sender.url).origin;
    } catch {
      senderOrigin = "";
    }
  }
  const allowedOrigin = /^https:\/\/([a-z0-9-]+\.)*aitherium\.com$/i;
  if (!senderOrigin || !allowedOrigin.test(senderOrigin)) {
    console.warn(
      "[Awconnect] Rejected external message from untrusted origin:",
      senderOrigin || sender.url
    );
    sendResponse({ ok: false, error: "Untrusted origin" });
    return false;
  }

  if (message.type === "cta-prefill") {
    (async () => {
      try {
        const pkg = message.package;
        if (!pkg || !pkg.url || !pkg.origin || !Array.isArray(pkg.fields)) {
          sendResponse({
            ok: false,
            error: "Invalid prefill package: missing url, origin, or fields",
          });
          return;
        }

        // Request permission for the target origin if not already granted.
        const permissionGranted = await chrome.permissions.contains({
          origins: [pkg.origin + "/*"],
        });
        let havePerm = permissionGranted;
        if (!havePerm) {
          try {
            havePerm = await chrome.permissions.request({
              origins: [pkg.origin + "/*"],
            });
          } catch (e) {
            console.debug(
              "[Awconnect] Permission request for",
              pkg.origin,
              "failed:",
              e.message
            );
          }
        }

        if (!havePerm) {
          sendResponse({
            ok: false,
            error:
              "User denied permission to prefill on " +
              pkg.origin +
              ". Form prefill requires site-specific host permission.",
          });
          return;
        }

        // Create a new tab with the form URL.
        const tab = await chrome.tabs.create({ url: pkg.url });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "Failed to create tab" });
          return;
        }

        // Wait for the tab to finish loading, then inject the prefill script.
        const tabId = tab.id;
        const loadListener = (changedTabId, changeInfo) => {
          if (changedTabId !== tabId || changeInfo.status !== "complete") return;
          chrome.tabs.onUpdated.removeListener(loadListener);

          // Set the package in a global before injecting the script.
          chrome.scripting
            .executeScript({
              target: { tabId },
              func: (prefillPkg) => {
                window.__aitherPrefillPkg = prefillPkg;
              },
              args: [pkg],
            })
            .then(() => {
              // Now inject the formbridge-prefill.js content script.
              return chrome.scripting.executeScript({
                target: { tabId },
                files: ["content/formbridge-prefill.js"],
              });
            })
            .then(() => {
              console.debug("[Awconnect] FormBridge prefill injected in tab", tabId);
            })
            .catch((e) => {
              console.debug(
                "[Awconnect] FormBridge prefill injection failed:",
                e.message
              );
            });
        };

        chrome.tabs.onUpdated.addListener(loadListener);
        sendResponse({ ok: true, tabId, message: "Form opened, prefilling…" });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // Marketplace install handoff from the portal: a listing page's
  // "Install via Awconnect" button sends the same shape the sidepanel
  // uses and rides the identical resolution ladder (node → apply-pack →
  // copyable command). Origin is already validated above; the ladder itself
  // is fail-closed (a pack the caller doesn't own → license-required, never
  // a silent install).
  if (message.type === "marketplace-install") {
    (async () => {
      try {
        sendResponse(await marketplaceInstall(
          String(message.itemId || ""), message.install || {},
        ));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // Ping from portal pages: lets a listing page render "Install via
  // Awconnect" only when the extension is actually present.
  if (message.type === "aitherconnect-ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, tier: DETECTED_TIER });
    return false;
  }

  // Reject any other external message types.
  sendResponse({ ok: false, error: `External message type not allowed: ${message.type}` });
  return false;
});

// ── Offscreen Port management ──
// The single offscreen document hosts BOTH audio capture (offscreen.js,
// port "offscreen-audio") and on-device WebGPU inference
// (offscreen-inference.js, port "offscreen-inference"). Never tear the doc
// down just to refresh one port — that would kill a running inference.
let _offscreenPort = null;      // audio port singleton
let _inferencePort = null;      // inference port singleton
let _lastLoadedWebMLModelId = null; // background-side idempotent-load tracking

// Serialize inference-port flows. worker-core hosts a SINGLE pipeline
// singleton, so a preload and a chat (or two chats) must never drive the port
// concurrently — they would double-load, double-generate, or interleave tokens
// on the shared "offscreen-inference" port. Each flow awaits this lock before
// touching the port and releases it when it finishes.
let _inferenceLock = Promise.resolve();
function acquireInference() {
  let release;
  const next = new Promise((res) => { release = res; });
  const prior = _inferenceLock;
  _inferenceLock = prior.then(() => next);
  return prior.then(() => release);
}
// Monotonic flow tag. The offscreen host stamps every worker-core emission
// with the id of the flow it is servicing, so each flow's port listeners react
// only to their own load/ready/error/token/done — a defense against a late or
// stray message from an abandoned or timed-out prior flow.
let _inferenceFlowSeq = 0;
function nextInferenceFlowId() {
  return `flow-${Date.now()}-${++_inferenceFlowSeq}`;
}

// Persistent connect listener: capture both port singletons whenever the
// offscreen document (re)connects, regardless of which caller triggered it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "offscreen-audio") {
    _offscreenPort = port;
    port.onDisconnect.addListener(() => {
      if (_offscreenPort === port) _offscreenPort = null;
    });
  } else if (port.name === "offscreen-inference") {
    _inferencePort = port;
    port.onDisconnect.addListener(() => {
      if (_inferencePort === port) _inferencePort = null;
    });
  }
});

/** Await the next connect of a named offscreen port (5s default). */
function waitForOffscreenPort(name, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onConnect.removeListener(onConnect);
      reject(new Error(`Offscreen document did not connect (${name})`));
    }, timeoutMs);
    function onConnect(port) {
      if (port.name === name) {
        clearTimeout(timeout);
        chrome.runtime.onConnect.removeListener(onConnect);
        resolve(port);
      }
    }
    chrome.runtime.onConnect.addListener(onConnect);
  });
}

/**
 * Get a live port to the offscreen doc by name. If a doc already exists,
 * poke it to reconnect (its ports die when this service worker restarts);
 * only closeDocument() + recreate when the reconnect times out (stale doc).
 */
async function getNamedOffscreenPort(name, reconnectType, getSingleton) {
  const existing = getSingleton();
  if (existing) return existing;

  const hadDoc = (await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  })).length > 0;

  let portPromise = waitForOffscreenPort(name);
  if (hadDoc) {
    // Doc alive but port dead (SW restarted) — ask it to reconnect
    chrome.runtime.sendMessage({ type: reconnectType }).catch(() => {});
  } else {
    await ensureOffscreenDocument();
  }

  try {
    return await portPromise;
  } catch (e) {
    if (!hadDoc) throw e;
    // Existing doc is unresponsive — recreate it (last resort: this also
    // drops any warm inference pipeline, but the doc is dead anyway).
    console.warn(`[Awconnect] Offscreen doc unresponsive (${name}) — recreating`);
    try { await chrome.offscreen.closeDocument(); } catch {}
    _lastLoadedWebMLModelId = null;
    portPromise = waitForOffscreenPort(name);
    await ensureOffscreenDocument();
    return portPromise;
  }
}

async function getOffscreenPort() {
  return getNamedOffscreenPort("offscreen-audio", "offscreen-audio-reconnect", () => _offscreenPort);
}

async function getInferencePort() {
  return getNamedOffscreenPort("offscreen-inference", "webml-reconnect", () => _inferencePort);
}

// Send a command over the port, wait for a specific response type
function portRPC(port, command, responseType, extra = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      port.onMessage.removeListener(listener);
      reject(new Error(`Offscreen ${command} timed out`));
    }, timeoutMs);

    function listener(msg) {
      if (msg.type === responseType) {
        clearTimeout(timer);
        port.onMessage.removeListener(listener);
        resolve(msg);
      }
    }
    port.onMessage.addListener(listener);
    port.postMessage({ type: command, ...extra });
  });
}

// ── STT transcription with retry ──
async function transcribeWithRetry(audio_base64, filename = "recording.webm") {
  // Use the bridge proxy (same as chat) — it handles CORS preflight correctly.
  // Direct /api/voice/transcribe fails CORS from extension service workers.
  const url = SETTINGS.remoteUrl
    ? `${SETTINGS.remoteUrl.replace(/\/+$/, "")}/services/voice/transcribe/base64`
    : `http://${LOOPBACK}:${SETTINGS.veilPort || 3000}/api/bridge/voice/transcribe/base64`;
  console.log("[Awconnect] STT →", url, "audio length:", (audio_base64 || "").length);

  let lastErr = "Unknown error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ audio_base64, filename }),
        signal: AbortSignal.timeout(30000),
      });
      const raw = await res.text();
      console.log("[Awconnect] STT attempt", attempt + 1, "response:", res.status, raw.slice(0, 300));
      let data;
      try { data = JSON.parse(raw); } catch { data = { success: false, error: raw.slice(0, 200) }; }
      if (res.ok && data.success) {
        return { ok: true, text: data.text || "" };
      }
      lastErr = data.error || `HTTP ${res.status}`;
    } catch (e) {
      console.warn("[Awconnect] STT attempt", attempt + 1, "error:", e.message);
      lastErr = e.message;
    }
  }
  return { ok: false, error: lastErr };
}

// ── Offscreen document management ──
// Single creation path for the shared audio + inference document. Chrome
// allows only one offscreen doc, so the reasons are the union of both uses.
let _creatingOffscreen = null;
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");
  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  if (existingContexts.length > 0) return;
  // Avoid race condition with multiple callers
  if (_creatingOffscreen) { await _creatingOffscreen; return; }
  _creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ["USER_MEDIA", "WORKERS"],
    justification: "Speech recognition and on-device AI inference",
  });
  await _creatingOffscreen;
  _creatingOffscreen = null;
}

// =============================================================================
// ON-DEVICE WEBGPU INFERENCE (aither-local provider)
// =============================================================================
// Dispatches chat to the offscreen inference host (offscreen-inference.js)
// over the "offscreen-inference" port, speaking portal-kit's WebML wire
// protocol (shared/webml-mirror/protocol.js), and re-emits the exact same
// chat-event broadcasts the HTTP provider path produces — the sidepanel
// needs zero changes.

const WEBML_WATCHDOG_MS = 10 * 60 * 1000; // first download of ~900 MB is slow

/** Mark a WebML model as downloaded in chrome.storage.local. */
async function markWebMLDownloaded(modelId) {
  try {
    const { "webml-downloaded": flags } = await chrome.storage.local.get("webml-downloaded");
    await chrome.storage.local.set({
      "webml-downloaded": { ...(flags || {}), [modelId]: true },
    });
  } catch (e) {
    console.debug("[Awconnect] Could not persist webml-downloaded flag:", e.message);
  }
}

/** WebGPU capability probe via the offscreen host, cached in session storage. */
async function getWebMLCapabilities() {
  // A positive probe is stable for the browser session. A NEGATIVE result can
  // be a one-off failure (GPU process hiccup, adapter contention, offscreen
  // still warming up) — only trust it for a short TTL so a transient failure
  // self-heals without a browser restart (and "Test provider" re-probes too).
  const NEG_TTL_MS = 60 * 1000;
  try {
    const { "webml-caps": cached } = await chrome.storage.session.get("webml-caps");
    if (cached && (cached.webgpu || (cached.ts && Date.now() - cached.ts < NEG_TTL_MS))) {
      return cached;
    }
  } catch { /* session storage unavailable — probe fresh */ }

  const port = await getInferencePort();
  const result = await portRPC(port, "capability", "capability-result");
  const caps = {
    webgpu: !!result.webgpu,
    f16: !!result.f16,
    subgroups: !!result.subgroups,
    adapter: result.adapter || null,
    ts: Date.now(),
  };
  try { await chrome.storage.session.set({ "webml-caps": caps }); } catch { /* best effort */ }
  return caps;
}

/**
 * Handle a chat turn on the on-device provider. Mirrors the BYOK HTTP path:
 * RAG grounding → pipeline events during load → chunk per token → complete
 * with model label + citations. No BYOK error mapping / CORS hints — there
 * is no network in this path.
 */
async function handleLocalChat(message, providerDef, sendResponse) {
  const modelId = PROVIDER_CFG.model
    || providerDef.models?.find((m) => m.ready)?.id
    || (self.AitherWebMLModels ? AitherWebMLModels.DEFAULT_WEBML_MODEL_ID : null);
  const registryRow = self.AitherWebMLModels?.getWebMLModel?.(modelId);
  const modelLabel = `${providerDef.name || "On-Device"}: ${registryRow?.label || modelId}`;

  // RAG: ground the reply in the local knowledge base (same logic as the
  // HTTP provider branch — token-capped context + citations)
  const citations = [];
  const messages = [];
  if (SETTINGS.ragEnabled !== false) {
    try {
      const hits = await AitherKbDb.search(message.text, PROVIDER_CFG, 5);
      if (hits && hits.length) {
        const MAX_CTX_CHARS = 4000; // ~1000 tokens
        let used = 0;
        const parts = [];
        for (const h of hits) {
          const text = (h.chunk?.text || "").slice(0, MAX_CTX_CHARS - used);
          if (!text) break;
          used += text.length;
          parts.push(`[${parts.length + 1}] ${h.doc?.title || "Untitled"} (${h.doc?.url || h.doc?.source || "local"}):\n${text}`);
          citations.push({
            docId: h.doc?.id, title: h.doc?.title || "Untitled",
            url: h.doc?.url || "", score: h.score,
          });
          if (used >= MAX_CTX_CHARS) break;
        }
        if (parts.length) {
          messages.push({
            role: "system",
            content: "Context from the user's local knowledge base (cite by [n] when used):\n\n" + parts.join("\n\n"),
          });
          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
            stage: "rag", message: `Grounding with ${parts.length} knowledge-base passage(s)`,
          }});
        }
      }
    } catch (e) {
      console.debug("[Awconnect] KB retrieval skipped:", e.message);
    }
  }
  messages.push({ role: "user", content: message.text });

  // Serialize against a concurrent preload/chat on the shared singleton
  // pipeline (released in finish()), and tag this flow so our port listeners
  // ignore stray messages from any other flow sharing the same port.
  const flowId = nextInferenceFlowId();
  const release = await acquireInference();

  let port;
  try {
    port = await getInferencePort();
  } catch (e) {
    release();
    const msg = `On-device runtime unavailable: ${e.message}`;
    broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: msg } });
    sendResponse({ success: false, error: msg });
    return;
  }

  broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
    stage: "stream", message: `Running ${modelLabel} on your GPU...`,
  }});

  const generateReq = {
    type: "generate",
    messages,
    maxTokens: 2048,
    temperature: message.temperature ?? 0,
    flowId,
  };

  let fullContent = "";
  let finished = false;
  let watchdog = null;
  let sentLoadRecovery = false;

  const finish = () => {
    finished = true;
    clearTimeout(watchdog);
    port.onMessage.removeListener(onMsg);
    port.onDisconnect.removeListener(onGone);
    release();
  };
  // No-event watchdog instead of AbortSignal.timeout(120000) — a first
  // ~900 MB weight download legitimately takes many minutes.
  const bumpWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (finished) return;
      broadcastToSidePanel({ type: "chat-event", event: "error", data: {
        error: `${modelLabel} stalled (no progress for 10 minutes) — try again.`,
      }});
      finish();
      try { port.disconnect(); } catch { /* already gone */ }
      // Chrome does NOT fire onDisconnect for a locally-initiated disconnect,
      // so drop the singleton ourselves — otherwise the next chat posts to this
      // dead port and throws "Attempting to use a disconnected port".
      if (_inferencePort === port) _inferencePort = null;
    }, WEBML_WATCHDOG_MS);
  };

  const onMsg = (msg) => {
    if (finished || !msg?.type) return;
    // Only react to messages the offscreen host stamped for THIS flow — a
    // concurrent preload/chat shares the same "offscreen-inference" port.
    if (msg.flowId !== undefined && msg.flowId !== flowId) return;
    bumpWatchdog();
    switch (msg.type) {
      case "progress": {
        const pct = typeof msg.progress === "number" ? ` ${Math.round(msg.progress)}%` : "";
        broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
          stage: "webml-load", message: `Fetching ${msg.file || "model"}${pct}`,
        }});
        break;
      }
      case "ready": {
        _lastLoadedWebMLModelId = msg.modelId;
        markWebMLDownloaded(msg.modelId);
        broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
          stage: "webml-load", message: "Model ready — generating on WebGPU",
        }});
        port.postMessage(generateReq);
        break;
      }
      case "token": {
        fullContent += msg.text;
        broadcastToSidePanel({ type: "chat-event", event: "chunk", data: { content: msg.text } });
        break;
      }
      case "done": {
        broadcastToSidePanel({ type: "chat-event", event: "complete", data: {
          type: "complete", content: msg.text || fullContent,
          model: modelLabel,
          artifacts: [],
          ...(citations.length ? { citations } : {}),
          ...(msg.tokensPerSecond ? { tokens_per_second: Math.round(msg.tokensPerSecond * 10) / 10 } : {}),
        }});
        finish();
        break;
      }
      case "error": {
        // Recover from a stale skip-load: the doc was recreated since our
        // tracking said the model was warm, so load it now.
        if (/no model loaded/i.test(msg.message || "") && !sentLoadRecovery) {
          sentLoadRecovery = true;
          _lastLoadedWebMLModelId = null;
          port.postMessage({ type: "load", modelId, flowId });
          break;
        }
        broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: msg.message } });
        finish();
        break;
      }
    }
  };
  const onGone = () => {
    if (finished) return;
    broadcastToSidePanel({ type: "chat-event", event: "error", data: {
      error: "On-device inference host disconnected mid-stream — send your message again.",
    }});
    finish();
  };

  port.onMessage.addListener(onMsg);
  port.onDisconnect.addListener(onGone);
  bumpWatchdog();

  // Load is idempotent in worker-core; skip only when this background's own
  // tracking says the model is already warm in the current doc. Wrap the
  // dispatch: if the singleton slipped through pointing at a dead port (Chrome
  // doesn't notify us of a locally-initiated disconnect), postMessage throws
  // synchronously — catch it, drop the stale singleton so the next turn
  // re-creates a fresh port, and surface a proper error + sendResponse instead
  // of an unhandled rejection with a silently dead chat.
  try {
    if (_lastLoadedWebMLModelId === modelId) {
      port.postMessage(generateReq);
    } else {
      broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: {
        stage: "webml-load", message: `Loading ${registryRow?.label || modelId} (first run downloads ~${registryRow?.approxDownloadMB || "?"} MB)...`,
      }});
      port.postMessage({ type: "load", modelId, flowId });
    }
    // Same handshake as the HTTP streaming path
    sendResponse({ success: true, streaming: true });
  } catch (e) {
    if (_inferencePort === port) _inferencePort = null;
    finish();
    const emsg = "On-device runtime dropped the connection — send your message again.";
    broadcastToSidePanel({ type: "chat-event", event: "error", data: { error: emsg } });
    sendResponse({ success: false, error: emsg });
  }
}

// =============================================================================
// NOTIFICATION CLICK
// =============================================================================

chrome.notifications.onClicked.addListener((id) => {
  // A notification that named its own destination (e.g. the X daily-summary
  // toast → the side panel's social stats) opens THAT. Everything else keeps
  // the old behaviour: the PUBLIC portal, not the local Veil host. VEIL_URL is
  // a localhost address in local mode; landing a user there breaks passwordless
  // login (the auth cookie is issued for the public *.aitherium.com origin, so
  // a localhost tab can never see it and just bounces back to /login).
  const dest = (id && _notificationTargets.get(id)) || null;
  if (dest) _notificationTargets.delete(id);
  const portal = (SETTINGS && SETTINGS.portalUrl) || PORTAL_URL;
  chrome.tabs.create({ url: dest || portal });
});

// =============================================================================
// FEDERATED SEARCH
// =============================================================================

async function performFederatedSearch(query, options = {}) {
  const results = [];
  const errors = [];
  const mode = options.mode || "quick"; // quick | deep
  const t0 = Date.now();
  const phaseMetrics = [];

  // Stream each phase's results to any open sidepanel AS they land (fast lane,
  // web, knowledge base) with provider + latency metrics; the final return
  // still answers the original message with the authoritative full set.
  // Fail-soft: sendMessage with no listener rejects into the swallow.
  const emitStream = (phase, phaseResults, metrics = {}) => {
    const m = { ...metrics, wall_ms: Date.now() - t0, count: phaseResults.length };
    phaseMetrics.push({ phase, ...m });
    chrome.runtime.sendMessage({
      type: "search-stream",
      query,
      phase,
      results: phaseResults,
      metrics: m,
    }).catch(() => {});
  };

  // One transient bridge failure must not become "Search service unavailable":
  // DNS bursts on the fleet last ~seconds (the .54 resolver drops ~2% of
  // queries with 2s stalls, measured 2026-07-28), so network-shaped failures
  // and 5xx get two spaced retries. Timeouts do NOT retry — they already spent
  // the full budget.
  const fetchSearchWithRetry = async (url, opts) => {
    const delays = [250, 1000];
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await fetch(url, opts);
        if (resp.status >= 500 && attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return resp;
      } catch (e) {
        const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
        if (isTimeout || attempt >= delays.length) throw e;
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  };

  // Fast first paint: race a deadline-bounded /search/fast alongside the full
  // search. A tier whose proxy lacks /search/fast just 404s into the swallow.
  if (mode === "quick") {
    (async () => {
      try {
        const fastHeaders = { "Content-Type": "application/json" };
        if (DETECTED_TIER === "cloud-only" && SETTINGS.cloudApiKey) {
          fastHeaders["Authorization"] = `Bearer ${SETTINGS.cloudApiKey}`;
          fastHeaders["X-API-Key"] = SETTINGS.cloudApiKey;
        }
        const resp = await fetch(`${SEARCH_URL}/search/fast`, {
          method: "POST",
          headers: fastHeaders,
          body: JSON.stringify({ query, deadline_ms: 1200, min_results: 3 }),
          signal: AbortSignal.timeout(2500),
        });
        if (!resp.ok) return;
        const fast = await resp.json();
        if (!fast?.results?.length) return;
        emitStream(
          "fast",
          fast.results.map((r) => ({
            title: r.title || "Web Result",
            snippet: r.snippet || r.content || "",
            url: r.url || "",
            icon: "⚡",
            metadata: {
              source: "aithersearch-fast",
              provider: fast.provider,
              server_ms: fast.search_time_ms,
            },
          })),
          { provider: fast.provider, server_ms: fast.search_time_ms, cached: !!fast.cached },
        );
      } catch { /* fail-soft: fast lane is best-effort */ }
    })();
  }

  // 1. PRIMARY — AitherSearch web search (port 8114)
  try {
    const fetchUrl = `${SEARCH_URL}/search`;
    console.log(`[Awconnect] Search request: POST ${fetchUrl} query="${query}" mode=${mode}`);
    // On the cloud tier the gateway's /search route is aither_sk-gated (it
    // proxies to genesis→AitherSearch), so send the cloud key; local/node tiers
    // reach search through the trusted bridge/proxy and need no bearer.
    const searchHeaders = { "Content-Type": "application/json" };
    if (DETECTED_TIER === "cloud-only" && SETTINGS.cloudApiKey) {
      searchHeaders["Authorization"] = `Bearer ${SETTINGS.cloudApiKey}`;
      searchHeaders["X-API-Key"] = SETTINGS.cloudApiKey;
    }
    const rawResp = await fetchSearchWithRetry(fetchUrl, {
      method: "POST",
      headers: searchHeaders,
      body: JSON.stringify({
        query,
        mode,
        limit: options.limit || 10,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!rawResp.ok) {
      const errText = await rawResp.text().catch(() => rawResp.statusText);
      errors.push(`Search service error: HTTP ${rawResp.status}`);
      console.warn(`[Awconnect] AitherSearch HTTP ${rawResp.status}: ${errText.slice(0, 200)}`);
    } else {
      let searchResp;
      try {
        searchResp = await rawResp.json();
      } catch (jsonErr) {
        errors.push("Search returned invalid response");
        console.warn("[Awconnect] AitherSearch returned non-JSON response");
        searchResp = {};
      }

      // Surface the AI-generated answer as the first result if present
      if (searchResp.answer) {
        results.push({
          title: `AI Answer — ${query}`,
          snippet: searchResp.answer,
          url: "",
          icon: "✨",
          metadata: {
            source: "aithersearch-answer",
            provider: searchResp.provider,
            mode: searchResp.mode,
            search_time_ms: searchResp.search_time_ms,
          },
        });
      }

      if (searchResp.results) {
        for (const r of searchResp.results) {
          results.push({
            title: r.title || "Web Result",
            snippet: r.snippet || r.content || "",
            url: r.url || "",
            icon: searchResp.provider === "semantic_cache" ? "🧠" : "🔍",
            metadata: {
              source: "aithersearch-web",
              provider: searchResp.provider,
              server_ms: searchResp.search_time_ms,
              cached: !!searchResp.cached,
              ...r.metadata,
            },
          });
        }
      }

      emitStream("web", results.slice(0), {
        provider: searchResp.provider,
        server_ms: searchResp.search_time_ms,
        cached: !!searchResp.cached,
      });

      console.log(
        `[Awconnect] AitherSearch returned ${searchResp.results?.length || 0} results ` +
        `(provider: ${searchResp.provider}, ${searchResp.search_time_ms}ms)`
      );
    }
  } catch (e) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    errors.push(isTimeout ? "Search timed out" : "Search service unavailable");
    console.warn("[Awconnect] AitherSearch unavailable, falling back:", e.message);
  }

  // 2. SECONDARY — Nexus knowledge base (internal docs / ingested content)
  if (results.length < 5) {
    try {
      const tNexus = Date.now();
      const nexusResp = await fetch(`${NEXUS_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: 10 }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      }).then((r) => r.json());

      if (nexusResp.results) {
        const beforeNexus = results.length;
        for (const r of nexusResp.results) {
          results.push({
            title: r.title || r.metadata?.title || "AitherOS Knowledge",
            snippet: r.text || r.content || "",
            url: r.url || r.metadata?.url || "",
            icon: "⚡",
            metadata: { source: "aitheros-nexus", ...r.metadata },
          });
        }
        emitStream("knowledge", results.slice(beforeNexus), {
          provider: "aitheros-nexus",
          server_ms: Date.now() - tNexus,
        });
      }
    } catch (e) {
      console.debug("[Awconnect] Nexus search error:", e.message);
    }
  }

  return {
    results,
    query,
    count: results.length,
    errors,
    metrics: { wall_ms: Date.now() - t0, phases: phaseMetrics },
  };
}

// =============================================================================
// INGESTION
// =============================================================================

async function ingestToAitherOS(payload) {
  try {
    await fetch(`${STRATA_URL}/api/v1/ingest/browser`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
    });
  } catch {
    try {
      await fetch(`${PULSE_URL}/api/ingest/browser`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
      });
    } catch {
      console.log("[Awconnect] AitherOS ingestion offline");
    }
  }
}

/**
 * Full knowledge base ingestion pipeline.
 * Stores content across Genesis memory, Nexus RAG, and Strata for
 * tenant/workspace/project-scoped knowledge persistence.
 */
/**
 * Knowledge ingest — LOCAL-FIRST.
 *
 * The local IndexedDB KB is the primary store (works standalone, BYOK or
 * offline). When a fleet is detected, the legacy 5-backend fan-out runs as a
 * fire-and-forget mirror — local success never waits on fleet availability.
 */
async function knowledgeIngest({ content, source, title, tags, collection, metadata }) {
  if (!content || !String(content).trim()) {
    throw new Error("Nothing to save — empty content");
  }
  const text = String(content);
  const tagList = tags || [];

  // Auto-harvest is a Pro feature (and default-off): gate at the ingest
  // chokepoint so every capture path is covered.
  if (tagList.includes("auto-harvest")) {
    const gate = await AitherGating.checkGate("auto_harvest");
    if (!gate.allowed) {
      throw new Error("Auto-harvest requires Pro — manual saves (selection, page, upload) are free.");
    }
  }

  // Free-tier quota — checked BEFORE any writes
  const stats = await AitherKbDb.stats();
  const quota = await AitherGating.checkKbQuota(stats.docCount);
  if (!quota.allowed) {
    throw new Error(`Free knowledge base is full (${quota.limit} documents) — delete old documents in the KB manager or upgrade to Pro.`);
  }

  // Chunk → embed → store
  const chunks = AitherChunker.chunkText(text, { maxTokens: 512, overlapTokens: 64 });
  const { vectors, embedderId } = await AitherEmbeddings.embedBatch(
    chunks.map((c) => c.text), PROVIDER_CFG, { concurrency: 3 },
  );
  const doc = await AitherKbDb.addDocument({
    title: title || `Capture: ${source || "untitled"}`,
    url: source && /^https?:\/\//.test(source) ? source : "",
    source: source || "browser-extension",
    tags: tagList,
    charCount: text.length,
    chunkCount: chunks.length,
  });
  await AitherKbDb.addChunks(chunks.map((c, i) => ({
    docId: doc.id,
    chunkIndex: c.chunkIndex ?? i,
    text: c.text,
    embedderId,
    vector: vectors[i],
  })));

  // Fleet mirror — fire-and-forget, never blocks or fails the local save
  const caps = TierDetect.capabilitiesFor(DETECTED_TIER);
  if (caps.hasFleet) {
    fleetKnowledgeIngest({ content, source, title, tags, collection, metadata })
      .then((r) => console.debug("[Awconnect] Fleet KB mirror:", Object.keys(r).filter((k) => r[k])))
      .catch((e) => console.debug("[Awconnect] Fleet KB mirror failed:", e.message));
  }

  return {
    docId: doc.id,
    chunkCount: chunks.length,
    embedderId,
    local: true,
    fleetMirror: caps.hasFleet,
    quotaRemaining: quota.remaining,
  };
}

/** Legacy fleet fan-out (Memory/Genesis docs/Nexus/Strata/LyraWiki) — now the async mirror. */
async function fleetKnowledgeIngest({ content, source, title, tags, collection, metadata }) {
  const timestamp = new Date().toISOString();
  const results = { memory: null, nexus: null, strata: null, document: null, workspace: null, lyra: null };

  // 0. Workspace knowledge ingest (scoped to workspace if configured)
  if (SETTINGS.workspaceKnowledge && SETTINGS.workspaceId) {
    try {
      const resp = await fetch(`${GENESIS_URL}/workspace/${encodeURIComponent(SETTINGS.workspaceId)}/knowledge/ingest`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          urls: source && (source.startsWith("http://") || source.startsWith("https://")) ? [source] : [],
          paths: [],
          // Attach content as metadata for URL-less captures
          ...((!source || !source.startsWith("http")) ? {
            _browser_capture: {
              content,
              title: title || "",
              tags: tags || [],
              captured_at: timestamp,
              ...(metadata || {}),
            }
          } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) results.workspace = await resp.json();
    } catch (e) {
      console.debug("[Awconnect] Workspace knowledge ingest failed:", e.message);
    }
  }

  // 1. Genesis memory/remember (short-term + graph memory)
  try {
    const resp = await fetch(`${GENESIS_URL}/memory/remember`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        text: content,
        source: source || "browser-extension",
        tags: [...(tags || []), "knowledge-ingest"],
        metadata: { title, url: source, collection, ...(metadata || {}) },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) results.memory = await resp.json();
  } catch (e) {
    console.debug("[Awconnect] Memory remember failed:", e.message);
  }

  // 2. Genesis document/ingest (structured document storage)
  try {
    const resp = await fetch(`${GENESIS_URL}/document/ingest`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        content,
        title: title || `Browser: ${source}`,
        source: source || "browser-extension",
        doc_type: "browser_capture",
        tags: tags || [],
        metadata: { url: source, collection, captured_at: timestamp, ...(metadata || {}) },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) results.document = await resp.json();
  } catch (e) {
    console.debug("[Awconnect] Document ingest failed:", e.message);
  }

  // 3. Nexus RAG ingest (vector embeddings for semantic search)
  try {
    const resp = await fetch(`${NEXUS_URL}/api/v1/ingest`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        text: content,
        collection: collection || "browser",
        metadata: {
          source: source || "browser-extension",
          title: title || "",
          tags: tags || [],
          captured_at: timestamp,
          ...(metadata || {}),
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) results.nexus = await resp.json();
  } catch (e) {
    console.debug("[Awconnect] Nexus ingest failed:", e.message);
  }

  // 4. Strata session ingest (telemetry + training data)
  try {
    await fetch(`${STRATA_URL}/api/v1/ingest/browser-knowledge`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        content,
        source: source || "browser-extension",
        title: title || "",
        tags: tags || [],
        collection: collection || "browser",
        ingestion_type: "knowledge_capture",
        timestamp,
        metadata: metadata || {},
      }),
      signal: AbortSignal.timeout(5000),
    });
    results.strata = true;
  } catch (e) {
    console.debug("[Awconnect] Strata ingest failed:", e.message);
  }

  // 5. LyraWiki ingest (knowledge engine — autonomous processing, lint, graph sync)
  try {
    const resp = await fetch(`${LYRAWIKI_URL}/ingest`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        content,
        title: title || "",
        source: source || "browser-extension",
        source_type: "browser_capture",
        // Top-level scoping — LyraWiki composes the isolated {tenant}/{wiki}
        // project namespace from these (metadata copies kept for downstream).
        tenant_id: SETTINGS.tenantId || "default",
        project: SETTINGS.wikiProject || SETTINGS.projectName || "default",
        tags: tags || [],
        collection: collection || "browser",
        metadata: {
          url: source,
          captured_at: timestamp,
          workspace_id: SETTINGS.workspaceId || "",
          tenant_id: SETTINGS.tenantId || "",
          ...(metadata || {}),
        },
        // Request async processing — Lyra queues for lint + enrichment
        async_process: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) results.lyra = await resp.json();
  } catch (e) {
    console.debug("[Awconnect] LyraWiki ingest failed:", e.message);
  }

  return results;
}
// =============================================================================
// TOP-LEVEL WARM-UP
// =============================================================================
// MV3 service workers restart constantly; onInstalled/onStartup do NOT fire on
// those wakes. Without this, SETTINGS stays at defaults and PROVIDER_CFG stays
// null until an alarm or storage change — which silently drops the BYOK
// provider tier after every worker recycle.
(async () => {
  try {
    await loadSettings();
    await loadProviderConfig();
    await loadFormbridgeConfig();
    await autoDetectTier();
    await syncRegisteredContentScripts();
    if (formbridgeQueue.length) await formbridgeDrainQueue();

    // The autonomy bootstrap belongs HERE, not only in onInstalled/onStartup —
    // for exactly the reason this block already exists. A service worker recycles
    // constantly and neither of those events fires on a wake, so anything wired
    // only to them runs once a day at best:
    //   * ensureXAlarms  — alarms usually survive, but if the set is ever lost
    //     nothing restores it and the account stops posting permanently.
    //   * autoResolveIdentity — self-guards to a no-op once tenant/workspace/user
    //     are all set, so this costs nothing on the common path; without it a
    //     recycle leaves the workspace badge empty until the side panel is opened.
    //   * sweepInjectables — open tabs are bare after a recycle. On x.com that is
    //     not cosmetic: the bar is the in-page driver, so an un-swept tab is an
    //     automation that silently never runs.
    await ensureXAlarms();
    autoResolveIdentity("worker-wake").catch(() => {});
    // Debounced: the sweep executeScripts into every open http(s) tab, and a
    // worker can wake many times a minute. Both injected scripts guard against
    // double-injection, so the cost is wasted messages rather than duplicate
    // bars — but there is no reason to pay it on every wake.
    const _sw = await chrome.storage.local.get(["lastInjectSweepAt"]);
    if (!_sw.lastInjectSweepAt || Date.now() - _sw.lastInjectSweepAt > 5 * 60 * 1000) {
      await chrome.storage.local.set({ lastInjectSweepAt: Date.now() });
      sweepInjectables().catch(() => {});
    }
  } catch (e) {
    console.warn("[Awconnect] Warm-up failed:", e.message);
  }
})();
