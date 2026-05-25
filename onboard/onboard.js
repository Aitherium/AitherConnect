/**
 * AitherConnect onboarding wizard
 * 3 steps: portal sign-in → pick mode → provision.
 */

const $ = (id) => document.getElementById(id);
const P = self.AitherPortal;

let state = {
  step: 1,
  mode: null, // 'cloud' | 'hybrid' | 'local'
  temp2faToken: null,
  bundle: null,
  user: null,
};

function showPill(n) {
  for (let i = 1; i <= 3; i++) {
    const pill = $(`pill-${i}`);
    pill.classList.toggle("active", i === n);
    pill.classList.toggle("done", i < n);
  }
}
function showPanel(n) {
  for (let i = 1; i <= 3; i++) {
    $(`panel-${i}`).classList.toggle("hidden", i !== n);
  }
  showPill(n);
  state.step = n;
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

// ---- Step 1: portal sign-in ------------------------------------------------

async function initStep1() {
  const rec = await P.getPortalRecord();
  $("portal-url").value = rec.url || P.PORTAL_DEFAULT_URL;
}

$("open-signup").addEventListener("click", (e) => {
  e.preventDefault();
  const url = $("portal-url").value.trim() || P.PORTAL_DEFAULT_URL;
  chrome.tabs.create({ url: `${url.replace(/\/+$/, "")}/signup` });
});

$("skip-portal").addEventListener("click", () => {
  state.mode = "local";
  showPanel(2);
  selectModeCard("local");
});

$("do-login").addEventListener("click", async () => {
  msg("step1-message", "");
  const url = $("portal-url").value.trim() || P.PORTAL_DEFAULT_URL;
  await P.setPortalRecord({ url });

  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    msg("step1-message", "Email and password are required.");
    return;
  }

  $("do-login").disabled = true;
  try {
    if (state.temp2faToken) {
      const code = $("login-2fa").value.trim();
      const r = await P.portalVerify2fa({ temp_token: state.temp2faToken, code });
      if (!r.ok) {
        msg("step1-message", r.error || "2FA verification failed.");
        return;
      }
      state.temp2faToken = null;
    } else {
      const r = await P.portalLogin({ email, password });
      if (!r.ok && r.requires_2fa) {
        state.temp2faToken = r.temp_token;
        $("twofa-field").classList.remove("hidden");
        msg("step1-message", "Enter the 2FA code from your authenticator.", "warn");
        return;
      }
      if (!r.ok) {
        msg("step1-message", r.error || "Sign-in failed.");
        return;
      }
    }
    const me = await P.portalMe();
    if (!me.ok) {
      msg("step1-message", "Signed in but could not load profile. Continuing.", "warn");
    } else {
      state.user = me.user;
    }
    msg("step1-message", "Signed in.", "success");
    setTimeout(() => showPanel(2), 350);
  } catch (e) {
    msg("step1-message", `Network error: ${e.message}`);
  } finally {
    $("do-login").disabled = false;
  }
});

// ---- Step 2: mode ----------------------------------------------------------

function selectModeCard(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.mode === mode);
  });
  $("continue-to-3").disabled = false;
}

document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => selectModeCard(card.dataset.mode));
});

$("back-to-1").addEventListener("click", () => showPanel(1));
$("continue-to-3").addEventListener("click", () => {
  initStep3();
  showPanel(3);
});

// ---- Step 3: provision -----------------------------------------------------

async function initStep3() {
  $("step3-title").textContent =
    state.mode === "cloud" ? "Register this browser with the portal"
    : state.mode === "hybrid" ? "Register and check your local stack"
    : "Configure local-only mode";

  $("step3-desc").textContent =
    state.mode === "cloud" ? "We'll provision a scoped API key bound to this browser identity. No local install required."
    : state.mode === "hybrid" ? "We'll register the browser with portal and probe for AitherShell + AitherNode running locally."
    : "Nothing will be sent to the portal. Make sure AitherOS is running locally (or install it below).";

  const showPortal = state.mode === "cloud" || state.mode === "hybrid";
  const showLocal = state.mode === "hybrid" || state.mode === "local";
  $("provision-portal").classList.toggle("hidden", !showPortal);
  $("provision-local").classList.toggle("hidden", !showLocal);
  $("provision-result").innerHTML = "";
  msg("step3-message", "");

  if (showPortal) {
    const suggested = (state.user?.email || "browser")
      .replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 32) + "-conn";
    $("agent-name").value = suggested;
  }
  if (showLocal) await recheckLocal();
}

$("back-to-2").addEventListener("click", () => showPanel(2));
$("recheck-local").addEventListener("click", recheckLocal);

async function recheckLocal() {
  await Promise.all([
    probeAndPaint("status-shell", "http://127.0.0.1:8090/health"),
    probeAndPaint("status-node",  "http://127.0.0.1:8090/health"),
  ]);
  // Shell doesn't expose an HTTP probe; we just label "install via pip".
  // Override: show shell as "manual" rather than miss/ok.
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
  msg("step3-message", "");
  $("finish").disabled = true;
  try {
    let bundle = null;

    if (state.mode === "cloud" || state.mode === "hybrid") {
      const name = $("agent-name").value.trim() || "browser-conn";
      const r = await P.portalQuickOnboard({
        agent_name: name,
        description: "AitherConnect browser extension",
      });
      if (!r.ok) {
        msg("step3-message", r.error || "Portal onboard failed.");
        return;
      }
      bundle = r.bundle;
      state.bundle = bundle;
      renderBundle(bundle);
    }

    // Persist into the legacy settings shape so the rest of the extension
    // (background worker, popup, options page) picks up the new mode.
    const settings = await getCurrentSettings();
    if (state.mode === "cloud") {
      settings.remoteUrl = bundle?.inference?.base_url || (await P.getPortalUrl());
      settings.apiKey = bundle?.api_key || settings.apiKey;
      settings.standaloneMode = false;
    } else if (state.mode === "hybrid") {
      settings.remoteUrl = ""; // local-first
      settings.apiKey = bundle?.api_key || settings.apiKey;
      settings.standaloneMode = false;
    } else if (state.mode === "local") {
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
    await chrome.storage.local.set({ aither_onboarded_at: Date.now(), aither_mode: state.mode });

    msg("step3-message", "Setup complete. You can close this tab.", "success");
  } catch (e) {
    msg("step3-message", `Unexpected error: ${e.message}`);
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

// ---- Settings bridge (talks to the background worker) ---------------------

function getCurrentSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "get-settings" }, (resp) => {
      resolve((resp && resp.settings) || {});
    });
  });
}
function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "save-settings", settings }, (resp) => {
      resolve(resp || { ok: false });
    });
  });
}

// ---- Boot ------------------------------------------------------------------

initStep1();
showPanel(1);
