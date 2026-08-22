/**
 * Lockbox tab — Personal + Workspace secrets browser
 *
 * Three sections, only rendered if available:
 *   1. Personal Secrets — /lockbox/user (POST/DELETE/GET names)
 *   2. Workspace Secrets — /workspace-secrets (GET keys, POST/DELETE set/delete)
 *   3. Admin Vault — /api/admin/vault (GET names, GET single value, auto-hide after 30s)
 *
 * All calls ride the user's portal session (credentials: "include").
 * Never console.log secret values. No stored tokens in the extension.
 *
 * BACKEND ROUTES (genesis proxy):
 *   GET /lockbox/user                    → list personal secret names
 *   PUT /lockbox/user/{name}             → set personal secret { value }
 *   DELETE /lockbox/user/{name}          → delete personal secret
 *   (personal values are WRITE-ONLY — genesis has no value-read route)
 *
 *   GET /workspace-secrets/keys          → list workspace secret keys
 *   POST /workspace-secrets/set          → set { key, value }
 *   POST /workspace-secrets/delete       → delete { key }
 *   GET /workspace-secrets/value?key=K   → get workspace secret value (audit-logged)
 *
 *   GET /api/admin/vault                 → list vault names (admin-only)
 *   GET /api/admin/vault/{name}          → get vault value (admin-only)
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    veilPort: 3000,
    // Personal secrets
    personalSecrets: [],
    personalFilter: "",
    // Workspace secrets
    workspaceSecrets: [],
    workspaceFilter: "",
    // Admin vault
    adminSecrets: [],
    adminFilter: "",
    adminRevealed: null,  // { name, value, timer }
    // Feature flags
    hasPersonal: false,
    hasWorkspace: false,
    hasAdmin: false,
    loaded: false,
  };

  const els = {};

  function cacheEls() {
    els.tabBtn = document.querySelector('.nav-tab[data-panel="lockbox"]');
    els.panel = $("panel-lockbox");
    // Personal
    els.personalStatus = $("lockbox-personal-status");
    els.personalName = $("lockbox-personal-name");
    els.personalValue = $("lockbox-personal-value");
    els.personalAdd = $("lockbox-personal-add");
    els.personalList = $("lockbox-personal-list");
    // Workspace
    els.workspaceSection = $("lockbox-workspace-section");
    els.workspaceStatus = $("lockbox-workspace-status");
    els.workspaceKey = $("lockbox-workspace-key");
    els.workspaceValue = $("lockbox-workspace-value");
    els.workspaceSet = $("lockbox-workspace-set");
    els.workspaceList = $("lockbox-workspace-list");
    // Admin
    els.adminSection = $("lockbox-admin-section");
    els.adminFilter = $("lockbox-admin-filter");
    els.adminRefresh = $("lockbox-admin-refresh");
    els.adminList = $("lockbox-admin-list");
    // Sign-in prompt
    els.signinPrompt = $("lockbox-signin-prompt");
  }

  function base() {
    return `http://127.0.0.1:${state.veilPort}`;
  }

  async function loadSettings() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
      if (resp && resp.settings && resp.settings.veilPort) {
        state.veilPort = resp.settings.veilPort;
      }
    } catch {
      /* keep default port */
    }
  }

  /**
   * Fetch with the portal session cookie (credentials: include).
   * Genesis is proxied through Veil's bridge at /api/bridge/genesis/...
   */
  async function fetchLockbox(path, opts = {}) {
    const url = `${base()}/api/bridge/genesis/${path.replace(/^\/+/, "")}`;
    return fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
  }

  /**
   * Fetch vault endpoint (admin-only, served by Veil).
   */
  async function fetchVault(path, opts = {}) {
    const url = `${base()}/api/admin/vault${path}`;
    return fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
  }

  /**
   * Load personal secrets names.
   */
  async function loadPersonalSecrets() {
    try {
      const res = await fetchLockbox("/lockbox/user");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          showSigninPrompt();
          return;
        }
        els.personalStatus.textContent = `Failed to load (HTTP ${res.status})`;
        return;
      }
      const data = await res.json();
      // genesis shape: { secrets: [{name, stored, source}], count, ... }
      state.personalSecrets = (data.secrets || data.names || []).map(
        (s) => (typeof s === "string" ? s : s.name)
      ).filter(Boolean);
      state.hasPersonal = true;
      els.personalStatus.textContent = `${state.personalSecrets.length} secret(s)`;
      renderPersonalSecrets();
    } catch (e) {
      els.personalStatus.textContent = `Error: ${e.message}`;
    }
  }

  /**
   * Load workspace secrets keys.
   */
  async function loadWorkspaceSecrets() {
    try {
      const res = await fetchLockbox("/workspace-secrets/keys");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Workspace section silently hides if not available
          els.workspaceSection.style.display = "none";
          return;
        }
        els.workspaceStatus.textContent = `Failed to load (HTTP ${res.status})`;
        return;
      }
      const data = await res.json();
      // genesis shape: { secrets: [{key, description, tags, masked, ...}], count, ... }
      state.workspaceSecrets = (data.secrets || data.keys || []).map(
        (s) => (typeof s === "string" ? s : s.key)
      ).filter(Boolean);
      state.hasWorkspace = true;
      els.workspaceSection.style.display = "block";
      els.workspaceStatus.textContent = `${state.workspaceSecrets.length} secret(s)`;
      renderWorkspaceSecrets();
    } catch (e) {
      els.workspaceStatus.textContent = `Error: ${e.message}`;
    }
  }

  /**
   * Load admin vault names.
   */
  async function loadAdminVault() {
    try {
      const res = await fetchVault("");
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Admin section silently hides if not authorized
          els.adminSection.style.display = "none";
          return;
        }
        // Silent failure for other errors — don't clutter UI
        els.adminSection.style.display = "none";
        return;
      }
      const data = await res.json();
      state.adminSecrets = data.secrets || [];
      state.hasAdmin = true;
      els.adminSection.style.display = "block";
      renderAdminVault();
    } catch (e) {
      // Silent failure
      els.adminSection.style.display = "none";
    }
  }

  function renderPersonalSecrets() {
    if (!els.personalList) return;
    const shown = state.personalSecrets.filter((s) =>
      s.toLowerCase().includes(state.personalFilter.toLowerCase())
    );
    if (!shown.length) {
      els.personalList.innerHTML = `<div style="padding:8px 12px; color:var(--text-muted); font-size:10px; text-align:center;">
        ${state.personalSecrets.length === 0 ? "No secrets yet." : "No matches."}
      </div>`;
      return;
    }
    shown.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    els.personalList.innerHTML = shown
      .map((name) => `
        <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.03);">
          <div style="flex:1; min-width:0; font-family:var(--font-mono); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);">${escapeHtml(name)}</div>
          <button class="lockbox-btn" data-act="reveal" data-name="${escapeHtml(name)}" title="Reveal for 30s">👁</button>
          <button class="lockbox-btn" data-act="copy-personal" data-name="${escapeHtml(name)}" title="Copy">📋</button>
          <button class="lockbox-btn danger" data-act="del-personal" data-name="${escapeHtml(name)}" title="Delete">🗑</button>
        </div>
      `)
      .join("");
  }

  function renderWorkspaceSecrets() {
    if (!els.workspaceList) return;
    const shown = state.workspaceSecrets.filter((s) =>
      s.toLowerCase().includes(state.workspaceFilter.toLowerCase())
    );
    if (!shown.length) {
      els.workspaceList.innerHTML = `<div style="padding:8px 12px; color:var(--text-muted); font-size:10px; text-align:center;">
        ${state.workspaceSecrets.length === 0 ? "No secrets yet." : "No matches."}
      </div>`;
      return;
    }
    shown.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    els.workspaceList.innerHTML = shown
      .map((key) => `
        <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.03);">
          <div style="flex:1; min-width:0; font-family:var(--font-mono); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#a78bfa;">${escapeHtml(key)}</div>
          <button class="lockbox-btn" data-act="copy-workspace" data-key="${escapeHtml(key)}" title="Copy">📋</button>
          <button class="lockbox-btn danger" data-act="del-workspace" data-key="${escapeHtml(key)}" title="Delete">🗑</button>
        </div>
      `)
      .join("");
  }

  function renderAdminVault() {
    if (!els.adminList) return;
    const shown = state.adminSecrets.filter((s) =>
      s.name.toLowerCase().includes(state.adminFilter.toLowerCase())
    );
    if (!shown.length) {
      els.adminList.innerHTML = `<div style="padding:8px 12px; color:var(--text-muted); font-size:10px; text-align:center;">
        ${state.adminSecrets.length === 0 ? "No secrets in vault." : "No matches."}
      </div>`;
      return;
    }
    shown.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    els.adminList.innerHTML = shown
      .map((s) => {
        const revealed = state.adminRevealed && state.adminRevealed.name === s.name;
        const val = revealed
          ? `<code style="font-family:var(--font-mono); font-size:9px; color:var(--text-primary); user-select:all;">••••</code>`
          : `<span style="font-size:9px; color:var(--text-muted);">hidden</span>`;
        return `
        <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.03);">
          <div style="flex:1; min-width:0; font-family:var(--font-mono); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#f87171;">${escapeHtml(s.name)}</div>
          <div style="font-size:8px; color:var(--text-muted);">${val}</div>
          <button class="lockbox-btn" data-act="reveal-admin" data-name="${escapeHtml(s.name)}" title="${revealed ? "Hide" : "Reveal (30s)"}">${revealed ? "🙈" : "👁"}</button>
          <button class="lockbox-btn danger" data-act="del-admin" data-name="${escapeHtml(s.name)}" title="Delete">🗑</button>
        </div>
      `;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function showSigninPrompt() {
    if (els.personalList) els.personalList.innerHTML = "";
    if (els.workspaceSection) els.workspaceSection.style.display = "none";
    if (els.adminSection) els.adminSection.style.display = "none";
    if (els.signinPrompt) els.signinPrompt.style.display = "block";
  }

  /**
   * Add personal secret.
   */
  async function onAddPersonal() {
    const name = els.personalName.value.trim();
    const value = els.personalValue.value;
    if (!name) { alert("Secret name is required."); return; }
    if (!value) { alert("Secret value is required."); return; }

    try {
      const res = await fetchLockbox("/lockbox/user/" + encodeURIComponent(name), {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        alert(`Failed to save (HTTP ${res.status})`);
        return;
      }
      els.personalName.value = "";
      els.personalValue.value = "";
      await loadPersonalSecrets();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  /**
   * Personal secrets are WRITE-ONLY by backend design: genesis /lockbox/user
   * has no value-read route (values never leave the vault over this API).
   * Update by re-entering the value; there is no copy.
   */
  function onCopyPersonal(name) {
    alert(
      `"${name}" is write-only — the vault never returns personal secret ` +
      `values. To change it, save a new value under the same name.`
    );
  }

  /**
   * Delete personal secret.
   */
  async function onDeletePersonal(name) {
    if (!confirm(`Delete personal secret "${name}"?`)) return;
    try {
      const res = await fetchLockbox("/lockbox/user/" + encodeURIComponent(name), {
        method: "DELETE",
      });
      if (!res.ok) {
        alert(`Failed to delete (HTTP ${res.status})`);
        return;
      }
      await loadPersonalSecrets();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  /**
   * Set workspace secret.
   */
  async function onSetWorkspace() {
    const key = els.workspaceKey.value.trim();
    const value = els.workspaceValue.value;
    if (!key) { alert("Secret key is required."); return; }
    if (!value) { alert("Secret value is required."); return; }

    try {
      const res = await fetchLockbox("/workspace-secrets/set", {
        method: "POST",
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        alert(`Failed to save (HTTP ${res.status})`);
        return;
      }
      els.workspaceKey.value = "";
      els.workspaceValue.value = "";
      await loadWorkspaceSecrets();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  /**
   * Copy workspace secret value (never shown on screen).
   */
  async function onCopyWorkspace(key) {
    try {
      const res = await fetchLockbox("/workspace-secrets/value?key=" + encodeURIComponent(key));
      if (!res.ok) {
        alert(`Failed to fetch (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      const value = data.value || "";
      await navigator.clipboard.writeText(value);
      alert(`Copied secret (never shown on screen).`);
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  /**
   * Delete workspace secret.
   */
  async function onDeleteWorkspace(key) {
    if (!confirm(`Delete workspace secret "${key}"?`)) return;
    try {
      const res = await fetchLockbox("/workspace-secrets/delete", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        alert(`Failed to delete (HTTP ${res.status})`);
        return;
      }
      await loadWorkspaceSecrets();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  /**
   * Reveal admin vault value for 30 seconds.
   */
  async function onRevealAdmin(name) {
    if (state.adminRevealed && state.adminRevealed.name === name) {
      clearAdminReveal();
      renderAdminVault();
      return;
    }

    try {
      const res = await fetchVault("/" + encodeURIComponent(name));
      if (!res.ok) {
        alert(`Failed to fetch (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      const value = data.value || "";
      clearAdminReveal();
      state.adminRevealed = { name, value };
      // Auto-hide after 30 seconds
      state.adminRevealed.timer = setTimeout(() => {
        clearAdminReveal();
        renderAdminVault();
      }, 30000);
      renderAdminVault();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  function clearAdminReveal() {
    if (state.adminRevealed && state.adminRevealed.timer) {
      clearTimeout(state.adminRevealed.timer);
    }
    state.adminRevealed = null;
  }

  /**
   * Delete admin vault secret (must be admin).
   */
  async function onDeleteAdmin(name) {
    if (!confirm(`Delete admin secret "${name}"?`)) return;
    try {
      const res = await fetchVault("/" + encodeURIComponent(name), {
        method: "DELETE",
      });
      if (!res.ok) {
        alert(`Failed to delete (HTTP ${res.status})`);
        return;
      }
      await loadAdminVault();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  function wire() {
    // Personal
    els.personalAdd?.addEventListener("click", onAddPersonal);
    els.personalName?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") onAddPersonal();
    });

    // Workspace
    els.workspaceSet?.addEventListener("click", onSetWorkspace);
    els.workspaceKey?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") onSetWorkspace();
    });

    // Admin
    els.adminFilter?.addEventListener("input", () => {
      state.adminFilter = els.adminFilter.value.trim();
      renderAdminVault();
    });
    els.adminRefresh?.addEventListener("click", loadAdminVault);

    // Event delegation for list buttons
    els.personalList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lockbox-btn");
      if (!btn) return;
      const name = btn.dataset.name;
      const act = btn.dataset.act;
      if (act === "reveal") onRevealAdmin(name);
      else if (act === "copy-personal") onCopyPersonal(name);
      else if (act === "del-personal") onDeletePersonal(name);
    });

    els.workspaceList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lockbox-btn");
      if (!btn) return;
      const key = btn.dataset.key;
      const act = btn.dataset.act;
      if (act === "copy-workspace") onCopyWorkspace(key);
      else if (act === "del-workspace") onDeleteWorkspace(key);
    });

    els.adminList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lockbox-btn");
      if (!btn) return;
      const name = btn.dataset.name;
      const act = btn.dataset.act;
      if (act === "reveal-admin") onRevealAdmin(name);
      else if (act === "del-admin") onDeleteAdmin(name);
    });

    // Load lazily on first open
    els.tabBtn?.addEventListener("click", () => {
      if (!state.loaded) {
        state.loaded = true;
        loadPersonalSecrets();
        loadWorkspaceSecrets();
        loadAdminVault();
      }
    });

    // Clear revealed value when panel loses focus (shoulder-surfing protection)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.adminRevealed) {
        clearAdminReveal();
        renderAdminVault();
      }
    });
  }

  async function init() {
    cacheEls();
    if (!els.panel) return;
    await loadSettings();
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
