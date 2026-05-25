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
 *
 * Author: AitherZero
 */

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
  // Remote mode: when set, all service URLs derive from this single base
  // e.g. "https://aither.example.com" → genesis at /api, pulse at /pulse, etc.
  remoteUrl: "",
  apiKey: "",                            // Bearer token for remote auth
  tenantId: "",                          // Tenant scope (X-Tenant-ID header)
  projectName: "",                       // Project scope (X-Project-Name header)
  workspaceId: "",                       // Workspace scope (X-Workspace-ID header)
  userId: "",                            // User identity (X-User-ID header)
  standaloneMode: false,                 // Force standalone mode (Node ADK only)
  autoHarvest: false,                    // Auto-capture page content on visit
  workspaceKnowledge: true,              // Route KB ingests through workspace knowledge API
};

// Live settings object — populated from storage on startup
let SETTINGS = { ...DEFAULT_SETTINGS };

// Derived URLs (recalculated after settings load)
// Default to Veil bridge proxy — avoids self-signed TLS issues in Chrome extensions
let GENESIS_URL = "http://localhost:3000/api/bridge/genesis";
let GENESIS_WS = "ws://localhost:3000/ws/events";
let VEIL_URL = "http://localhost:3000";
let PULSE_URL = "http://localhost:3000/api/bridge/pulse";
let MIND_URL = "http://localhost:3000/api/bridge/mind";
let NODE_URL = "http://localhost:3000/api/bridge/node";
let NEXUS_URL = "http://localhost:3000/api/bridge/nexus";
let SEARCH_URL = "http://localhost:3000/api/bridge/search";
let STRATA_URL = "http://localhost:3000/api/bridge/strata";
let RELAY_URL = "http://localhost:3000/api/bridge/relay";
let RELAY_WS = "ws://localhost:3000/ws/chat";
let THEMIS_URL = "http://localhost:3000/api/bridge/themis";
let NEWSWIRE_URL = "http://localhost:3000/api/bridge/newswire";
let LYRAWIKI_URL = "http://localhost:3000/api/bridge/lyra-wiki";

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
    RELAY_URL = SETTINGS.relayUrl || `${base}/services/relay`;
    RELAY_WS = SETTINGS.relayWsUrl || `${wsBase}/ws/chat`;
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
    const veilBase = `http://localhost:${SETTINGS.veilPort}`;
    const bridge = `${veilBase}/api/bridge`;
    VEIL_URL = veilBase;
    GENESIS_URL = `${bridge}/genesis`;
    GENESIS_WS = `ws://localhost:${SETTINGS.veilPort}/ws/events`;  // Veil WS proxy
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
    RELAY_WS = SETTINGS.relayWsUrl || `ws://localhost:${SETTINGS.veilPort}/ws/chat`;
  }
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

const RECONNECT_INTERVAL_MS = 30000;  // WS reconnect — 30s (WS is best-effort, polling is primary)
const SEARCH_TIMEOUT_MS = 10000;

// =============================================================================
// STATE
// =============================================================================

let genesisSocket = null;
let isConnected = false;
let reconnectTimer = null;
let aitherOSStatus = "unknown";
let connectedApps = new Map();

// Agent context bridge state
let agentContextCache = new Map();  // tabId -> last extracted context
const CONTEXT_CACHE_TTL_MS = 60000; // 1 minute staleness window

// AitherRelay IRC state
let relaySocket = null;
let relayConnected = false;
let relayReconnectTimer = null;
let relayNick = null;

// =============================================================================
// LIFECYCLE
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[AitherConnect] Extension installed/updated", details && details.reason);

  // Load connection settings from storage before anything else
  await loadSettings();

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

  // Periodic health check
  chrome.alarms.create("health-check", { periodInMinutes: 0.5 });

  await checkHealth();
  connectToGenesis();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[AitherConnect] Browser started, reconnecting...");
  await loadSettings();
  connectToGenesis();
  checkHealth();
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

function connectToRelay(nick) {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) return;
  if (!nick) return;
  relayNick = nick;

  try {
    relaySocket = new WebSocket(RELAY_WS);

    relaySocket.onopen = () => {
      console.log("[AitherConnect] Connected to AitherRelay");
      relayConnected = true;
      // Join #general by default
      relaySocket.send(JSON.stringify({
        type: "join", nick: relayNick, channel: "#general", is_agent: false,
      }));
      broadcastToSidePanel({ type: "relay-status", connected: true, nick: relayNick });
    };

    relaySocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        broadcastToSidePanel({ type: "relay-message", data });
      } catch { /* ignore malformed */ }
    };

    relaySocket.onclose = () => {
      console.log("[AitherConnect] Relay WS closed");
      relayConnected = false;
      broadcastToSidePanel({ type: "relay-status", connected: false });
      scheduleRelayReconnect();
    };

    relaySocket.onerror = () => { relayConnected = false; };
  } catch (e) {
    console.debug("[AitherConnect] Could not connect to Relay:", e);
    scheduleRelayReconnect();
  }
}

function scheduleRelayReconnect() {
  if (relayReconnectTimer) return;
  relayReconnectTimer = setTimeout(() => {
    relayReconnectTimer = null;
    if (relayNick) connectToRelay(relayNick);
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
});

async function checkHealth() {
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

  const checks = endpoints.map(async (ep) => {
    try {
      const resp = await fetch(ep.url, { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        serviceStatus[ep.name] = "up";
        return ep.tier;
      }
      serviceStatus[ep.name] = "error";
      return null;
    } catch {
      serviceStatus[ep.name] = "down";
      return null;
    }
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
    // Full knowledge base ingestion pipeline
    knowledgeIngest({
      content: info.selectionText || "",
      source: tab?.url || "",
      title: tab?.title || "",
      tags: ["context-menu", "browser-capture"],
      collection: "browser",
      metadata: { url: tab?.url, captured_via: "context-menu" },
    }).then(() => {
      chrome.notifications.create(`aither-kb-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "AitherConnect",
        message: "Saved to Knowledge Base",
        priority: 1,
      });
    }).catch(() => {});
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
    if (chrome.sidePanel && tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    chrome.runtime.sendMessage({ type: "forge-dispatch", task: info.selectionText, agent: "demiurge" });
  }
});

// =============================================================================
// MESSAGE ROUTING
//
// Every async handler MUST:
//   1. Call sendResponse() in both success AND error paths
//   2. Return true to keep the message channel alive
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ── Chat (SSE streaming via Genesis /agent, fallback to /chat) ──
    case "chat":
      (async () => {
        const chatBody = {
          message: message.text,
          context: message.context || { source: "browser-extension" },
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.agent ? { agent: message.agent } : {}),
          ...(message.prefer_cloud_model ? { prefer_cloud_model: message.prefer_cloud_model } : {}),
        };
        let streamingStarted = false;
        let gotCompleteEvent = false;

        // Try SSE streaming via /agent first (real-time events)
        try {
          const resp = await fetch(`${GENESIS_URL}/agent`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(chatBody),
            signal: AbortSignal.timeout(120000),
          });

          if (resp.ok && (resp.headers.get("content-type") || "").includes("text/event-stream") && resp.body) {
            streamingStarted = true;
            broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "stream", message: "SSE stream connected" } });
            sendResponse({ success: true, streaming: true });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

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
                    broadcastToSidePanel({ type: "chat-event", event: currentEvent, data });
                  } catch {
                    broadcastToSidePanel({ type: "chat-event", event: currentEvent, data: { raw: line.slice(6) } });
                  }
                }
              }
            }
            // SSE stream ended — ensure sidepanel gets a complete event
            if (!gotCompleteEvent) {
              broadcastToSidePanel({ type: "chat-event", event: "complete", data: {
                type: "complete", content: "", model: "auto", artifacts: [],
              }});
            }
            return;
          }
        } catch (streamErr) {
          console.debug("[AitherConnect] /agent stream failed, falling back:", streamErr.message);
          // If streaming was started, tell the sidepanel it errored
          if (streamingStarted) {
            broadcastToSidePanel({ type: "chat-event", event: "error", data: {
              error: `Stream interrupted: ${streamErr.message}`,
            }});
          }
        }

        // Fallback: non-streaming /chat — broadcast pipeline traces for visibility
        broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "fallback", message: "SSE unavailable, using /chat" } });
        try {
          broadcastToSidePanel({ type: "chat-event", event: "pipeline", data: { stage: "request", message: "Sending to Genesis /chat" } });
          const resp = await fetch(`${GENESIS_URL}/chat`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(chatBody),
            signal: AbortSignal.timeout(60000),
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
        }
      })();
      return true; // ← keeps channel open for async response

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

    // ── IRC Relay — connect / send / join ────────────────────────
    case "relay-connect":
      connectToRelay(message.nick);
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
              headers: { "Content-Type": "application/json" },
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
            : `http://localhost:${SETTINGS.veilPort}/api/bridge/connect/api/ingest`;
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

    // ── Get status ──────────────────────────────────────────────
    case "get-status":
      sendResponse({
        connected: isConnected,
        status: aitherOSStatus,
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
        const veilBase = SETTINGS.remoteUrl ? VEIL_URL : `http://localhost:${SETTINGS.veilPort}`;
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
          { id: "ollama",   name: "Ollama",               url: "http://localhost:11434/api/tags" },
          { id: "vllm",     name: "vLLM",                 url: "http://localhost:3000/api/bridge/microscheduler/health" },
          { id: "portal",   name: "portal.aitherium.com", url: "https://portal.aitherium.com/api/health" },
        ];

        const results = await Promise.allSettled(
          checks.map(async (svc) => {
            try {
              const resp = await fetch(svc.url, { signal: AbortSignal.timeout(4000), headers: authHeaders() });
              let detail = "";
              if (resp.ok) {
                try {
                  const d = await resp.json();
                  detail = d.version || d.status || d.model_count || "";
                } catch { /* not JSON */ }
              }
              return { ...svc, status: resp.ok ? "up" : "error", detail: String(detail) };
            } catch {
              return { ...svc, status: "down", detail: "" };
            }
          })
        );

        const services = results.map(r => r.status === "fulfilled" ? r.value : { ...checks[0], status: "down" });
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

        // 2. If we have a token, call /auth/me
        if (token) {
          const identityUrl = SETTINGS.remoteUrl
            ? `${SETTINGS.remoteUrl}/services/identity/auth/me`
            : `http://localhost:${SETTINGS.veilPort}/api/bridge/identity/auth/me`;
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
          } catch (e) {
            console.debug("[AitherConnect] Identity service unreachable, trying local session:", e.message);
          }
        }

        // 3. NEW: Probe local Genesis for AitherShell session (~/.aither/auth.json)
        try {
          const localUrl = SETTINGS.remoteUrl
            ? `${SETTINGS.remoteUrl}/api/auth/local-session`
            : `http://localhost:${SETTINGS.veilPort}/api/bridge/genesis/auth/local-session`;
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

        sendResponse({ ok: false, error: "Not authenticated. Log in at portal.aitherium.com or run `aither login`." });
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
          setTimeout(() => { connectToGenesis(); checkHealth(); }, 500);
          sendResponse({ ok: true, applied: updates });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    // ── Connection Settings ─────────────────────────────────────────
    case "get-settings":
      sendResponse({ ok: true, settings: { ...SETTINGS } });
      break;

    case "save-settings":
      (async () => {
        try {
          await saveSettings(message.settings || {});
          // Reconnect WebSockets with new URLs
          if (genesisSocket) { genesisSocket.close(); }
          if (relaySocket) { relaySocket.close(); }
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
          const resp = await fetch(`${GENESIS_URL}/forge/dispatch/sync`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              task: message.task,
              parent_agent: "system",
              agent: message.agent || "demiurge",
              effort: message.effort || 5,
            }),
            signal: AbortSignal.timeout(300000),
          });
          const result = await resp.json();
          broadcastToSidePanel({ type: "forge-result", data: result });
          sendResponse({ success: true, data: result });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
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

    default:
      console.debug("[AitherConnect] Unknown message type:", message.type);
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }
});

// ── Offscreen Port management ──
let _offscreenPort = null;

async function getOffscreenPort() {
  if (_offscreenPort) return _offscreenPort;

  // Kill any stale offscreen doc (its port is dead anyway)
  try { await chrome.offscreen.closeDocument(); } catch {}

  // Register connect listener BEFORE creating doc to avoid race
  const portPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onConnect.removeListener(onConnect);
      reject(new Error("Offscreen document did not connect"));
    }, 5000);
    function onConnect(port) {
      if (port.name === "offscreen-audio") {
        clearTimeout(timeout);
        chrome.runtime.onConnect.removeListener(onConnect);
        _offscreenPort = port;
        port.onDisconnect.addListener(() => { _offscreenPort = null; });
        resolve(port);
      }
    }
    chrome.runtime.onConnect.addListener(onConnect);
  });

  // Now create — the offscreen JS will connect() on load
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen/offscreen.html"),
    reasons: ["USER_MEDIA"],
    justification: "Speech recognition for voice-to-text input",
  });

  return portPromise;
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
    : `http://localhost:${SETTINGS.veilPort || 3000}/api/bridge/voice/transcribe/base64`;
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
    reasons: ["USER_MEDIA"],
    justification: "Speech recognition for voice-to-text input",
  });
  await _creatingOffscreen;
  _creatingOffscreen = null;
}

// =============================================================================
// NOTIFICATION CLICK
// =============================================================================

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: VEIL_URL });
});

// =============================================================================
// FEDERATED SEARCH
// =============================================================================

async function performFederatedSearch(query, options = {}) {
  const results = [];
  const errors = [];
  const mode = options.mode || "quick"; // quick | deep

  // 1. PRIMARY — AitherSearch web search (port 8114)
  try {
    const fetchUrl = `${SEARCH_URL}/search`;
    console.log(`[AitherConnect] Search request: POST ${fetchUrl} query="${query}" mode=${mode}`);
    const rawResp = await fetch(fetchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
            icon: "🔍",
            metadata: {
              source: "aithersearch-web",
              provider: searchResp.provider,
              ...r.metadata,
            },
          });
        }
      }

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
      const nexusResp = await fetch(`${NEXUS_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: 10 }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      }).then((r) => r.json());

      if (nexusResp.results) {
        for (const r of nexusResp.results) {
          results.push({
            title: r.title || r.metadata?.title || "AitherOS Knowledge",
            snippet: r.text || r.content || "",
            url: r.url || r.metadata?.url || "",
            icon: "⚡",
            metadata: { source: "aitheros-nexus", ...r.metadata },
          });
        }
      }
    } catch (e) {
      console.debug("[AitherConnect] Nexus search error:", e.message);
    }
  }

  return { results, query, count: results.length, errors };
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
async function knowledgeIngest({ content, source, title, tags, collection, metadata }) {
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