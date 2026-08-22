// Awconnect — Machine Onboarding Console
// A self-contained floating panel that reads the local adk-daemon and shows
// the user's onboarding state with actions (sign-in, vault sync, enrollment).

(() => {
  if (window.__aitherMachinePanel) return;
  window.__aitherMachinePanel = true;

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

  async function fetchStatus() {
    const res = await ask({
      type: "daemon-onboard",
      method: "GET",
      path: "/onboard/status",
    });
    if (res.ok) {
      return res.data;
    } else {
      return { error: res.error || "unknown error" };
    }
  }

  async function syncVault() {
    return await ask({
      type: "daemon-onboard",
      method: "POST",
      path: "/onboard/sync",
    });
  }

  async function enrollMachine() {
    return await ask({
      type: "daemon-onboard",
      method: "POST",
      path: "/onboard/enroll",
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

    const status = await fetchStatus();

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
        {
          textContent: "Copy command",
        },
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

    // Sign-in state
    const signinBox = el(
      "div",
      {},
      `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
    );
    if (status.logged_in && status.username) {
      const signinLabel = el(
        "div",
        {
          textContent: `Signed in as ${status.username}${status.tenant ? ` (${status.tenant})` : ""}`,
        },
        `color:#22d3ee;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:600;`
      );
      signinBox.appendChild(signinLabel);
    } else {
      const signinLabel = el(
        "div",
        { textContent: "Not signed in" },
        `color:#999;font:13px -apple-system;margin-bottom:8px;`
      );
      const hint = el(
        "div",
        { textContent: "Run: adk login" },
        `color:#999;font:12px monospace;background:#0a0a0a;padding:8px;border-radius:4px;`
      );
      signinBox.appendChild(signinLabel);
      signinBox.appendChild(hint);
    }
    content.appendChild(signinBox);

    // Vault
    const vaultBox = el(
      "div",
      {},
      `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
    );
    const vaultLabel = el(
      "div",
      {
        textContent: `${status.vault_secrets || 0} secrets synced`,
      },
      `color:#888;font:13px -apple-system;margin-bottom:8px;`
    );
    const syncBtn = el(
      "button",
      { textContent: "Sync vault" },
      `background:#22d3ee;color:#000;border:none;border-radius:4px;padding:6px 12px;font:12px -apple-system;font-weight:600;cursor:pointer;width:100%;`
    );
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing...";
      const res = await syncVault();
      if (res.ok) {
        syncBtn.textContent = `Synced ${res.data.synced} secrets`;
        await renderPanel();
      } else {
        syncBtn.textContent = "Sync failed";
      }
      setTimeout(() => {
        syncBtn.disabled = false;
      }, 1500);
    });
    vaultBox.appendChild(vaultLabel);
    vaultBox.appendChild(syncBtn);
    content.appendChild(vaultBox);

    // Node enrollment
    const nodeBox = el(
      "div",
      {},
      `padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:12px;`
    );
    if (status.enrolled && status.node_id) {
      const nodeLabel = el(
        "div",
        {
          textContent: `Enrolled (node ${status.node_id.slice(0, 8)}…)`,
        },
        `color:#22d3ee;font:13px -apple-system;font-weight:600;`
      );
      nodeBox.appendChild(nodeLabel);
    } else {
      const nodeLabel = el(
        "div",
        { textContent: "Machine not enrolled" },
        `color:#999;font:13px -apple-system;margin-bottom:8px;`
      );
      const enrollBtn = el(
        "button",
        { textContent: "Enroll this machine" },
        `background:#22d3ee;color:#000;border:none;border-radius:4px;padding:6px 12px;font:12px -apple-system;font-weight:600;cursor:pointer;width:100%;`
      );
      enrollBtn.addEventListener("click", async () => {
        enrollBtn.disabled = true;
        enrollBtn.textContent = "Enrolling (this may take a minute)…";
        const res = await enrollMachine();
        if (res.ok) {
          enrollBtn.textContent = `Enrolled! (${res.data.node_id.slice(0, 8)}…)`;
          await sleep(2000);
          await renderPanel();
        } else {
          enrollBtn.textContent = "Enrollment failed";
        }
        setTimeout(() => {
          enrollBtn.disabled = false;
        }, 2000);
      });
      nodeBox.appendChild(nodeLabel);
      nodeBox.appendChild(enrollBtn);
    }
    content.appendChild(nodeBox);

    // Agents
    if (status.agents && status.agents.length > 0) {
      const agentsBox = el(
        "div",
        {},
        `padding:12px;background:#1a1a1a;border-radius:8px;`
      );
      const agentsLabel = el(
        "div",
        { textContent: "Local agents" },
        `color:#888;font:12px -apple-system;margin-bottom:8px;font-weight:600;`
      );
      agentsBox.appendChild(agentsLabel);
      status.agents.forEach((agent) => {
        const agentItem = el(
          "div",
          {},
          `padding:6px 0;border-bottom:1px solid #222;font:12px -apple-system;`
        );
        const name = el(
          "div",
          { textContent: agent.name },
          `color:#ddd;font-weight:500;margin-bottom:2px;`
        );
        const statusText = el(
          "div",
          { textContent: agent.status || "running" },
          `color:#666;font:11px;`
        );
        agentItem.appendChild(name);
        agentItem.appendChild(statusText);
        agentsBox.appendChild(agentItem);
      });
      content.appendChild(agentsBox);
    } else {
      const empty = el(
        "div",
        { textContent: "No local agents registered yet" },
        `padding:12px;color:#666;font:12px -apple-system;text-align:center;`
      );
      content.appendChild(empty);
    }
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
      `position:fixed;right:20px;bottom:20px;z-index:${Z};width:320px;
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
      { textContent: "Connect Machine" },
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
      `padding:16px;max-height:500px;overflow-y:auto;`
    );
    panel.appendChild(content);

    document.body.appendChild(panel);

    // Initial render
    await renderPanel();
  }

  // Expose to global so aither-command-bar can call it
  window.__openMachinePanel = openPanel;
})();
