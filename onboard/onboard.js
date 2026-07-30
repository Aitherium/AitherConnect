/**
 * AitherConnect onboarding wizard (consumer-first)
 * Step 0: choice → BYOK|Fleet|Portal paths
 * BYOK: provider → key entry → verify → finish
 * Fleet: local detect → finish
 * Portal: sign-in → mode → provision → finish
 */

const $ = (id) => document.getElementById(id);
const P = self.AitherPortal;
const Prov = self.AitherProviders;

let state = {
  step: 0,
  choice: null, // 'byok' | 'fleet' | 'portal'
  byokProvider: null, // provider id
  byokConfig: null, // {id, apiKey, model, baseUrl, embeddingModel}
  portalMode: null, // 'cloud' | 'hybrid' | 'local'
  temp2faToken: null,
  bundle: null,
  user: null,
};

// === NAVIGATION & DISPLAY ===

function showPill(n) {
  for (let i = 0; i <= 3; i++) {
    const pill = $(`pill-${i}`);
    if (pill) {
      pill.classList.toggle("active", i === n);
      pill.classList.toggle("done", i < n);
    }
  }
}

function showPanel(id) {
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.add("hidden");
  });
  $(id).classList.remove("hidden");
}

function msg(target, text, kind = "error") {
  const host = $(target);
  if (!text) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<div class="message ${kind}">${escapeHtml(text)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// === STEP 0: CHOICE ===

function initStep0() {
  showPanel("panel-0");
  showPill(0);
  // Portal sign-in is the DEFAULT path for non-technical customers (store pilots):
  // install -> sign in to portal.aitherium.com -> land in your feature-locked apps.
  // BYOK / Fleet remain one click away for power users.
  state.choice = "portal";
  const byokCard = $("choice-byok");
  const fleetCard = $("choice-fleet");
  const portalCard = $("choice-portal");
  if (byokCard) byokCard.classList.remove("selected");
  if (fleetCard) fleetCard.classList.remove("selected");
  if (portalCard) portalCard.classList.add("selected");
  $("choice-confirm").disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  const byokCard = $("choice-byok");
  const fleetCard = $("choice-fleet");
  const portalCard = $("choice-portal");

  const selectChoice = (choice) => {
    state.choice = choice;
    byokCard.classList.toggle("selected", choice === "byok");
    fleetCard.classList.toggle("selected", choice === "fleet");
    portalCard.classList.toggle("selected", choice === "portal");
    $("choice-confirm").disabled = !choice;
  };

  byokCard.addEventListener("click", () => selectChoice("byok"));
  fleetCard.addEventListener("click", () => selectChoice("fleet"));
  portalCard.addEventListener("click", () => selectChoice("portal"));

  $("choice-confirm").addEventListener("click", async () => {
    if (state.choice === "byok") {
      initBYOKProvider();
    } else if (state.choice === "fleet") {
      initFleet();
    } else if (state.choice === "portal") {
      initPortal();
    }
  });

  initStep0();
});

// === BYOK PATH ===

// On-device (WebGPU) providers have no API key and can't be verified with the
// live-fetch "Test connection" step, so they'd dead-end this BYOK funnel
// (card reads "API key required", verify fails). They're set up from the
// Options page, which gates on WebGPU/offscreen availability. Keep them out of
// onboarding entirely.
function byokProviderIds() {
  return Prov.listProviders().filter((id) => !Prov.getProvider(id)?.local);
}

async function initBYOKProvider() {
  showPanel("panel-byok-provider");
  showPill(1);

  const list = $("byok-provider-list");
  list.innerHTML = "";

  const providerIds = byokProviderIds();
  providerIds.forEach((id) => {
    const def = Prov.getProvider(id);
    const card = document.createElement("div");
    card.className = "mode-card";
    card.innerHTML = `
      <div class="title">${escapeHtml(def.name)}</div>
      <div class="body">${escapeHtml(def.keyPlaceholder || "API key required")}</div>
    `;
    card.addEventListener("click", () => selectBYOKProvider(id));
    list.appendChild(card);
  });
}

function selectBYOKProvider(id) {
  state.byokProvider = id;
  document.querySelectorAll("#byok-provider-list .mode-card").forEach((card, i) => {
    const provIds = byokProviderIds();
    card.classList.toggle("selected", i === provIds.indexOf(id));
  });
  $("continue-byok-key").disabled = false;
}

$("continue-byok-key").addEventListener("click", initBYOKKey);

async function initBYOKKey() {
  showPanel("panel-byok-key");

  const def = Prov.getProvider(state.byokProvider);
  $("byok-key-title").textContent = `Enter your ${def.name} API key`;
  $("byok-key-desc").textContent = `Get a key from ${def.keyUrl ? def.name : "your provider"}${def.keyUrl ? " (sign in required)" : ""}`;

  // Show origins help for Ollama
  const originsHelp = $("byok-origins-help");
  if (state.byokProvider === "ollama") {
    originsHelp.textContent = `Ollama is running at http://localhost:11434. The extension can access it locally without extra permissions.`;
    originsHelp.classList.remove("hidden");
  } else {
    originsHelp.classList.add("hidden");
  }

  // Show base URL field for custom provider
  const baseUrlField = $("byok-baseurl-field");
  if (state.byokProvider === "custom") {
    baseUrlField.classList.remove("hidden");
  } else {
    baseUrlField.classList.add("hidden");
  }

  // Populate model dropdown
  const modelSelect = $("byok-model");
  modelSelect.innerHTML = "";

  if (def.models && def.models.length > 0) {
    def.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    });
  }

  if (def.allowCustomModel) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Custom model —";
    modelSelect.appendChild(opt);
  }

  $("byok-api-key").value = "";
  $("byok-base-url").value = "";
  msg("byok-key-message", "");
  $("byok-test-connection").disabled = false;
  $("byok-save").disabled = true;

  showPill(1);
}

$("back-from-byok-provider").addEventListener("click", initStep0);
$("back-from-byok-key").addEventListener("click", initBYOKProvider);

$("byok-test-connection").addEventListener("click", async () => {
  const apiKey = $("byok-api-key").value.trim();
  const baseUrl = $("byok-base-url").value.trim();
  const model = $("byok-model").value.trim();

  if (!apiKey && state.byokProvider !== "ollama") {
    msg("byok-key-message", "API key required.");
    return;
  }

  if (state.byokProvider === "custom" && !baseUrl) {
    msg("byok-key-message", "Base URL required for custom endpoints.");
    return;
  }

  $("byok-test-connection").disabled = true;
  msg("byok-key-message", "Testing…", "warn");

  try {
    const testCfg = {
      apiKey,
      model,
      baseUrlOverride: baseUrl,
    };
    const req = Prov.buildTestRequest(state.byokProvider, testCfg);
    if (req.error) {
      msg("byok-key-message", req.error);
      return;
    }

    // Request the provider's host permission inside this user gesture —
    // OpenAI in particular needs the grant (no CORS headers on its API).
    // localhost (Ollama) is already covered by manifest host_permissions.
    try {
      const origin = new URL(req.url).origin;
      if (!/localhost|127\.0\.0\.1/.test(origin)) {
        await chrome.permissions.request({ origins: [`${origin}/*`] });
      }
    } catch (_) { /* permission prompt declined — the fetch below will say so */ }

    const r = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
    });

    if (!r.ok) {
      const text = await r.text();
      msg("byok-key-message", `Error (HTTP ${r.status}): ${text.substring(0, 100)}`);
      return;
    }

    msg("byok-key-message", "Connection successful!", "success");
    $("byok-save").disabled = false;
  } catch (e) {
    msg("byok-key-message", `Network error: ${e.message}`);
  } finally {
    $("byok-test-connection").disabled = false;
  }
});

$("byok-save").addEventListener("click", async () => {
  const apiKey = $("byok-api-key").value.trim();
  const baseUrl = $("byok-base-url").value.trim();
  const model = $("byok-model").value.trim();

  const def = Prov.getProvider(state.byokProvider);
  state.byokConfig = {
    id: state.byokProvider,
    apiKey,
    model: model || def.models?.[0]?.id || "",
    baseUrl: baseUrl || undefined,
  };

  if (def.defaultEmbeddingModel) {
    state.byokConfig.embeddingModel = def.defaultEmbeddingModel;
  }

  // Save to chrome.storage.local (never sync)
  await Prov.setProviderConfig(state.byokConfig);

  // Save settings with preferred tier
  const settings = await getCurrentSettings();
  settings.preferredTier = "provider";
  await saveSettings(settings);

  // Mark onboarded
  await chrome.storage.local.set({
    aither_onboarded_at: Date.now(),
    aither_mode: "byok",
  });

  showPanel("panel-byok-finish");
  showPill(3);
});

$("byok-open-kb").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("kb/kb.html") });
});

$("byok-open-sidepanel").addEventListener("click", () => {
  chrome.sidePanel.open({ window: chrome.windows.WINDOW_ID_CURRENT });
});

// === FLEET PATH ===

async function initFleet() {
  showPanel("panel-1");
  showPill(1);
  msg("fleet-message", "");
  await recheckFleet();
}

$("back-from-fleet").addEventListener("click", initStep0);
$("recheck-fleet").addEventListener("click", recheckFleet);

async function recheckFleet() {
  const statusEl = $("status-node-fleet");
  statusEl.className = "status miss";
  statusEl.textContent = "checking…";

  try {
    const r = await fetch("http://127.0.0.1:8090/health", { method: "GET", mode: "cors" });
    if (r.ok) {
      statusEl.className = "status ok";
      statusEl.textContent = "running";
    } else {
      statusEl.className = "status err";
      statusEl.textContent = `HTTP ${r.status}`;
    }
  } catch (_) {
    statusEl.className = "status miss";
    statusEl.textContent = "not detected";
  }
}

$("finish-fleet").addEventListener("click", async () => {
  const settings = await getCurrentSettings();
  settings.preferredTier = "genesis";
  await saveSettings(settings);

  await chrome.storage.local.set({
    aither_onboarded_at: Date.now(),
    aither_mode: "fleet",
  });

  msg("fleet-message", "Setup complete. Open the side panel to start.", "success");
  setTimeout(() => {
    chrome.sidePanel.open({ window: chrome.windows.WINDOW_ID_CURRENT });
  }, 500);
});

// === PORTAL PATH ===

async function initPortal() {
  showPanel("panel-2");
  showPill(1);

  const rec = await P.getPortalRecord();
  $("portal-url").value = rec.url || P.PORTAL_DEFAULT_URL;
  $("login-email").value = "";
  $("login-password").value = "";
  $("twofa-field").classList.add("hidden");
  msg("portal-message", "");
  state.temp2faToken = null;
}

$("back-from-portal").addEventListener("click", initStep0);

$("open-signup").addEventListener("click", (e) => {
  e.preventDefault();
  const url = $("portal-url").value.trim() || P.PORTAL_DEFAULT_URL;
  chrome.tabs.create({ url: `${url.replace(/\/+$/, "")}/signup` });
});

$("do-login").addEventListener("click", async () => {
  msg("portal-message", "");
  const url = $("portal-url").value.trim() || P.PORTAL_DEFAULT_URL;
  await P.setPortalRecord({ url });

  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    msg("portal-message", "Email and password are required.");
    return;
  }

  $("do-login").disabled = true;
  try {
    if (state.temp2faToken) {
      const code = $("login-2fa").value.trim();
      const r = await P.portalVerify2fa({ temp_token: state.temp2faToken, code });
      if (!r.ok) {
        msg("portal-message", r.error || "2FA verification failed.");
        return;
      }
      state.temp2faToken = null;
    } else {
      const r = await P.portalLogin({ email, password });
      if (!r.ok && r.requires_2fa) {
        state.temp2faToken = r.temp_token;
        $("twofa-field").classList.remove("hidden");
        msg("portal-message", "Enter the 2FA code from your authenticator.", "warn");
        return;
      }
      if (!r.ok) {
        msg("portal-message", r.error || "Sign-in failed.");
        return;
      }
    }
    const me = await P.portalMe();
    if (!me.ok) {
      msg("portal-message", "Signed in but could not load profile. Continuing.", "warn");
    } else {
      state.user = me.user;
    }
    msg("portal-message", "Signed in.", "success");
    setTimeout(() => initPortalMode(), 350);
  } catch (e) {
    msg("portal-message", `Network error: ${e.message}`);
  } finally {
    $("do-login").disabled = false;
  }
});

function initPortalMode() {
  showPanel("panel-3");
  showPill(1);

  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.remove("selected");
  });
  state.portalMode = null;
  $("continue-to-provision").disabled = true;
}

document.querySelectorAll("#panel-3 .mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.portalMode = card.dataset.mode;
    document.querySelectorAll("#panel-3 .mode-card").forEach((c) => {
      c.classList.toggle("selected", c === card);
    });
    $("continue-to-provision").disabled = false;
  });
});

$("back-from-mode").addEventListener("click", initPortal);

$("continue-to-provision").addEventListener("click", () => {
  initProvision();
  showPanel("panel-4");
  showPill(2);
});

// === PROVISION (PORTAL PATH) ===

async function initProvision() {
  $("step4-title").textContent =
    state.portalMode === "cloud" ? "Register this browser with the portal"
    : state.portalMode === "hybrid" ? "Register and check your local stack"
    : "Configure local-only mode";

  $("step4-desc").textContent =
    state.portalMode === "cloud" ? "We'll provision a scoped API key bound to this browser identity. No local install required."
    : state.portalMode === "hybrid" ? "We'll register the browser with portal and probe for AitherNode running locally."
    : "Nothing will be sent to the portal. Make sure AitherOS is running locally (or install it below).";

  const showPortal = state.portalMode === "cloud" || state.portalMode === "hybrid";
  const showLocal = state.portalMode === "hybrid" || state.portalMode === "local";
  $("provision-portal").classList.toggle("hidden", !showPortal);
  $("provision-local").classList.toggle("hidden", !showLocal);
  $("provision-result").innerHTML = "";
  msg("step4-message", "");

  if (showPortal) {
    const suggested = (state.user?.email || "browser")
      .replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 32) + "-conn";
    $("agent-name").value = suggested;
  }
  if (showLocal) await recheckLocal();
}

$("back-from-provision").addEventListener("click", () => {
  showPanel("panel-3");
  showPill(1);
});

$("recheck-local").addEventListener("click", recheckLocal);

async function recheckLocal() {
  await probeAndPaint("status-node", "http://127.0.0.1:8090/health");
  const shell = $("status-shell");
  shell.className = "status miss";
  shell.textContent = "install via pip";
}

async function probeAndPaint(id, url) {
  const el = $(id);
  el.className = "status miss";
  el.textContent = "checking…";
  try {
    const r = await fetch(url, { method: "GET", mode: "cors" });
    if (r.ok) {
      el.className = "status ok";
      el.textContent = "running";
    } else {
      el.className = "status err";
      el.textContent = `HTTP ${r.status}`;
    }
  } catch (_) {
    el.className = "status miss";
    el.textContent = "not detected";
  }
}

$("finish").addEventListener("click", async () => {
  msg("step4-message", "");
  $("finish").disabled = true;
  try {
    let bundle = null;

    if (state.portalMode === "cloud" || state.portalMode === "hybrid") {
      const name = $("agent-name").value.trim() || "browser-conn";
      const r = await P.portalQuickOnboard({
        agent_name: name,
        description: "AitherConnect browser extension",
      });
      if (!r.ok) {
        msg("step4-message", r.error || "Portal onboard failed.");
        return;
      }
      bundle = r.bundle;
      state.bundle = bundle;
      renderBundle(bundle);
    }

    const settings = await getCurrentSettings();
    if (state.portalMode === "cloud") {
      settings.remoteUrl = bundle?.inference?.base_url || (await P.getPortalUrl());
      settings.apiKey = bundle?.api_key || settings.apiKey;
      settings.standaloneMode = false;
    } else if (state.portalMode === "hybrid") {
      settings.remoteUrl = "";
      settings.apiKey = bundle?.api_key || settings.apiKey;
      settings.standaloneMode = false;
    } else if (state.portalMode === "local") {
      settings.remoteUrl = "";
      settings.standaloneMode = true;
    }
    if (bundle?.scope) {
      settings.tenantId = bundle.scope.tenant_id || settings.tenantId;
      settings.workspaceId = bundle.scope.workspace_id || settings.workspaceId;
      settings.userId = bundle.scope.owner_user_id || settings.userId;
    } else if (state.user) {
      settings.userId = state.user.email || settings.userId;
      settings.tenantId = state.user.tenant_id || settings.tenantId;
      settings.workspaceId = state.user.workspace_id || settings.workspaceId;
    }
    await saveSettings(settings);
    await chrome.storage.local.set({
      aither_onboarded_at: Date.now(),
      aither_mode: state.portalMode,
    });

    msg("step4-message", "Setup complete. You can close this tab.", "success");
    showPill(3);
  } catch (e) {
    msg("step4-message", `Unexpected error: ${e.message}`);
  } finally {
    $("finish").disabled = false;
  }
});

function renderBundle(b) {
  const scope = b.scope || {};
  $("provision-result").innerHTML = `
    <div class="message success">
      Registered as <code>${escapeHtml(b.agent_name || "agent")}</code> (id
      <code>${escapeHtml(b.agent_id || "")}</code>).
    </div>
    <div class="scope-list" style="margin-top:8px">
      tenant: <span>${escapeHtml(scope.tenant_id || "—")}</span>
      &nbsp;workspace: <span>${escapeHtml(scope.workspace_id || "—")}</span>
      &nbsp;visibility: <span>${escapeHtml(scope.visibility || "workspace")}</span>
    </div>
  `;
}

// === SETTINGS BRIDGE ===

function getCurrentSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-settings" }, (resp) => {
      resolve((resp && resp.settings) || {});
    });
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "save-settings", settings }, (resp) => {
      resolve(resp || { ok: false });
    });
  });
}
