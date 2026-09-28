/**
 * Awconnect onboarding wizard.
 *
 * Step 0  Get AitherOS on this computer: probe the adk daemon (:9001), the awsh
 *         harness daemon (:8362) and the MCP gateway (:8182); when none answers,
 *         show the one-line awdk+awsh installer with "Check again".
 *         "Just use an API key" (BYOK) stays one click away.
 * Step 1  Sign in, passwordless: "Sign in with Aitherium" runs Identity's device
 *         flow (the endpoints `adk login` uses); "Email me a sign-in link" is the
 *         same flow with the account's address, so Identity mails a one-tap
 *         approve link. The password form sits behind "Use a password instead".
 *         With AitherOS local, "Skip - use this computer only" needs no account.
 * Step 2  Mode + provision (unchanged).
 *
 * A portal/fleet that does not answer (network error, 5xx) is reported as
 * "unreachable (maintenance or offline)", never as a generic failure -- measured
 * 2026-09-27: portal.aitherium.com answered 503 and the old form said
 * "Network error".
 */

const $ = (id) => document.getElementById(id);
const P = self.AitherPortal;
const Prov = self.AitherProviders;
const Flow = self.AitherOnboardFlow;
const LocalEP = self.AitherLocalEndpoints;

let state = {
  step: 0,
  choice: null, // 'byok' | 'fleet' | 'portal'
  byokProvider: null, // provider id
  byokConfig: null, // {id, apiKey, model, baseUrl, embeddingModel}
  portalMode: null, // 'cloud' | 'hybrid' | 'local'
  bundle: null,
  user: null,
  local: null, // last probeLocal() result
  device: null, // {device_code, user_code, verification_uri_complete, interval, expires_in}
  deviceCancelled: false,
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

// === STEP 0: GET AITHEROS ON THIS COMPUTER ===

async function localEndpointMap() {
  try {
    if (LocalEP) return (await LocalEP.localEndpoints({ force: true })).endpoints;
  } catch (_) { /* fall back to the defaults inside probeLocal */ }
  return {};
}

function paintProbe(id, r) {
  const el = $(id);
  if (!el) return;
  if (r && r.ok) {
    el.className = "status ok";
    el.textContent = "running";
  } else if (r && r.status) {
    el.className = "status err";
    el.textContent = `HTTP ${r.status}`;
  } else {
    el.className = "status miss";
    el.textContent = "not detected";
  }
}

async function detectLocal() {
  ["status-adk", "status-awsh", "status-awnode"].forEach((id) => {
    const el = $(id);
    if (el) { el.className = "status miss"; el.textContent = "checking…"; }
  });
  const local = await Flow.probeLocal({ fetch: (u, o) => fetch(u, o), endpoints: await localEndpointMap() });
  state.local = local;
  paintProbe("status-adk", local.adk);
  paintProbe("status-awsh", local.awsh);
  paintProbe("status-awnode", local.awnode);
  $("local-found").classList.toggle("hidden", !local.found);
  $("local-install").classList.toggle("hidden", local.found);
  $("choice-confirm").textContent = local.found ? "Continue" : "Continue without installing";
  return local;
}

function initStep0() {
  showPanel("panel-0");
  showPill(0);
  const platform = Flow.platformOf();
  $("install-cmd").textContent = Flow.installCommand(platform);
  $("install-os").textContent = platform === "windows" ? "Windows PowerShell" : platform === "mac" ? "macOS Terminal" : "Linux shell";
  msg("local-message", "");
  detectLocal();
}

document.addEventListener("DOMContentLoaded", () => {
  $("choice-byok").addEventListener("click", () => {
    state.choice = "byok";
    initBYOKProvider();
  });
  $("recheck-local0").addEventListener("click", detectLocal);
  $("copy-install").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("install-cmd").textContent);
      $("copy-install-msg").textContent = "Copied. Paste it into a terminal.";
    } catch (_) {
      $("copy-install-msg").textContent = "Select the command above and copy it.";
    }
  });
  $("choice-confirm").addEventListener("click", () => {
    state.choice = "portal";
    initPortal();
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

// === LOCAL-ONLY PATH (no account) ===

async function initFleet() {
  showPanel("panel-1");
  showPill(2);
  msg("fleet-message", "");
  await recheckFleet();
}

$("back-from-fleet").addEventListener("click", () => initPortal());
$("recheck-fleet").addEventListener("click", recheckFleet);

async function recheckFleet() {
  const statusEl = $("status-node-fleet");
  statusEl.className = "status miss";
  statusEl.textContent = "checking…";
  const local = await detectLocal();
  if (local.found) {
    statusEl.className = "status ok";
    statusEl.textContent = ["adk", "awsh", "awnode"].filter((k) => local[k] && local[k].ok).join(" + ");
  } else {
    statusEl.className = "status miss";
    statusEl.textContent = "not detected";
    msg("fleet-message", "Nothing is running on this computer yet. Go back and install awdk + awsh first.", "warn");
  }
}

// "Finish setup" on the local-only panel: no account, the local stack serves.
$("finish-fleet").addEventListener("click", async () => {
  $("finish-fleet").disabled = true;
  try {
    const settings = await getCurrentSettings();
    settings.preferredTier = "genesis";
    await saveSettings(settings);

    await chrome.storage.local.set({
      aither_onboarded_at: Date.now(),
      aither_mode: "fleet",
    });

    msg("fleet-message", "Setup complete. Open the side panel to start.", "success");
    showPill(3);
    setTimeout(() => {
      chrome.sidePanel.open({ window: chrome.windows.WINDOW_ID_CURRENT });
    }, 500);
  } finally {
    $("finish-fleet").disabled = false;
  }
});

// === SIGN-IN (PASSWORDLESS FIRST) ===

function identityUrl() {
  // The portal URL field is only for the password fallback; the device flow
  // lives on Identity (idp.aitherium.com for the hosted topology).
  return Flow.identityUrlFor($("portal-url").value.trim() || P.PORTAL_DEFAULT_URL);
}

async function initPortal() {
  showPanel("panel-2");
  showPill(1);

  const rec = await P.getPortalRecord();
  $("portal-url").value = rec.url || P.PORTAL_DEFAULT_URL;
  $("device-box").classList.add("hidden");
  $("device-signin").disabled = false;
  msg("portal-message", "");
  $("skip-signin").classList.toggle("hidden", !(state.local && state.local.found));

  // The local node's identity, when its daemon will say (a name, never a token).
  const idBox = $("local-identity");
  idBox.classList.add("hidden");
  if (state.local && state.local.adk && state.local.adk.ok) {
    const who = await Flow.localIdentity({ fetch: (u, o) => fetch(u, o), adkUrl: state.local.adk.url });
    if (who) {
      idBox.textContent = `This computer is signed in as ${who.display_name || who.username}. Approve the same account below.`;
      idBox.classList.remove("hidden");
    }
  }

  // Hide the email option when Identity says it cannot send mail; say so plainly
  // when Identity does not answer at all.
  const methods = await Flow.authMethods({ fetch: (u, o) => fetch(u, o), identityUrl: identityUrl() });
  $("magic-block").classList.toggle("hidden", methods.magic_link === false);
  if (!methods.reachable) msg("portal-message", Flow.UNREACHABLE_MESSAGE, "warn");
}

$("back-from-portal").addEventListener("click", () => {
  state.deviceCancelled = true;
  initStep0();
});

$("skip-signin").addEventListener("click", () => {
  state.deviceCancelled = true;
  state.choice = "fleet";
  initFleet();
});

$("open-signup").addEventListener("click", (e) => {
  e.preventDefault();
  const url = $("portal-url").value.trim() || P.PORTAL_DEFAULT_URL;
  chrome.tabs.create({ url: `${url.replace(/\/+$/, "")}/signup` });
});

async function runDeviceSignIn({ email } = {}) {
  msg("portal-message", "");
  const idp = identityUrl();
  $("device-signin").disabled = true;
  $("magic-send").disabled = true;
  state.deviceCancelled = false;
  try {
    const started = await Flow.startDeviceFlow({ fetch: (u, o) => fetch(u, o), identityUrl: idp, email });
    if (!started.ok) {
      msg("portal-message", started.message, started.kind === "unreachable" ? "warn" : "error");
      return;
    }
    state.device = started;
    $("device-code").textContent = started.user_code;
    $("device-box").classList.remove("hidden");
    if (email) {
      $("device-status").textContent =
        `If ${email} has an Aitherium account, a sign-in link is on its way. Tap it (on any device), ` +
        "then confirm this code. Waiting…";
    } else {
      $("device-status").textContent = "Waiting for you to approve in the tab we opened…";
      chrome.tabs.create({ url: started.verification_uri_complete });
    }
    const result = await Flow.pollDeviceFlow({
      fetch: (u, o) => fetch(u, o),
      identityUrl: idp,
      deviceCode: started.device_code,
      interval: started.interval,
      expiresIn: started.expires_in,
      isCancelled: () => state.deviceCancelled,
    });
    if (!result.ok) {
      if (result.kind !== "cancelled") {
        msg("portal-message", result.message, result.kind === "unreachable" ? "warn" : "error");
      }
      $("device-box").classList.add("hidden");
      return;
    }
    await P.setPortalBearer(result.token);
    await P.setPortalRecord({
      identity_url: idp, authenticated_at: Date.now(),
      auth_method: email ? "device_email" : "device",
    });
    const me = await Flow.identityMe({ fetch: (u, o) => fetch(u, o), identityUrl: idp, token: result.token });
    if (me.ok) state.user = me.user;
    $("device-status").textContent = "Approved.";
    msg("portal-message", `Signed in${state.user && state.user.email ? ` as ${state.user.email}` : ""}.`, "success");
    setTimeout(() => initPortalMode(), 350);
  } catch (e) {
    msg("portal-message", Flow.UNREACHABLE_MESSAGE, "warn");
  } finally {
    $("device-signin").disabled = false;
    $("magic-send").disabled = false;
  }
}

$("device-signin").addEventListener("click", () => runDeviceSignIn());
$("magic-send").addEventListener("click", () => {
  const email = $("magic-email").value.trim();
  if (!email || !email.includes("@")) {
    msg("portal-message", "Enter the email address of your Aitherium account.");
    return;
  }
  runDeviceSignIn({ email });
});
$("device-cancel").addEventListener("click", () => {
  state.deviceCancelled = true;
  $("device-box").classList.add("hidden");
});
$("device-reopen").addEventListener("click", () => {
  if (state.device && state.device.verification_uri_complete) {
    chrome.tabs.create({ url: state.device.verification_uri_complete });
  }
});

/** A failure from the portal: "unreachable" wording for network/5xx. */
function portalFailure(r, fallback) {
  const c = Flow.classifyFailure({ status: r && r.status, error: r && r.status === undefined ? "network" : null });
  if (c.kind === "unreachable") return { text: c.message, kind: "warn" };
  return { text: (r && r.error) || fallback, kind: "error" };
}

function initPortalMode() {
  showPanel("panel-3");
  showPill(1);

  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.remove("selected");
  });
  state.portalMode = null;
  $("continue-to-provision").disabled = true;
  // AitherOS on this computer: preselect "local", which needs nothing from the
  // portal. "hybrid" registers with portal.aitherium.com, which can be down
  // (measured 503 on 2026-09-27); the owner picks it deliberately.
  if (state.local && state.local.found) {
    const local = document.querySelector('#panel-3 .mode-card[data-mode="local"]');
    if (local) {
      local.classList.add("selected");
      state.portalMode = "local";
      $("continue-to-provision").disabled = false;
    }
  }
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
    : state.portalMode === "hybrid" ? "We'll register the browser with portal and probe for awnode running locally."
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
  $("provision-install-cmd").textContent = Flow.installCommand(Flow.platformOf());
  const local = await detectLocal();
  paintProbe("status-node", local.adk && local.adk.ok ? local.adk : local.awnode);
  paintProbe("status-shell", local.awsh);
}

$("finish").addEventListener("click", async () => {
  msg("step4-message", "");
  $("finish").disabled = true;
  try {
    let bundle = null;
    let degraded = null;

    if (state.portalMode === "cloud" || state.portalMode === "hybrid") {
      // The signed-in account's workspaces ARE the scope (the old quick-onboard
      // route never existed on the platform).
      let r;
      try {
        r = await P.fetchWorkspaceMetadata();
      } catch (_) {
        r = { ok: false }; // network error: status undefined -> "unreachable"
      }
      if (!r.ok) {
        const f = portalFailure(r, "Could not load your workspaces.");
        // Hybrid with the portal down: the local half still works, so finish
        // local-only rather than dead-ending (register again later).
        if (state.portalMode === "hybrid" && f.kind === "warn") {
          state.portalMode = "local";
          degraded = f.text;
        } else {
          msg("step4-message", f.text, f.kind);
          return;
        }
      } else {
        const ws = (r.workspaces || []).find((w) => w.is_default || w.default) || (r.workspaces || [])[0];
        bundle = ws ? { scope: { tenant_id: ws.tenant_id || "", workspace_id: ws.id || ws.slug || "" } } : null;
        state.bundle = bundle;
      }
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

    msg("step4-message",
      degraded ? `Set up for this computer only. ${degraded} Register with the portal later from Options.`
        : "Setup complete. You can close this tab.",
      degraded ? "warn" : "success");
    showPill(3);
  } catch (e) {
    msg("step4-message", Flow.UNREACHABLE_MESSAGE, "warn");
  } finally {
    $("finish").disabled = false;
  }
});

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
