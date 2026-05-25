/**
 * AitherConnect Options Page
 * ===========================
 * Loads/saves connection settings via the background worker's
 * get-settings / save-settings / reset-settings messages.
 */

const $ = (id) => document.getElementById(id);

let currentMode = "local";

// ── Toast ──────────────────────────────────────────────────────────

function showToast(msg, type = "success", duration = 3000) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.className = "toast"; }, duration);
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

function populateForm(settings) {
  $("baseUrl").value = settings.baseUrl || "http://localhost";
  $("genesisPort").value = settings.genesisPort || 8001;
  $("veilPort").value = settings.veilPort || 3000;
  $("mindPort").value = settings.mindPort || 8088;
  $("pulsePort").value = settings.pulsePort || 8081;
  $("strataPort").value = settings.strataPort || 8136;
  $("searchPort").value = settings.searchPort || 8114;
  $("nexusPort").value = settings.nexusPort || 8122;
  $("canvasPort").value = settings.canvasPort || 8108;
  $("remoteUrl").value = settings.remoteUrl || "";
  $("apiKey").value = settings.apiKey || "";
  $("relayUrl").value = settings.relayUrl || "https://irc.aitherium.com";
  $("relayWsUrl").value = settings.relayWsUrl || "wss://irc.aitherium.com/ws/chat";
  $("tenantId").value = settings.tenantId || "";
  $("projectName").value = settings.projectName || "";
  $("workspaceId").value = settings.workspaceId || "";
  $("userId").value = settings.userId || "";
  $("autoHarvest").checked = !!settings.autoHarvest;
  $("workspaceKnowledge").checked = settings.workspaceKnowledge !== false;

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
    baseUrl: $("baseUrl").value.trim() || "http://localhost",
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
    workspaceId: $("workspaceId").value.trim(),
    userId: $("userId").value.trim(),
    autoHarvest: $("autoHarvest").checked,
    workspaceKnowledge: $("workspaceKnowledge").checked,
  };
}

// ── Load ────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
    if (resp?.ok && resp.settings) {
      populateForm(resp.settings);
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

// ── Init ────────────────────────────────────────────────────────────

loadSettings();
checkStatus();
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
  $("baseUrl").value = "http://localhost";
  $("relayUrl").value = "";
  $("relayWsUrl").value = "";
  showToast("Preset: local mode applied — click Save");
});