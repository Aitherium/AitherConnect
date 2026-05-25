/**
 * AitherConnect Side Panel Controller
 * =====================================
 *
 * Native extension UI — uses chrome.runtime messaging to talk to the
 * service worker, and direct fetch to AitherMind (port 8088) for
 * near-instant chat responses. No iframe, no cross-origin issues.
 *
 * Mirrors AitherExtension/sidepanel/panel.js architecture.
 */

(() => {
  "use strict";

  // ====================================================================
  // STATE
  // ====================================================================

  const state = {
    connected: false,
    baseUrl: "http://localhost",
    mindPort: 8088,
    genesisPort: 8001,
    nodePort: 8090,
    veilPort: 3000,
    standaloneMode: false,
    searchResults: [],
    events: [],
  };

  // Load connection settings from background worker (synced from chrome.storage)
  async function loadStateFromSettings() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
      if (resp?.ok && resp.settings) {
        const s = resp.settings;
        if (s.remoteUrl) {
          // Remote mode — use the remote URL as base, ports don't apply
          state.baseUrl = s.remoteUrl.replace(/\/+$/, "");
          state.mindPort = 0;    // port embedded in baseUrl
          state.genesisPort = 0;
          state.veilPort = 0;
        } else {
          // Local mode — route through Veil's bridge proxy (HTTP:3000)
          // to avoid self-signed TLS cert issues in extension context.
          const veilPort = s.veilPort || 3000;
          state.baseUrl = `http://localhost:${veilPort}/api/bridge`;
          state.mindPort = 0;    // port embedded in bridge URL
          state.genesisPort = 0;
          state.nodePort = 0;
          state.veilPort = veilPort;
          state.standaloneMode = !!s.standaloneMode;
        }
      }
    } catch (e) {
      console.debug("[Sidepanel] Could not load settings:", e);
    }
  }

  /**
   * Build a service URL. In local mode (bridge), returns
   * http://localhost:3000/api/bridge/{service}/{path}.
   * In remote mode, returns {remoteUrl}/api/{path} or {remoteUrl}/services/{service}/{path}.
   */
  function svcUrl(service, path = "") {
    const p = path.replace(/^\/+/, "");
    if (state.genesisPort === 0) {
      // Bridge or remote mode — baseUrl already includes the prefix
      if (state.baseUrl.includes("/api/bridge")) {
        // Local bridge: http://localhost:3000/api/bridge/genesis/health
        return `${state.baseUrl}/${service}${p ? "/" + p : ""}`;
      }
      // Remote mode
      if (service === "genesis") return `${state.baseUrl}/api${p ? "/" + p : ""}`;
      return `${state.baseUrl}/services/${service}${p ? "/" + p : ""}`;
    }
    // Legacy direct mode (shouldn't happen normally)
    return `${state.baseUrl}:${state.genesisPort}${p ? "/" + p : ""}`;
  }

  function veilUrl() {
    return `http://localhost:${state.veilPort}`;
  }

  // ====================================================================
  // IMAGE GENERATION QUEUE (max 2 concurrent)
  // ====================================================================

  const imgQueue = {
    MAX_CONCURRENT: 2,
    jobs: [],           // All jobs (queued, generating, completed, failed)
    active: 0,          // How many are currently generating
    nextId: 1,

    enqueue(prompt, tier, resolution, style, { tierOverride, seed } = {}) {
      const job = {
        id: imgQueue.nextId++,
        prompt,
        tier,
        resolution,
        style,
        tierOverride: tierOverride || null,  // explicit override, else Genesis decides
        seed: seed ?? null,                  // for regeneration
        usedSeed: null,                      // populated after completion
        usedTier: null,
        status: "queued",   // queued → generating → completed | failed
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        queuedAt: Date.now(),
      };
      imgQueue.jobs.unshift(job);  // newest first in the array
      renderJobCard(job);
      updateQueueStatus();
      imgQueue.pump();
      addEvent("IMG", `Queued #${job.id}: "${prompt.slice(0, 40)}…"`);
      return job;
    },

    pump() {
      // Start up to MAX_CONCURRENT jobs
      const waiting = imgQueue.jobs.filter(j => j.status === "queued");
      while (imgQueue.active < imgQueue.MAX_CONCURRENT && waiting.length > 0) {
        const job = waiting.shift();
        imgQueue.active++;
        job.status = "generating";
        job.startedAt = Date.now();
        updateJobCard(job);
        updateQueueStatus();
        imgQueue.run(job);
      }
    },

    async run(job) {
      try {
        // Advisory Canvas health check — warn but don't block
        // Genesis may route image gen through other backends (DALL-E, etc.)
        let canvasOnline = true;
        try {
          const healthResp = await fetch(svcUrl("canvas", "health"), {
            signal: AbortSignal.timeout(3000),
          });
          canvasOnline = healthResp.ok;
        } catch {
          canvasOnline = false;
        }
        if (!canvasOnline) {
          addEvent("IMG", `Warning: Canvas/ComfyUI offline — Genesis may use cloud fallback`);
        }

        // Route through Genesis /chat — full orchestration pipeline
        // Send raw prompt; Genesis intent classifier detects image intent
        const imagePrompt = job.prompt.match(/\b(draw|create|generate|paint|design|make|render)\b/i)
          ? `${job.prompt}${job.style ? ` (style: ${job.style})` : ""}`
          : `create an image of: ${job.prompt}${job.style ? ` (style: ${job.style})` : ""}`;

        // Pass tier/seed/resolution as top-level context fields + intent hint
        const ctx = {
          source: "browser-extension",
          resolution: job.resolution,
          intent_hint: "image_generation",
        };
        if (job.tierOverride) ctx.tier = job.tierOverride;
        if (job.seed != null) ctx.seed = job.seed;

        const resp = await fetch(`${svcUrl("genesis", "chat")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: imagePrompt, context: ctx }),
          signal: AbortSignal.timeout(180_000),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => resp.statusText);
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }

        const data = await resp.json();
        // Genesis ChatResponse: artifacts contain base64 image data + metadata
        const artifacts = (data.artifacts?.length ? data.artifacts : data.metadata?.artifacts) || [];
        const images = artifacts
          .filter(a => a.type === "image")
          .map(a => a.base64)
          .filter(Boolean);

        if (images.length === 0) {
          // Check for structured error from Canvas
          const genError = data.metadata?.image_gen_error || data.response || "";
          if (genError.toLowerCase().includes("comfyui") || genError.toLowerCase().includes("canvas")) {
            throw new Error(`Canvas error: ${genError.slice(0, 150)}`);
          }
          throw new Error(genError || "No image returned — model may be busy");
        }

        // Store seed/tier from response for regeneration
        const firstArt = artifacts.find(a => a.type === "image") || {};
        job.usedSeed = firstArt.seed ?? data.metadata?.image_seed;
        job.usedTier = firstArt.tier ?? data.metadata?.image_tier ?? "auto";

        job.status = "completed";
        job.completedAt = Date.now();
        job.result = { images };
        addEvent("IMG", `✓ #${job.id} [${job.usedTier}] done in ${((job.completedAt - job.startedAt) / 1000).toFixed(1)}s`);
      } catch (e) {
        job.status = "failed";
        job.completedAt = Date.now();
        job.error = e.message;
        addEvent("IMG", `✗ #${job.id} failed: ${e.message.slice(0, 60)}`);
      } finally {
        imgQueue.active--;
        updateJobCard(job);
        updateQueueStatus();
        imgQueue.pump();  // kick next queued job
      }
    },
  };

  function updateQueueStatus() {
    const queued = imgQueue.jobs.filter(j => j.status === "queued").length;
    const active = imgQueue.active;
    const dot = $("img-qs-dot");
    const txt = $("img-qs-text");

    if (active > 0) {
      dot.classList.add("active");
      txt.textContent = `Generating ${active}/2` +
        (queued > 0 ? ` · ${queued} queued` : "") +
        ` · ${imgQueue.jobs.filter(j => j.status === "completed").length} done`;
    } else if (queued > 0) {
      dot.classList.remove("active");
      txt.textContent = `${queued} queued`;
    } else {
      dot.classList.remove("active");
      const done = imgQueue.jobs.filter(j => j.status === "completed").length;
      txt.textContent = done > 0 ? `Queue idle — ${done} completed` : "Queue idle — 0 jobs";
    }
  }

  function renderJobCard(job) {
    const container = $("img-results");
    const card = document.createElement("div");
    card.className = `img-job ${job.status} fade-in`;
    card.id = `img-job-${job.id}`;
    card.innerHTML = jobCardHTML(job);
    wireJobCardActions(card, job);
    container.prepend(card);  // newest on top
  }

  function updateJobCard(job) {
    const card = $(`img-job-${job.id}`);
    if (!card) return;
    card.className = `img-job ${job.status}`;
    card.innerHTML = jobCardHTML(job);
    wireJobCardActions(card, job);
  }

  function wireJobCardActions(card, job) {
    card.querySelectorAll('[data-action="delete-job"]').forEach(btn => {
      btn.addEventListener('click', () => {
        imgQueue.jobs = imgQueue.jobs.filter(j => j.id !== job.id);
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => card.remove(), 200);
        updateQueueStatus();
        addEvent('IMG', `Deleted #${job.id}`);
      });
    });
    card.querySelectorAll('[data-action="download-img"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.imgIdx) || 0;
        const b64 = job.result?.images?.[idx];
        if (!b64) return;
        downloadBase64Image(b64, `aither-img-${job.id}-${idx + 1}.png`);
        addEvent('IMG', `Downloaded #${job.id} image ${idx + 1}`);
      });
    });
    card.querySelectorAll('[data-action="regen-hd"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextTier = _TIER_UP[job.usedTier];
        if (!nextTier || job.usedSeed == null) return;
        imgQueue.enqueue(job.prompt, nextTier, job.resolution, job.style, {
          tierOverride: nextTier,
          seed: job.usedSeed,
        });
        addEvent('IMG', `Regen #${job.id} → ${nextTier} (seed ${job.usedSeed})`);
      });
    });
  }

  function downloadBase64Image(b64, filename) {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${b64}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Tier upgrade chain for regeneration
  const _TIER_UP = { lightning: "turbo", turbo: "quality", quality: "ultra" };

  function jobCardHTML(job) {
    const elapsed = job.completedAt && job.startedAt
      ? ((job.completedAt - job.startedAt) / 1000).toFixed(1) + "s"
      : job.startedAt
        ? "…"
        : "";

    // Tier badge
    const tierBadge = job.usedTier
      ? `<span class="job-tier" title="Generated at ${job.usedTier} tier">${job.usedTier}</span>`
      : "";

    let body = "";
    if (job.status === "generating") {
      body = `<div class="job-progress"><div class="job-progress-bar"></div></div>`;
    } else if (job.status === "completed" && job.result?.images?.length) {
      body = job.result.images
        .map((b64, idx) => `<img src="data:image/png;base64,${b64}" alt="${escapeHtml(job.prompt)}" loading="lazy" data-img-idx="${idx}" />`)
        .join("");
    } else if (job.status === "failed") {
      body = `<div class="job-error">${escapeHtml(job.error)}</div>`;
    }

    // Build action bar
    let actionsHtml = "";
    if (job.status === "completed" && job.result?.images?.length) {
      const downloadBtns = job.result.images
        .map((_, idx) => `<button class="img-action-btn download" data-action="download-img" data-job-id="${job.id}" data-img-idx="${idx}" title="Download image ${idx + 1}">⬇ Save${job.result.images.length > 1 ? " #" + (idx + 1) : ""}</button>`)
        .join("");
      // Regenerate HD button — same seed, next tier up
      const nextTier = _TIER_UP[job.usedTier];
      const regenBtn = nextTier && job.usedSeed != null
        ? `<button class="img-action-btn regen" data-action="regen-hd" data-job-id="${job.id}" title="Regenerate same seed at ${nextTier} tier">↑ ${nextTier}</button>`
        : "";
      actionsHtml = `<div class="img-job-actions">${downloadBtns}${regenBtn}<button class="img-action-btn delete" data-action="delete-job" data-job-id="${job.id}" title="Delete image">✕ Delete</button></div>`;
    } else if (job.status === "failed" || job.status === "queued") {
      actionsHtml = `<div class="img-job-actions"><button class="img-action-btn delete" data-action="delete-job" data-job-id="${job.id}" title="Remove">✕ Remove</button></div>`;
    }

    return `
      <div class="img-job-header">
        <span class="job-status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        ${tierBadge}
        <span class="job-prompt" title="${escapeHtml(job.prompt)}">${escapeHtml(job.prompt)}</span>
        <span class="job-time">${elapsed}</span>
      </div>
      ${body ? `<div class="img-job-body">${body}</div>` : ""}
      ${actionsHtml}
    `;
  }

  // ====================================================================
  // DOM
  // ====================================================================

  const $ = (id) => document.getElementById(id);
  const statusDot = $("status-dot");
  const workspaceBadge = $("workspace-badge");
  const navTabs = $("nav-tabs");
  const chatMessages = $("chat-messages");
  const chatInput = $("chat-input");
  const chatSend = $("chat-send");

  // ── Chat history persistence ──────────────────────────────────────
  const CHAT_STORAGE_KEY = "aitherconnect_chat_history";
  const CHAT_MAX_MESSAGES = 200;

  function saveChatHistory() {
    const msgs = [];
    chatMessages.querySelectorAll(".chat-msg").forEach(div => {
      const role = div.classList.contains("user") ? "user"
        : div.classList.contains("assistant") ? "assistant" : "system";
      // Clone and strip action buttons before serializing
      const clone = div.cloneNode(true);
      const actions = clone.querySelector(".msg-actions");
      if (actions) actions.remove();
      msgs.push({ role, html: clone.innerHTML });
    });
    // Keep only the last N messages
    const trimmed = msgs.slice(-CHAT_MAX_MESSAGES);
    chrome.storage.local.set({ [CHAT_STORAGE_KEY]: trimmed });
  }

  let _restoring = false;
  async function restoreChatHistory() {
    try {
      const data = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
      const msgs = data[CHAT_STORAGE_KEY];
      if (!Array.isArray(msgs) || msgs.length === 0) return;
      _restoring = true;
      for (const msg of msgs) {
        // Sanitize stored HTML to prevent stored XSS: strip script tags and event handlers
        const sanitized = msg.html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "");
        appendMsg(msg.role, sanitized, true);
      }
      _restoring = false;
    } catch (e) {
      _restoring = false;
      console.debug("[Sidepanel] Could not restore chat history:", e);
    }
  }
  const themisScanBtn = $("themis-scan-btn");
  const themisQuickBtn = $("themis-quick-btn");
  const themisScanStatus = $("themis-scan-status");
  const shieldScanBtn = $("shield-scan-btn");
  const shieldQuickBtn = $("shield-quick-btn");
  const searchInput = $("search-input");
  const searchBtn = $("search-btn");
  const searchStatus = $("search-status");
  const searchResults = $("search-results");
  const eventsLog = $("events-log");

  // ====================================================================
  // NAVIGATION
  // ====================================================================

  navTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".nav-tab");
    if (!tab) return;
    const panel = tab.dataset.panel;

    navTabs.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    $(`panel-${panel}`).classList.add("active");
  });

  // ====================================================================
  // CONNECTION CHECK — delegates to background service worker
  // ====================================================================

  async function checkConnection() {
    try {
      // Ask the background worker which does multi-endpoint checks
      const resp = await chrome.runtime.sendMessage({ type: 'get-status' });
      if (resp && (resp.status === 'online' || resp.status === 'degraded' || resp.connected)) {
        state.connected = true;
        statusDot.className = "topbar-status connected";
        statusDot.title = resp.status === 'degraded'
          ? "AitherOS (degraded — some services slow)"
          : "Connected to AitherOS";
        addEvent("CONN", `AitherOS ${resp.status} (WS: ${resp.connected ? 'yes' : 'no'})`);
        return true;
      }
    } catch { /* service worker not ready */ }

    // Fallback: try direct fetch to Genesis, Pulse via bridge proxy
    const fallbacks = [
      `${svcUrl("genesis", "health")}`,   // Genesis — if this is up, chat WILL work
      `${svcUrl("pulse", "health")}`,     // Pulse
    ];
    for (const url of fallbacks) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          state.connected = true;
          statusDot.className = "topbar-status connected";
          statusDot.title = "Connected to AitherOS (via fallback)";
          addEvent("CONN", "Connected via fallback service");
          return true;
        }
      } catch { /* try next */ }
    }

    state.connected = false;
    statusDot.className = "topbar-status";
    statusDot.title = "Disconnected";
    return false;
  }

  // ====================================================================
  // WORKSPACE / TENANT / ENDPOINT STATUS
  // ====================================================================

  async function loadWorkspaceContext() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
      const s = resp?.settings || {};
      const parts = [];
      if (s.tenantId) parts.push(s.tenantId);
      if (s.workspaceId && s.workspaceId !== s.tenantId) parts.push(s.workspaceId);
      if (parts.length) {
        // Show user-friendly label
        const label = s.userId ? `${s.userId} @ ${parts.join("/")}` : parts.join(" / ");
        workspaceBadge.textContent = label;
        workspaceBadge.className = "topbar-context active";
        workspaceBadge.title = `User: ${s.userId || "—"}\nTenant: ${s.tenantId || "—"}\nWorkspace: ${s.workspaceId || "—"}\nProject: ${s.projectName || "—"}`;
      } else {
        workspaceBadge.textContent = "no workspace";
        workspaceBadge.className = "topbar-context";
        workspaceBadge.title = "Configure tenant/workspace in extension options";
      }
    } catch { /* settings not available */ }
  }

  async function checkEndpointStatus() {
    const endpoints = [
      { name: "Genesis", url: svcUrl("genesis", "health") },
      { name: "Node", url: svcUrl("node", "health") },
      { name: "LyraWiki", url: svcUrl("lyra-wiki", "health") },
      { name: "portal.aitherium.com", url: "https://portal.aitherium.com/api/health" },
    ];
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep.url, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          addEvent("SVC", `${ep.name}: UP`);
        } else {
          addEvent("SVC", `${ep.name}: ${resp.status}`);
        }
      } catch {
        addEvent("SVC", `${ep.name}: DOWN`);
      }
    }
  }

  // ====================================================================
  // CHAT — Direct to AitherMind (near-instant)
  // ====================================================================

  // ====================================================================
  // IMAGE UPLOAD STATE
  // ====================================================================
  const pendingImages = [];
  const chatAttach = $("chat-attach");
  const chatFileInput = $("chat-file-input");
  const chatImagePreview = $("chat-image-preview");
  const chatContextBtn = $("chat-context-btn");
  let pageContextActive = true;  // Default ON — extension should see what user browses

  function addImageFile(file) {
    if (!file.type.startsWith("image/") || pendingImages.length >= 4) return;
    if (file.size > 10 * 1024 * 1024) return; // 10MB limit
    const reader = new FileReader();
    reader.onload = () => {
      pendingImages.push(reader.result);
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreview() {
    if (pendingImages.length === 0) {
      chatImagePreview.style.display = "none";
      return;
    }
    chatImagePreview.style.display = "flex";
    chatImagePreview.innerHTML = pendingImages.map((img, i) =>
      `<div style="position:relative; flex-shrink:0;">
        <img src="${img}" style="height:48px; width:48px; object-fit:cover; border-radius:6px; border:1px solid var(--border);" />
        <button data-remove="${i}" style="position:absolute; top:-4px; right:-4px; width:16px; height:16px; background:var(--bg-primary); border:1px solid var(--border); border-radius:50%; color:var(--text-muted); font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">✕</button>
      </div>`
    ).join("");
    chatImagePreview.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingImages.splice(parseInt(btn.dataset.remove), 1);
        renderImagePreview();
      });
    });
  }

  chatAttach.addEventListener("click", () => chatFileInput.click());
  chatFileInput.addEventListener("change", (e) => {
    Array.from(e.target.files).forEach(addImageFile);
    e.target.value = "";
  });

  // Paste images
  chatInput.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        addImageFile(item.getAsFile());
      }
    }
  });

  // Page context toggle — default ON, sync button visual on load
  chatContextBtn.style.color = "var(--accent)";
  chatContextBtn.style.borderColor = "var(--accent)";
  chatContextBtn.title = "Page context ON — will include current page content";
  chatContextBtn.addEventListener("click", async () => {
    pageContextActive = !pageContextActive;
    chatContextBtn.style.color = pageContextActive ? "var(--accent)" : "var(--text-muted)";
    chatContextBtn.style.borderColor = pageContextActive ? "var(--accent)" : "var(--border)";
    chatContextBtn.title = pageContextActive ? "Page context ON — will include current page content" : "Include page context";
  });

  async function getPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          url: document.location.href,
          title: document.title,
          text: document.body?.innerText?.slice(0, 3000) || "",
        }),
      });
      return result?.result || null;
    } catch { return null; }
  }

  // ── Streaming chat state ──
  let _streamingMsgEl = null;   // The assistant bubble being streamed into
  let _streamingContent = "";   // Accumulated content for current stream
  let _streamingWatchdog = null; // Timeout to catch stalled streams
  let _lastStreamEvent = 0;     // Timestamp of last received stream event
  let _traceLines = [];         // Pipeline trace lines for current generation

  function _addTrace(tagClass, tag, msg) {
    _traceLines.push({ tagClass, tag, msg });
    if (!_streamingMsgEl) return;
    const logEl = _streamingMsgEl.querySelector("#trace-log");
    if (!logEl) return;
    const line = document.createElement("div");
    line.className = "trace-line";
    line.innerHTML = `<span class="trace-tag ${escapeHtml(tagClass)}">[${escapeHtml(tag)}]</span> ${escapeHtml(msg)}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  const STREAM_TIMEOUT_MS = 60000; // 60s without any event = stalled

  function _resetStreamWatchdog() {
    _lastStreamEvent = Date.now();
    clearTimeout(_streamingWatchdog);
    _streamingWatchdog = setTimeout(() => {
      if (_streamingMsgEl) {
        _finishStreamingMsg("", []);
        appendMsg("system", "Response timed out — AitherOS may be processing a complex request. Try again or check if services are running.");
      }
    }, STREAM_TIMEOUT_MS);
  }

  function _clearStreamWatchdog() {
    clearTimeout(_streamingWatchdog);
    _streamingWatchdog = null;
  }

  async function sendChat(message) {
    if (!message.trim() && pendingImages.length === 0) return;

    // Abort if already streaming — prevent state corruption
    if (_streamingMsgEl) return;

    // Parse @agent routing (e.g. "@hydra review this code")
    let agentTarget = null;
    let cleanMessage = message;
    const agentMatch = message.match(/^@(\w+)\s+([\s\S]+)/);
    if (agentMatch) {
      agentTarget = agentMatch[1];
      cleanMessage = agentMatch[2];
    }

    // Show user images in chat
    const imageHtml = pendingImages.length > 0
      ? `<div style="display:flex; gap:4px; margin-bottom:4px;">${pendingImages.map(img =>
          `<img src="${img}" style="max-height:80px; max-width:100px; border-radius:6px; border:1px solid var(--border); object-fit:contain;" />`
        ).join("")}</div>`
      : "";
    appendMsg("user", imageHtml + escapeHtml(message), true);

    const images = [...pendingImages];
    pendingImages.length = 0;
    renderImagePreview();
    chatInput.value = "";
    chatInput.style.height = "auto";
    chatSend.disabled = true;

    if (!state.connected) {
      appendMsg("system", "Not connected to AitherOS. Checking...");
      await checkConnection();
      if (!state.connected) {
        appendMsg("system", "AitherOS is offline. Start it with: docker compose -f docker-compose.aitheros.yml up -d");
        chatSend.disabled = false;
        return;
      }
    }

    // Get page context if active
    let pageContext = null;
    if (pageContextActive) {
      pageContext = await getPageContext();
    }

    // Show trace log immediately (AitherShell parity)
    _streamingContent = "";
    _traceLines = [];
    const traceHTML = `<div class="trace-header"><span class="trace-spinner"></span>Processing</div><div class="trace-log" id="trace-log"></div>`;
    _streamingMsgEl = appendMsg("assistant", traceHTML, true);
    _resetStreamWatchdog();

    // Route through background.js service worker (single chat implementation)
    try {
      const preferCloud = localStorage.getItem('prefer_cloud_model') || null;
      const resp = await chrome.runtime.sendMessage({
        type: "chat",
        text: cleanMessage || "What do you see in this image?",
        context: {
          source: "browser-extension",
          search_results: state.searchResults.slice(0, 5),
          ...(pageContext ? { page: pageContext } : {}),
        },
        ...(images.length > 0 ? { attachments: images } : {}),
        ...(agentTarget ? { agent: agentTarget } : {}),
        ...(preferCloud ? { prefer_cloud_model: preferCloud } : {}),
      });

      if (resp?.streaming) {
        // Response will arrive via chat-event broadcasts
        // Keep send button disabled until stream completes
        return;
      }

      // Non-streaming fallback response (came back directly)
      _clearStreamWatchdog();
      if (resp?.success) {
        const content = resp.response || resp.message || resp.reply || "";
        _finishStreamingMsg(content, (resp.artifacts?.length ? resp.artifacts : resp.metadata?.artifacts) || []);
      } else {
        _finishStreamingMsg("", []);
        appendMsg("system", resp?.error || "Chat failed — no response from Genesis.");
      }
    } catch (e) {
      _clearStreamWatchdog();
      _finishStreamingMsg("", []);
      appendMsg("system", `Chat error: ${e.message}`);
    }
  }

  function _finishStreamingMsg(content, artifacts) {
    _clearStreamWatchdog();
    if (_streamingMsgEl) {
      if (content && content.trim()) {
        // Re-render with full markdown via appendMsg — replace the streaming bubble
        _streamingMsgEl.remove();
        _streamingMsgEl = null;
        appendMsg("assistant", content);
        speakSonia(content);
      } else {
        _streamingMsgEl.remove();
      }
    }
    _streamingMsgEl = null;
    _streamingContent = "";

    // Deduplicate and render artifacts
    if (artifacts && artifacts.length > 0) {
      const _seen = new Set();
      const deduped = artifacts.filter(a => {
        const key = a.name || a.url || a.path || JSON.stringify(a);
        if (_seen.has(key)) return false;
        _seen.add(key);
        return true;
      });
      if (deduped.length > 0) {
        appendMsg("assistant", renderArtifacts(deduped), true);
      }
    }
    chatSend.disabled = false;
  }

  // ── Artifact rendering (parity with AitherVeil/Aeon) ────────────
  function renderArtifacts(artifacts) {
    if (!artifacts || artifacts.length === 0) return "";
    const cards = artifacts.map(art => {
      const type = art.type || _inferArtifactType(art);
      switch (type) {
        case "image":
          return _renderImageArtifact(art);
        case "code_output":
          return _renderCodeOutput(art);
        case "preview":
          return _renderPreview(art);
        default:
          return _renderFileArtifact(art);
      }
    }).filter(Boolean);
    if (cards.length === 0) return "";
    return `<div class="artifact-tray">${cards.join("")}</div>`;
  }

  function _inferArtifactType(art) {
    if (art.base64 || (art.mime || "").startsWith("image/")) return "image";
    if (art.stdout != null || art.exit_code != null) return "code_output";
    if (art.preview_url || art.direct_url) return "preview";
    const ext = (art.name || art.path || "").split(".").pop()?.toLowerCase();
    if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return "image";
    return "file";
  }

  function _renderImageArtifact(art) {
    const src = art.base64
      ? `data:${art.mime || "image/png"};base64,${art.base64}`
      : _resolveArtifactUrl(art.url || "");
    if (!src) return "";
    const meta = [];
    if (art.tier) meta.push(art.tier);
    if (art.seed != null) meta.push(`seed:${art.seed}`);
    const metaLine = meta.length > 0
      ? `<div class="art-meta">${escapeHtml(meta.join(" · "))}</div>` : "";
    return `<div class="art-card art-image">
      <img src="${src}" alt="${escapeHtml(art.name || "image")}" loading="lazy" />
      ${metaLine}
      <div class="art-actions">
        ${art.name ? `<span class="art-name">${escapeHtml(art.name)}</span>` : ""}
        <a class="art-dl" href="${src}" download="${escapeHtml(art.name || "image.png")}" title="Download">⬇</a>
      </div>
    </div>`;
  }

  function _renderCodeOutput(art) {
    const exitOk = art.exit_code === 0;
    const badge = art.exit_code != null
      ? `<span class="art-exit ${exitOk ? "ok" : "err"}">exit ${art.exit_code}</span>` : "";
    let body = "";
    if (art.stdout) body += `<pre class="art-stdout">${escapeHtml(art.stdout)}</pre>`;
    if (art.stderr) body += `<pre class="art-stderr">${escapeHtml(art.stderr)}</pre>`;
    if (!body && art.output) body = `<pre class="art-stdout">${escapeHtml(art.output)}</pre>`;
    return `<div class="art-card art-code-output">
      <div class="art-header">Execution Output ${badge}</div>
      ${body}
    </div>`;
  }

  function _renderPreview(art) {
    const url = art.preview_url || art.direct_url || art.url;
    if (!url) return "";
    return `<div class="art-card art-preview">
      <div class="art-header">Preview <a href="${url}" target="_blank" rel="noopener" style="color:var(--accent);">open ↗</a></div>
      <iframe src="${url}" sandbox="allow-scripts allow-same-origin" loading="lazy" style="width:100%;height:200px;border:none;border-radius:4px;"></iframe>
    </div>`;
  }

  function _resolveArtifactUrl(relativeUrl) {
    if (!relativeUrl) return "";
    // Already absolute — return as-is
    if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://") || relativeUrl.startsWith("data:")) {
      return relativeUrl;
    }
    // Resolve relative URLs against Genesis (extension can't use relative paths)
    const base = svcUrl("genesis");
    return `${base}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
  }

  function _renderFileArtifact(art) {
    const name = art.name || art.path?.split("/").pop() || "file";
    const rawUrl = art.url || (art.path ? `/api/files?path=${encodeURIComponent(art.path)}` : "");
    const url = _resolveArtifactUrl(rawUrl);
    const mime = art.mime || "";
    const icon = mime.includes("pdf") ? "📄"
      : mime.includes("spreadsheet") || mime.includes("xlsx") ? "📊"
      : mime.includes("presentation") || mime.includes("pptx") ? "📽"
      : mime.includes("document") || mime.includes("docx") ? "📝"
      : mime.includes("audio") ? "🎵"
      : mime.includes("video") ? "🎬"
      : "📎";
    return `<div class="art-card art-file">
      <span class="art-icon">${icon}</span>
      <span class="art-name">${escapeHtml(name)}</span>
      ${url ? `<a class="art-dl" href="${url}" download="${escapeHtml(name)}" title="Download">⬇</a>` : ""}
    </div>`;
  }

  function appendMsg(role, content, rawHtml = false) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role} fade-in`;

    let html;
    if (rawHtml) {
      html = content;
    } else {
      html = escapeHtml(content);
      // Markdown rendering — order matters (block elements first, then inline)
      // Images (block javascript:/data: protocols)
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        if (/^(javascript|data|vbscript|blob):/i.test(url.trim())) return escapeHtml(`![${alt}](${url})`);
        return `<img src="${url}" alt="${alt}" style="max-height:200px; border-radius:8px; border:1px solid var(--border); margin:4px 0;" />`;
      });
      // Fenced code blocks (with optional language tag)
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre${lang ? ` data-lang="${lang}"` : ""}>${code.trim()}</pre>`);
      // Blockquotes (lines starting with >)
      html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
      // Headers (h1-h4)
      html = html.replace(/^####\s+(.+)$/gm, '<h4 style="margin:8px 0 4px;font-size:0.85em;">$1</h4>');
      html = html.replace(/^###\s+(.+)$/gm, '<h3 style="margin:8px 0 4px;font-size:0.9em;">$1</h3>');
      html = html.replace(/^##\s+(.+)$/gm, '<h2 style="margin:10px 0 4px;font-size:0.95em;">$1</h2>');
      html = html.replace(/^#\s+(.+)$/gm, '<h1 style="margin:10px 0 4px;font-size:1.05em;">$1</h1>');
      // Horizontal rules
      html = html.replace(/^---$/gm, '<hr style="border:0;border-top:1px solid var(--border);margin:8px 0;">');
      // Unordered lists (- or * at line start)
      html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin-left:16px;list-style:disc;">$1</li>');
      // Ordered lists (1. 2. etc.)
      html = html.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-left:16px;list-style:decimal;">$1</li>');
      // Inline code (must come before bold/italic to avoid conflicts)
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
      // Links [text](url) — block dangerous protocols
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        if (/^(javascript|data|vbscript|blob):/i.test(url.trim())) return escapeHtml(`[${text}](${url})`);
        return `<a href="${url}" target="_blank" rel="noopener" style="color:var(--accent);">${text}</a>`;
      });
      // Bold + italic
      html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
      // Bold
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      // Italic
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      // Line breaks — convert double newlines to paragraph breaks
      html = html.replace(/\n\n/g, '<br><br>');
      html = html.replace(/\n/g, '<br>');
    }

    // Add action buttons (delete + save-to-KB for assistant messages)
    const kbBtn = role === "assistant" ? `<button class="msg-action-btn" title="Save to Knowledge Base" data-action="save-kb">🧠</button>` : "";
    const actions = `<div class="msg-actions">${kbBtn}<button class="msg-action-btn" title="Delete message" data-action="delete-msg">✕</button></div>`;
    div.innerHTML = html + actions;

    div.querySelector('[data-action="delete-msg"]').addEventListener('click', (e) => {
      e.stopPropagation();
      div.style.transition = 'opacity 0.2s, transform 0.2s';
      div.style.opacity = '0';
      div.style.transform = 'translateX(20px)';
      setTimeout(() => { div.remove(); saveChatHistory(); }, 200);
    });

    // Save to Knowledge Base button
    const kbBtnEl = div.querySelector('[data-action="save-kb"]');
    if (kbBtnEl) {
      kbBtnEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        kbBtnEl.textContent = '⏳';
        kbBtnEl.disabled = true;
        try {
          const textContent = div.textContent.replace(/[\u2715\u23f3\ud83e\udde0\u2713]/g, "").trim();
          const resp = await chrome.runtime.sendMessage({
            type: "knowledge-ingest",
            content: textContent,
            source: "aither-connect-chat",
            title: "Chat conversation extract",
            tags: ["chat", "sidepanel", "browser-extension"],
            collection: "conversations",
          });
          if (resp?.success) {
            kbBtnEl.textContent = '✓';
            const d = resp.data || {};
            const stages = [d.memory && "memory", d.document && "docs", d.nexus && "nexus", d.strata && "strata", d.workspace && "workspace", d.lyra && "lyra"].filter(Boolean);
            kbBtnEl.title = `Saved: ${stages.join(", ") || "queued"}`;
            kbBtnEl.style.color = '#22c55e';
            addEvent("KB", `Ingested → ${stages.join(", ") || "queued"}`);
          } else {
            kbBtnEl.textContent = '⚠';
            kbBtnEl.title = resp?.error || 'Save failed';
            kbBtnEl.style.color = '#f59e0b';
          }
        } catch (err) {
          kbBtnEl.textContent = '⚠';
          kbBtnEl.title = 'AitherOS offline';
          kbBtnEl.style.color = '#ef4444';
        }
        setTimeout(() => { kbBtnEl.disabled = false; }, 2000);
      });
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (!_restoring) saveChatHistory();
    return div;
  }

  chatSend.addEventListener("click", () => sendChat(chatInput.value));
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat(chatInput.value);
    }
  });

  // ====================================================================
  // VOICE — Sonia TTS + browser STT
  // ====================================================================

  const voiceState = { enabled: true, speaking: false, currentAudio: null, presynth: null, presynthText: null };
  const micBtn = $("chat-mic-btn");
  const voiceToggle = $("chat-voice-toggle");
  const voiceDownloadBtn = $("chat-voice-download");

  function getVoiceUrl() {
    // AitherVoice is at /voice on perception-media (port 8084)
    return svcUrl("voice", "synthesize").replace(/\/synthesize$/, "");
  }

  function setVoiceToggleUI() {
    voiceToggle.textContent = voiceState.enabled ? "🔊" : "🔇";
    voiceToggle.title = voiceState.enabled ? "Voice readout ON (click to mute)" : "Voice readout OFF (click to enable Sonia)";
    voiceToggle.style.color = voiceState.enabled ? "var(--accent, #7c6af7)" : "var(--text-muted)";
  }

  voiceToggle.addEventListener("click", () => {
    voiceState.enabled = !voiceState.enabled;
    if (!voiceState.enabled && voiceState.currentAudio) {
      voiceState.currentAudio.pause();
      voiceState.currentAudio = null;
      voiceState.speaking = false;
    }
    setVoiceToggleUI();
  });

  if (voiceDownloadBtn) {
    voiceDownloadBtn.addEventListener("click", () => downloadLastAudio());
  }
  setVoiceToggleUI(); // Initialize toggle UI on load

  // ── TTS Pre-synthesis (Voice Neuron) ──
  // Fires synthesis as soon as final_answer arrives so audio is ready instantly.
  // The result is cached in voiceState.presynth as { text, blobUrl, blob, promise }.

  function cleanTextForTTS(text) {
    return text.replace(/[*_~`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 1000);
  }

  async function fetchSoniaTTS(clean) {
    const res = await fetch(`${getVoiceUrl()}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, return_base64: true, format: "mp3", speed: 1.5 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.audio_base64) throw new Error("no audio");
    const bytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const blobUrl = URL.createObjectURL(blob);
    return { blob, blobUrl };
  }

  /** Kick off pre-synthesis in the background. Called on final_answer event. */
  function presynthTTS(text) {
    const clean = cleanTextForTTS(text);
    if (!clean) return;
    // Don't re-synth if we already have this text queued
    if (voiceState.presynthText === clean && voiceState.presynth) return;
    voiceState.presynthText = clean;
    voiceState.presynth = fetchSoniaTTS(clean).catch(e => {
      console.warn("[AitherConnect] Pre-synth failed:", e);
      return null;
    });
  }

  // Speak text via Sonia backend with browser fallback
  async function speakSonia(text) {
    if (!voiceState.enabled) return;
    if (voiceState.currentAudio) { voiceState.currentAudio.pause(); }

    const clean = cleanTextForTTS(text);
    if (!clean) return;

    try {
      let result = null;
      // Use pre-synthesized audio if it matches
      if (voiceState.presynth && voiceState.presynthText === clean) {
        result = await voiceState.presynth;
        voiceState.presynth = null;
        voiceState.presynthText = null;
      }
      // Otherwise synthesize now
      if (!result) {
        result = await fetchSoniaTTS(clean);
      }

      const audio = new Audio(result.blobUrl);
      voiceState.currentAudio = audio;
      voiceState.speaking = true;
      // Store blob for download and show download button
      voiceState.lastAudioBlob = result.blob;
      voiceState.lastAudioUrl = result.blobUrl;
      if (voiceDownloadBtn) voiceDownloadBtn.style.display = "";
      audio.onended = audio.onerror = () => {
        voiceState.speaking = false;
        voiceState.currentAudio = null;
        // Don't revoke — keep for download. Old URLs cleaned on next synthesis.
      };
      audio.play();
    } catch (e) {
      console.warn("[AitherConnect] Sonia TTS failed, using browser fallback:", e);
      if ("speechSynthesis" in window) {
        const utt = new SpeechSynthesisUtterance(clean);
        const voices = speechSynthesis.getVoices();
        const sonia = voices.find(v => /sonia/i.test(v.name))
          || voices.find(v => /female.*en.GB|en.GB.*female|hazel|libby|maisie/i.test(v.name))
          || voices.find(v => v.lang === "en-GB")
          || voices.find(v => v.lang.startsWith("en") && /female|zira|samantha/i.test(v.name));
        if (sonia) utt.voice = sonia;
        speechSynthesis.speak(utt);
      }
    }
  }

  /** Download the last spoken audio as an MP3 file. */
  function downloadLastAudio() {
    if (!voiceState.lastAudioBlob) {
      appendMsg("system", "No audio to download. Send a message with voice enabled first.");
      return;
    }
    const a = document.createElement("a");
    a.href = voiceState.lastAudioUrl || URL.createObjectURL(voiceState.lastAudioBlob);
    a.download = `sonia-${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── STT — Speech-to-Text ──────────────────────────────────────────
  // Offscreen doc records audio (getUserMedia + MediaRecorder).
  // Background.js transcribes via bridge → AitherVoice (Whisper).

  let _sttActive = false;

  micBtn.addEventListener("click", () => {
    if (_sttActive) {
      // Stop recording → transcribe
      _sttActive = false;
      micBtn.textContent = "\u23F3";
      chatInput.placeholder = "Transcribing...";
      chrome.runtime.sendMessage({ type: "stt-stop" }, (resp) => {
        if (resp?.ok && resp.text?.trim()) {
          chatInput.value = resp.text.trim();
          sendChat(resp.text.trim());
        } else if (resp?.error) {
          appendMsg("system", "STT failed: " + resp.error);
        } else {
          appendMsg("system", "Could not transcribe. Try speaking louder.");
        }
        micBtn.textContent = "\uD83C\uDFA4";
        micBtn.style.color = "";
        chatInput.placeholder = "Ask AitherOS...";
      });
      return;
    }

    // Start recording via offscreen document
    _sttActive = true;
    micBtn.textContent = "\uD83D\uDD34";
    micBtn.style.color = "#e55";
    chatInput.placeholder = "Recording... click mic to stop";
    console.log("[AitherConnect] Mic clicked — starting STT via offscreen");
    chrome.runtime.sendMessage({ type: "stt-start" }, (resp) => {
      if (!resp?.ok) {
        appendMsg("system", "Mic failed: " + (resp?.error || "unknown"));
        _sttActive = false;
        micBtn.textContent = "\uD83C\uDFA4";
        micBtn.style.color = "";
        chatInput.placeholder = "Ask AitherOS...";
      }
    });
  });

  // speakSonia is called directly in sendChat after assistant messages are appended.
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // ====================================================================
  // THEMIS — Consumer Advocacy Page Scanner
  // ====================================================================

  let themisScanInProgress = false;

  /**
   * Full Themis scan: extracts page context, sends to Themis backend,
   * renders structured insight cards live in the chat.
   */
  async function scanPageWithThemis() {
    if (themisScanInProgress) return;
    themisScanInProgress = true;
    themisScanBtn.disabled = true;
    themisScanBtn.innerHTML = '<span class="spinner"></span> Scanning…';
    themisScanStatus.textContent = "Extracting page data…";

    appendMsg("system", "⚖️ Themis scanning current page for consumer advocacy issues…");
    addEvent("THEMIS", "Full page scan started");

    try {
      const resp = await chrome.runtime.sendMessage({ type: "themis-analyze-page" });

      if (!resp?.success) {
        appendMsg("system", `⚖️ Themis scan failed: ${resp?.error || "Unknown error"}`);
        themisScanStatus.textContent = "Scan failed";
        addEvent("THEMIS", `Scan failed: ${resp?.error}`);
        return;
      }

      const analysis = resp.analysis;
      renderThemisResults(analysis);
      addEvent("THEMIS", `Scan done: ${analysis.overall_assessment} (${analysis.insights?.length || 0} insights)`);
      themisScanStatus.textContent = `${analysis.overall_assessment} — ${analysis.severity_score}/100`;
    } catch (e) {
      appendMsg("system", `⚖️ Themis error: ${e.message}`);
      themisScanStatus.textContent = "Error";
      addEvent("THEMIS", `Error: ${e.message}`);
    } finally {
      themisScanInProgress = false;
      themisScanBtn.disabled = false;
      themisScanBtn.innerHTML = "⚖️ Scan Page";
    }
  }

  /**
   * Quick scan: client-side only, extracts consumer signals from the page
   * without hitting the Themis backend. Instant results.
   */
  async function quickScanPage() {
    if (themisScanInProgress) return;
    themisScanInProgress = true;
    themisQuickBtn.disabled = true;
    themisQuickBtn.innerHTML = '<span class="spinner"></span> Scanning…';
    themisScanStatus.textContent = "Quick scan…";

    try {
      const resp = await chrome.runtime.sendMessage({ type: "themis-quick-scan" });

      if (!resp?.success) {
        appendMsg("system", `🔍 Quick scan failed: ${resp?.error || "No signals found"}`);
        themisScanStatus.textContent = "";
        return;
      }

      const signals = resp.signals;
      const url = resp.url || "";
      const title = resp.title || "";
      const issueCount = (signals.dark_patterns?.length || 0) +
        (signals.hidden_fees?.length || 0) +
        (signals.tracking?.length || 0) +
        (signals.cookie_consent ? 1 : 0);

      if (issueCount === 0 && !signals.prices?.length && !signals.page_type) {
        appendMsg("system", `🔍 Quick scan of "${title.slice(0, 40)}": No consumer issues detected ✅`);
        themisScanStatus.textContent = "Clean ✓";
        addEvent("THEMIS", `Quick scan: clean (${title.slice(0, 30)})`);
        return;
      }

      // Render quick results in chat
      appendMsg("system", `🔍 Quick scan of "${title.slice(0, 40)}" — ${issueCount} issue${issueCount !== 1 ? "s" : ""} found`);

      if (signals.dark_patterns?.length) {
        const card = createThemisCard({
          category: "dark_patterns",
          icon: "🕳️",
          title: `${signals.dark_patterns.length} Dark Pattern${signals.dark_patterns.length > 1 ? "s" : ""}`,
          severity: signals.dark_patterns.length >= 3 ? "high" : "medium",
          details: signals.dark_patterns.map(dp => ({
            type: dp.type?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            description: dp.text || "Deceptive UI pattern",
          })),
          recommendation: "This page uses manipulative design. Proceed with caution.",
        });
        chatMessages.appendChild(card);
      }

      if (signals.hidden_fees?.length) {
        const card = createThemisCard({
          category: "pricing",
          icon: "💰",
          title: `${signals.hidden_fees.length} Hidden Fee${signals.hidden_fees.length > 1 ? "s" : ""}`,
          severity: "high",
          details: signals.hidden_fees.map(f => ({ issue: f.context || f.text })),
          recommendation: "Check the final price carefully before committing.",
        });
        chatMessages.appendChild(card);
      }

      if (signals.tracking?.length) {
        const card = createThemisCard({
          category: "privacy",
          icon: "👁️",
          title: `${signals.tracking.length} Tracker${signals.tracking.length > 1 ? "s" : ""} Detected`,
          severity: signals.tracking.length >= 5 ? "high" : "medium",
          details: signals.tracking.map(t => ({ issue: t.type || t.src })),
          recommendation: "Consider using a privacy extension to block trackers.",
        });
        chatMessages.appendChild(card);
      }

      if (signals.cookie_consent?.reject_difficulty === "hard") {
        const card = createThemisCard({
          category: "privacy",
          icon: "🍪",
          title: "Cookie Consent Dark Pattern",
          severity: "medium",
          details: [{ issue: signals.cookie_consent.note || "Reject option missing or hidden" }],
          recommendation: "The cookie banner makes it hard to reject tracking — a common dark pattern.",
        });
        chatMessages.appendChild(card);
      }

      if (signals.prices?.length) {
        appendMsg("system", `💲 Found ${signals.prices.length} price elements (${signals.page_type || "general"} page)`);
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;
      themisScanStatus.textContent = `${issueCount} issue${issueCount !== 1 ? "s" : ""}`;
      addEvent("THEMIS", `Quick scan: ${issueCount} issues (${title.slice(0, 30)})`);
    } catch (e) {
      appendMsg("system", `🔍 Quick scan error: ${e.message}`);
      themisScanStatus.textContent = "";
    } finally {
      themisScanInProgress = false;
      themisQuickBtn.disabled = false;
      themisQuickBtn.innerHTML = "🔍 Quick";
    }
  }

  /**
   * Render full Themis analysis results as structured cards in the chat.
   */
  function renderThemisResults(analysis) {
    // Overall assessment banner
    const overallText = {
      safe: "✅ Page appears safe — no significant consumer issues detected",
      mild_concern: "ℹ️ Minor concerns detected — review details below",
      caution: "⚠️ Caution — multiple consumer concerns found",
      dangerous: "🚨 High risk — significant dark patterns and consumer issues detected",
    };

    const overall = document.createElement("div");
    overall.className = `themis-overall ${analysis.overall_assessment} fade-in`;
    overall.innerHTML = `
      <span>⚖️</span>
      <span>${overallText[analysis.overall_assessment] || "Analysis complete"}</span>
      <span style="margin-left: auto; font-size: 10px; opacity: 0.7;">Score: ${analysis.severity_score}/100</span>
    `;
    chatMessages.appendChild(overall);

    // Render each insight as a card
    for (const insight of (analysis.insights || [])) {
      const card = createThemisCard(insight);
      chatMessages.appendChild(card);
    }

    // LLM analysis (if available)
    if (analysis.llm_analysis) {
      const llmDiv = document.createElement("div");
      llmDiv.className = "themis-llm-analysis fade-in";
      llmDiv.innerHTML = `<strong>⚖️ Themis Advisory:</strong> ${escapeHtml(analysis.llm_analysis)}`;
      chatMessages.appendChild(llmDiv);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /**
   * Create a Themis insight card element.
   */
  function createThemisCard(insight) {
    const severity = insight.severity || "medium";
    const card = document.createElement("div");
    card.className = `themis-insight-card severity-${severity} fade-in`;

    let detailsHtml = "";
    if (insight.details?.length) {
      detailsHtml = insight.details.map(d => {
        if (d.type) {
          return `<div class="themis-detail-row">
            <span class="detail-type">${escapeHtml(d.type)}</span>
            <span>${escapeHtml(d.description || "")}</span>
          </div>`;
        }
        if (d.issue) {
          return `<div class="themis-detail-row">
            <span>• ${escapeHtml(d.issue)}</span>
          </div>`;
        }
        if (d.clause) {
          return `<div class="themis-detail-row">
            <span class="detail-type">📜</span>
            <span>${escapeHtml(d.clause)}</span>
          </div>`;
        }
        if (d.title) {
          return `<div class="themis-detail-row">
            <span class="detail-type">📰</span>
            <span>${escapeHtml(d.title)}${d.source ? ` (${escapeHtml(d.source)})` : ""}</span>
          </div>`;
        }
        return "";
      }).join("");
    }

    card.innerHTML = `
      <div class="themis-card-header">
        <span>${insight.icon || "⚖️"}</span>
        <span>${escapeHtml(insight.title || "Insight")}</span>
        <span class="themis-severity ${severity}">${severity}</span>
      </div>
      ${detailsHtml ? `<div class="themis-card-body">${detailsHtml}</div>` : ""}
      ${insight.recommendation ? `<div class="themis-recommendation">${escapeHtml(insight.recommendation)}</div>` : ""}
    `;

    return card;
  }

  // Themis button event listeners
  themisScanBtn.addEventListener("click", scanPageWithThemis);
  themisQuickBtn.addEventListener("click", quickScanPage);

  // ====================================================================
  // AITHERSHIELD — Security Threat Scanner (Sentry + Bastion + Sentinel)
  // ====================================================================

  let shieldScanInProgress = false;

  /**
   * Full Shield scan: extracts security signals, sends to Themis /security-scan
   * which aggregates Bastion, Sentry, and Sentinel results. Renders threat
   * cards live in the chat.
   */
  async function scanPageWithShield() {
    if (shieldScanInProgress) return;
    shieldScanInProgress = true;
    shieldScanBtn.disabled = true;
    shieldScanBtn.innerHTML = '<span class="spinner"></span> Scanning…';
    themisScanStatus.textContent = "Security scan…";

    appendMsg("system", "🛡️ AitherShield scanning page for security threats…");
    addEvent("SHIELD", "Full security scan started");

    try {
      const resp = await chrome.runtime.sendMessage({ type: "shield-scan-page" });

      if (!resp?.success) {
        appendMsg("system", `🛡️ Shield scan failed: ${resp?.error || "Unknown error"}`);
        themisScanStatus.textContent = "Scan failed";
        addEvent("SHIELD", `Scan failed: ${resp?.error}`);
        return;
      }

      const analysis = resp.analysis;
      renderShieldResults(analysis);
      addEvent("SHIELD", `Scan done: ${analysis.overall_assessment} (risk=${analysis.risk_score}/100, ${analysis.insights?.length || 0} findings)`);
      themisScanStatus.textContent = `🛡️ ${analysis.overall_assessment} — ${analysis.risk_score}/100`;
    } catch (e) {
      appendMsg("system", `🛡️ Shield error: ${e.message}`);
      themisScanStatus.textContent = "Error";
      addEvent("SHIELD", `Error: ${e.message}`);
    } finally {
      shieldScanInProgress = false;
      shieldScanBtn.disabled = false;
      shieldScanBtn.innerHTML = "🛡️ Shield";
    }
  }

  /**
   * Quick Shield scan: client-side only, extracts security signals from the
   * page without hitting any backend. Instant results for crypto miners,
   * phishing indicators, malicious ads, suspicious scripts.
   */
  async function quickShieldScan() {
    if (shieldScanInProgress) return;
    shieldScanInProgress = true;
    shieldQuickBtn.disabled = true;
    shieldQuickBtn.innerHTML = '<span class="spinner"></span> Scanning…';
    themisScanStatus.textContent = "Quick security scan…";

    try {
      const resp = await chrome.runtime.sendMessage({ type: "shield-quick-scan" });

      if (!resp?.success) {
        appendMsg("system", `⚡ Quick security scan failed: ${resp?.error || "No data"}`);
        themisScanStatus.textContent = "";
        return;
      }

      const signals = resp.signals;
      const url = resp.url || "";
      const title = resp.title || "";
      const threats = signals.threats || [];
      const riskScore = signals.risk_score || 0;
      const threatLevel = signals.threat_level || "safe";
      const posture = signals.security_posture || {};

      if (threats.length === 0 && threatLevel === "safe") {
        appendMsg("system", `⚡ Quick security scan of "${title.slice(0, 40)}": No threats detected ✅`);
        themisScanStatus.textContent = "🛡️ Safe ✓";
        addEvent("SHIELD", `Quick scan: safe (${title.slice(0, 30)})`);
        return;
      }

      // Overall banner
      const overallEl = document.createElement("div");
      const overallClass = riskScore >= 60 ? "dangerous" : riskScore >= 35 ? "warning" : riskScore >= 15 ? "caution" : "safe";
      overallEl.className = `shield-overall ${overallClass} fade-in`;
      overallEl.innerHTML = `
        <span>🛡️</span>
        <span>${_shieldOverallText(overallClass)}</span>
        <span style="margin-left: auto; font-size: 10px; opacity: 0.7;">Risk: ${riskScore}/100</span>
      `;
      chatMessages.appendChild(overallEl);

      // Render each threat as a card
      const threatGroups = {};
      for (const t of threats) {
        const ttype = t.type || "unknown";
        if (!threatGroups[ttype]) threatGroups[ttype] = [];
        threatGroups[ttype].push(t);
      }

      const iconMap = {
        cryptominer: "⛏️", hidden_iframe: "🪟", malicious_ad: "📢",
        phishing: "🎣", suspicious_script: "🔴", download_risk: "⬇️",
      };
      const titleMap = {
        cryptominer: "Crypto Miner", hidden_iframe: "Hidden iFrame",
        malicious_ad: "Malicious Ad", phishing: "Phishing Indicator",
        suspicious_script: "Suspicious Script", download_risk: "Download Risk",
      };

      for (const [ttype, items] of Object.entries(threatGroups)) {
        const maxSev = items.reduce((max, t) => {
          const order = { critical: 4, high: 3, medium: 2, low: 1 };
          return Math.max(max, order[t.severity] || 1);
        }, 1);
        const sevName = { 4: "critical", 3: "high", 2: "medium", 1: "low" }[maxSev] || "medium";

        const card = createShieldCard({
          icon: iconMap[ttype] || "🛡️",
          title: `${titleMap[ttype] || ttype.replace(/_/g, " ")} (${items.length})`,
          severity: sevName,
          details: items.map(t => ({ issue: t.detail || "Detected" })).slice(0, 5),
          recommendation: _quickShieldRec(ttype),
        });
        chatMessages.appendChild(card);
      }

      // Security posture card
      const postureIssues = [];
      if (!posture.https) postureIssues.push({ issue: "⚠️ Not served over HTTPS" });
      if (!posture.csp) postureIssues.push({ issue: "No Content-Security-Policy" });
      if (posture.hidden_iframes > 0) postureIssues.push({ issue: `${posture.hidden_iframes} hidden iframe(s)` });
      if (posture.unknown_external_scripts > 3) postureIssues.push({ issue: `${posture.unknown_external_scripts} unknown external scripts` });

      if (postureIssues.length > 0) {
        const postureCard = createShieldCard({
          icon: "🏛️",
          title: "Page Security Posture",
          severity: !posture.https ? "high" : "medium",
          details: postureIssues,
          recommendation: "Improve page security headers and reduce unknown script sources.",
        });
        chatMessages.appendChild(postureCard);
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;
      themisScanStatus.textContent = `🛡️ ${threatLevel} (${threats.length} threat${threats.length !== 1 ? "s" : ""})`;
      addEvent("SHIELD", `Quick scan: ${threatLevel}, ${threats.length} threats (${title.slice(0, 30)})`);
    } catch (e) {
      appendMsg("system", `⚡ Quick security scan error: ${e.message}`);
      themisScanStatus.textContent = "";
    } finally {
      shieldScanInProgress = false;
      shieldQuickBtn.disabled = false;
      shieldQuickBtn.innerHTML = "⚡ Quick";
    }
  }

  /**
   * Render full Shield analysis results (from backend) as structured cards.
   */
  function renderShieldResults(analysis) {
    const overallText = {
      safe: "✅ No security threats detected — page appears safe",
      caution: "ℹ️ Minor security concerns — review details below",
      warning: "⚠️ Security threats detected — proceed with caution",
      dangerous: "🚨 Critical threats found — this page may be dangerous",
    };

    const overall = document.createElement("div");
    overall.className = `shield-overall ${analysis.overall_assessment} fade-in`;
    overall.innerHTML = `
      <span>🛡️</span>
      <span>${overallText[analysis.overall_assessment] || "Security scan complete"}</span>
      <span style="margin-left: auto; font-size: 10px; opacity: 0.7;">Risk: ${analysis.risk_score}/100</span>
    `;
    chatMessages.appendChild(overall);

    // Render each insight as a card
    for (const insight of (analysis.insights || [])) {
      const card = createShieldCard(insight);
      chatMessages.appendChild(card);
    }

    // Backend status summary
    const backends = analysis.backend_results || {};
    const backendSummary = [];
    if (backends.bastion?.status === "unavailable") backendSummary.push("Bastion offline");
    if (backends.sentry?.status === "unavailable") backendSummary.push("Sentry offline");
    if (backends.sentinel?.status === "unavailable") backendSummary.push("Sentinel offline");

    if (backendSummary.length > 0) {
      appendMsg("system", `🛡️ Note: ${backendSummary.join(", ")} — results based on client-side detection only`);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /**
   * Create a Shield security insight card element.
   */
  function createShieldCard(insight) {
    const severity = insight.severity || "medium";
    const card = document.createElement("div");
    card.className = `shield-insight-card severity-${severity} fade-in`;

    let detailsHtml = "";
    if (insight.details?.length) {
      detailsHtml = insight.details.map(d => {
        if (d.issue) {
          return `<div class="shield-detail-row"><span>• ${escapeHtml(d.issue)}</span></div>`;
        }
        return "";
      }).join("");
    }

    card.innerHTML = `
      <div class="shield-card-header">
        <span>${insight.icon || "🛡️"}</span>
        <span>${escapeHtml(insight.title || "Security Finding")}</span>
        <span class="shield-severity ${severity}">${severity}</span>
      </div>
      ${detailsHtml ? `<div class="shield-card-body">${detailsHtml}</div>` : ""}
      ${insight.recommendation ? `<div class="shield-recommendation">${escapeHtml(insight.recommendation)}</div>` : ""}
    `;

    return card;
  }

  function _shieldOverallText(level) {
    return {
      safe: "No security threats detected — page appears safe ✅",
      caution: "Minor security concerns — review details below",
      warning: "Security threats detected — proceed with caution ⚠️",
      dangerous: "Critical threats found — this page may be dangerous 🚨",
    }[level] || "Security scan complete";
  }

  function _quickShieldRec(threatType) {
    return {
      cryptominer: "This page is mining cryptocurrency using your device. Leave or block the script.",
      hidden_iframe: "Hidden iframes may load malicious content or track you without consent.",
      malicious_ad: "Known malicious ad network detected. Consider using an ad blocker.",
      phishing: "This page shows phishing indicators. Do NOT enter credentials.",
      suspicious_script: "Potentially malicious JavaScript detected on this page.",
      download_risk: "Executable download links found. Only download from trusted sources.",
    }[threatType] || "Exercise caution on this page.";
  }

  // Shield button event listeners
  shieldScanBtn.addEventListener("click", scanPageWithShield);
  shieldQuickBtn.addEventListener("click", quickShieldScan);

  // ====================================================================
  // FEDERATED SEARCH
  // ====================================================================

  async function performSearch(query, mode = "quick") {
    if (!query.trim()) return;

    searchBtn.disabled = true;
    searchStatus.textContent = "Searching the web via AitherSearch...";
    searchResults.innerHTML = "";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "federated-search",
        query,
        options: { mode },
      });

      const results = response?.results || [];
      const searchErrors = response?.errors || [];
      state.searchResults = results;

      if (results.length === 0) {
        if (searchErrors.length) {
          searchStatus.textContent = searchErrors[0];
        } else {
          searchStatus.textContent = `No results for "${query}"`;
        }
        return;
      }

      const suffix = searchErrors.length ? ` (${searchErrors[0]})` : "";
      searchStatus.textContent = `${results.length} results found${suffix}`;
      renderResults(results);
      addEvent("SRCH", `"${query}" → ${results.length} results`);
    } catch (e) {
      searchStatus.textContent = `Search service unavailable: ${e.message}`;
    } finally {
      searchBtn.disabled = false;
    }
  }

  function safeHostname(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function renderResults(results) {
    searchResults.innerHTML = results
      .map(
        (r, i) => `
      <div class="result-card fade-in" data-index="${i}" style="animation-delay: ${i * 30}ms">
        <div class="result-title">${r.icon || "📄"} ${escapeHtml(r.title)}</div>
        ${r.snippet ? `<div class="result-snippet">${escapeHtml(r.snippet).slice(0, 300)}</div>` : ""}
        <div class="result-meta">
          <span class="result-source">${r.metadata?.source || "unknown"}</span>
          ${r.url ? `<span class="result-url" title="${escapeHtml(r.url)}">${escapeHtml(safeHostname(r.url))}</span>` : ""}
        </div>
      </div>
    `
      )
      .join("");

    searchResults.querySelectorAll(".result-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.dataset.index);
        const result = state.searchResults[idx];
        if (result?.url) chrome.tabs.create({ url: result.url });
      });
    });
  }

  searchBtn.addEventListener("click", () => {
    const mode = $("search-mode")?.value || "quick";
    performSearch(searchInput.value, mode);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const mode = $("search-mode")?.value || "quick";
      performSearch(searchInput.value, mode);
    }
  });

  // ====================================================================
  // IMAGE GENERATION — DOM wiring
  // ====================================================================

  const imgPrompt = $("img-prompt");
  const imgEnqueue = $("img-enqueue");

  imgEnqueue.addEventListener("click", () => {
    const prompt = imgPrompt.value.trim();
    if (!prompt) return;
    const tier = $("img-tier").value;
    const res = $("img-res").value;
    const style = $("img-style").value;
    // "auto" = let Genesis decide from prompt effort; anything else = explicit override
    const opts = tier !== "auto" ? { tierOverride: tier } : {};
    imgQueue.enqueue(prompt, tier, res, style, opts);
    imgPrompt.value = "";
    imgPrompt.style.height = "auto";
  });

  imgPrompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      imgEnqueue.click();
    }
  });

  imgPrompt.addEventListener("input", () => {
    imgPrompt.style.height = "auto";
    imgPrompt.style.height = Math.min(imgPrompt.scrollHeight, 80) + "px";
  });

  // ====================================================================
  // IRC RELAY — AitherRelay integration
  // ====================================================================

  const ircState = {
    connected: false,
    nick: null,
    activeChannel: "#general",
    channels: [
      { name: "#general", topic: "General chat", mode: "public" },
      { name: "#dev", topic: "Development", mode: "public" },
      { name: "#random", topic: "Off-topic", mode: "public" },
      { name: "#support", topic: "Get help", mode: "public" },
      { name: "#agents", topic: "Agent-only", mode: "agent-only" },
    ],
    messages: {},   // { "#general": [...], ... }
    unread: {},     // { "#general": 0, ... }
  };

  const ircNickEntry = $("irc-nick-entry");
  const ircChatUI = $("irc-chat-ui");
  const ircNickInput = $("irc-nick-input");
  const ircConnectBtn = $("irc-connect-btn");
  const ircStatusDot = $("irc-status-dot");
  const ircChannelsEl = $("irc-channels");
  const ircUsersCount = $("irc-users-count");
  const ircChName = $("irc-ch-name");
  const ircChTopic = $("irc-ch-topic");
  const ircMessages = $("irc-messages");
  const ircInput = $("irc-input");
  const ircSendBtn = $("irc-send-btn");

  // Enable/disable connect button based on nick input
  ircNickInput.addEventListener("input", () => {
    ircConnectBtn.disabled = !ircNickInput.value.trim();
  });

  ircNickInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && ircNickInput.value.trim()) ircDoConnect();
  });

  ircConnectBtn.addEventListener("click", ircDoConnect);

  function ircDoConnect() {
    const nick = ircNickInput.value.trim().replace(/\s/g, "").slice(0, 20);
    if (!nick) return;
    ircState.nick = nick;

    // Tell background to connect the Relay WS
    chrome.runtime.sendMessage({ type: "relay-connect", nick });

    // Switch to chat UI immediately (optimistic)
    ircNickEntry.style.display = "none";
    ircChatUI.style.display = "flex";
    ircInput.placeholder = `Message ${ircState.activeChannel}...`;
    ircRenderChannels();
    ircInput.focus();
    addEvent("IRC", `Connecting as ${nick}...`);
  }

  // Send IRC message
  ircSendBtn.addEventListener("click", ircSendMessage);
  ircInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ircSendMessage();
  });

  function ircSendMessage() {
    const text = ircInput.value.trim();
    if (!text || !ircState.connected) return;

    if (text.startsWith("/")) {
      const parts = text.split(" ");
      const cmd = parts[0].toLowerCase();
      if (cmd === "/join" && parts[1]) {
        chrome.runtime.sendMessage({ type: "relay-send", data: { type: "command", command: text } });
        ircState.activeChannel = parts[1];
        ircSwitchChannel(parts[1]);
      } else {
        chrome.runtime.sendMessage({ type: "relay-send", data: { type: "command", command: text } });
      }
    } else {
      chrome.runtime.sendMessage({
        type: "relay-send",
        data: { type: "message", channel: ircState.activeChannel, content: text },
      });
    }
    ircInput.value = "";
    ircInput.focus();
  }

  function ircSwitchChannel(channel) {
    ircState.activeChannel = channel;
    ircState.unread[channel] = 0;
    ircChName.textContent = channel;
    const ch = ircState.channels.find(c => c.name === channel);
    ircChTopic.textContent = ch ? ch.topic : "";
    ircInput.placeholder = `Message ${channel}...`;
    ircRenderMessages();
    ircRenderChannels();

    // Tell relay to join
    chrome.runtime.sendMessage({
      type: "relay-send",
      data: { type: "command", command: `/join ${channel}` },
    });
  }

  function ircRenderChannels() {
    ircChannelsEl.innerHTML = ircState.channels
      .map(ch => {
        const active = ch.name === ircState.activeChannel ? "active" : "";
        const unread = ircState.unread[ch.name] || 0;
        const badge = unread > 0 ? `<span class="ch-badge">${unread}</span>` : "";
        return `<div class="irc-channel ${active}" data-ch="${ch.name}">
          <span class="ch-hash">#</span>${ch.name.slice(1)}${badge}
        </div>`;
      })
      .join("");

    ircChannelsEl.querySelectorAll(".irc-channel").forEach(el => {
      el.addEventListener("click", () => ircSwitchChannel(el.dataset.ch));
    });
  }

  function ircRenderMessages() {
    const msgs = ircState.messages[ircState.activeChannel] || [];
    ircMessages.innerHTML = msgs
      .map(m => {
        if (["system", "join", "part", "topic"].includes(m.type)) {
          return `<div class="irc-msg system">${ircTime(m.timestamp)} ${escapeHtml(m.content)}</div>`;
        }
        const color = ircNickColor(m.nick);
        return `<div class="irc-msg">
          <span class="msg-time">${ircTime(m.timestamp)}</span>
          <span class="msg-nick" style="color: ${color}">${escapeHtml(m.nick)}</span>
          <span class="msg-text">${escapeHtml(m.content)}</span>
        </div>`;
      })
      .join("");
    ircMessages.scrollTop = ircMessages.scrollHeight;
  }

  function ircAppendMessage(msg) {
    const ch = msg.channel || ircState.activeChannel;
    if (!ircState.messages[ch]) ircState.messages[ch] = [];
    ircState.messages[ch].push(msg);

    // Unread for inactive channels
    if (ch !== ircState.activeChannel && msg.type === "message") {
      ircState.unread[ch] = (ircState.unread[ch] || 0) + 1;
      ircRenderChannels();
    }

    // If we're viewing this channel, append live
    if (ch === ircState.activeChannel) {
      const div = document.createElement("div");
      if (["system", "join", "part", "topic"].includes(msg.type)) {
        div.className = "irc-msg system fade-in";
        div.textContent = `${ircTime(msg.timestamp)} ${msg.content}`;
      } else {
        div.className = "irc-msg fade-in";
        const color = ircNickColor(msg.nick);
        div.innerHTML = `<span class="msg-time">${ircTime(msg.timestamp)}</span><span class="msg-nick" style="color: ${color}">${escapeHtml(msg.nick)}</span><span class="msg-text">${escapeHtml(msg.content)}</span>`;
      }
      ircMessages.appendChild(div);
      ircMessages.scrollTop = ircMessages.scrollHeight;
    }
  }

  function ircHandleRelayMessage(data) {
    const type = data.type;

    if (type === "message" || type === "action") {
      ircAppendMessage(data);
    } else if (type === "system" || type === "join" || type === "part" || type === "topic") {
      const ch = data.channel || ircState.activeChannel;
      ircAppendMessage({
        id: Math.random().toString(36).slice(2),
        channel: ch,
        nick: data.nick || "system",
        content: data.content || `${data.nick || ""} ${type === "join" ? "joined" : type === "part" ? "left" : type === "topic" ? "set topic: " + data.topic : ""}`,
        type,
        timestamp: new Date().toISOString(),
      });
    } else if (type === "history") {
      ircState.messages[data.channel] = data.messages || [];
      if (data.channel === ircState.activeChannel) ircRenderMessages();
    } else if (type === "userlist") {
      const count = (data.users || []).length;
      ircUsersCount.textContent = `${count} in channel`;
    } else if (type === "channels") {
      ircState.channels = data.channels || ircState.channels;
      ircRenderChannels();
    } else if (type === "error") {
      ircAppendMessage({
        id: Math.random().toString(36).slice(2),
        channel: ircState.activeChannel,
        nick: "system",
        content: `⚠ ${data.message}`,
        type: "system",
        timestamp: new Date().toISOString(),
      });
    }
  }

  function ircTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch { return "--:--"; }
  }

  const IRC_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#60a5fa", "#2dd4bf", "#f472b6", "#a3e635", "#fb923c"];
  function ircNickColor(nick) {
    let h = 0;
    for (let i = 0; i < nick.length; i++) h = nick.charCodeAt(i) + ((h << 5) - h);
    return IRC_COLORS[Math.abs(h) % IRC_COLORS.length];
  }

  // ====================================================================
  // EVENTS LOG
  // ====================================================================

  function addEvent(type, message) {
    const time = new Date().toTimeString().slice(0, 8);
    state.events.push({ time, type, message });

    const line = document.createElement("div");
    line.className = "event-line fade-in";
    line.innerHTML = `
      <span class="event-time">${time}</span>
      <span class="event-type">${escapeHtml(type)}</span>
      <span class="event-msg">${escapeHtml(message)}</span>
    `;
    eventsLog.appendChild(line);
    eventsLog.scrollTop = eventsLog.scrollHeight;
  }

  // ====================================================================
  // MESSAGE LISTENER (from service worker)
  // ====================================================================

  let _lastTextActionId = null;

  chrome.runtime.onMessage.addListener((msg) => {
    // Ignore messages targeted at offscreen doc
    if (msg.target === "offscreen") return;

    // Panel switching (from popup or other sources)
    if (msg.type === "switch-panel" && msg.panel) {
      const tab = navTabs.querySelector(`[data-panel="${msg.panel}"]`);
      if (tab) tab.click();
    }

    if (msg.type === "ANALYZE_TEXT") {
      // Context menu "Analyze with AitherOS" — auto-send to chat
      navTabs.querySelector('[data-panel="chat"]').click();
      sendChat(`Analyze this text:\n\n${msg.text}\n\nSource: ${msg.source}`);
    }

    if (msg.type === "SEARCH_TEXT") {
      // Context menu "Search AitherOS" — federated search
      navTabs.querySelector('[data-panel="search"]')?.click();
      const searchInput = $("search-input");
      if (searchInput) {
        searchInput.value = msg.text;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        // Trigger search after a short delay to let UI update
        setTimeout(() => {
          const searchBtn = $("search-btn") || document.querySelector('[data-action="search"]');
          if (searchBtn) searchBtn.click();
        }, 100);
      }
    }

    if (msg.type === "TEXT_ACTION") {
      // Deduplicate — background retries this message multiple times
      const actionId = `${msg.action}:${(msg.text || "").slice(0, 50)}`;
      if (actionId === _lastTextActionId) return;
      _lastTextActionId = actionId;
      setTimeout(() => { _lastTextActionId = null; }, 5000);

      // Floating menu text action — send prompt + text to chat with KB save context
      navTabs.querySelector('[data-panel="chat"]').click();
      const source = msg.title ? `${msg.title} (${msg.source})` : msg.source;
      // Show the source content as a user message for context
      appendMsg("user", `📎 Captured from: ${escapeHtml(source)}\n\n${escapeHtml(msg.text.slice(0, 500))}${msg.text.length > 500 ? "\u2026" : ""}`, true);
      // Send the AI prompt
      sendChat(`${msg.prompt}\n\n${msg.text}\n\nSource: ${source}`);
      // After discussion, show a hint about saving to KB
      setTimeout(() => {
        if (!_streamingMsgEl) {
          appendMsg("system", '💡 Tip: Click \ud83e\udde0 on any message to save it to your Knowledge Base', true);
        }
      }, 3000);
    }

    if (msg.type === "THEMIS_SCAN_PAGE") {
      // Context menu "Scan Page with Themis" or other triggers
      navTabs.querySelector('[data-panel="chat"]').click();
      scanPageWithThemis();
    }

    if (msg.type === "SHIELD_SCAN_PAGE") {
      // Context menu "Shield Scan" or other triggers
      navTabs.querySelector('[data-panel="chat"]').click();
      scanPageWithShield();
    }

    if (msg.type === "SCREENSHOT_ANALYZE") {
      // Context menu "Analyze this page (screenshot)" → attach image + auto-send
      navTabs.querySelector('[data-panel="chat"]').click();
      if (msg.image) {
        pendingImages.push(msg.image);
        renderImagePreview();
        const prompt = `Analyze this screenshot of "${msg.title || "this page"}"${msg.source ? ` (${msg.source})` : ""}. Describe what you see and identify key elements.`;
        sendChat(prompt);
      }
    }

    // ── Audio recorded from recorder tab → transcribe via Whisper ──
    if (msg.type === "recorder-audio") {
      (async () => {
        micBtn.textContent = "\u23F3"; // hourglass
        try {
          const text = await transcribeBase64(msg.audio_base64);
          if (text.trim()) {
            chatInput.value = text.trim();
            sendChat(text.trim());
          } else {
            appendMsg("system", "Could not transcribe audio. Try speaking louder.");
          }
        } catch (e) {
          console.warn("[AitherConnect] STT failed:", e);
          appendMsg("system", "STT failed: " + e.message);
        }
        micBtn.textContent = "\uD83C\uDFA4"; // mic emoji
        micBtn.style.color = "";
      })();
    }

    // ── Streaming chat events from background.js ──
    if (msg.type === "chat-event") {
      const { event, data } = msg;

      // Reset watchdog on every event — stream is alive
      _resetStreamWatchdog();

      if (event === "session_start") {
        const agent = data.agent || "aither";
        const model = data.model || "auto";
        _addTrace("agent", agent, `model=${model}`);
      }

      else if (event === "pipeline") {
        const effort = data.effort || {};
        const strategy = data.strategy || "";
        const stage = data.stage || "";
        if (effort && typeof effort === "object" && effort.label) {
          _addTrace("effort", effort.label || "effort", `level=${effort.level || "?"}`);
        } else if (stage === "agentic_promotion") {
          _addTrace("agentic", "AGENTIC", `promoted: ${data.category || ""}`);
        } else if (stage) {
          _addTrace("pipeline", stage, data.message || stage);
        } else if (strategy) {
          _addTrace("pipeline", "strategy", strategy);
        }
      }

      else if (event === "thinking") {
        const content = (data.content || "").slice(0, 120);
        if (content) {
          _addTrace("think", "think", content);
        }
      }

      else if (event === "tool_call") {
        const toolName = data.name || data.tool || "tool";
        _addTrace("tool", "tool", toolName);
      }

      else if (event === "tool_result") {
        const toolName = data.name || data.tool || "tool";
        const ok = data.success !== false;
        _addTrace(ok ? "tool-ok" : "tool-fail", "tool", `${toolName} \u2192 ${ok ? "ok" : "FAIL"}`);
      }

      else if (event === "progress") {
        const msg = data.message || "";
        if (msg) _addTrace("progress", "progress", msg);
      }

      else if (event === "steering") {
        const action = data.action || "";
        const msg = data.message || "";
        _addTrace("steer", `steer:${action}`, msg);
      }

      else if (event === "final_answer" || event === "answer") {
        const answer = data.answer || data.content || "";
        if (answer && _streamingMsgEl) {
          _streamingContent = answer;
          // Switch from trace view to answer preview
          _streamingMsgEl.innerHTML = escapeHtml(answer).replace(/\n/g, "<br>");
          if (voiceState.enabled) presynthTTS(answer);
        }
      }

      else if (event === "complete") {
        const dur = data.duration_ms || 0;
        const model = data.model || "";
        if (dur || model) _addTrace("done", "done", `${dur}ms ${model}`.trim());
        const content = _streamingContent || data.content || "";
        const artifacts = data.artifacts || [];
        _finishStreamingMsg(content, artifacts);
      }

      else if (event === "error") {
        _addTrace("tool-fail", "error", data.error || "Unknown error");
        _finishStreamingMsg("", []);
        appendMsg("system", data.error || "An error occurred.");
      }

      // heartbeat: silently ignored (liveness only)
    }

    if (msg.type === "genesis-event") {
      addEvent("EVT", JSON.stringify(msg.data));
    }

    if (msg.type === "health-update") {
      if (msg.status === "online" || msg.healthy) {
        state.connected = true;
        statusDot.className = "topbar-status connected";
        statusDot.title = "Connected to AitherOS";
      } else if (msg.status === "degraded") {
        state.connected = true;
        statusDot.className = "topbar-status connected";
        statusDot.title = "AitherOS (degraded)";
      } else {
        state.connected = false;
        statusDot.className = "topbar-status";
        statusDot.title = "Disconnected";
      }
    }

    if (msg.type === "app-connected") {
      addEvent("APP", `${msg.app} connected (${msg.domain})`);
    }

    // ── IRC Relay messages ──
    if (msg.type === "relay-status") {
      ircState.connected = msg.connected;
      if (msg.connected) {
        ircStatusDot.className = "irc-dot connected";
        ircSendBtn.disabled = false;
        addEvent("IRC", `Connected as ${msg.nick}`);
      } else {
        ircStatusDot.className = "irc-dot";
        ircSendBtn.disabled = true;
      }
    }

    if (msg.type === "relay-message") {
      ircHandleRelayMessage(msg.data);
    }
  });

  // ====================================================================
  // TOOLBAR BUTTONS
  // ====================================================================

  // ── Setup overlay helpers ──────────────────────────────────────────
  function showSetup({ icon, title, body, actions }) {
    $("setup-icon").textContent = icon;
    $("setup-title").textContent = title;
    $("setup-body").innerHTML = body;
    const actionsEl = $("setup-actions");
    actionsEl.innerHTML = "";
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.textContent = a.label;
      btn.style.cssText = `padding:8px 12px; border-radius:8px; border:1px solid var(--border); cursor:pointer; font-size:12px; text-align:left; background:${a.primary ? "var(--accent)" : "var(--bg-tertiary)"}; color:${a.primary ? "#fff" : "var(--text-secondary)"}; transition:var(--transition);`;
      btn.addEventListener("click", () => { a.action(); if (a.close !== false) closeSetup(); });
      actionsEl.appendChild(btn);
    }
    const overlay = $("setup-overlay");
    overlay.style.display = "flex";
  }
  function closeSetup() { $("setup-overlay").style.display = "none"; }
  $("setup-close").addEventListener("click", closeSetup);
  $("setup-overlay").addEventListener("click", (e) => { if (e.target === $("setup-overlay")) closeSetup(); });

  // ── AitherVeil button — detect then open or guide setup ──────────
  $("btn-veil").addEventListener("click", async () => {
    const vUrl = veilUrl();
    try {
      const res = await fetch(`${vUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { chrome.runtime.sendMessage({ type: "open-veil-local" }); return; }
    } catch { /* not running */ }

    showSetup({
      icon: "🖥️",
      title: "AitherVeil isn't running",
      body: `AitherVeil is the web dashboard for AitherOS.<br><br>
             <strong>Start it:</strong><br>
             <code style="font-size:11px; background:var(--bg-tertiary); padding:2px 6px; border-radius:4px;">npm start</code> (from AitherOS root)<br><br>
             Then visit <strong>${veilUrl}</strong> — it runs on port <strong>${state.veilPort || 3000}</strong>.`,
      actions: [
        {
          label: "📖 View setup docs",
          action: () => chrome.tabs.create({ url: "https://github.com/aitherium/aitherzero#quick-start" }),
        },
        {
          label: `🔗 Try opening ${veilUrl} anyway`,
          primary: true,
          action: () => chrome.tabs.create({ url: veilUrl }),
        },
      ],
    });
  });

  // ── AitherDesktop button — try launch, guide install if missing ───
  $("btn-desktop").addEventListener("click", async () => {
    addEvent("ECO", "Launching AitherDesktop...");
    const resp = await chrome.runtime.sendMessage({ type: "launch-desktop" });
    if (resp?.ok) {
      addEvent("ECO", resp.message || "AitherDesktop launched");
      return;
    }

    // Launcher not running — show install/setup card
    const PYWIN = "python"; // generic; instructions use Windows command
    showSetup({
      icon: "🪟",
      title: "AitherDesktop isn't running",
      body: `AitherDesktop is the native Windows overlay for AitherOS.<br><br>
             <strong>1. Install (once):</strong><br>
             <code style="font-size:10px; background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; display:block; margin:4px 0;">
               cd AitherOS\\apps\\AitherDesktop<br>
               pip install -e .
             </code>
             <strong>2. Start the launcher:</strong><br>
             <code style="font-size:10px; background:var(--bg-tertiary); padding:2px 6px; border-radius:4px; display:block; margin:4px 0;">
               python -m aither_desktop.launcher
             </code>
             Then click Launch again — AitherConnect will start it automatically.`,
      actions: [
        {
          label: "📋 Copy install command",
          close: false,
          action: () => {
            navigator.clipboard.writeText("cd AitherOS\\apps\\AitherDesktop && pip install -e . && python -m aither_desktop.launcher");
            addEvent("ECO", "Install command copied to clipboard");
          },
        },
        {
          label: "🔁 Try launching again",
          primary: true,
          action: async () => {
            const r2 = await chrome.runtime.sendMessage({ type: "launch-desktop" });
            if (r2?.ok) addEvent("ECO", r2.message || "AitherDesktop launched");
            else addEvent("ECO", "Still not available — start the launcher first");
          },
        },
      ],
    });
  });

  $("btn-dashboard").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-dashboard" });
  });

  // Gear icon → open extension options page
  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Theme button → theme picker overlay
  $('btn-theme').addEventListener('click', () => {
    const overlay = $('theme-overlay');
    overlay.classList.toggle('open');
    if (overlay.classList.contains('open')) {
      const container = $('theme-picker-container');
      const currentId = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME_ID;
      renderThemePicker(container, currentId, async (newId) => {
        applyTheme(newId);
        await saveTheme(newId);
        overlay.classList.remove('open');
        addEvent('THEME', `Switched to ${AITHER_THEMES[newId]?.name || newId}`);
      });
    }
  });

  // Close theme overlay
  $('theme-close').addEventListener('click', () => {
    $('theme-overlay').classList.remove('open');
  });
  $('theme-overlay').addEventListener('click', (e) => {
    if (e.target === $('theme-overlay')) {
      $('theme-overlay').classList.remove('open');
    }
  });

  // ====================================================================
  // NOTEPAD — persistent scratchpad with sync to AitherVeil & Desktop
  // ====================================================================

  const npEditor = $("np-editor");
  const npStatus = $("np-status");
  const npChars = $("np-chars");
  const npLines = $("np-lines");
  const npUpdated = $("np-updated");
  let npSaveTimer = null;
  let npSyncTimer = null;
  let npLastSyncedContent = null;

  function npUpdateStats() {
    const text = npEditor.value;
    const chars = text.length;
    const lines = text.split("\n").length;
    npChars.textContent = `${chars.toLocaleString()} chars`;
    npLines.textContent = `${lines} line${lines !== 1 ? "s" : ""}`;
  }

  async function npSave() {
    try {
      const text = npEditor.value;
      const ts = new Date().toISOString();
      await chrome.storage.local.set({ notepad_content: text, notepad_updated: ts });
      npStatus.textContent = "Saved locally";
      npUpdated.textContent = `Last saved ${new Date(ts).toLocaleTimeString()}`;

      // Auto-sync to cloud after local save (debounced)
      clearTimeout(npSyncTimer);
      npSyncTimer = setTimeout(() => npPush(true), 3000);
    } catch {
      npStatus.textContent = "Save failed";
    }
  }

  async function npLoad() {
    try {
      const data = await chrome.storage.local.get(["notepad_content", "notepad_updated"]);
      if (data.notepad_content != null) {
        npEditor.value = data.notepad_content;
        npLastSyncedContent = data.notepad_content;
      }
      if (data.notepad_updated) {
        npUpdated.textContent = `Last saved ${new Date(data.notepad_updated).toLocaleTimeString()}`;
      }
      npUpdateStats();
    } catch { /* first run — no data yet */ }
  }

  // Push notes to AitherVeil sync API → Strata
  async function npPush(silent = false) {
    const text = npEditor.value;
    if (text === npLastSyncedContent && silent) return; // skip if unchanged
    if (!silent) $("np-sync").classList.add("syncing");
    npStatus.textContent = "Syncing…";

    try {
      const resp = await chrome.runtime.sendMessage({
        type: "sync-notes-push",
        content: text,
        source: "aither-connect",
      });
      if (resp?.ok) {
        npLastSyncedContent = text;
        npStatus.textContent = "☁ Synced";
        npUpdated.textContent = `Synced ${new Date().toLocaleTimeString()}`;
        if (!silent) addEvent("NOTE", "Notes pushed to AitherVeil/Strata");
      } else {
        npStatus.textContent = resp?.offline ? "Saved locally (cloud offline)" : "Sync failed";
      }
    } catch {
      npStatus.textContent = "Saved locally";
    } finally {
      if (!silent) $("np-sync").classList.remove("syncing");
    }
  }

  // Pull notes from AitherVeil sync API
  async function npPull() {
    $("np-pull").classList.add("syncing");
    npStatus.textContent = "Pulling…";

    try {
      const resp = await chrome.runtime.sendMessage({ type: "sync-notes-pull" });
      if (resp?.synced && resp.content != null) {
        const localText = npEditor.value;
        const remoteText = resp.content;

        if (remoteText === localText) {
          npStatus.textContent = "Already up to date";
          addEvent("NOTE", "Pull: already in sync");
        } else if (!localText.trim() || confirm("Replace local notes with cloud version?")) {
          npEditor.value = remoteText;
          npLastSyncedContent = remoteText;
          npUpdateStats();
          await chrome.storage.local.set({
            notepad_content: remoteText,
            notepad_updated: resp.updated_at || new Date().toISOString(),
          });
          npStatus.textContent = "☁ Pulled from cloud";
          npUpdated.textContent = `Pulled ${new Date().toLocaleTimeString()}`;
          addEvent("NOTE", "Notes pulled from AitherVeil/Strata");
        } else {
          npStatus.textContent = "Pull cancelled";
        }
      } else if (resp?.offline) {
        npStatus.textContent = "Cloud offline";
        addEvent("NOTE", "Pull failed: cloud offline");
      } else {
        npStatus.textContent = "No cloud notes found";
      }
    } catch {
      npStatus.textContent = "Pull failed";
    } finally {
      $("np-pull").classList.remove("syncing");
    }
  }

  npEditor.addEventListener("input", () => {
    npUpdateStats();
    npStatus.textContent = "Unsaved";
    clearTimeout(npSaveTimer);
    npSaveTimer = setTimeout(npSave, 800);  // debounced auto-save
  });

  $("np-sync").addEventListener("click", () => npPush(false));
  $("np-pull").addEventListener("click", () => npPull());

  $("np-export").addEventListener("click", () => {
    const text = npEditor.value;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aither-notes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addEvent("NOTE", "Exported notes as .txt");
  });

  $("np-clear").addEventListener("click", () => {
    if (!npEditor.value.trim()) return;
    if (confirm("Clear all notes? This cannot be undone.")) {
      npEditor.value = "";
      npUpdateStats();
      npSave();
      addEvent("NOTE", "Cleared notepad");
    }
  });

  // Save notes to a Knowledge Base
  $("np-save-kb")?.addEventListener("click", async () => {
    const text = npEditor.value.trim();
    if (!text) { addEvent("NOTE", "Nothing to save — notepad is empty"); return; }

    // Build KB selector from cached list
    if (!kbList.length) {
      try { await kbRefresh(); } catch { /* best effort */ }
    }
    if (!kbList.length) {
      addEvent("NOTE", "No knowledge bases available. Create one first.");
      return;
    }

    const names = kbList.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
    const choice = prompt(`Select a knowledge base (enter number):\n\n${names}`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= kbList.length) { addEvent("NOTE", "Invalid selection"); return; }

    const kb = kbList[idx];
    $("np-save-kb").textContent = "Saving...";
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "save-note-to-kb",
        baseId: kb.base_id,
        content: text,
        title: `Browser notes ${new Date().toISOString().slice(0, 16)}`,
      });
      if (resp?.ok) {
        addEvent("NOTE", `Saved to KB "${kb.name}"`);
        $("np-save-kb").textContent = "Saved!";
      } else {
        addEvent("NOTE", `Save to KB failed: ${resp?.error || "unknown"}`);
        $("np-save-kb").textContent = "Failed";
      }
    } catch (e) {
      addEvent("NOTE", `Save to KB error: ${e.message}`);
      $("np-save-kb").textContent = "Error";
    }
    setTimeout(() => { $("np-save-kb").textContent = "📚 Save to KB"; }, 2000);
  });

  // Load notepad content on init
  npLoad();

  // ====================================================================
  // APPS — Embeddable AitherVeil app launcher
  // ====================================================================

  const AITHER_APPS = [
    // Core
    { id: "dashboard",   name: "Dashboard",        icon: "📊", route: "/dashboard",        category: "core",    desc: "System overview with widgets",     status: "stable" },
    { id: "desktop",     name: "Desktop",           icon: "🖥️", route: "/desktop",          category: "core",    desc: "Full GNOME-style desktop",         status: "stable" },
    { id: "writer",      name: "Writer",            icon: "📝", route: "/writer",            category: "core",    desc: "AI-powered document editor",       status: "stable" },
    { id: "files",       name: "Files",             icon: "📁", route: "/files",             category: "core",    desc: "File manager (Strata)",            status: "stable" },
    { id: "settings",    name: "Settings",          icon: "⚙️", route: "/settings",          category: "core",    desc: "System configuration",             status: "stable" },
    { id: "watch",       name: "Watch",             icon: "👁️", route: "/watch",             category: "core",    desc: "Service health monitor",           status: "stable" },
    { id: "apps",        name: "App Manager",       icon: "🧩", route: "/apps",              category: "core",    desc: "Browse all AitherOS apps",         status: "stable" },
    // Agents
    { id: "demi",        name: "Demi",              icon: "🪄", route: "/demi",              category: "agents",  desc: "AI assistant agent",               status: "stable", agent: true },
    { id: "atlas",       name: "Atlas",             icon: "🔀", route: "/atlas",             category: "agents",  desc: "Git & code orchestrator",          status: "stable", agent: true },
    { id: "constellation", name: "Constellation",   icon: "✨", route: "/constellation",     category: "agents",  desc: "Multi-agent visualization",        status: "stable" },
    { id: "hera",        name: "Hera",              icon: "📻", route: "/hera",              category: "agents",  desc: "Event-driven automation",          status: "stable", agent: true },
    { id: "vera",        name: "Vera",              icon: "🪶", route: "/vera",              category: "agents",  desc: "Research & fact-checking",         status: "beta",   agent: true },
    { id: "lyra",        name: "Lyra",              icon: "📚", route: "/lyra",              category: "agents",  desc: "Knowledge curation",               status: "beta",   agent: true },
    { id: "saga",        name: "Saga",              icon: "📖", route: "/saga",              category: "agents",  desc: "Long-form story generation",       status: "beta",   agent: true },
    { id: "iris",        name: "Iris",              icon: "🖥️", route: "/iris",              category: "agents",  desc: "Vision & screen analysis",         status: "beta",   agent: true },
    { id: "themis",      name: "Themis",            icon: "⚖️", route: "/themis",            category: "agents",  desc: "Quality review & judgment",        status: "beta",   agent: true },
    // Creative
    { id: "creative",    name: "Creative Studio",   icon: "🎨", route: "/creative-studio",   category: "creative", desc: "AI image generation",             status: "stable" },
    { id: "canvas",      name: "Canvas",            icon: "🖼️", route: "/canvas",            category: "creative", desc: "Canvas image gallery",            status: "stable" },
    { id: "media",       name: "Media Library",     icon: "🎬", route: "/media-library",     category: "creative", desc: "Browse media files",              status: "beta" },
    // Dev
    { id: "forge",       name: "Forge IDE",         icon: "🔥", route: "/forge",             category: "dev",     desc: "Full code editor + AI",           status: "stable" },
    { id: "expeditions", name: "Expeditions",       icon: "🚀", route: "/expeditions",       category: "dev",     desc: "Multi-step AI code tasks",        status: "stable" },
    { id: "github",      name: "GitHub Ops",        icon: "🐙", route: "/github-ops",        category: "dev",     desc: "GitHub PR/issue management",      status: "stable" },
    { id: "eval-lab",    name: "Eval Lab",          icon: "🧪", route: "/eval-lab",          category: "dev",     desc: "LLM evaluation benchmarks",       status: "beta" },
    { id: "playground",  name: "Playground",        icon: "⚗️", route: "/playground",        category: "dev",     desc: "LLM playground & testing",        status: "stable" },
    // Social
    { id: "social",      name: "Social Hub",        icon: "🌐", route: "/social",            category: "social",  desc: "Social media management",         status: "beta" },
    { id: "forum",       name: "Forum",             icon: "💬", route: "/forum",             category: "social",  desc: "Community discussions",            status: "beta" },
    { id: "relay",       name: "Relay Chat",        icon: "📡", route: "/relay",             category: "social",  desc: "IRC-style team chat",             status: "stable" },
    // Monitor
    { id: "monitor",     name: "Monitor Hub",       icon: "📈", route: "/monitor-hub",       category: "monitor", desc: "Full system monitoring",          status: "stable" },
    { id: "gpu",         name: "GPU Dashboard",     icon: "🎮", route: "/gpu-dashboard",     category: "monitor", desc: "GPU utilization & VRAM",          status: "beta" },
    { id: "benchmark",   name: "Benchmark",         icon: "⚡", route: "/benchmark",         category: "monitor", desc: "Performance benchmarks",          status: "stable" },
    // Infra
    { id: "infra",       name: "Infra Inspector",   icon: "🔧", route: "/infra-inspector",   category: "infra",   desc: "Docker & service inspection",     status: "beta" },
    { id: "fleet",       name: "Fleet",             icon: "🚢", route: "/fleet",             category: "infra",   desc: "Container fleet management",      status: "beta" },
    { id: "search",      name: "Search",            icon: "🔍", route: "/search",            category: "utility", desc: "Federated web search",            status: "stable" },
    { id: "clipboard",   name: "Clipboard",         icon: "📋", route: "/clipboard",         category: "utility", desc: "Clipboard history manager",       status: "stable" },
    { id: "knowledge",   name: "Knowledge",         icon: "🧠", route: "/knowledge",         category: "utility", desc: "Knowledge graph browser",         status: "beta" },
  ];

  const CATEGORY_ICONS = {
    core: "💎", agents: "🤖", creative: "🎨", dev: "💻",
    social: "🌐", monitor: "📈", infra: "🔧", utility: "🛠️"
  };

  const appsGrid = $("apps-grid");
  const appsSearch = $("apps-search");
  const appsCategory = $("apps-category");
  const appEmbedContainer = $("app-embed-container");
  const appEmbedFrame = $("app-embed-frame");
  const appEmbedTitle = $("app-embed-title");
  let currentAppRoute = null;

  function renderApps() {
    const query = appsSearch.value.toLowerCase();
    const cat = appsCategory.value;

    const filtered = AITHER_APPS.filter(app => {
      if (cat !== "all" && app.category !== cat) return false;
      if (query && !app.name.toLowerCase().includes(query) && !app.desc.toLowerCase().includes(query)) return false;
      return true;
    });

    appsGrid.innerHTML = filtered.map(app => {
      const badgeHtml = app.agent
        ? `<span class="app-badge agent">Agent</span>`
        : app.status === "beta"
          ? `<span class="app-badge beta">Beta</span>`
          : "";
      return `
        <div class="app-card fade-in" data-route="${app.route}" data-name="${escapeHtml(app.name)}" title="${escapeHtml(app.desc)}">
          ${badgeHtml}
          <span class="app-icon">${app.icon}</span>
          <span class="app-name">${escapeHtml(app.name)}</span>
          <span class="app-desc">${escapeHtml(app.desc)}</span>
        </div>
      `;
    }).join("");

    appsGrid.querySelectorAll(".app-card").forEach(card => {
      card.addEventListener("click", () => {
        const route = card.dataset.route;
        const name = card.dataset.name;
        openAppEmbed(route, name);
      });
    });
  }

  function openAppEmbed(route, name) {
    currentAppRoute = route;
    const url = `${veilUrl()}${route}`;
    appEmbedTitle.textContent = name;
    appEmbedFrame.src = url;
    appsGrid.style.display = "none";
    $("apps-header") && ($("apps-header").style.display = "none");
    appEmbedContainer.style.display = "flex";
    addEvent("APP", `Opened ${name} (${route})`);
  }

  function closeAppEmbed() {
    appEmbedFrame.src = "about:blank";
    appEmbedContainer.style.display = "none";
    appsGrid.style.display = "grid";
    const hdr = $("apps-header");
    if (hdr) hdr.style.display = "flex";
    currentAppRoute = null;
  }

  $("app-back").addEventListener("click", closeAppEmbed);
  $("app-popout").addEventListener("click", () => {
    if (currentAppRoute) {
      chrome.tabs.create({ url: `${veilUrl()}${currentAppRoute}` });
    }
  });

  appsSearch.addEventListener("input", renderApps);
  appsCategory.addEventListener("change", renderApps);

  // Initial render
  renderApps();

  // ====================================================================
  // UTILITIES
  // ====================================================================

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ====================================================================
  // KNOWLEDGE BASE PANEL (Knowledge-RAG API)
  // ====================================================================

  // Cache of loaded KBs for selector dropdowns
  let kbList = [];

  async function kbRefresh() {
    const el = document.getElementById("kb-plugins-list");
    if (!el) return;
    el.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Loading...</div>';
    try {
      const resp = await fetch(svcUrl("genesis", "api/knowledge-rag/bases"), {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        el.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">Error: HTTP ${resp.status}</div>`;
        return;
      }
      const data = await resp.json();
      const bases = data.bases || [];
      kbList = bases;
      kbUpdateSelector();

      if (!bases.length) {
        el.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">No knowledge bases yet. Click "+ Create" to add one.</div>';
        return;
      }
      el.innerHTML = bases.map(b => `
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:12px">${escapeHtml(b.name)}</strong>
            <span style="font-size:10px;color:var(--accent)">${b.doc_count || 0} docs</span>
          </div>
          ${b.description ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${escapeHtml(b.description)}</div>` : ''}
          <div style="font-size:9px;color:var(--text-muted);margin-top:3px">${b.source_type || 'local'} · created ${new Date((b.created_at || 0) * 1000).toLocaleDateString()}</div>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button data-kb-query="${escapeHtml(b.base_id)}" style="padding:3px 8px;border-radius:4px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:10px">Query</button>
            <button data-kb-ingest-url="${escapeHtml(b.base_id)}" style="padding:3px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;font-size:10px">Ingest URL</button>
            <button data-kb-delete="${escapeHtml(b.base_id)}" style="padding:3px 8px;border-radius:4px;border:1px solid var(--error);background:transparent;color:var(--error);cursor:pointer;font-size:10px">Delete</button>
          </div>
        </div>
      `).join("");

      // Wire action buttons
      el.querySelectorAll("[data-kb-query]").forEach(btn => {
        btn.addEventListener("click", () => {
          const sel = document.getElementById("kb-query-select");
          if (sel) sel.value = btn.dataset.kbQuery;
          document.getElementById("kb-query-input")?.focus();
        });
      });
      el.querySelectorAll("[data-kb-ingest-url]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const baseId = btn.dataset.kbIngestUrl;
          const url = prompt("Enter URL to ingest into this knowledge base:");
          if (!url?.trim()) return;
          btn.textContent = "Ingesting...";
          btn.disabled = true;
          try {
            const r = await fetch(svcUrl("genesis", `api/knowledge-rag/bases/${baseId}/ingest/url`), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: url.trim() }),
              signal: AbortSignal.timeout(30000),
            });
            const d = await r.json();
            btn.textContent = r.ok ? "Done" : "Failed";
            addEvent("KB", r.ok ? `Ingested URL into ${baseId}` : `Ingest failed: ${d.detail || d.error || "unknown"}`);
            setTimeout(() => kbRefresh(), 1500);
          } catch (e) {
            btn.textContent = "Error";
            addEvent("KB", `Ingest URL error: ${e.message}`);
          }
        });
      });
      el.querySelectorAll("[data-kb-delete]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const baseId = btn.dataset.kbDelete;
          if (!confirm(`Delete knowledge base "${baseId}"? This cannot be undone.`)) return;
          try {
            await fetch(svcUrl("genesis", `api/knowledge-rag/bases/${baseId}`), {
              method: "DELETE",
              signal: AbortSignal.timeout(5000),
            });
            addEvent("KB", `Deleted knowledge base: ${baseId}`);
            kbRefresh();
          } catch (e) {
            addEvent("KB", `Delete error: ${e.message}`);
          }
        });
      });
    } catch (e) {
      el.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">Genesis offline</div>`;
    }
  }

  function kbUpdateSelector() {
    const sel = document.getElementById("kb-query-select");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All knowledge bases</option>' +
      kbList.map(b => `<option value="${escapeHtml(b.base_id)}">${escapeHtml(b.name)}</option>`).join("");
    if (current) sel.value = current;
  }

  async function kbQuery(query) {
    const results = document.getElementById("kb-query-results");
    if (!results) return;
    results.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Searching...</div>';

    const baseId = document.getElementById("kb-query-select")?.value;

    // No global cross-KB query endpoint — fan out to each KB or require selection
    if (!baseId) {
      if (!kbList.length) {
        results.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">No knowledge bases available</div>';
        return;
      }
      // Fan out: query each KB and merge results
      const allHits = [];
      const fetches = kbList.map(async (kb) => {
        try {
          const r = await fetch(svcUrl("genesis", `api/knowledge-rag/bases/${kb.base_id}/query`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, mode: "hybrid", top_k: 3 }),
            signal: AbortSignal.timeout(10000),
          });
          if (r.ok) {
            const d = await r.json();
            for (const hit of (d.results || d.chunks || d.source_docs || [])) {
              hit.base_name = kb.name;
              allHits.push(hit);
            }
          }
        } catch { /* skip unavailable KBs */ }
      });
      await Promise.all(fetches);
      // Sort by score descending, take top 8
      allHits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const merged = allHits.slice(0, 8);
      if (!merged.length) {
        results.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">No results across all knowledge bases</div>';
        return;
      }
      results.innerHTML = merged.map(h => `
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:4px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:10px;color:var(--accent)">${escapeHtml(h.base_name || h.source || "")}</span>
            ${h.score != null ? `<span style="font-size:9px;color:var(--text-muted)">${(h.score * 100).toFixed(0)}%</span>` : ""}
          </div>
          ${h.title ? `<div style="font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:2px">${escapeHtml(h.title)}</div>` : ""}
          <div style="font-size:11px;color:var(--text-primary);line-height:1.4">${escapeHtml((h.content || h.text || "").slice(0, 300))}${(h.content || h.text || "").length > 300 ? '...' : ''}</div>
        </div>
      `).join("");
      return;
    }

    try {
      const resp = await fetch(svcUrl("genesis", `api/knowledge-rag/bases/${baseId}/query`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "hybrid", top_k: 8 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        results.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">Error: HTTP ${resp.status}</div>`;
        return;
      }
      const data = await resp.json();
      const hits = data.results || data.chunks || [];
      if (!hits.length) {
        results.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">No results</div>';
        return;
      }
      results.innerHTML = hits.map(h => `
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:4px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:10px;color:var(--accent)">${escapeHtml(h.source || h.base_name || h.base_id || "")}</span>
            ${h.score != null ? `<span style="font-size:9px;color:var(--text-muted)">${(h.score * 100).toFixed(0)}%</span>` : ""}
          </div>
          ${h.title ? `<div style="font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:2px">${escapeHtml(h.title)}</div>` : ""}
          <div style="font-size:11px;color:var(--text-primary);line-height:1.4">${escapeHtml((h.content || h.text || "").slice(0, 300))}${(h.content || h.text || "").length > 300 ? '...' : ''}</div>
        </div>
      `).join("");
    } catch (e) {
      results.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function kbCreate() {
    const name = document.getElementById("kb-create-name")?.value.trim();
    if (!name) return;
    const desc = document.getElementById("kb-create-desc")?.value.trim() || "";
    try {
      const resp = await fetch(svcUrl("genesis", "api/knowledge-rag/bases"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      if (resp.ok) {
        addEvent("KB", `Created knowledge base: ${name}`);
        document.getElementById("kb-create-form").style.display = "none";
        document.getElementById("kb-create-name").value = "";
        document.getElementById("kb-create-desc").value = "";
        kbRefresh();
      } else {
        addEvent("KB", `Create failed: ${data.detail || data.error || "unknown"}`);
      }
    } catch (e) {
      addEvent("KB", `Create error: ${e.message}`);
    }
  }

  // Wire KB panel events after DOM load
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("kb-refresh-btn")?.addEventListener("click", kbRefresh);
    document.getElementById("kb-create-btn")?.addEventListener("click", () => {
      const form = document.getElementById("kb-create-form");
      if (form) form.style.display = form.style.display === "none" ? "block" : "none";
    });
    document.getElementById("kb-create-cancel")?.addEventListener("click", () => {
      const form = document.getElementById("kb-create-form");
      if (form) form.style.display = "none";
    });
    document.getElementById("kb-create-submit")?.addEventListener("click", kbCreate);
    document.getElementById("kb-query-submit")?.addEventListener("click", () => {
      const input = document.getElementById("kb-query-input");
      if (input?.value.trim()) kbQuery(input.value.trim());
    });
    document.getElementById("kb-query-input")?.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const input = document.getElementById("kb-query-input");
        if (input?.value.trim()) kbQuery(input.value.trim());
      }
    });
  });

  // ====================================================================
  // SETUP PANEL — Environment detection, install help, workspace
  // ====================================================================

  async function refreshSetupPanel() {
    const connEl = $("setup-connection-status");
    const svcEl = $("setup-services");
    const actEl = $("setup-actions");
    const wsEl = $("setup-workspace");
    if (!connEl) return;

    // Show loading state
    connEl.innerHTML = '<div class="setup-row"><div class="setup-dot checking"></div><span class="setup-name">Scanning environment...</span></div>';
    svcEl.innerHTML = "";
    actEl.innerHTML = "";
    wsEl.innerHTML = "";

    let env;
    try {
      env = await chrome.runtime.sendMessage({ type: "get-environment" });
    } catch {
      connEl.innerHTML = '<div class="setup-row"><div class="setup-dot down"></div><span class="setup-name">Extension service worker unavailable</span></div>';
      return;
    }
    if (!env?.ok) return;

    const svcMap = {};
    (env.services || []).forEach(s => { svcMap[s.id] = s; });

    // ── Connection section ──
    const mode = env.settings.remoteUrl ? (env.settings.remoteUrl.includes("aitherium.com") ? "Cloud" : "Remote") : "Local";
    const wsStatus = env.wsConnected ? "WebSocket connected" : "WebSocket disconnected";
    connEl.innerHTML = `
      <div class="setup-row">
        <div class="setup-dot ${env.wsConnected ? 'up' : 'down'}"></div>
        <span class="setup-name">Mode: ${escapeHtml(mode)}</span>
        <span class="setup-detail">${wsStatus}</span>
      </div>
      ${env.settings.remoteUrl ? `<div class="setup-row"><div class="setup-dot up"></div><span class="setup-name">${escapeHtml(env.settings.remoteUrl)}</span></div>` : ""}
    `;

    // ── Services section ──
    const serviceGroups = [
      { label: "Core", ids: ["genesis", "veil", "node", "pulse"] },
      { label: "Intelligence", ids: ["mind", "lyra", "nexus", "search", "strata"] },
      { label: "Inference", ids: ["vllm", "ollama"] },
      { label: "External", ids: ["portal"] },
    ];
    let svcHTML = "";
    for (const group of serviceGroups) {
      const rows = group.ids.map(id => {
        const s = svcMap[id];
        if (!s) return "";
        const dotClass = s.status === "up" ? "up" : s.status === "error" ? "down" : "down";
        return `<div class="setup-row">
          <div class="setup-dot ${dotClass}"></div>
          <span class="setup-name">${escapeHtml(s.name)}</span>
          <span class="setup-detail">${s.status === "up" ? (s.detail || "OK") : s.status}</span>
        </div>`;
      }).join("");
      if (rows) {
        svcHTML += `<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:${svcHTML ? '8px' : '0'} 0 4px;">${group.label}</div>${rows}`;
      }
    }
    svcEl.innerHTML = svcHTML;

    // ── Quick Setup actions ──
    const actions = [];

    if (svcMap.node?.status !== "up") {
      actions.push({ icon: "🔌", label: "Install AitherNode (MCP tools)", hint: "pip install aither-node", cmd: "pip install aither-node && aither-node serve" });
    }
    if (svcMap.genesis?.status !== "up") {
      actions.push({ icon: "🧠", label: "Start AitherOS services", hint: "npm start", cmd: "cd AitherOS && npm start" });
    }
    if (svcMap.ollama?.status !== "up" && svcMap.vllm?.status !== "up") {
      actions.push({ icon: "🤖", label: "Install Ollama (local inference)", hint: "ollama.com/download", url: "https://ollama.com/download" });
    }
    if (svcMap.ollama?.status === "up" && svcMap.vllm?.status !== "up") {
      actions.push({ icon: "📦", label: "Pull a model", hint: "ollama pull llama3.2", cmd: "ollama pull llama3.2" });
    }
    actions.push({ icon: "💻", label: "Install AitherShell", hint: "pip install aithershell", cmd: "pip install aithershell" });
    if (!env.settings.remoteUrl) {
      actions.push({ icon: "🌐", label: "Connect to portal.aitherium.com", hint: "Set up cloud access", action: "open-options" });
    }
    actions.push({ icon: "⚙", label: "Open extension settings", hint: "Tenant, workspace, API keys", action: "open-options" });

    actEl.innerHTML = actions.map(a => {
      if (a.url) {
        return `<button class="setup-btn" data-url="${escapeHtml(a.url)}"><span class="setup-btn-icon">${a.icon}</span><span>${escapeHtml(a.label)}<br><span style="font-weight:400;color:var(--text-muted);font-size:10px;">${escapeHtml(a.hint)}</span></span></button>`;
      }
      if (a.cmd) {
        return `<button class="setup-btn" data-copy="${escapeHtml(a.cmd)}"><span class="setup-btn-icon">${a.icon}</span><span>${escapeHtml(a.label)}<br><span style="font-weight:400;color:var(--text-muted);font-size:10px;">${escapeHtml(a.hint)}</span></span></button>`;
      }
      return `<button class="setup-btn" data-action="${a.action}"><span class="setup-btn-icon">${a.icon}</span><span>${escapeHtml(a.label)}<br><span style="font-weight:400;color:var(--text-muted);font-size:10px;">${escapeHtml(a.hint)}</span></span></button>`;
    }).join("");

    // Wire setup action buttons
    actEl.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.copy);
        btn.querySelector(".setup-btn-icon").textContent = "✓";
        addEvent("SETUP", `Copied: ${btn.dataset.copy}`);
        setTimeout(() => { btn.querySelector(".setup-btn-icon").textContent = btn.dataset.copy.includes("ollama") ? "📦" : "💻"; }, 1500);
      });
    });
    actEl.querySelectorAll("[data-url]").forEach(btn => {
      btn.addEventListener("click", () => { chrome.tabs.create({ url: btn.dataset.url }); });
    });
    actEl.querySelectorAll('[data-action="open-options"]').forEach(btn => {
      btn.addEventListener("click", () => { chrome.runtime.openOptionsPage(); });
    });

    // ── Auto-detect identity button ──
    const detectBtn = document.createElement("button");
    detectBtn.className = "setup-btn primary";
    detectBtn.innerHTML = '<span class="setup-btn-icon">🔑</span><span>Sign in<br><span style="font-weight:400;color:var(--text-muted);font-size:10px;">From portal cookie or API key</span></span>';
    detectBtn.addEventListener("click", async () => {
      detectBtn.disabled = true;
      detectBtn.querySelector(".setup-btn-icon").textContent = "⏳";
      try {
        const result = await chrome.runtime.sendMessage({ type: "resolve-identity" });
        if (result?.ok && result.identity) {
          const id = result.identity;
          addEvent("AUTH", `Resolved: ${id.username} (${id.tenant_slug || id.tenant_id}) via ${result.source}`);
          // Apply to settings
          await chrome.runtime.sendMessage({ type: "apply-identity", identity: id, token: result.token });
          detectBtn.querySelector(".setup-btn-icon").textContent = "✓";
          const wsLabel = id.workspace_name || id.workspace_slug || id.workspace_id || id.tenant_slug || id.tenant_id;
          detectBtn.querySelector("span:last-child").innerHTML = `${escapeHtml(id.display_name || id.username)}<br><span style="font-weight:400;color:var(--success);font-size:10px;">${escapeHtml(wsLabel)} — ${result.source}</span>`;
          // Refresh workspace badge + panel
          await loadWorkspaceContext();
          setTimeout(refreshSetupPanel, 1500);
        } else {
          detectBtn.querySelector(".setup-btn-icon").textContent = "⚠";
          detectBtn.querySelector("span:last-child").innerHTML = `Not authenticated<br><span style="font-weight:400;color:var(--warning);font-size:10px;">${escapeHtml(result?.error || "Log in to portal or run aither login")}</span>`;
          addEvent("AUTH", result?.error || "No identity found");
        }
      } catch (e) {
        detectBtn.querySelector(".setup-btn-icon").textContent = "✕";
        addEvent("AUTH", `Error: ${e.message}`);
      }
      setTimeout(() => { detectBtn.disabled = false; }, 2000);
    });
    actEl.prepend(detectBtn);

    // ── Workspace section ──
    const s = env.settings;
    if (s.tenantId || s.workspaceId) {
      let wsHTML = `
        <div class="setup-row">
          <div class="setup-dot ${s.tenantId ? 'up' : 'down'}"></div>
          <span class="setup-name">Tenant</span>
          <span class="setup-detail">${escapeHtml(s.tenantId || "not set")}</span>
        </div>
        <div class="setup-row">
          <div class="setup-dot ${s.workspaceId ? 'up' : 'down'}"></div>
          <span class="setup-name">Workspace</span>
          <span class="setup-detail">${escapeHtml(s.workspaceId || "not set")}</span>
        </div>
      `;
      if (s.userId) {
        wsHTML += `<div class="setup-row"><div class="setup-dot up"></div><span class="setup-name">User</span><span class="setup-detail">${escapeHtml(s.userId)}</span></div>`;
      }
      // Portal workspace links
      const portalBase = s.remoteUrl || "https://portal.aitherium.com";
      wsHTML += `
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
          <button class="setup-btn primary" data-url="${escapeHtml(portalBase)}/workspace">
            <span class="setup-btn-icon">🏢</span><span>Open Workspace in Portal</span>
          </button>
          <button class="setup-btn" data-url="${escapeHtml(portalBase)}/files">
            <span class="setup-btn-icon">📁</span><span>Shared Files</span>
          </button>
          <button class="setup-btn" data-url="${escapeHtml(portalBase)}/knowledge">
            <span class="setup-btn-icon">🧠</span><span>Knowledge Base</span>
          </button>
        </div>
      `;
      wsEl.innerHTML = wsHTML;
      wsEl.querySelectorAll("[data-url]").forEach(btn => {
        btn.addEventListener("click", () => { chrome.tabs.create({ url: btn.dataset.url }); });
      });
    } else {
      wsEl.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding:12px;">
          No workspace configured.<br>
          <button class="setup-btn primary" style="margin-top:8px;" data-action="open-options">
            <span class="setup-btn-icon">⚙</span><span>Configure in Settings</span>
          </button>
        </div>
      `;
      wsEl.querySelector('[data-action="open-options"]')?.addEventListener("click", () => { chrome.runtime.openOptionsPage(); });
    }
  }

  // Refresh setup panel when tab is activated
  navTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".nav-tab");
    if (tab?.dataset.panel === "setup") {
      refreshSetupPanel();
    }
  });

  // ====================================================================
  // INIT
  // ====================================================================

  async function init() {
    // Apply saved visual theme before anything else
    await loadAndApplyTheme();

    // Restore chat history before anything writes to the chat pane
    await restoreChatHistory();

    // Load connection settings from background worker
    await loadStateFromSettings();

    // Load workspace/tenant context badge
    await loadWorkspaceContext();

    // Auto-resolve identity if not configured
    try {
      const settings = (await chrome.runtime.sendMessage({ type: "get-settings" }))?.settings || {};
      if (!settings.tenantId && !settings.userId) {
        const result = await chrome.runtime.sendMessage({ type: "resolve-identity" });
        if (result?.ok && result.identity) {
          await chrome.runtime.sendMessage({ type: "apply-identity", identity: result.identity, token: result.token });
          addEvent("AUTH", `Auto-detected: ${result.identity.username} (${result.identity.tenant_slug || result.identity.tenant_id})`);
          await loadWorkspaceContext();
        }
      }
    } catch { /* identity resolution is best-effort */ }

    const ok = await checkConnection();
    if (ok) {
      addEvent('INIT', 'AitherConnect initialized \u2014 connected');
      kbRefresh();  // Load knowledge base plugins
      checkEndpointStatus();  // Show local + portal status
    } else {
      addEvent('INIT', 'AitherConnect initialized \u2014 offline');
      checkEndpointStatus();  // Still show what's reachable
    }

    // Periodic health check
    setInterval(checkConnection, 15000);
    setInterval(checkEndpointStatus, 60000);  // Refresh endpoint status every 60s

    // Tell background we're ready — pick up any queued text actions
    chrome.runtime.sendMessage({ type: "sidepanel-ready" }).catch(() => {});
  }

  // ====================================================================
  // CONTENT PANEL
  // ====================================================================

  const contentState = {
    decks: [],
    currentSlug: "",
    currentDeck: null,
  };

  // ── Expose globally for onclick handlers ──
  window.contentNewDeck = contentNewDeck;
  window.contentSaveDeck = contentSaveDeck;
  window.contentExport = contentExport;
  window.contentAddBlock = contentAddBlock;

  async function contentLoadDecks() {
    try {
      const resp = await fetch(svcUrl("genesis", "content/decks"));
      if (!resp.ok) return;
      const data = await resp.json();
      contentState.decks = data.decks || [];
      const sel = document.getElementById("content-deck-select");
      if (!sel) return;
      sel.innerHTML = '<option value="">Select deck...</option>';
      contentState.decks.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.slug;
        opt.textContent = d.name || d.slug;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        if (sel.value) contentLoadDeck(sel.value);
      };
    } catch (e) {
      console.debug("[Content] Failed to load decks:", e);
    }
  }

  async function contentLoadDeck(slug) {
    try {
      const resp = await fetch(svcUrl("genesis", `content/decks/${slug}`));
      if (!resp.ok) return;
      const data = await resp.json();
      contentState.currentSlug = slug;
      contentState.currentDeck = data;
      contentRenderBlocks(data.slides || []);
    } catch (e) {
      console.debug("[Content] Failed to load deck:", e);
    }
  }

  function contentRenderBlocks(slides) {
    const container = document.getElementById("content-blocks");
    if (!container) return;
    container.innerHTML = "";

    slides.forEach((slide, si) => {
      const card = document.createElement("div");
      card.style.cssText = "background:var(--bg-tertiary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px; cursor:pointer;";
      card.draggable = true;
      card.dataset.idx = si;

      const title = slide.title || `Slide ${si + 1}`;
      const layout = slide.layout || "bullets";
      const bulletCount = (slide.bullets || []).length;
      const elementCount = (slide.elements || []).length;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:600; font-size:12px; color:var(--text-primary);">${si + 1}. ${esc(title)}</span>
          <span style="font-size:10px; color:var(--text-muted);">${layout}</span>
        </div>
        <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">
          ${bulletCount ? bulletCount + " bullets" : ""} ${elementCount ? elementCount + " elements" : ""}
        </div>
        <div style="display:flex; gap:4px; margin-top:6px;">
          <button class="input-btn" style="padding:2px 6px; font-size:9px;" onclick="event.stopPropagation(); contentDeleteBlock(${si})">Del</button>
        </div>
      `;

      // Drag-to-reorder
      card.ondragstart = e => { e.dataTransfer.setData("text/plain", si); card.style.opacity = "0.4"; };
      card.ondragend = () => { card.style.opacity = "1"; };
      card.ondragover = e => e.preventDefault();
      card.ondrop = e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData("text/plain"));
        if (from !== si) contentMoveBlock(from, si);
      };

      container.appendChild(card);
    });
  }

  async function contentSaveDeck() {
    if (!contentState.currentSlug || !contentState.currentDeck) return;
    try {
      const resp = await fetch(svcUrl("genesis", `content/decks/${contentState.currentSlug}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contentState.currentDeck),
      });
      if (resp.ok) addEvent("CONTENT", "Deck saved: " + contentState.currentSlug);
    } catch (e) {
      console.debug("[Content] Save failed:", e);
    }
  }

  async function contentExport(format) {
    if (!contentState.currentSlug) return;
    try {
      const resp = await fetch(svcUrl("genesis", "content/transform"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: contentState.currentSlug,
          source_format: "presentation",
          target_format: format,
          enrich: true,
        }),
      });
      const data = await resp.json();
      if (data.success || data.markdown || data.html) {
        const content = data.markdown || data.html || JSON.stringify(data, null, 2);
        const ext = format === "blog" ? "md" : format === "document" ? "html" : "json";
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${contentState.currentSlug}-export.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        addEvent("CONTENT", `Exported as ${format}`);
      }
    } catch (e) {
      console.debug("[Content] Export failed:", e);
    }
  }

  function contentNewDeck() {
    const title = prompt("Deck title:");
    if (!title) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    contentState.currentSlug = slug;
    contentState.currentDeck = {
      title,
      slides: [
        { title, layout: "title", subtitle: "" },
        { title: "Key Points", layout: "bullets", bullets: ["Point 1", "Point 2"] },
        { title: "Thank You", layout: "closing", subtitle: title },
      ],
    };
    contentRenderBlocks(contentState.currentDeck.slides);
    addEvent("CONTENT", "New deck: " + slug);
  }

  function contentAddBlock(type) {
    if (!contentState.currentDeck) return;
    const templates = {
      text: { title: "New Slide", layout: "bullets", body_markdown: "Content here" },
      bullets: { title: "Key Points", layout: "bullets", bullets: ["Point 1", "Point 2", "Point 3"] },
      image: { title: "Visual", layout: "image", image_url: "" },
      code: { title: "Code Example", layout: "code", code: "# code here", language: "python" },
      stats: { title: "Metrics", layout: "stats", stats: [{ label: "Metric", value: "100%" }] },
      quote: { title: "Insight", layout: "quote", quote: "Quote text here", attribution: "Source" },
      diagram: { title: "Architecture", layout: "diagram", mermaid: "graph TD\n  A-->B" },
    };
    const tmpl = templates[type] || templates.text;
    contentState.currentDeck.slides.push(tmpl);
    contentRenderBlocks(contentState.currentDeck.slides);
  }

  window.contentDeleteBlock = function(idx) {
    if (!contentState.currentDeck) return;
    contentState.currentDeck.slides.splice(idx, 1);
    contentRenderBlocks(contentState.currentDeck.slides);
  };

  function contentMoveBlock(from, to) {
    if (!contentState.currentDeck) return;
    const slides = contentState.currentDeck.slides;
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    contentRenderBlocks(slides);
  }

  // Load content decks when switching to content tab
  const navTabsEl = document.getElementById("nav-tabs");
  if (navTabsEl) {
    navTabsEl.addEventListener("click", (e) => {
      const tab = e.target.closest(".nav-tab");
      if (tab && tab.dataset.panel === "content") {
        contentLoadDecks();
      }
    });
  }

  // ── Helper ──
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  init();
})();