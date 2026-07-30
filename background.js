/**
 * AitherConnect Background Service Worker
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
  "shared/aitherbrowser.js");

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
  nodePort: 8090,                        // AitherNode ADK standalone port
  nexusPort: 8122,
  searchPort: 8114,
  strataPort: 8136,
  themisPort: 8791,
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

// ── AitherBrowser bridge ─────────────────────────────────────────────────────
// The helpers live in shared/aitherbrowser.js so they can be imported by
// tests/run-tests.mjs — a service worker cannot be (D-922).
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
    RELAY_URL = SETTINGS.relayUrl || `${base}/services/relay`;
    RELAY_WS = SETTINGS.relayWsUrl || `${wsBase}/ws/chat`;
  } else if (DETECTED_TIER === "node-only" && TIER_URLS.chatUrl) {
    // Node-only mode — direct HTTP to AitherNode (no TLS issue on localhost).
    //
    // AitherNode >= 0.2.0 is a persistent host service with an allowlisted
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
      `[AitherConnect] Ignoring tier demotion ${DETECTED_TIER} → ${newTier} — ${decision.reason}`,
    );
    return;  // keep the current tier, URLs, and capabilities untouched
  }
  if (decision.reason.startsWith("demotion")) {
    console.warn(`[AitherConnect] Tier demotion ${DETECTED_TIER} → ${newTier}: ${decision.reason}`);
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
    console.log(`[AitherConnect] Tier changed: ${DETECTED_TIER} → URLs:`, TIER_URLS);
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
    console.log("[AitherConnect] Created server session ID:", sessionId);
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
    console.warn("[AitherConnect] Could not persist entitlement:", e);
  }
}

/**
 * Auto-pull the authenticated user's entitlement from the gateway and reflect
 * it as the AitherConnect tier — "if you're signed in with a valid
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
    console.debug("[AitherConnect] connect/license mint unavailable:", e.message);
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
      console.debug(`[AitherConnect] /auth/me reflect via ${url} failed:`, e.message);
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
    console.warn("[AitherConnect] Could not load settings:", e);
  }
  recalcUrls();
}

/** Save current settings to chrome.storage.sync. */
async function saveSettings(newSettings) {
  SETTINGS = { ...DEFAULT_SETTINGS, ...newSettings };
  await chrome.storage.sync.set({ "aither-settings": SETTINGS });
  recalcUrls();
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
    console.warn("[AitherConnect] Could not load provider config:", e);
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
// (.PRODUCTS/.FORMBRIDGE/06-SECURITY-MODEL.md).

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
    console.warn("[AitherConnect] Could not load formbridge config:", e);
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

function xNotify(msg, ok) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: ok ? "Posted to X" : "AitherConnect — X",
      message: msg,
    });
  } catch { /* notifications optional */ }
}

// Ask the fleet to write the tweet in Aither's voice. Tries the dedicated X
// composer first (worker/genesis /social/x/tick), then falls back to Aither's
// general chat brain (Genesis /chat, which IS reachable through the bridge
// today) with a fresh, rotating brief so no two posts are the same. Only if the
// whole fleet is unreachable does it use a varied local line — never a single
// hardcoded string, which is the bug the first version had.
async function xComposeText(promptOverride) {
  // Config-driven brief: if the command bar / a fleet agent supplied a prompt,
  // use it (with the rotating angle appended for variety); else the built-in.
  const cfgPrompt = (promptOverride && String(promptOverride).trim()) || "";
  // 1) The real X composer, when its route is deployed.
  for (const url of [`${GENESIS_URL}/social/x/tick`, `${NODE_URL}/social/x/tick`]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json().catch(() => ({}));
      const t = d && (d.text || (d.result && d.result.text));
      if (t && String(t).trim()) return String(t).trim();
    } catch { /* try next */ }
  }

  // 2) Aither's chat brain via Genesis /chat (reachable through the bridge).
  //    A rotating angle keeps each post distinct. Response shape varies across
  //    genesis versions, so accept any of the common text fields.
  const angles = [
    "a builder's note on shipping AI infrastructure that runs itself",
    "one sharp, non-obvious lesson from building autonomous agents",
    "why local-first, self-hosted AI matters, in a confident line",
    "a candid progress update from an AI platform that operates itself",
    "a contrarian take on agent autonomy worth arguing with",
  ];
  const angle = angles[Math.floor(Date.now() / 60000) % angles.length];
  const prompt = cfgPrompt
    ? `${cfgPrompt}\n\n(Angle for variety: ${angle}. Return only the post text.)`
    : `Write ONE original tweet (under 260 characters) in Aither's own `
      + `voice: ${angle}. First person as Aither, an AI that runs its own `
      + `infrastructure. No hashtags, no quotes around it, no emojis unless it `
      + `genuinely lands. Return only the tweet text.`;
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

// Runs IN the page (MAIN world). Fills x.com's composer via execCommand (which
// the Draft.js editor treats as real input) and clicks Post. Returns a verdict.
function AITHER_X_PAGE_POSTER(text) {
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
    try {
      const composer = await waitFor(
        ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
        12000
      );
      if (!composer) { resolve({ ok: false, reason: "no_composer", url: location.href }); return; }
      composer.focus();
      document.execCommand("insertText", false, text);
      await sleep(900);
      const btnSel = ['button[data-testid="tweetButton"]', 'button[data-testid="tweetButtonInline"]'];
      let btn = null;
      for (let i = 0; i < 25; i++) {
        btn = btnSel.map((s) => document.querySelector(s)).find(Boolean);
        if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") break;
        await sleep(200);
      }
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") {
        resolve({ ok: false, reason: "post_button_disabled" }); return;
      }
      btn.click();
      await sleep(3500);
      const box = document.querySelector('div[data-testid="tweetTextarea_0"]');
      const cleared = !box || (box.innerText || "").trim().length === 0;
      resolve({ ok: true, cleared });
    } catch (e) {
      resolve({ ok: false, reason: "exception", error: String(e).slice(0, 200) });
    }
  });
}

async function xPostInTab(tabId, text) {
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
      target: { tabId }, world: "MAIN", args: [text], func: AITHER_X_PAGE_POSTER,
    });
    return res?.result || { ok: false, reason: "no_result" };
  } catch (e) {
    return { ok: false, reason: "inject_failed", error: String(e).slice(0, 200) };
  }
}

async function xComposeAndPost(tab) {
  if (!tab || !tab.id) { xNotify("Open x.com in a tab first.", false); return { ok: false }; }
  xNotify("Aither is writing a post…", true);
  const text = await xComposeText();
  const result = await xPostInTab(tab.id, text);
  if (result.ok) {
    xNotify(`Posted: “${text.slice(0, 80)}”`, true);
    await xLogActivity({ type: "post", text: text.slice(0, 200) });
  } else {
    xNotify(`Post failed (${result.reason || result.error}). Make sure you're on x.com and logged in.`, false);
  }
  // Tell the fleet how it went (best-effort; the extension is the source of truth).
  try {
    await fetch(`${GENESIS_URL}/social/x/posted`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: result.ok, text, result }),
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
async function xEngagePlan(feed) {
  const summary = feed.map((t) => `[${t.idx}] @${t.handle}: ${t.text.slice(0, 180)}`).join("\n");
  const prompt = "You are Aither, engaging on X to grow an audience around AI "
    + "infrastructure, agents, and building in public. Current feed:\n" + summary
    + "\n\nChoose up to 3 tweets to LIKE (genuinely relevant to AI/infra/agents/"
    + "building) and optionally ONE to REPLY to with a short, real, non-spammy "
    + "reply in Aither's first-person voice (under 200 chars, no hashtags, adds "
    + "something). Return ONLY JSON: "
    + '{"likes":[idx,...],"reply":{"idx":N,"text":"..."}} or with "reply":null.';
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
      const jm = t && String(t).match(/\{[\s\S]*\}/);
      if (jm) {
        const plan = JSON.parse(jm[0]);
        const valid = new Set(feed.map((f) => f.idx));
        plan.likes = (plan.likes || []).filter((i) => valid.has(i)).slice(0, 3);
        if (!plan.reply || !plan.reply.text || !valid.has(plan.reply.idx)) plan.reply = null;
        else plan.reply.text = String(plan.reply.text).slice(0, 260);
        return plan;
      }
    } catch { /* try next / fall back */ }
  }
  // Fallback: like the first two fresh items, no reply.
  return { likes: feed.slice(0, 2).map((t) => t.idx), reply: null };
}

async function xEngageTick() {
  try {
    const s = await chrome.storage.local.get(["xEngageEnabled"]);
    if (s.xEngageEnabled === false) return; // kill switch
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
    const [{ result: feed } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_READ_FEED, args: [15],
    });
    if (!feed || !feed.length) return;
    const plan = await xEngagePlan(feed);
    const [{ result: done } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_DO_ENGAGE, args: [plan],
    });
    if (done && (done.liked || done.replied)) {
      xNotify(`Engaged: ${done.liked} likes${done.replied ? " + 1 reply" : ""}`, true);
      await xLogActivity({ type: "engage", liked: done.liked || 0, replied: done.replied ? 1 : 0, source: "home" });
    }
  } catch (e) {
    console.debug("[AitherConnect] x-engage tick failed:", e);
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
  const prompt = "You are Aither, growing an audience around AI infrastructure, "
    + "agents, and building in public. These accounts appeared in search:\n" + summary
    + `\n\nPick up to ${maxFollows} genuinely relevant accounts worth following `
    + "(real builders/researchers/tools in this space — NOT engagement-farmers, "
    + "NOT unrelated). Return ONLY JSON: {\"follow\":[idx,...]}.";
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
      const jm = t && String(t).match(/\{[\s\S]*\}/);
      if (jm) {
        const plan = JSON.parse(jm[0]);
        const valid = new Set(users.map((u) => u.idx));
        plan.follow = (plan.follow || []).filter((i) => valid.has(i)).slice(0, maxFollows);
        return plan;
      }
    } catch { /* try next */ }
  }
  return { follow: users.slice(0, maxFollows).map((u) => u.idx) };
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
        target: { tabId: tab.id }, world: "MAIN", func: AITHER_X_READ_SEARCH_USERS, args: [15],
      });
      if (users && users.length) {
        const perTick = Math.min(3, budget.remaining);
        const plan = await xDiscoverPlan(users, perTick);
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

    // 2) Latest tweets for the topic → like/reply (reuses the engagement path).
    const tab2 = await _xLoadTab(`https://x.com/search?q=${q}&src=typed_query&f=live`);
    const [{ result: feed } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab2.id }, world: "MAIN", func: AITHER_X_READ_FEED, args: [15],
    });
    if (feed && feed.length) {
      const plan = await xEngagePlan(feed);
      const [{ result: done } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab2.id }, world: "MAIN", func: AITHER_X_DO_ENGAGE, args: [plan],
      });
      if (done && (done.liked || done.replied)) {
        xNotify(`“${topic}”: ${done.liked} likes${done.replied ? " + reply" : ""}`, true);
        await xLogActivity({ type: "engage", liked: done.liked || 0, replied: done.replied ? 1 : 0, source: "discover", topic });
      }
    }
  } catch (e) {
    console.debug("[AitherConnect] x-discover tick failed:", e);
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

async function xDailySummaryTick() {
  await xTrackFollowers();          // refresh today's follower count first
  const sum = await xDailySummary();
  xNotify(sum.text, true);
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
        headers: { "Content-Type": "application/json" },
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
  // No endpoint took it (e.g. the route is on the worker but not yet on Genesis).
  // Hand the caller the storage_state so it can offer a local download; the
  // operator then imports it via the proven worker path
  // (`adk x-session import --state <file>`). Cookie values live only in this
  // extension and the downloaded file, both on the user's own machine.
  return {
    ok: false,
    error: lastErr,
    needsManualImport: true,
    storageState: { cookies: payload.cookies, origins: [] },
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
  try {
    // Quick probe — if the content script is already there, it responds instantly
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
  } catch {
    // Content script not present — inject it now
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/agent-extractor.js"],
    });
    // Give it a moment to register its message listener
    await new Promise((r) => setTimeout(r, 100));
  }
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
    console.log(`[AitherConnect] Registered content scripts: ${wanted.map((w) => w.id).join(", ") || "(none)"}`);
  } catch (e) {
    console.warn("[AitherConnect] Content-script registration failed:", e.message);
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
  // Project & tenant scope — propagated to AitherNode/Genesis
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
 *   1. SOVEREIGN — local AitherNode /packs/install (bundled adk packs
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
      // Remember it: adk's CLI can only install bundled packs too (D-751),
      // so for a confirmed-non-bundled pack the command is a dead end.
      nodeSaidNotBundled = resp.status === 404;
    } catch { /* node not running / no endpoint — fall through */ }
  }
  // Rung 2 — managed: apply the pack to the caller's bound agent.
  const applied = await tryApplyPackManaged(itemId);
  if (applied) return applied;
  // Rung 3 — portal handoff. On the cloud/off-box tier the gateway has no
  // apply-pack route (D-750), so rung 2 can't reach genesis directly. Rather
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
  console.log("[AitherConnect] Extension installed/updated", details && details.reason);

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
    console.warn("[AitherConnect] onboard tab open failed:", e);
  }

  // Context menus — parent menu for text actions
  chrome.contextMenus.create({
    id: "aither-parent",
    title: "AitherConnect",
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

  // Periodic health check + tier detection
  chrome.alarms.create("health-check", { periodInMinutes: 0.5 });
  chrome.alarms.create("tier-check", { periodInMinutes: 0.5 });

  // Autonomous X poster: on a timer, Aither writes a tweet and this posts it in
  // the logged-in browser — no click, no fleet round-trip required. Gated by a
  // storage flag (the kill switch) and a configurable interval.
  chrome.storage.local.get(["xAutopostIntervalMin", "xEngageIntervalMin"], (s) => {
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
  });

  await autoDetectTier();
  await syncRegisteredContentScripts();
  await bootstrapCtaAdapters();
  await checkHealth();
  connectToGenesis();
  pullEntitlement().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[AitherConnect] Browser started, reconnecting...");
  await loadSettings();
  await loadProviderConfig();
  await autoDetectTier();
  await bootstrapCtaAdapters();
  connectToGenesis();
  checkHealth();
  pullEntitlement().catch(() => {});
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
      console.log("[AitherConnect] Connected to Genesis WS");
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
        console.debug("[AitherConnect] Non-JSON WS message:", event.data);
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
        console.debug("[AitherConnect] x_post_request failed:", e);
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

  // Cache it
  agentContextCache.set(tab.id, {
    context: response.context,
    extracted_at: Date.now(),
  });

  return response.context;
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
  try {
    const ctx = await extractActiveTabContext({ include_text: false });
    pushContextToGenesis(ctx, "tab_activated");
  } catch { /* tab not ready yet */ }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.active || !isConnected) return;
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
    console.debug("[AitherConnect] No portal token — relay auth skipped");
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
    console.warn("[AitherConnect] Relay token mint failed:", result.error);
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
      console.warn("[AitherConnect] Cannot connect to Relay without a token");
      broadcastToSidePanel({ type: "relay-status", connected: false, error: "auth_required" });
      return;
    }

    try {
      // Open WS with token as query parameter
      const wsUrl = `${RELAY_WS}${RELAY_WS.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
      relaySocket = new WebSocket(wsUrl);

      relaySocket.onopen = () => {
        console.log("[AitherConnect] Connected to AitherRelay (authenticated)");
        relayConnected = true;
        // Join #general by default with workspace context
        relaySocket.send(JSON.stringify({
          type: "join",
          nick: relayNick,
          channel: "#general",
          workspace_id: relayWorkspaceId,
          is_agent: false,
        }));
        broadcastToSidePanel({ type: "relay-status", connected: true, nick: relayNick });
      };

      relaySocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          broadcastToSidePanel({ type: "relay-message", data });
        } catch { /* ignore malformed */ }
      };

      relaySocket.onclose = (event) => {
        console.log("[AitherConnect] Relay WS closed", { code: event.code, reason: event.reason });
        relayConnected = false;
        // Close code 4401 = invalid token
        if (event.code === 4401) {
          relayToken = null;
          broadcastToSidePanel({ type: "relay-status", connected: false, error: "auth_invalid" });
          console.warn("[AitherConnect] Relay auth token invalid (4401) — re-authentication required");
        } else {
          broadcastToSidePanel({ type: "relay-status", connected: false });
          scheduleRelayReconnect();
        }
      };

      relaySocket.onerror = (event) => {
        console.debug("[AitherConnect] Relay WS error:", event);
        relayConnected = false;
      };
    } catch (e) {
      console.debug("[AitherConnect] Could not connect to Relay:", e);
      scheduleRelayReconnect();
    }
  }).catch((e) => {
    console.debug("[AitherConnect] Relay token mint async error:", e);
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
});

// Inject the on-page growth control panel whenever an x.com tab finishes loading.
// The panel guards against double-injection itself, so re-firing is harmless.
function _xInjectPanel(tabId, file) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
  }).catch(() => { /* not a supported tab / no host permission yet — ignore */ });
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab || !tab.url) return;
  // One command bar for every social surface (config-driven; replaces the old
  // per-platform floating panels).
  if (/^https:\/\/(x\.com|twitter\.com|(www\.)?linkedin\.com)\//.test(tab.url)) {
    _xInjectPanel(tabId, "content/aither-command-bar.js");
  }
});

// Autonomous X post on the timer. Kill switch: chrome.storage.local
// xAutopostEnabled (default TRUE — the owner asked for hands-off). Only posts
// when an x.com tab is available (opens one if none), and lets xComposeText
// write fresh text each time.
async function xAutopostTick() {
  try {
    const s = await chrome.storage.local.get(["xAutopostEnabled"]);
    if (s.xAutopostEnabled === false) return; // explicit kill switch
    let tabs = await chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] });
    let tab = tabs && tabs[0];
    if (!tab) {
      tab = await chrome.tabs.create({ url: "https://x.com/compose/post", active: false });
    }
    await xComposeAndPost(tab);
  } catch (e) {
    console.debug("[AitherConnect] x-autopost tick failed:", e);
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

function updateBadge(status) {
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
  chrome.action.setBadgeBackgroundColor({ color: colors[status] || "#6b7280" });
  chrome.action.setBadgeText({ text: text[status] || "" });
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
        title: "AitherConnect",
        message: `Saved to Knowledge Base (${r.chunkCount} chunk${r.chunkCount === 1 ? "" : "s"})`,
        priority: 1,
      });
    }).catch((e) => {
      chrome.notifications.create(`aither-kb-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "AitherConnect",
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
      console.error("[AitherConnect] Screenshot capture failed:", err);
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
      title: "AitherConnect",
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
    console.warn("[AitherConnect] HAR inject failed:", e.message);
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
      creator: { name: "AitherConnect", version: chrome.runtime.getManifest().version },
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
          else if (which === "engage") await xEngageTick();
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
                console.debug("[AitherConnect] KB retrieval skipped:", e.message);
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
              : `Connecting to ${tier === "node-only" ? "AitherNode" : "Cloud Gateway"}...`,
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
                console.debug(`[AitherConnect] ${tier} returned ${resp.status}, re-detecting tier...`);
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
              console.log("[AitherConnect] Updated session ID to:", returnedSessionId);
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
            console.debug(`[AitherConnect] ${tier} chat failed:`, err.message);
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
              console.log("[AitherConnect] Updated session ID to:", returnedSessionId);
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
          console.warn(`[AitherConnect] ${agentFallbackReason} — falling back to /chat`);
        } catch (streamErr) {
          agentFallbackReason = `/agent failed: ${streamErr.message}`;
          console.debug("[AitherConnect] /agent stream failed, falling back:", streamErr.message);
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
      console.log(`[AitherConnect] Harvest from ${sender.url}`);
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
    // Rides the AitherNode proxy plane in node tier, the Veil bridge in
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
          // not one giant blob. Loop lives in shared/aitherbrowser.js (D-922).
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
        // AitherNode is the always-on host service that Claude Code + aither-adk
        // also use. When it's reachable, list ITS tools first (one source of
        // truth) — regardless of tier — via /mcp/tools on the persistent server.
        const nodeBase = (tier === "node-only" && TIER_URLS.nodeUrl)
          ? TIER_URLS.nodeUrl
          : `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
        try {
          const result = await fetchJson(`${nodeBase}/mcp/tools`, {}, 20000, "AitherNode");
          if (result.ok) {
            const tools = mapTools(result.data.tools);
            if (tools.length) {
              sendResponse({ ok: true, tools, tier: "node", source: "aithernode" });
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
              error: "AitherNode is running but exposed no tools — start a backend "
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
    //   1. SOVEREIGN: local AitherNode /packs/install (bundled adk packs
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
      chrome.tabs.create({ url: VEIL_URL });
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
          { id: "node",     name: "AitherNode",           url: `${NODE_URL}/health` },
          { id: "veil",     name: "AitherVeil",           url: `${VEIL_URL}/api/health` },
          { id: "lyra",     name: "LyraWiki",             url: `${LYRAWIKI_URL}/health` },
          { id: "pulse",    name: "Pulse",                url: `${PULSE_URL}/health` },
          { id: "mind",     name: "Mind",                 url: `${MIND_URL}/health` },
          { id: "strata",   name: "Strata",               url: `${STRATA_URL}/health` },
          { id: "nexus",    name: "Nexus",                url: `${NEXUS_URL}/health` },
          { id: "search",   name: "AitherSearch",         url: `${SEARCH_URL}/health` },
          { id: "browser",  name: "AitherBrowser",        url: `${BROWSER_URL}/health` },
          { id: "bonsai",   name: "Bonsai-27B (local)",   url: `${NODE_URL || `http://${LOOPBACK}:` + (SETTINGS.nodePort || 8090)}/proxy/bonsai/health` },
          { id: "ollama",   name: "Ollama",               url: `http://${LOOPBACK}:11434/api/tags` },
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
      (async () => {
        // 1. Find a token: settings API key > portal cookie
        let token = SETTINGS.apiKey || null;
        let source = token ? "settings" : null;

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
        // Quick Setup advertises "Sign in — From portal cookie or API key"; this is
        // what makes the cookie half of that claim true.
        if (token) {
          try { await self.AitherPortal.setPortalBearer(token); } catch { /* no session storage */ }
        }

        // Track WHY a verify failed so a transient outage isn't reported as a
        // logout: 401/403 = token actually rejected (truly logged out);
        // network error / timeout / 5xx = verifier unreachable (still signed in).
        let authRejected = false;

        // 2. If we have a token, call /auth/me
        if (token) {
          const identityUrl = SETTINGS.remoteUrl
            ? `${SETTINGS.remoteUrl}/services/identity/auth/me`
            : `http://${LOOPBACK}:${SETTINGS.veilPort}/api/bridge/identity/auth/me`;
          try {
            const resp = await fetch(identityUrl, {
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            });
            if (resp.ok) {
              const me = await resp.json();
              sendResponse({ ok: true, source, identity: me, token });
              return;
            }
            if (resp.status === 401 || resp.status === 403) {
              authRejected = true;  // credentials genuinely invalid/expired
            }
            // 5xx / 429 / other → leave authRejected false (transient)
          } catch (e) {
            console.debug("[AitherConnect] Identity service unreachable, trying local session:", e.message);
          }
        }

        // 3. NEW: Probe local Genesis for AitherShell session (~/.aither/auth.json)
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
              sendResponse({
                ok: true,
                source: "local-genesis",
                identity: session.user,
                token: null,
              });
              return;
            }
          }
        } catch (e) {
          console.debug("[AitherConnect] Local session probe failed:", e.message);
        }

        // 4. Couldn't verify. If we have a usable token/credentials AND the
        //    failure was transient (NOT a 401/403 rejection), the user is still
        //    signed in — the verifier was just unreachable (fleet flap, portal
        //    down, tier switched to cloud). Return the stored identity with an
        //    `unverified` flag so the UI keeps the session instead of flipping
        //    to "Not authenticated".
        const haveStored = !!(token || SETTINGS.userId || SETTINGS.cloudApiKey);
        if (haveStored && !authRejected) {
          const _slug = (SETTINGS.tenantId || "").replace(/^tnt_/, "");
          sendResponse({
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
          });
          return;
        }

        sendResponse({
          ok: false,
          authRejected,
          error: authRejected
            ? "Your session expired or was rejected. Sign in again at portal.aitherium.com."
            : "Not authenticated. Log in at portal.aitherium.com or run `aither login`.",
        });
      })();
      return true;

    // ── Auto-apply resolved identity to settings ──
    case "apply-identity":
      (async () => {
        try {
          const { identity, token } = message;
          const updates = {};
          if (identity.tenant_id) updates.tenantId = identity.tenant_id;
          // Workspace: prefer workspace_id/slug from /auth/me or local session
          if (identity.workspace_id) {
            updates.workspaceId = identity.workspace_id;
          } else if (identity.workspace_slug) {
            updates.workspaceId = identity.workspace_slug;
          }
          if (identity.username) updates.userId = identity.username;
          // Also accept email as userId fallback (local session may have email but not username)
          if (!updates.userId && identity.email) updates.userId = identity.email;
          if (token && !SETTINGS.apiKey) updates.apiKey = token;
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
            console.warn("[AitherConnect] Could not persist scopes:", e);
          }
          setTimeout(() => { connectToGenesis(); checkHealth(); }, 500);
          // Now that we're authenticated, pull the subscription tier automatically.
          pullEntitlement().catch(() => {});
          sendResponse({ ok: true, applied: updates });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
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
            body: JSON.stringify({ client_name: "AitherConnect" }),
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
                body: JSON.stringify({ name: "AitherConnect" }),
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
          console.debug("[AitherConnect] API capture forward failed:", e.message);
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
        // AitherConnect whenever an engine is running locally — no exact-seed
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
    // Research node and read its GET /api/license so AitherConnect can reflect
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
    // aither-adk's is_pack_available() reads. NEVER pass a license/signing key.
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
          console.log("[AitherConnect] Got audio from offscreen, b64 length:", (rec.audio_base64 || "").length);
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
                "[AitherConnect] Permission request for",
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
                console.debug("[AitherConnect] FormBridge prefill injected in tab", tabId);
              })
              .catch((e) => {
                console.debug(
                  "[AitherConnect] FormBridge prefill injection failed:",
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
      console.debug("[AitherConnect] Unknown message type:", message.type);
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }
});

// ── External messages (portal.aitherium.com) ──────────────────────────────
// Accept a small allowlist of request types from portal.aitherium.com and
// sibling subdomains (*.aitherium.com), ONLY after origin validation:
//   cta-prefill          — FormBridge form prefill handoff
//   marketplace-install  — portal listing "Install via AitherConnect" button
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
      "[AitherConnect] Rejected external message from untrusted origin:",
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
              "[AitherConnect] Permission request for",
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
              console.debug("[AitherConnect] FormBridge prefill injected in tab", tabId);
            })
            .catch((e) => {
              console.debug(
                "[AitherConnect] FormBridge prefill injection failed:",
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
  // "Install via AitherConnect" button sends the same shape the sidepanel
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
  // AitherConnect" only when the extension is actually present.
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
    console.warn(`[AitherConnect] Offscreen doc unresponsive (${name}) — recreating`);
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
  console.log("[AitherConnect] STT →", url, "audio length:", (audio_base64 || "").length);

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
      console.log("[AitherConnect] STT attempt", attempt + 1, "response:", res.status, raw.slice(0, 300));
      let data;
      try { data = JSON.parse(raw); } catch { data = { success: false, error: raw.slice(0, 200) }; }
      if (res.ok && data.success) {
        return { ok: true, text: data.text || "" };
      }
      lastErr = data.error || `HTTP ${res.status}`;
    } catch (e) {
      console.warn("[AitherConnect] STT attempt", attempt + 1, "error:", e.message);
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
    console.debug("[AitherConnect] Could not persist webml-downloaded flag:", e.message);
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
      console.debug("[AitherConnect] KB retrieval skipped:", e.message);
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

chrome.notifications.onClicked.addListener(() => {
  // Open the PUBLIC portal, not the local Veil host. VEIL_URL is a localhost
  // address in local mode; landing a user there breaks passwordless login
  // (the auth cookie is issued for the public *.aitherium.com origin, so a
  // localhost tab can never see it and just bounces back to /login). Use the
  // configured public portal so the click behaves like a real customer's.
  const portal = (SETTINGS && SETTINGS.portalUrl) || PORTAL_URL;
  chrome.tabs.create({ url: portal });
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
    console.log(`[AitherConnect] Search request: POST ${fetchUrl} query="${query}" mode=${mode}`);
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
      console.warn(`[AitherConnect] AitherSearch HTTP ${rawResp.status}: ${errText.slice(0, 200)}`);
    } else {
      let searchResp;
      try {
        searchResp = await rawResp.json();
      } catch (jsonErr) {
        errors.push("Search returned invalid response");
        console.warn("[AitherConnect] AitherSearch returned non-JSON response");
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
        `[AitherConnect] AitherSearch returned ${searchResp.results?.length || 0} results ` +
        `(provider: ${searchResp.provider}, ${searchResp.search_time_ms}ms)`
      );
    }
  } catch (e) {
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    errors.push(isTimeout ? "Search timed out" : "Search service unavailable");
    console.warn("[AitherConnect] AitherSearch unavailable, falling back:", e.message);
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
      console.debug("[AitherConnect] Nexus search error:", e.message);
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
      console.log("[AitherConnect] AitherOS ingestion offline");
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
      .then((r) => console.debug("[AitherConnect] Fleet KB mirror:", Object.keys(r).filter((k) => r[k])))
      .catch((e) => console.debug("[AitherConnect] Fleet KB mirror failed:", e.message));
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
      console.debug("[AitherConnect] Workspace knowledge ingest failed:", e.message);
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
    console.debug("[AitherConnect] Memory remember failed:", e.message);
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
    console.debug("[AitherConnect] Document ingest failed:", e.message);
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
    console.debug("[AitherConnect] Nexus ingest failed:", e.message);
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
    console.debug("[AitherConnect] Strata ingest failed:", e.message);
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
    console.debug("[AitherConnect] LyraWiki ingest failed:", e.message);
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
  } catch (e) {
    console.warn("[AitherConnect] Warm-up failed:", e.message);
  }
})();
