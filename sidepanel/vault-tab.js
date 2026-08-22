/**
 * Vault tab — a real password-manager surface over AitherSecrets.
 *
 * WHY: the vault holds ~354 secrets and, before this, there was no way to see or
 * edit most of them. `/api/admin/setup/secrets` walks a hardcoded ~30-name array
 * and reports booleans, so ~92% of the vault was invisible and uncreatable from
 * any UI — entering PROTON_EMAIL / PROTON_PASSWORD / PROTON_TOTP_SECRET was
 * simply impossible. This talks to /api/admin/vault, which is general.
 *
 * SECURITY SHAPE (deliberate, not incidental):
 *   • The extension NEVER holds the internal vault key. It calls Veil with the
 *     session cookie; Veil holds the key server-side. Pointing the extension at
 *     :8111 directly 401s, and should.
 *   • The LIST carries no values. Browsing/searching 354 secrets puts zero
 *     secret material on the wire.
 *   • Revealing is one explicit click, one secret, and it auto-hides.
 *   • Copy uses the clipboard WITHOUT rendering the value on screen.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    veilPort: 3000,
    secrets: [],
    filter: "",
    revealed: null,       // { name, value } — at most ONE at a time
    revealTimer: null,
    loaded: false,
  };

  const els = {};

  function cacheEls() {
    els.tabBtn = document.querySelector('.nav-tab[data-panel="vault"]');
    els.panel = $("panel-vault");
    els.search = $("vault-search");
    els.list = $("vault-list");
    els.status = $("vault-status");
    els.refresh = $("vault-refresh");
    els.addToggle = $("vault-add-toggle");
    els.addForm = $("vault-add-form");
    els.newName = $("vault-new-name");
    els.newValue = $("vault-new-value");
    els.newType = $("vault-new-type");
    els.save = $("vault-save");
    els.cancel = $("vault-cancel");
  }

  function base() {
    return `http://127.0.0.1:${state.veilPort}`;
  }

  function setStatus(msg, kind = "") {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.className = `vault-status ${kind}`;
  }

  async function loadSettings() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
      if (resp && resp.settings && resp.settings.veilPort) {
        state.veilPort = resp.settings.veilPort;
      }
    } catch {
      /* keep the default port */
    }
  }

  /**
   * Every failure mode gets its OWN message. A vault UI that renders "no
   * secrets" for an auth failure is indistinguishable from an empty vault, and
   * that ambiguity is exactly how a broken surface looks like a working one.
   */
  function explain(status) {
    if (status === 401) return "Not signed in — open the portal and log in first.";
    if (status === 403) return "Signed in, but this account is not an admin/owner.";
    if (status === 503) return "Veil has no AITHER_INTERNAL_SECRET configured — it cannot reach the vault.";
    if (status === 502) return "Veil reached, vault did not answer.";
    return `Request failed (HTTP ${status}).`;
  }

  async function api(path, opts = {}) {
    return fetch(`${base()}/api/admin/vault${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
  }

  async function loadSecrets() {
    setStatus("Loading vault…");
    try {
      const res = await api("");
      if (!res.ok) {
        setStatus(explain(res.status), "err");
        els.list.innerHTML = "";
        return;
      }
      const data = await res.json();
      state.secrets = data.secrets || [];
      state.loaded = true;
      setStatus(`${state.secrets.length} secrets`, "ok");
      render();
    } catch (e) {
      setStatus(`Cannot reach Veil on :${state.veilPort} (${e.name})`, "err");
    }
  }

  function matches(s) {
    if (!state.filter) return true;
    return s.name.toLowerCase().includes(state.filter);
  }

  function render() {
    if (!els.list) return;
    const shown = state.secrets.filter(matches);
    if (!shown.length) {
      els.list.innerHTML = `<div class="vault-empty">${
        state.loaded ? "No secrets match that search." : "Nothing loaded yet."
      }</div>`;
      return;
    }
    // Sort case-insensitively so SCREAMING_CASE and lowercase interleave the way
    // a human scans them, rather than ASCII order putting all caps first.
    shown.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    els.list.innerHTML = shown
      .map((s) => {
        const revealed = state.revealed && state.revealed.name === s.name;
        const val = revealed
          ? `<code class="vault-value">${escapeHtml(state.revealed.value)}</code>`
          : `<span class="vault-mask">••••••••••••</span>`;
        return `
        <div class="vault-row" data-name="${escapeHtml(s.name)}">
          <div class="vault-row-main">
            <div class="vault-name">${escapeHtml(s.name)}</div>
            <div class="vault-meta">${escapeHtml(s.type || "secret")}${
          s.created_at ? " · " + escapeHtml(String(s.created_at).slice(0, 10)) : ""
        }</div>
          </div>
          <div class="vault-row-val">${val}</div>
          <div class="vault-row-actions">
            <button class="vault-btn" data-act="reveal" title="${
              revealed ? "Hide" : "Reveal for 20s"
            }">${revealed ? "🙈" : "👁"}</button>
            <button class="vault-btn" data-act="copy" title="Copy without showing">📋</button>
            <button class="vault-btn" data-act="edit" title="Replace value">✏️</button>
            <button class="vault-btn danger" data-act="del" title="Delete">🗑</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function clearReveal() {
    if (state.revealTimer) clearTimeout(state.revealTimer);
    state.revealTimer = null;
    state.revealed = null;
  }

  async function fetchValue(name) {
    const res = await api(`/${encodeURIComponent(name)}`);
    if (!res.ok) {
      setStatus(explain(res.status), "err");
      return null;
    }
    const data = await res.json();
    return data.value ?? "";
  }

  async function onReveal(name) {
    if (state.revealed && state.revealed.name === name) {
      clearReveal();
      render();
      return;
    }
    const value = await fetchValue(name);
    if (value === null) return;
    clearReveal();
    state.revealed = { name, value };
    // Auto-hide: a revealed secret left on screen in a docked sidepanel is a
    // shoulder-surfing surface for the rest of the session.
    state.revealTimer = setTimeout(() => {
      clearReveal();
      render();
      setStatus("Value hidden again.", "");
    }, 20000);
    render();
    setStatus(`Revealed ${name} (auto-hides in 20s)`, "ok");
  }

  async function onCopy(name) {
    const value = await fetchValue(name);
    if (value === null) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`Copied ${name} to clipboard (never shown on screen).`, "ok");
    } catch {
      setStatus("Clipboard blocked by the browser.", "err");
    }
  }

  async function onDelete(name) {
    if (!confirm(`Delete "${name}" from the vault?\n\nThis cannot be undone.`)) return;
    const res = await api(`/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) {
      setStatus(explain(res.status), "err");
      return;
    }
    setStatus(`Deleted ${name}.`, "ok");
    await loadSecrets();
  }

  function openAdd(name = "") {
    // "flex", not "block" — the form is a flex column in the markup, and block
    // would silently drop the gap/direction and render the fields squashed.
    els.addForm.style.display = "flex";
    els.newName.value = name;
    els.newValue.value = "";
    (name ? els.newValue : els.newName).focus();
  }

  async function onSave() {
    const name = els.newName.value.trim();
    const value = els.newValue.value;
    if (!name) { setStatus("Name is required.", "err"); return; }
    if (!value) { setStatus("Value is required — an empty value would wipe a working secret.", "err"); return; }

    setStatus(`Saving ${name}…`);
    const res = await api("", {
      method: "POST",
      body: JSON.stringify({ name, value, type: els.newType.value || "api_key" }),
    });
    let data = {};
    try { data = await res.json(); } catch { /* keep {} */ }
    if (!res.ok) {
      setStatus(data.error || explain(res.status), "err");
      return;
    }
    // The API re-reads the secret after writing, so this length is proof it
    // PERSISTED, not just that the POST returned 200.
    setStatus(`Saved ${name} (${data.length} chars, verified stored).`, "ok");
    els.addForm.style.display = "none";
    els.newValue.value = "";
    await loadSecrets();
  }

  function wire() {
    els.search?.addEventListener("input", () => {
      state.filter = els.search.value.trim().toLowerCase();
      render();
    });
    els.refresh?.addEventListener("click", loadSecrets);
    els.addToggle?.addEventListener("click", () => openAdd());
    els.cancel?.addEventListener("click", () => {
      els.addForm.style.display = "none";
      els.newValue.value = "";
    });
    els.save?.addEventListener("click", onSave);

    els.list?.addEventListener("click", (e) => {
      const btn = e.target.closest(".vault-btn");
      if (!btn) return;
      const row = e.target.closest(".vault-row");
      if (!row) return;
      const name = row.dataset.name;
      const act = btn.dataset.act;
      if (act === "reveal") onReveal(name);
      else if (act === "copy") onCopy(name);
      else if (act === "edit") openAdd(name);
      else if (act === "del") onDelete(name);
    });

    // Load lazily on first open — 354 rows should not cost anything until the
    // tab is actually looked at.
    els.tabBtn?.addEventListener("click", () => {
      if (!state.loaded) loadSecrets();
    });

    // Never leave a secret rendered when the panel loses focus.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.revealed) {
        clearReveal();
        render();
      }
    });
  }

  async function init() {
    cacheEls();
    if (!els.panel) return; // markup not present — nothing to do
    await loadSettings();
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
