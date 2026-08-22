// Awconnect — Zero-Knowledge Backups
// A self-contained floating panel for zero-knowledge encrypted backups to GitHub.
// All encryption happens locally — Aitherium and GitHub see only ciphertext.

(() => {
  if (window.__aitherBackupsPanel) return;
  window.__aitherBackupsPanel = true;

  const Z = 2147483647; // max z-index
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, props = {}, css = "") => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    if (css) e.style.cssText = css;
    return e;
  };
  const ask = (msg) =>
    new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => res(r || {}));
      } catch {
        res({});
      }
    });

  let panel = null;

  async function fetchBackupStatus() {
    const res = await ask({
      type: "daemon-backup",
      method: "GET",
      path: "/backup/status",
    });
    if (res.ok) {
      return res.data;
    } else {
      return { error: res.error || "unknown error" };
    }
  }

  async function configureBackup(github_repo, github_token, passphrase) {
    return await ask({
      type: "daemon-backup",
      method: "POST",
      path: "/backup/config",
      body: { target: "github", github_repo, github_token, passphrase },
    });
  }

  // The passphrase is NEVER stored — it is supplied on EVERY backup/list/restore
  // call from an ephemeral in-panel field, and the daemon requires it each time.
  async function backupNow(passphrase) {
    return await ask({
      type: "daemon-backup",
      method: "POST",
      path: "/backup/now",
      body: { passphrase },
    });
  }

  async function fetchBackupList(passphrase) {
    const res = await ask({
      type: "daemon-backup",
      method: "POST",
      path: "/backup/list",
      body: { passphrase },
    });
    if (res.ok) {
      return res.data;
    } else {
      return { error: res.error || "unknown error" };
    }
  }

  async function restoreBackup(backup_id, passphrase) {
    return await ask({
      type: "daemon-backup",
      method: "POST",
      path: "/backup/restore",
      body: { backup_id, passphrase },
    });
  }

  async function renderPanel() {
    if (!panel) return;

    const content = panel.querySelector("[data-role='content']");
    if (!content) return;

    content.innerHTML = "";

    // Show spinner while loading
    const spinner = el(
      "div",
      {},
      `text-align:center;padding:16px;color:#888;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;`
    );
    spinner.textContent = "Loading...";
    content.appendChild(spinner);

    const status = await fetchBackupStatus();

    content.innerHTML = "";

    if (status.error) {
      // Daemon unreachable
      const box = el(
        "div",
        {},
        `padding:16px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
      );
      const msg = el(
        "div",
        { textContent: "No local agent daemon" },
        `color:#ff9999;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:600;margin-bottom:8px;`
      );
      const hint = el(
        "div",
        { textContent: "Run: adk up" },
        `color:#999;font:12px monospace;background:#0a0a0a;padding:8px;border-radius:4px;margin:8px 0;word-break:break-all;`
      );
      const copy = el(
        "button",
        { textContent: "Copy command" },
        `background:#22d3ee;color:#000;border:none;border-radius:4px;padding:6px 12px;font:12px -apple-system;font-weight:600;cursor:pointer;`
      );
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText("adk up").catch(() => {});
        copy.textContent = "Copied!";
        setTimeout(() => {
          copy.textContent = "Copy command";
        }, 1500);
      });
      box.appendChild(msg);
      box.appendChild(hint);
      box.appendChild(copy);
      content.appendChild(box);
      return;
    }

    if (!status.configured) {
      // Config form
      const configBox = el(
        "div",
        {},
        `padding:16px;background:#1a1a1a;border-radius:8px;`
      );

      const title = el(
        "div",
        { textContent: "Set up backups" },
        `color:#22d3ee;font:13px -apple-system;font-weight:600;margin-bottom:12px;`
      );
      configBox.appendChild(title);

      const note = el(
        "div",
        { textContent: "Your passphrase & token stay on THIS machine. Only ciphertext is ever uploaded — Aitherium never sees your data." },
        `color:#999;font:11px -apple-system;margin-bottom:16px;line-height:1.4;`
      );
      configBox.appendChild(note);

      const repoLabel = el("div", { textContent: "GitHub repo (owner/repo)" }, `color:#ddd;font:12px -apple-system;margin-bottom:4px;`);
      const repoInput = el("input", { type: "text", placeholder: "owner/repo" }, `width:100%;padding:8px;background:#0a0a0a;border:1px solid #333a44;border-radius:4px;color:#e9e9ea;font:12px monospace;box-sizing:border-box;margin-bottom:12px;`);
      configBox.appendChild(repoLabel);
      configBox.appendChild(repoInput);

      const tokenLabel = el("div", { textContent: "GitHub token" }, `color:#ddd;font:12px -apple-system;margin-bottom:4px;`);
      const tokenInput = el("input", { type: "password", placeholder: "ghp_..." }, `width:100%;padding:8px;background:#0a0a0a;border:1px solid #333a44;border-radius:4px;color:#e9e9ea;font:12px monospace;box-sizing:border-box;margin-bottom:12px;`);
      configBox.appendChild(tokenLabel);
      configBox.appendChild(tokenInput);

      const passphraseLabel = el("div", { textContent: "Backup passphrase" }, `color:#ddd;font:12px -apple-system;margin-bottom:4px;`);
      const passphraseInput = el("input", { type: "password", placeholder: "your passphrase" }, `width:100%;padding:8px;background:#0a0a0a;border:1px solid #333a44;border-radius:4px;color:#e9e9ea;font:12px monospace;box-sizing:border-box;margin-bottom:16px;`);
      configBox.appendChild(passphraseLabel);
      configBox.appendChild(passphraseInput);

      const configBtn = el(
        "button",
        { textContent: "Configure backups" },
        `background:#22d3ee;color:#000;border:none;border-radius:4px;padding:8px 12px;font:12px -apple-system;font-weight:600;cursor:pointer;width:100%;`
      );
      configBtn.addEventListener("click", async () => {
        const repo = repoInput.value.trim();
        const token = tokenInput.value.trim();
        const passphrase = passphraseInput.value.trim();

        if (!repo || !token || !passphrase) {
          configBtn.textContent = "Please fill all fields";
          setTimeout(() => {
            configBtn.textContent = "Configure backups";
          }, 2000);
          return;
        }

        configBtn.disabled = true;
        configBtn.textContent = "Configuring...";
        const res = await configureBackup(repo, token, passphrase);

        if (res.ok) {
          configBtn.textContent = "Configured! Reloading...";
          await sleep(1500);
          await renderPanel();
        } else {
          configBtn.textContent = "Configuration failed";
          await sleep(2000);
          configBtn.disabled = false;
          configBtn.textContent = "Configure backups";
        }
      });
      configBox.appendChild(configBtn);

      content.appendChild(configBox);
      return;
    }

    // Backups configured
    const infoBox = el(
      "div",
      {},
      `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
    );
    const repoLabel = el(
      "div",
      { textContent: "Repository" },
      `color:#888;font:11px -apple-system;margin-bottom:4px;`
    );
    const repoValue = el(
      "div",
      { textContent: status.github_repo || "unknown" },
      `color:#22d3ee;font:12px monospace;font-weight:600;`
    );
    infoBox.appendChild(repoLabel);
    infoBox.appendChild(repoValue);
    content.appendChild(infoBox);

    // Last backup info
    const lastBox = el(
      "div",
      {},
      `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
    );
    const lastLabel = el(
      "div",
      { textContent: "Last backup" },
      `color:#888;font:11px -apple-system;margin-bottom:4px;`
    );
    const lastValue = el(
      "div",
      { textContent: status.last_backup || "Never" },
      `color:#ddd;font:12px -apple-system;`
    );
    lastBox.appendChild(lastLabel);
    lastBox.appendChild(lastValue);
    content.appendChild(lastBox);

    // Ephemeral passphrase field — never persisted, cleared when the panel closes.
    // Required for every backup / list / restore (the daemon enforces it too).
    const passBox = el("div", {}, `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`);
    passBox.appendChild(el("div", { textContent: "Passphrase — needed for every backup & restore; never leaves this machine" }, `color:#888;font:11px -apple-system;margin-bottom:6px;line-height:1.4;`));
    const passInput = el("input", { type: "password", placeholder: "enter your backup passphrase" }, `width:100%;padding:8px;background:#0a0a0a;border:1px solid #333a44;border-radius:4px;color:#e9e9ea;font:12px monospace;box-sizing:border-box;`);
    passBox.appendChild(passInput);
    content.appendChild(passBox);
    const flash = (btn, msg, orig, ms = 1800) => { btn.textContent = msg; setTimeout(() => { btn.textContent = orig; }, ms); };

    // Back up now
    const backupBtn = el(
      "button",
      { textContent: "Back up now" },
      `background:#22d3ee;color:#000;border:none;border-radius:4px;padding:8px 12px;font:12px -apple-system;font-weight:600;cursor:pointer;width:100%;margin-bottom:12px;`
    );
    backupBtn.addEventListener("click", async () => {
      const pass = passInput.value.trim();
      if (!pass) { flash(backupBtn, "Enter passphrase first", "Back up now"); return; }
      backupBtn.disabled = true;
      backupBtn.textContent = "Backing up (may take a minute)…";
      const res = await backupNow(pass);
      const data = res.data || {};
      if (res.ok && data.ok) {
        backupBtn.textContent = `Backed up (${((data.size || 0) / 1024 / 1024).toFixed(1)} MB)`;
        await sleep(2000);
        await renderPanel();
      } else {
        backupBtn.textContent = data.error || res.error || "Backup failed";
        await sleep(2500);
        backupBtn.disabled = false;
        backupBtn.textContent = "Back up now";
      }
    });
    content.appendChild(backupBtn);

    // Restore points — loaded ON DEMAND (listing needs the passphrase to unlock the token)
    const showBtn = el(
      "button",
      { textContent: "Show restore points" },
      `background:none;border:1px solid #333a44;color:#ddd;border-radius:4px;padding:8px 12px;font:12px -apple-system;cursor:pointer;width:100%;`
    );
    const restoreBox = el("div", {}, `margin-top:12px;`);
    showBtn.addEventListener("click", async () => {
      const pass = passInput.value.trim();
      if (!pass) { flash(showBtn, "Enter passphrase first", "Show restore points"); return; }
      showBtn.disabled = true;
      showBtn.textContent = "Loading…";
      const listRes = await fetchBackupList(pass);
      showBtn.disabled = false;
      showBtn.textContent = "Refresh restore points";
      restoreBox.innerHTML = "";
      const backups = (listRes && listRes.ok && Array.isArray(listRes.backups)) ? listRes.backups : null;
      if (!backups) {
        restoreBox.appendChild(el("div", { textContent: (listRes && listRes.error) || "Could not list backups" }, `color:#ff9999;font:11px -apple-system;padding:8px 0;`));
        return;
      }
      restoreBox.appendChild(el("div", { textContent: `Restore points (${backups.length})` }, `color:#888;font:12px -apple-system;margin:8px 0;font-weight:600;`));
      if (backups.length === 0) {
        restoreBox.appendChild(el("div", { textContent: "No backups yet" }, `color:#666;font:11px -apple-system;`));
        return;
      }
      backups.forEach((backup) => {
        const item = el("div", {}, `padding:8px 0;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;`);
        const info = el("div", {}, `flex:1;`);
        info.appendChild(el("div", { textContent: backup.ts || backup.backup_id }, `color:#ddd;font:11px monospace;margin-bottom:2px;`));
        info.appendChild(el("div", { textContent: `${((backup.size || 0) / 1024 / 1024).toFixed(1)} MB` }, `color:#666;font:10px -apple-system;`));
        const rBtn = el("button", { textContent: "Restore" }, `background:none;border:1px solid #22d3ee;color:#22d3ee;border-radius:4px;padding:4px 8px;font:10px -apple-system;font-weight:600;cursor:pointer;white-space:nowrap;`);
        rBtn.addEventListener("click", async () => {
          const p2 = passInput.value.trim();
          if (!p2) { flash(rBtn, "Need pass", "Restore"); return; }
          if (!confirm("Restore to ~/.aither-restore/ (NOT your live config)?")) return;
          rBtn.disabled = true;
          rBtn.textContent = "Restoring…";
          const res = await restoreBackup(backup.backup_id, p2);
          const data = res.data || {};
          rBtn.textContent = (res.ok && data.ok) ? "Restored ✓" : (data.error || "Failed");
          await sleep(2500);
          rBtn.disabled = false;
          rBtn.textContent = "Restore";
        });
        item.appendChild(info);
        item.appendChild(rBtn);
        restoreBox.appendChild(item);
      });
    });
    content.appendChild(showBtn);
    content.appendChild(restoreBox);
  }

  function closePanelFn() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  async function openPanel() {
    if (panel) return;

    panel = el(
      "div",
      {},
      `position:fixed;right:20px;bottom:20px;z-index:${Z};width:360px;
        background:#14171b;border:1px solid #333a44;border-radius:12px;
        box-shadow:0 20px 70px rgba(0,0,0,.8);
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color:#e9e9ea;`
    );

    // Header (draggable)
    const header = el(
      "div",
      {},
      `padding:12px 16px;border-bottom:1px solid #333a44;cursor:grab;
        display:flex;justify-content:space-between;align-items:center;
        background:linear-gradient(to bottom,#1b1f24,#14171b);`
    );
    header.addEventListener("mousedown", (e) => {
      if (e.target !== header && !header.contains(e.target)) return;
      const rect = panel.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      const handleMove = (moveE) => {
        const newLeft = moveE.clientX - startX;
        const newTop = moveE.clientY - startY;
        panel.style.right = "auto";
        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
        panel.style.bottom = "auto";
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    });

    const title = el(
      "div",
      { textContent: "Backups" },
      `font-weight:600;font-size:14px;`
    );

    const closeBtn = el(
      "button",
      { textContent: "✕" },
      `background:none;border:none;color:#888;font:18px;cursor:pointer;padding:0;width:24px;height:24px;
        display:flex;align-items:center;justify-content:center;`
    );
    closeBtn.addEventListener("click", closePanelFn);

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Content area
    const content = el(
      "div",
      { "data-role": "content" },
      `padding:16px;max-height:600px;overflow-y:auto;`
    );
    panel.appendChild(content);

    document.body.appendChild(panel);

    // Initial render
    await renderPanel();
  }

  // Expose to global so aither-command-bar can call it
  window.__openBackupsPanel = openPanel;
})();
