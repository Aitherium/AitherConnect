// Vision (Roboflow) app page — opened from the Awconnect Apps grid in the
// app embed frame (extension-internal page; full chrome.runtime access).
// Lean by design: health probe + workflow test-bench. No API key is ever
// stored in the extension; workflow images are passed as URLs and fetched by
// the INFERENCE SERVER, so no extra host permissions are needed.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s); return d.innerHTML; };

  let settings = null;

  async function loadSettings() {
    if (settings) return settings;
    const stored = await chrome.storage.sync.get("visionSettings");
    settings = Object.assign(
      { serverUrl: "http://localhost:9001", workspace: "", workflowId: "asset-pipeline" },
      stored.visionSettings || {});
    return settings;
  }

  async function refreshStatus() {
    const box = $("vision-status");
    box.textContent = "Checking…";
    const s = await loadSettings();
    chrome.runtime.sendMessage({ type: "vision-status", serverUrl: s.serverUrl }, (resp) => {
      if (chrome.runtime.lastError || !resp) { box.textContent = "⚠ background unavailable"; return; }
      box.innerHTML = resp.up
        ? `🟢 Inference server up <span class="muted">(${esc(s.serverUrl)})</span>`
        : `🔴 Inference server down <span class="muted">(${esc(s.serverUrl)})</span><br>` +
          `<span class="muted">Ask your agent to run rf_setup, or start it from the console Vision tab.</span>`;
    });
  }

  async function init() {
    const s = await loadSettings();
    $("vision-server").value = s.serverUrl;
    $("vision-workspace").value = s.workspace;
    $("vision-workflow").value = s.workflowId;

    $("vision-refresh").addEventListener("click", refreshStatus);
    $("vision-save").addEventListener("click", async () => {
      const val = (id, d) => ($(id).value || "").trim() || d;
      settings = {
        serverUrl: val("vision-server", "http://localhost:9001").replace(/\/+$/, ""),
        workspace: val("vision-workspace", ""),
        workflowId: val("vision-workflow", "asset-pipeline"),
      };
      await chrome.storage.sync.set({ visionSettings: settings });
      refreshStatus();
    });
    $("vision-run").addEventListener("click", async () => {
      const out = $("vision-result");
      const imageUrl = ($("vision-image-url").value || "").trim();
      if (!imageUrl) return;
      const cfg = await loadSettings();
      if (!cfg.workspace) { out.style.display = "block";
        out.textContent = "⚠ set a workspace in Settings first"; return; }
      out.style.display = "block";
      out.textContent = "Running workflow…";
      $("vision-run").disabled = true;
      chrome.runtime.sendMessage({
        type: "vision-workflow-test", imageUrl,
        serverUrl: cfg.serverUrl, workspace: cfg.workspace, workflowId: cfg.workflowId,
      }, (resp) => {
        $("vision-run").disabled = false;
        if (chrome.runtime.lastError || !resp) { out.textContent = "⚠ background unavailable"; return; }
        out.textContent = resp.ok ? JSON.stringify(resp.outputs, null, 2)
                                  : "⚠ " + (resp.error || "workflow failed");
      });
    });
    refreshStatus();
  }

  init();
})();
