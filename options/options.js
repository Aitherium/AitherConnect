/**
 * AitherConnect Options Page
 * ===========================
 * Loads/saves connection settings via the background worker's
 * get-settings / save-settings / reset-settings messages.
 *
 * SYNC ARCHITECTURE
 * =================
 * Fields are classified as DEVICE-LOCAL (stay on device) or PORTAL-SYNCED (sync
 * with portal.aitherium.com). On load, portal preferences are merged UNDER local
 * values (local wins ties). On save, only PORTAL-SYNCED fields are pushed to the
 * portal — DEVICE-LOCAL fields never leave the device.
 *
 * DEVICE-LOCAL (never synced):
 *   - apiKey, cloudApiKey (credentials stay on-device)
 *   - baseUrl, genesisPort, veilPort, mindPort, pulsePort, strataPort,
 *     searchPort, nexusPort, canvasPort, nodePort (per-machine ports)
 *   - autoHarvest, ragEnabled (device-specific behaviors)
 *   - remoteUrl (per-device override; cloudGatewayUrl is the portal-synced default)
 *
 * PORTAL-SYNCED (follow user across devices):
 *   - tenantId, workspaceId, userId, projectName, wikiProject (identity)
 *   - preferredTier, cloudGatewayUrl, mcpUrl, relayUrl, relayWsUrl (defaults)
 *   - workspaceKnowledge, textActionsAllSites, sitePacksEnabled (feature toggles)
 *   - Provider LLM config: providerSelect, providerModel, providerBaseUrl,
 *     providerEmbeddingModel (NOT providerApiKey — that stays local)
 */

const $ = (id) => document.getElementById(id);

let currentMode = "local";

// Last tier resolved by updateLicenseStatus(). Kept as a plain value so gesture
// handlers can gate on it WITHOUT an await — see the auto-harvest toggle.
let lastKnownTier = "free";

// Field classification for sync logic. PORTAL_SYNCED fields are merged from
// portal on load and pushed back on save. DEVICE_LOCAL fields never sync.
const FIELD_CLASSIFICATION = {
  // Identity (portal-synced — follow user to other devices/instances)
  PORTAL_SYNCED: new Set([
    'tenantId', 'workspaceId', 'userId', 'projectName', 'wikiProject',
    'preferredTier', 'cloudGatewayUrl', 'mcpUrl', 'relayUrl', 'relayWsUrl',
    'workspaceKnowledge', 'textActionsAllSites', 'sitePacksEnabled',
    // Provider config (NOT the API key — that stays local)
    'providerSelect', 'providerModel', 'providerBaseUrl', 'providerEmbeddingModel',
  ]),
  // Device-specific settings (never sync — ports, credentials, device behavior)
  DEVICE_LOCAL: new Set([
    'baseUrl', 'genesisPort', 'veilPort', 'mindPort', 'pulsePort', 'strataPort',
    'searchPort', 'nexusPort', 'canvasPort', 'remoteUrl', 'nodePort',
    'apiKey', 'cloudApiKey', 'autoHarvest', 'ragEnabled',
    'providerApiKey', // CRITICAL: API key NEVER syncs
  ]),
};

// Sync state tracking (for UI feedback)
let lastSyncTime = null;
let lastSyncError = null;

// ── Toast ──────────────────────────────────────────────────────────

function showToast(msg, type = "success", duration = 3000) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.className = "toast"; }, duration);
}

// ── Sync State UI ───────────────────────────────────────────────────

function updateSyncStatus(error = null) {
  const statusEl = $("sync-status");
  if (!statusEl) return; // Not all pages have this element

  if (error) {
    lastSyncError = error;
    lastSyncTime = null;
    statusEl.textContent = `✗ Sync failed: ${error}`;
    statusEl.style.color = "var(--error)";
    statusEl.style.display = "";
  } else {
    lastSyncError = null;
    lastSyncTime = new Date().toLocaleTimeString();
    statusEl.textContent = `✓ Synced at ${lastSyncTime}`;
    statusEl.style.color = "var(--success)";
    statusEl.style.display = "";
  }
}

// ── Portal Sync Helpers ─────────────────────────────────────────────

/**
 * Extract only the PORTAL_SYNCED fields from a settings object.
 * DEVICE_LOCAL fields and secrets are never included.
 */
function extractSyncableFields(settings) {
  const syncable = {};
  for (const field of FIELD_CLASSIFICATION.PORTAL_SYNCED) {
    if (field in settings) {
      syncable[field] = settings[field];
    }
  }
  // Map to portal schema: providerSelect → provider ID in llm config
  if (syncable.providerSelect || syncable.providerModel) {
    if (!syncable.adk) syncable.adk = {};
    if (!syncable.adk.llm) syncable.adk.llm = {};
    if (syncable.providerSelect) syncable.adk.llm.provider = syncable.providerSelect;
    if (syncable.providerModel) syncable.adk.llm.model = syncable.providerModel;
    if (syncable.providerBaseUrl) syncable.adk.llm.base_url = syncable.providerBaseUrl;
    if (syncable.providerEmbeddingModel) syncable.adk.llm.embedding_model = syncable.providerEmbeddingModel;
    // Remove the flat fields
    delete syncable.providerSelect;
    delete syncable.providerModel;
    delete syncable.providerBaseUrl;
    delete syncable.providerEmbeddingModel;
  }
  return syncable;
}

/**
 * Merge portal preferences into local settings.
 * Portal values are MERGED UNDER local values — local settings take precedence.
 * This prevents the portal from overwriting a user's device-specific config.
 */
async function mergePortalPreferences(localSettings) {
  if (!self.AitherPortal || !self.AitherPortal.getProfileSettings) {
    return localSettings; // Portal API not available
  }

  try {
    const result = await self.AitherPortal.getProfileSettings();
    if (!result.ok) {
      // Non-authenticated or service unavailable — keep local settings
      return localSettings;
    }

    const portal = result.preferences || {};
    const merged = { ...localSettings };

    // Merge portal values for PORTAL_SYNCED fields only
    for (const field of FIELD_CLASSIFICATION.PORTAL_SYNCED) {
      // Only set from portal if local value is empty (local takes precedence)
      if (field in portal && (!field in localSettings || !localSettings[field])) {
        merged[field] = portal[field];
      }
    }

    // Handle portal LLM config (map from adk.llm schema)
    if (portal.adk && portal.adk.llm && !localSettings.providerSelect) {
      merged.providerSelect = portal.adk.llm.provider;
      merged.providerModel = portal.adk.llm.model;
      merged.providerBaseUrl = portal.adk.llm.base_url;
      merged.providerEmbeddingModel = portal.adk.llm.embedding_model;
    }

    return merged;
  } catch (e) {
    console.warn("Portal merge failed (non-fatal):", e);
    return localSettings;
  }
}

/**
 * Sync portal-synced settings back to portal.
 * This is fire-and-forget but failures are surfaced in the UI.
 */
async function syncToPortal(settings) {
  if (!self.AitherPortal || !self.AitherPortal.putProfileSettings) {
    return; // Portal API not available
  }

  try {
    const syncable = extractSyncableFields(settings);
    if (Object.keys(syncable).length === 0) {
      return; // Nothing to sync
    }

    const result = await self.AitherPortal.putProfileSettings(syncable);
    if (result.ok) {
      updateSyncStatus(); // Success
    } else {
      updateSyncStatus(result.reason || 'unknown error');
    }
  } catch (e) {
    updateSyncStatus(e.message);
  }
}

// ── Mode toggle ────────────────────────────────────────────────────

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const isLocal = mode === "local";
  $("local-settings").classList.toggle("hidden", !isLocal);
  $("remote-settings").classList.toggle("hidden", isLocal);

  // Pre-fill cloud URL
  if (mode === "cloud" && !$("remoteUrl").value) {
    $("remoteUrl").value = "https://demo.aitherium.com";
  }
}

$("mode-local").addEventListener("click", () => setMode("local"));
$("mode-remote").addEventListener("click", () => setMode("remote"));
$("mode-cloud").addEventListener("click", () => setMode("cloud"));

// ── Populate form from settings ────────────────────────────────────

async function populateForm(settings) {
  // Merge portal preferences UNDER local settings (local wins ties)
  const mergedSettings = await mergePortalPreferences(settings);

  $("baseUrl").value = mergedSettings.baseUrl || "http://127.0.0.1";
  $("genesisPort").value = mergedSettings.genesisPort || 8001;
  $("veilPort").value = mergedSettings.veilPort || 3000;
  $("mindPort").value = mergedSettings.mindPort || 8088;
  $("pulsePort").value = mergedSettings.pulsePort || 8081;
  $("strataPort").value = mergedSettings.strataPort || 8136;
  $("searchPort").value = mergedSettings.searchPort || 8114;
  $("nexusPort").value = mergedSettings.nexusPort || 8122;
  $("canvasPort").value = mergedSettings.canvasPort || 8108;
  $("remoteUrl").value = mergedSettings.remoteUrl || "";
  $("apiKey").value = mergedSettings.apiKey || "";
  $("relayUrl").value = mergedSettings.relayUrl || "https://irc.aitherium.com";
  $("relayWsUrl").value = mergedSettings.relayWsUrl || "wss://irc.aitherium.com/ws/chat";
  $("tenantId").value = mergedSettings.tenantId || "";
  $("projectName").value = mergedSettings.projectName || "";
  $("wikiProject").value = mergedSettings.wikiProject || "";
  $("workspaceId").value = mergedSettings.workspaceId || "";
  $("userId").value = mergedSettings.userId || "";
  $("autoHarvest").checked = !!mergedSettings.autoHarvest;
  $("workspaceKnowledge").checked = mergedSettings.workspaceKnowledge !== false;
  $("textActionsAllSites").checked = !!mergedSettings.textActionsAllSites;
  $("ragEnabled").checked = mergedSettings.ragEnabled !== false;
  // Tier settings
  $("preferredTier").value = mergedSettings.preferredTier || "auto";
  $("nodePort").value = mergedSettings.nodePort || 8090;
  $("cloudApiKey").value = mergedSettings.cloudApiKey || "";
  $("cloudGatewayUrl").value = mergedSettings.cloudGatewayUrl || "https://gateway.aitherium.com";
  $("mcpUrl").value = mergedSettings.mcpUrl || "https://mcp.aitherium.com/mcp";
  // Hidden settings fields (preserved but not exposed in UI)
  $("themisPort").value = settings.themisPort || 8791;
  $("newswirePort").value = settings.newswirePort || 8208;
  $("relayPort").value = settings.relayPort || 8205;
  $("deepResearchPort").value = settings.deepResearchPort || 8130;
  $("mediaforgePort").value = settings.mediaforgePort || 8200;
  $("standaloneMode").value = settings.standaloneMode ? "true" : "false";
  $("sitePacksEnabled").value = settings.sitePacksEnabled ? "true" : "false";

  // Show/hide provider section based on tier
  const providerSection = $("provider-section");
  if (providerSection) {
    providerSection.classList.toggle("hidden", settings.preferredTier !== "provider");
  }

  // Load and display license status
  if (self.AitherLicense) {
    await updateLicenseStatus();
  }

  // Load KB stats
  if (self.AitherKbDb) {
    await updateKbStats();
  }

  // Determine mode
  if (settings.remoteUrl) {
    if (settings.remoteUrl.includes("aitherium.com")) {
      setMode("cloud");
    } else {
      setMode("remote");
    }
  } else {
    setMode("local");
  }
}

function readForm() {
  return {
    baseUrl: $("baseUrl").value.trim() || "http://127.0.0.1",
    genesisPort: parseInt($("genesisPort").value) || 8001,
    veilPort: parseInt($("veilPort").value) || 3000,
    mindPort: parseInt($("mindPort").value) || 8088,
    pulsePort: parseInt($("pulsePort").value) || 8081,
    strataPort: parseInt($("strataPort").value) || 8136,
    searchPort: parseInt($("searchPort").value) || 8114,
    nexusPort: parseInt($("nexusPort").value) || 8122,
    canvasPort: parseInt($("canvasPort").value) || 8108,
    remoteUrl: currentMode !== "local" ? $("remoteUrl").value.trim() : "",
    apiKey: $("apiKey").value.trim(),
    relayUrl: $("relayUrl").value.trim(),
    relayWsUrl: $("relayWsUrl").value.trim(),
    tenantId: $("tenantId").value.trim(),
    projectName: $("projectName").value.trim(),
    wikiProject: $("wikiProject").value.trim(),
    workspaceId: $("workspaceId").value.trim(),
    userId: $("userId").value.trim(),
    autoHarvest: $("autoHarvest").checked,
    workspaceKnowledge: $("workspaceKnowledge").checked,
    textActionsAllSites: $("textActionsAllSites").checked,
    ragEnabled: $("ragEnabled").checked,
    // Tier settings
    preferredTier: $("preferredTier").value || "auto",
    nodePort: parseInt($("nodePort").value) || 8090,
    cloudApiKey: $("cloudApiKey").value.trim(),
    cloudGatewayUrl: $("cloudGatewayUrl").value.trim() || "https://gateway.aitherium.com",
    mcpUrl: $("mcpUrl").value.trim() || "https://mcp.aitherium.com/mcp",
    // Hidden settings (preserved but not exposed in UI)
    themisPort: parseInt($("themisPort").value) || 8791,
    newswirePort: parseInt($("newswirePort").value) || 8208,
    relayPort: parseInt($("relayPort").value) || 8205,
    deepResearchPort: parseInt($("deepResearchPort").value) || 8130,
    mediaforgePort: parseInt($("mediaforgePort").value) || 8200,
    standaloneMode: $("standaloneMode").value === "true",
    sitePacksEnabled: $("sitePacksEnabled").value === "true",
  };
}

// ── Load ────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
    if (resp?.ok && resp.settings) {
      await populateForm(resp.settings);
    }
  } catch (e) {
    console.warn("Could not load settings:", e);
  }
}

// ── Save ────────────────────────────────────────────────────────────

$("btn-save").addEventListener("click", async () => {
  try {
    const settings = readForm();
    const resp = await chrome.runtime.sendMessage({ type: "save-settings", settings });
    if (resp?.ok) {
      showToast("Settings saved — connections reconnecting...");
      // Fire-and-forget sync to portal (failures are shown in sync-status)
      syncToPortal(settings);
      setTimeout(checkStatus, 2000);
    } else {
      showToast("Failed to save: " + (resp?.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
});

// ── Reset ───────────────────────────────────────────────────────────

$("btn-reset").addEventListener("click", async () => {
  if (!confirm("Reset all settings to defaults?")) return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "reset-settings" });
    if (resp?.ok) {
      populateForm(resp.settings);
      showToast("Settings reset to defaults");
      setTimeout(checkStatus, 2000);
    }
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
});

// ── Test Connection ─────────────────────────────────────────────────

$("btn-test").addEventListener("click", async () => {
  showToast("Testing connection...", "success", 8000);

  // Save first so background uses latest URLs
  const settings = readForm();
  await chrome.runtime.sendMessage({ type: "save-settings", settings });

  // Wait a moment for reconnect
  await new Promise((r) => setTimeout(r, 1500));

  // Check ecosystem status
  try {
    const resp = await chrome.runtime.sendMessage({ type: "get-ecosystem-status" });
    if (resp?.ok) {
      const up = resp.services.filter((s) => s.status === "up");
      if (up.length > 0) {
        showToast(`✓ Connected — ${up.length}/${resp.services.length} services online`);
        updateStatus("online", `${up.length}/${resp.services.length} services online`);
      } else {
        showToast("✗ No services reachable — check URL/ports", "error", 5000);
        updateStatus("offline", "No services reachable");
      }
    } else {
      showToast("✗ Could not check ecosystem status", "error");
    }
  } catch (e) {
    showToast("✗ Test failed: " + e.message, "error", 5000);
  }
});

// ── Status check ────────────────────────────────────────────────────

function updateStatus(status, text) {
  $("status-dot").className = `status-dot ${status}`;
  $("status-text").textContent = text;
}

async function checkStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "get-ecosystem-status" });
    if (resp?.ok) {
      const up = resp.services.filter((s) => s.status === "up");
      if (up.length > 0) {
        updateStatus("online", `Connected — ${up.length}/${resp.services.length} services`);
      } else {
        updateStatus("offline", "No services reachable");
      }
    }
  } catch {
    updateStatus("offline", "Extension service worker unreachable");
  }
}

// ── Preferred Tier Change Handler ────────────────────────────────────

$("preferredTier").addEventListener("change", () => {
  const newTier = $("preferredTier").value;
  const providerSection = $("provider-section");
  if (providerSection) {
    providerSection.classList.toggle("hidden", newTier !== "provider");
  }
  if (newTier === "provider") {
    initProviderUI();
  }
});

// ── Provider UI Initialization ───────────────────────────────────────

// On-device (WebGPU) providers need the offscreen inference host — Chrome
// only. Firefox has no chrome.offscreen, so hide local providers there.
const WEBML_SUPPORTED = typeof chrome !== "undefined" && !!chrome.offscreen;

// HF weight hosts (covers cdn-lfs* redirect hosts) — requested at save /
// download time, matching the existing optional-permission pattern.
const WEBML_HF_ORIGINS = [
  "https://huggingface.co/*",
  "https://*.huggingface.co/*",
  "https://*.hf.co/*",
];

async function initProviderUI() {
  // Populate provider dropdown
  const providerId = await self.AitherProviders.getProviderConfig();
  const providerNames = self.AitherProviders.listProviders();
  const select = $("providerSelect");

  select.innerHTML = '<option value="">Select a provider...</option>';
  providerNames.forEach((id) => {
    const def = self.AitherProviders.getProvider(id);
    if (def) {
      if (def.local && !WEBML_SUPPORTED) return; // Firefox: no offscreen host
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = def.name;
      select.appendChild(opt);
    }
  });

  // Restore saved provider
  if (providerId?.id) {
    select.value = providerId.id;
    await updateProviderUI(providerId.id);
    $("providerApiKey").value = "●●●●●●●●";
    $("providerModel").value = providerId.model || "";
    $("providerBaseUrl").value = providerId.baseUrl || "";
    $("providerEmbeddingModel").value = providerId.embeddingModel || "";
  }

  // Best-effort hydrate from portal profile settings
  try {
    if (self.AitherPortal && self.AitherPortal.getProfileSettings) {
      const settingsResult = await self.AitherPortal.getProfileSettings();
      if (settingsResult.ok && settingsResult.preferences.adk?.llm) {
        const portalLlm = settingsResult.preferences.adk.llm;
        const portalProvider = portalLlm.provider;
        const portalModel = portalLlm.model;
        const portalBaseUrl = portalLlm.base_url; // portal uses snake_case
        const portalEmbeddingModel = portalLlm.embedding_model;

        // Check if portal settings differ from local config
        const localProvider = providerId?.id;
        const localModel = providerId?.model;
        const localBaseUrl = providerId?.baseUrl;
        const localEmbedding = providerId?.embeddingModel;

        const isDifferent = portalProvider !== localProvider
          || portalModel !== localModel
          || portalBaseUrl !== localBaseUrl
          || portalEmbeddingModel !== localEmbedding;

        if (isDifferent && portalProvider) {
          // Update form fields with portal settings (but keep local apiKey)
          select.value = portalProvider;
          await updateProviderUI(portalProvider);
          $("providerModel").value = portalModel || "";
          $("providerBaseUrl").value = portalBaseUrl || "";
          $("providerEmbeddingModel").value = portalEmbeddingModel || "";
          // Keep the masked apiKey from local storage
          $("providerApiKey").value = "●●●●●●●●";
        }
      }
    }
  } catch (e) {
    // Silently ignore hydration errors; local config is the fallback
    console.warn("Portal settings hydration failed (non-fatal):", e);
  }
}

async function updateProviderUI(providerId) {
  const def = self.AitherProviders.getProvider(providerId);
  if (!def) return;

  // Update API key field visibility
  const keyField = $("provider-key-field");
  if (def.authStyle === "none") {
    keyField.classList.add("hidden");
  } else {
    keyField.classList.remove("hidden");
    $("provider-key-hint").textContent = def.keyPlaceholder || "Your API key";
  }

  // Update Get Key link
  const keyUrl = $("provider-key-url");
  if (def.keyUrl) {
    keyUrl.href = def.keyUrl;
    keyUrl.classList.remove("hidden");
  } else {
    keyUrl.classList.add("hidden");
  }

  // Update base URL hint
  const baseHint = $("provider-base-hint");
  baseHint.textContent = def.baseUrl || "Use the default provider base URL";

  // Show/hide Ollama help
  const helpBlock = $("provider-help-block");
  if (providerId === "ollama") {
    helpBlock.classList.remove("hidden");
    const extId = chrome.runtime.id;
    $("extension-id-span").textContent = extId;
    $("extension-id-span-2").textContent = extId;
  } else {
    helpBlock.classList.add("hidden");
  }

  // On-device (WebGPU) provider: no key/URL/embedding config — show the
  // model download panel and probe capabilities instead.
  const isLocal = !!def.local;
  $("provider-base-field").classList.toggle("hidden", isLocal);
  $("provider-embedding-field").classList.toggle("hidden", isLocal);
  $("btn-refresh-models").classList.toggle("hidden", isLocal);
  $("webml-panel").classList.toggle("hidden", !isLocal);
  if (isLocal) {
    refreshWebMLPanel();
  } else {
    $("btn-save-provider").disabled = false; // may have been disabled by a failed WebGPU probe
  }

  // Populate model dropdown
  await populateModelDropdown(providerId, def);
}

async function populateModelDropdown(providerId, def) {
  const select = $("providerModel");
  const customField = $("provider-custom-model-field");

  select.innerHTML = "";

  // Add static models
  if (def.models && def.models.length > 0) {
    def.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      // Local "summoning soon" slots stay visible but unselectable
      if (def.local && m.ready === false) opt.disabled = true;
      select.appendChild(opt);
    });
  }

  // Add custom option if allowed
  if (def.allowCustomModel) {
    const opt = document.createElement("option");
    opt.value = "(custom)";
    opt.textContent = "(custom…)";
    select.appendChild(opt);
  }

  if (!def.models || def.models.length === 0) {
    select.innerHTML = '<option value="">No models available — use custom</option>';
  }

  // Show custom field if selected
  select.addEventListener("change", () => {
    if (select.value === "(custom)") {
      customField.classList.remove("hidden");
      $("providerCustomModel").focus();
    } else {
      customField.classList.add("hidden");
    }
  });
}

// ── On-Device (WebGPU) panel ────────────────────────────────────────

let _webmlCaps = null;
const _webmlProgress = {}; // modelId -> { files: { name: {loaded,total} } }

function webmlSizeLabel(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
}

async function refreshWebMLPanel() {
  const capsEl = $("webml-caps");
  capsEl.textContent = "Checking WebGPU support...";

  let caps = { webgpu: false };
  try {
    const resp = await chrome.runtime.sendMessage({ type: "webml-capability" });
    if (resp?.ok && resp.caps) caps = resp.caps;
  } catch (e) {
    capsEl.textContent = `Could not probe WebGPU: ${e.message}`;
  }
  _webmlCaps = caps;

  if (caps.webgpu) {
    const extras = [caps.adapter, caps.f16 ? "f16" : null, caps.subgroups ? "subgroups" : null]
      .filter(Boolean).join(", ");
    capsEl.innerHTML = `<span style="color:var(--success);">&#9679; WebGPU available${extras ? ` — ${extras}` : ""}</span>`;
  } else {
    capsEl.innerHTML = '<span style="color:var(--error);">&#9675; WebGPU not available — requires Chrome 124+ and a supported GPU. On-device models cannot run on this machine.</span>';
  }
  $("btn-save-provider").disabled = !caps.webgpu;

  await renderWebMLModels();
}

async function renderWebMLModels() {
  const listEl = $("webml-models");
  const registry = self.AitherWebMLModels ? self.AitherWebMLModels.WEBML_MODELS : [];
  const { "webml-downloaded": downloaded } = await chrome.storage.local.get("webml-downloaded");

  listEl.innerHTML = "";
  registry.forEach((m) => {
    const isDownloaded = !!(downloaded && downloaded[m.id]);
    const row = document.createElement("div");
    row.id = `webml-row-${m.id}`;
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:6px;margin-bottom:6px;font-size:12px;";

    const badge = m.ready
      ? (isDownloaded
        ? '<span style="padding:2px 8px;border-radius:4px;background:rgba(16,185,129,0.15);color:var(--success);font-weight:600;">Downloaded</span>'
        : '<span style="padding:2px 8px;border-radius:4px;background:var(--accent-dim);color:var(--accent);font-weight:600;">Ready</span>')
      : '<span style="padding:2px 8px;border-radius:4px;background:rgba(245,158,11,0.15);color:var(--warning);font-weight:600;">Summoning soon</span>';

    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${m.label || m.id}</div>
        <div style="color:var(--text-muted);font-size:10px;">${webmlSizeLabel(m.approxDownloadMB)} &middot; ${m.blurb || ""}</div>
      </div>
      ${badge}
    `;

    if (m.ready && !isDownloaded) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.style.cssText = "font-size:11px;padding:5px 10px;flex-shrink:0;";
      btn.textContent = "Download now";
      btn.disabled = !_webmlCaps?.webgpu;
      btn.addEventListener("click", () => downloadWebMLModel(m.id, btn, row));
      row.appendChild(btn);
    }

    const prog = document.createElement("progress");
    prog.id = `webml-progress-${m.id}`;
    prog.max = 1;
    prog.value = 0;
    prog.style.cssText = "width:80px;flex-shrink:0;display:none;";
    row.appendChild(prog);

    listEl.appendChild(row);
  });
}

async function downloadWebMLModel(modelId, btn, row) {
  btn.disabled = true;
  btn.textContent = "Downloading...";
  _webmlProgress[modelId] = { files: {} };
  const prog = $(`webml-progress-${modelId}`);
  if (prog) prog.style.display = "";

  try {
    const granted = await chrome.permissions.request({ origins: WEBML_HF_ORIGINS });
    if (!granted) {
      showToast("Permission for huggingface.co denied — cannot download weights", "error");
      btn.disabled = false;
      btn.textContent = "Download now";
      if (prog) prog.style.display = "none";
      return;
    }
  } catch (e) {
    // Permission request unsupported — the fetch will surface any block
  }

  try {
    const resp = await chrome.runtime.sendMessage({ type: "webml-preload", modelId });
    if (resp?.ok) {
      showToast("Model downloaded and ready");
      await renderWebMLModels();
    } else {
      showToast("Download failed: " + (resp?.error || "unknown"), "error");
      btn.disabled = false;
      btn.textContent = "Download now";
      if (prog) prog.style.display = "none";
    }
  } catch (e) {
    showToast("Download failed: " + e.message, "error");
    btn.disabled = false;
    btn.textContent = "Download now";
    if (prog) prog.style.display = "none";
  }
}

// Live download progress from background (webml-preload relay). Aggregates
// per-file loaded/total into one bar per model.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "webml-progress" || !msg.modelId) return;
  const prog = $(`webml-progress-${msg.modelId}`);
  if (!prog) return;
  if (msg.done) {
    prog.value = 1;
    return;
  }
  const state = _webmlProgress[msg.modelId] || (_webmlProgress[msg.modelId] = { files: {} });
  if (msg.file) {
    state.files[msg.file] = { loaded: msg.loaded || 0, total: msg.total || 0 };
  }
  let loaded = 0, total = 0;
  for (const f of Object.values(state.files)) {
    loaded += f.loaded;
    total += f.total;
  }
  prog.style.display = "";
  if (total > 0) prog.value = Math.min(1, loaded / total);
});

// ── Provider Dropdown Change ────────────────────────────────────────

$("providerSelect").addEventListener("change", async () => {
  const providerId = $("providerSelect").value;
  if (!providerId) return;
  await updateProviderUI(providerId);
  $("providerApiKey").value = "";
  $("providerModel").value = "";
  $("providerBaseUrl").value = self.AitherProviders.getProvider(providerId)?.baseUrl || "";
});

// ── Refresh Models ──────────────────────────────────────────────────

$("btn-refresh-models").addEventListener("click", async () => {
  const providerId = $("providerSelect").value;
  if (!providerId) {
    showToast("Select a provider first", "error");
    return;
  }

  const apiKey = $("providerApiKey").value;
  const baseUrl = $("providerBaseUrl").value;
  const statusEl = $("model-refresh-status");

  if (self.AitherProviders.getProvider(providerId)?.local) {
    statusEl.innerHTML = '<span style="color:var(--text-muted);">On-device models come from the built-in registry</span>';
    return;
  }

  if (!apiKey) {
    statusEl.innerHTML = '<span style="color:var(--error);">✕ API key required</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color:var(--text-muted);">Fetching models...</span>';

  try {
    const req = self.AitherProviders.buildModelListRequest(providerId, {
      apiKey,
      baseUrlOverride: baseUrl,
    });

    if (!req) {
      statusEl.innerHTML = '<span style="color:var(--text-muted);">This provider does not support dynamic model listing</span>';
      return;
    }

    if (req.error) {
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${req.error}</span>`;
      return;
    }

    const resp = await fetch(req.url, { headers: req.headers });
    const json = await resp.json();
    const models = req.parseResponse(json);

    const select = $("providerModel");
    const def = self.AitherProviders.getProvider(providerId);

    select.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      select.appendChild(opt);
    });

    if (def.allowCustomModel) {
      const opt = document.createElement("option");
      opt.value = "(custom)";
      opt.textContent = "(custom…)";
      select.appendChild(opt);
    }

    statusEl.innerHTML = `<span style="color:var(--success);">✓ Loaded ${models.length} models</span>`;
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
  }
});

// ── Test Provider Key ───────────────────────────────────────────────

$("btn-test-provider").addEventListener("click", async () => {
  const providerId = $("providerSelect").value;
  if (!providerId) {
    showToast("Select a provider first", "error");
    return;
  }

  const def = self.AitherProviders.getProvider(providerId);
  const statusEl = $("provider-test-status");

  // On-device provider: "test" = WebGPU capability probe — no key, no network
  if (def?.local) {
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Probing WebGPU...</span>';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "provider-test",
        provider: { id: providerId },
      });
      if (resp?.ok) {
        statusEl.innerHTML = `<span style="color:var(--success);">✓ ${resp.result || "WebGPU available"}</span>`;
        showToast("On-device inference available", "success");
      } else {
        statusEl.innerHTML = `<span style="color:var(--error);">✕ ${resp?.error || "WebGPU unavailable"}</span>`;
      }
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
    }
    return;
  }

  const apiKey = $("providerApiKey").value;
  if (!apiKey || apiKey.includes("●")) {
    showToast("Enter your API key first", "error");
    return;
  }

  const model = $("providerModel").value === "(custom)"
    ? $("providerCustomModel").value
    : $("providerModel").value;

  if (!model) {
    showToast("Select or enter a model first", "error");
    return;
  }

  const baseUrl = $("providerBaseUrl").value;
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Testing API key...</span>';

  // Request permission for the provider origin first
  const testUrl = baseUrl || def.baseUrl;

  try {
    const origin = new URL(testUrl).origin + "/*";
    await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    // Permission request not supported or denied, continue anyway
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "provider-test",
      provider: { id: providerId, apiKey, model, baseUrl },
    });

    if (resp?.ok) {
      statusEl.innerHTML = '<span style="color:var(--success);">✓ Key is valid</span>';
      showToast("API key validated", "success");
    } else {
      const errorMsg = resp?.error || "Test failed";
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${errorMsg}</span>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
  }
});

// ── Copy Ollama Command ─────────────────────────────────────────────

$("btn-copy-ollama-cmd").addEventListener("click", () => {
  const extId = chrome.runtime.id;
  const cmd = `OLLAMA_ORIGINS=chrome-extension://${extId} ollama serve`;
  navigator.clipboard.writeText(cmd).then(() => {
    showToast("Command copied to clipboard");
  });
});

// ── Save Provider ───────────────────────────────────────────────────

$("btn-save-provider").addEventListener("click", async () => {
  const providerId = $("providerSelect").value;
  if (!providerId) {
    showToast("Select a provider first", "error");
    return;
  }

  const apiKey = $("providerApiKey").value;
  const def = self.AitherProviders.getProvider(providerId);

  if (def.authStyle !== "none" && (!apiKey || apiKey.includes("●"))) {
    showToast("Enter your API key first", "error");
    return;
  }

  const model = $("providerModel").value === "(custom)"
    ? $("providerCustomModel").value
    : $("providerModel").value;

  if (!model) {
    showToast("Select or enter a model first", "error");
    return;
  }

  const baseUrl = def.local ? "" : ($("providerBaseUrl").value || def.baseUrl);
  const embeddingModel = def.local ? "" : ($("providerEmbeddingModel").value || "");

  try {
    await self.AitherProviders.setProviderConfig({
      id: providerId,
      apiKey,
      model,
      baseUrl,
      embeddingModel,
    });

    // Request permission for the provider origin(s). The on-device provider
    // fetches weights from HF hosts instead of a chat endpoint.
    try {
      if (def.local) {
        await chrome.permissions.request({ origins: WEBML_HF_ORIGINS });
      } else {
        const origin = new URL(baseUrl).origin + "/*";
        await chrome.permissions.request({ origins: [origin] });
      }
    } catch (e) {
      // Permission not available or denied, continue
    }

    showToast("Provider configuration saved");

    // Best-effort sync to portal profile (never includes apiKey).
    // Skipped for the on-device provider — it is machine-specific.
    try {
      if (!def.local && self.AitherPortal && self.AitherPortal.putProfileSettings) {
        const syncResult = await self.AitherPortal.putProfileSettings({
          adk: {
            llm: {
              provider: providerId,
              model,
              base_url: baseUrl,           // portal uses snake_case
              embedding_model: embeddingModel,
            },
          },
        });
        if (syncResult.ok) {
          showToast("Synced to your portal profile");
        }
        // If not ok but reason is "not-authenticated", silently skip
        // (local save already succeeded; user will sync when they login)
      }
    } catch (e) {
      // Silently ignore sync errors; local save already succeeded
      console.warn("Portal sync failed (non-fatal):", e);
    }

    // If tier is provider, also save settings
    if ($("preferredTier").value === "provider") {
      const settings = readForm();
      await chrome.runtime.sendMessage({ type: "save-settings", settings });
    }
  } catch (e) {
    showToast("Error saving provider: " + e.message, "error");
  }
});

// ── License Status Update ───────────────────────────────────────────

async function updateLicenseStatus() {
  if (!self.AitherLicense) return;

  const result = await self.AitherLicense.getStoredLicense();
  lastKnownTier = result.tier || "free";
  const tierBadge = $("license-tier-badge");
  const emailDiv = $("license-email");
  const expiryDiv = $("license-expiry");

  // Set tier badge
  let tierText = result.tier || "Free";
  tierText = tierText.charAt(0).toUpperCase() + tierText.slice(1);
  if (result.grace) {
    tierText += " (Grace)";
  }
  tierBadge.textContent = tierText;
  tierBadge.style.background =
    result.tier === "pro" ? "var(--accent-dim)" :
    result.tier === "trial" ? "rgba(245, 158, 11, 0.15)" :
    "rgba(107, 114, 128, 0.2)";
  tierBadge.style.color =
    result.tier === "pro" ? "var(--accent)" :
    result.tier === "trial" ? "#f59e0b" :
    "#94a3b8";

  // Set email
  emailDiv.textContent = result.email
    ? `Email: <strong>${result.email}</strong>`
    : "";

  // Set expiry / source. A tier pulled from the authenticated subscription
  // (no local signed envelope, or envelope outranked) shows its provenance.
  if (result.source === "subscription" || result.reason === "subscription") {
    expiryDiv.textContent = "Active via your portal.aitherium.com subscription";
  } else if (result.expiresAt) {
    const date = new Date(result.expiresAt);
    expiryDiv.textContent = `Expires: ${date.toLocaleDateString()}`;
  } else {
    expiryDiv.textContent = "";
  }
}

/** Ask the background worker to pull the entitlement, then refresh the panel. */
async function refreshEntitlement() {
  try {
    await chrome.runtime.sendMessage({ type: "pull-entitlement" });
  } catch (_) {
    /* background unavailable — updateLicenseStatus still shows any cached tier */
  }
  await updateLicenseStatus();
}

// ── Activate License ────────────────────────────────────────────────

$("btn-activate-license").addEventListener("click", async () => {
  const envelope = $("licenseEnvelope").value.trim();
  if (!envelope) {
    showToast("Paste a license envelope first", "error");
    return;
  }

  const statusEl = $("license-status");
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Verifying license...</span>';

  try {
    const result = await self.AitherLicense.setLicense(envelope);
    if (result.ok || result.grace) {
      statusEl.innerHTML = '<span style="color:var(--success);">✓ License activated</span>';
      $("licenseEnvelope").value = "";
      await updateLicenseStatus();
      showToast("License activated successfully");
    } else {
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${result.reason}</span>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
  }
});

// ── Remove License ──────────────────────────────────────────────────

$("btn-remove-license").addEventListener("click", async () => {
  if (!confirm("Remove your license?")) return;

  const statusEl = $("license-status");
  try {
    await self.AitherLicense.clearLicense();
    statusEl.innerHTML = '<span style="color:var(--success);">✓ License removed</span>';
    $("licenseEnvelope").value = "";
    await updateLicenseStatus();
    showToast("License removed");
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
  }
});

// ── Start Trial ─────────────────────────────────────────────────────

$("btn-start-trial").addEventListener("click", async () => {
  const statusEl = $("trial-status");
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Starting trial...</span>';

  try {
    // Ensure install-id exists
    let { "aither-install-id": installId } = await chrome.storage.local.get("aither-install-id");
    if (!installId) {
      installId = crypto.randomUUID();
      await chrome.storage.local.set({ "aither-install-id": installId });
    }

    // POST to gateway trial endpoint
    const gateway = "https://gateway.aitherium.com";
    const resp = await fetch(`${gateway}/v1/connect/license/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install_id: installId }),
    });

    const json = await resp.json();

    if (resp.status === 429) {
      statusEl.innerHTML = '<span style="color:var(--error);">✕ Trial limit reached or already claimed</span>';
      return;
    }

    if (!resp.ok) {
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${json.error || "Could not start trial"}</span>`;
      return;
    }

    // Activate the returned license
    const result = await self.AitherLicense.setLicense(json.license_key);
    if (result.ok || result.grace) {
      statusEl.innerHTML = '<span style="color:var(--success);">✓ Trial started (14 days)</span>';
      await updateLicenseStatus();
      showToast("14-day Pro trial activated");
    } else {
      statusEl.innerHTML = `<span style="color:var(--error);">✕ ${result.reason}</span>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${e.message}</span>`;
  }
});

// ── KB Stats Update ─────────────────────────────────────────────────

async function updateKbStats() {
  if (!self.AitherKbDb) return;

  const statsLine = $("kb-stats-line");
  try {
    const stats = await self.AitherKbDb.stats();
    if (stats) {
      statsLine.textContent = `${stats.docCount} documents • ${stats.chunkCount} chunks • ${(stats.charCount / 1024).toFixed(1)}KB`;
    } else {
      statsLine.textContent = "Knowledge base empty";
    }
  } catch (e) {
    statsLine.textContent = `Error loading stats: ${e.message}`;
  }
}

// ── Open KB Manager ─────────────────────────────────────────────────

$("btn-open-kb-manager").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("kb/kb.html") });
});

// ── Text Actions All Sites Toggle ───────────────────────────────────

$("textActionsAllSites").addEventListener("change", async (evt) => {
  if (!evt.target.checked) {
    evt.target.checked = false;
    return;
  }

  // Request all-sites permission
  try {
    const granted = await chrome.permissions.request({ origins: ["*://*/*"] });
    if (granted) {
      const settings = readForm();
      await chrome.runtime.sendMessage({ type: "save-settings", settings });
      await chrome.runtime.sendMessage({ type: "sync-content-scripts" });
      showToast("Text actions enabled on all sites");
    } else {
      evt.target.checked = false;
      showToast("Permission denied", "error");
    }
  } catch (e) {
    evt.target.checked = false;
    showToast("Permission error: " + e.message, "error");
  }
});

// ── Auto-Harvest Toggle ─────────────────────────────────────────────

$("autoHarvest").addEventListener("change", async (evt) => {
  if (!evt.target.checked) {
    evt.target.checked = false;
    return;
  }

  // Gate check must be SYNCHRONOUS — it runs inside a user gesture.
  //
  // This used to `await AitherGating.checkGate()` before calling
  // chrome.permissions.request(). Any await inside a gesture handler consumes
  // the gesture token, so by the time the request was made Chrome no longer
  // considered it user-initiated and refused it — the toggle then reported the
  // generic "Permission denied", which reads as an AUTHORIZATION failure and
  // sent people hunting for a missing role. It is not: it is a Chrome gesture
  // rule, and it failed identically for the platform owner and for a brand new
  // free account. `lastKnownTier` is refreshed by updateLicenseStatus() on load
  // and after every entitlement pull, so the tier is already in hand here.
  if (self.AitherGating && !(self.AitherGating.FEATURES.auto_harvest || []).includes(lastKnownTier)) {
    evt.target.checked = false;
    showToast(self.AitherGating.upsellCopy("auto_harvest"), "error");
    return;
  }

  // Request all-sites permission — FIRST await in this handler, gesture intact.
  try {
    const granted = await chrome.permissions.request({ origins: ["*://*/*"] });
    if (granted) {
      const settings = readForm();
      await chrome.runtime.sendMessage({ type: "save-settings", settings });
      await chrome.runtime.sendMessage({ type: "sync-content-scripts" });
      showToast("Auto-capture enabled");
    } else {
      evt.target.checked = false;
      showToast("Permission denied", "error");
    }
  } catch (e) {
    evt.target.checked = false;
    showToast("Permission error: " + e.message, "error");
  }
});

// ── Init ────────────────────────────────────────────────────────────

loadSettings();
checkStatus();
// Auto-pull the authenticated subscription tier so the License panel reflects
// reality instead of defaulting to Free.
refreshEntitlement();
// ── Tunnel / Cloud Presets ───────────────────────────────────────────────

$("btn-preset-tunnel").addEventListener("click", () => {
  setMode("remote");
  $("remoteUrl").value = "https://tunnel.aitherium.com";
  $("relayUrl").value = "https://tunnel.aitherium.com/services/relay";
  $("relayWsUrl").value = "wss://tunnel.aitherium.com/ws/chat";
  showToast("Preset: tunnel.aitherium.com applied — click Save");
});

$("btn-preset-irc").addEventListener("click", () => {
  $("relayUrl").value = "https://irc.aitherium.com";
  $("relayWsUrl").value = "wss://irc.aitherium.com/ws/chat";
  showToast("IRC preset applied — click Save");
});

$("btn-preset-demo").addEventListener("click", () => {
  setMode("cloud");
  $("remoteUrl").value = "https://demo.aitherium.com";
  $("relayUrl").value = "https://demo.aitherium.com/services/relay";
  $("relayWsUrl").value = "wss://demo.aitherium.com/ws/chat";
  showToast("Preset: demo.aitherium.com applied — click Save");
});

$("btn-preset-local").addEventListener("click", () => {
  setMode("local");
  $("baseUrl").value = "http://127.0.0.1";
  $("relayUrl").value = "";
  $("relayWsUrl").value = "";
  showToast("Preset: local mode applied — click Save");
});

// ── Cloud Gateway device flow ───────────────────────────────────────
$("btn-cloud-connect")?.addEventListener("click", async () => {
  const btn = $("btn-cloud-connect");
  const statusEl = $("cloud-connect-status");
  btn.disabled = true;
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Starting device flow...</span>';

  const start = await chrome.runtime.sendMessage({ type: "cloud-device-connect" });
  if (!start?.ok) {
    statusEl.innerHTML = `<span style="color:var(--error);">✕ ${start?.error || "Could not reach gateway"}</span>`;
    btn.disabled = false;
    return;
  }

  statusEl.innerHTML = `<span style="color:var(--text-primary);">Approve in the opened tab — code: <b>${start.user_code}</b></span>`;

  const intervalMs = (start.interval || 5) * 1000;
  const deadline = Date.now() + (start.expires_in || 900) * 1000;
  const timer = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(timer);
      statusEl.innerHTML = '<span style="color:var(--error);">✕ Code expired — try again</span>';
      btn.disabled = false;
      return;
    }
    const poll = await chrome.runtime.sendMessage({
      type: "cloud-device-poll", device_code: start.device_code,
    });
    if (poll?.status === "complete") {
      clearInterval(timer);
      const settings = (await chrome.runtime.sendMessage({ type: "get-settings" }))?.settings || {};
      $("cloudApiKey").value = settings.cloudApiKey || "";
      const keyKind = poll.durable ? "durable API key" : "24h session key";
      statusEl.innerHTML = `<span style="color:var(--success);">✓ Connected as ${poll.email || "you"}${poll.tier ? ` (${poll.tier})` : ""} — ${keyKind} saved</span>`;
      showToast("Cloud Gateway connected");
      btn.disabled = false;
    } else if (poll?.status === "denied") {
      clearInterval(timer);
      statusEl.innerHTML = '<span style="color:var(--error);">✕ Request denied</span>';
      btn.disabled = false;
    } else if (!poll?.ok && poll?.error) {
      // transient poll error — keep trying until deadline
      statusEl.innerHTML = `<span style="color:var(--text-muted);">waiting... (${poll.error})</span>`;
    }
  }, intervalMs);
});

// ── Tier test ───────────────────────────────────────────────────────
$("btn-test-tiers").addEventListener("click", async () => {
  const resultsEl = $("tier-test-results");
  if (!resultsEl) return;
  resultsEl.innerHTML = '<span style="color:var(--text-muted);">Testing...</span>';

  const veilPort = parseInt($("veilPort").value) || 3000;
  const nodePort = parseInt($("nodePort").value) || 8090;
  const gateway = $("cloudGatewayUrl").value.trim() || "https://gateway.aitherium.com";
  const mcpUrl = $("mcpUrl").value.trim() || "https://mcp.aitherium.com/mcp";
  const cloudKey = $("cloudApiKey").value.trim();

  // Always 127.0.0.1, never "localhost".
  //
  // On Windows "localhost" resolves to ::1 FIRST, and every one of these
  // services publishes on 127.0.0.1 only — so the v6 attempt has to fail before
  // the v4 one is tried. That costs ~2s per connection, which against the 3s
  // budget below turned healthy services into a confident "down".
  //
  // AitherNode gets TWO probes because it has two real deployment shapes and
  // they disagree on scheme: inside this fleet it serves HTTPS with the internal
  // CA (AITHER_INTERSERVICE_TLS), which a Chrome extension CANNOT fetch — the CA
  // is not in the browser's store, which is the whole reason the Veil bridge
  // exists. Standalone `adk` / AitherNode installs serve plain HTTP. Probing
  // only the direct HTTP URL reported "down" for a node that was answering 200
  // over TLS the entire time. Try direct first, fall back to the bridge, and say
  // which path answered rather than collapsing both into one red dot.
  //
  // MCP is a remote-only endpoint (no local bridge) that requires authentication.
  // A 401 response means REACHABLE but UNAUTHENTICATED, which is distinct from
  // down/unreachable (timeout, network error).
  const probes = [
    { name: "Genesis (Veil bridge)", url: `http://127.0.0.1:${veilPort}/api/bridge/genesis/health`, tier: "genesis" },
    {
      name: "AitherNode",
      url: `http://127.0.0.1:${nodePort}/health`,
      fallbackUrl: `http://127.0.0.1:${veilPort}/api/bridge/node/health`,
      directLabel: "direct",
      fallbackLabel: "via Veil bridge (node is TLS-only here)",
      tier: "node-only",
    },
    { name: "Cloud Gateway", url: `${gateway}/health`, tier: "cloud-only" },
    { name: "MCP Gateway", url: `${mcpUrl}`, mcp: true, tier: "mcp" },
  ];

  const rows = [];
  for (const p of probes) {
    let status = "down";
    let via = "";
    try {
      const resp = await fetch(p.url, { signal: AbortSignal.timeout(3000) });
      // MCP 401 means reachable but requires authentication (not a failure)
      if (p.mcp && resp.status === 401) {
        status = "auth required";
      } else {
        status = resp.ok ? "up" : "error";
      }
      if (resp.ok && p.directLabel) via = p.directLabel;
    } catch { /* down */ }

    if (status !== "up" && status !== "auth required" && p.fallbackUrl) {
      try {
        const resp = await fetch(p.fallbackUrl, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) { status = "up"; via = p.fallbackLabel || "fallback"; }
      } catch { /* still down */ }
    }
    if (via) p.name = `${p.name} (${via})`;

    // Color code: green for "up", yellow for "auth required", red for down/error
    let color = "var(--error)";
    let icon = "○";
    if (status === "up") {
      color = "var(--success)";
      icon = "●";
    } else if (status === "auth required") {
      color = "var(--warning)";
      icon = "◐";
    }
    rows.push(`<div style="padding:3px 0;"><span style="color:${color};">${icon}</span> ${p.name} — <span style="color:${color};">${status}</span></div>`);
  }

  if (!cloudKey) {
    rows.push('<div style="padding:3px 0;color:var(--text-muted);">⚠ Cloud tier requires an API key</div>');
  }

  resultsEl.innerHTML = rows.join("");
});