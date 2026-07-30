/**
 * AitherShell tab — drive the AitherOS shell from the browser sidepanel.
 *
 * Self-contained: talks to the background service worker via chrome.runtime
 * messaging and renders streamed events from its OWN `shell-event` broadcast
 * channel (so it never collides with the Chat tab's `chat-event` stream).
 *
 *   • registers a Genesis shell session (client_type:"browser") on first open
 *   • streams /chat/stream, injecting the current tab (url/title/selection) as context
 *   • steering (↪ append, ⏹ cancel) + 10s heartbeat + teardown on unload
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    tabBtn: document.querySelector('.nav-tab[data-panel="shell"]'),
    input: $("shell-input"),
    send: $("shell-send"),
    log: $("shell-log"),
    session: $("shell-session"),
    dot: $("shell-dot"),
    ctx: $("shell-ctx"),
    steer: $("shell-steer"),
    cancel: $("shell-cancel"),
  };
  if (!els.input || !els.send || !els.log) return;  // panel not present

  const state = {
    sessionId: null,
    started: false,
    streaming: false,
    bubble: null,     // current assistant bubble
    traceEl: null,    // its trace-log
    contentEl: null,  // its content area
    content: "",
    heartbeat: null,
  };

  function esc(t) {
    return String(t).replace(/[&<>"']/g, (m) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
    ));
  }
  function scroll() { els.log.scrollTop = els.log.scrollHeight; }

  function addMsg(role, html) {
    const d = document.createElement("div");
    d.className = `chat-msg ${role}`;
    d.innerHTML = html;
    els.log.appendChild(d);
    scroll();
    return d;
  }
  function trace(tagClass, tag, msg) {
    if (!state.traceEl) return;
    const line = document.createElement("div");
    line.className = "trace-line";
    line.innerHTML = `<span class="trace-tag ${esc(tagClass)}">[${esc(tag)}]</span> ${esc(msg)}`;
    state.traceEl.appendChild(line);
    state.traceEl.scrollTop = state.traceEl.scrollHeight;
  }

  // ── Session lifecycle ──
  async function startSession() {
    if (state.started) return;
    state.started = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "shell-session-start", client_type: "browser" });
      if (resp && resp.ok && resp.session_id) {
        state.sessionId = resp.session_id;
        els.session.textContent = `session: ${resp.session_id.slice(0, 8)}`;
        els.dot.style.background = "var(--accent)";
        beat();
        state.heartbeat = setInterval(beat, 10000);
      } else {
        els.session.textContent = "session: (offline)";
      }
    } catch {
      state.started = false;  // allow retry
      els.session.textContent = "session: (error)";
    }
  }
  async function beat() {
    if (!state.sessionId) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: "shell-heartbeat", session_id: state.sessionId });
      els.dot.style.background = r && r.ok ? "var(--accent)" : "var(--border)";
    } catch { els.dot.style.background = "var(--border)"; }
  }
  function endSession() {
    if (state.heartbeat) clearInterval(state.heartbeat);
    if (state.sessionId) chrome.runtime.sendMessage({ type: "shell-session-end", session_id: state.sessionId }).catch(() => {});
  }

  // ── Browser context ──
  async function pageContext() {
    if (!els.ctx || !els.ctx.checked) return null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return null;
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          url: location.href,
          title: document.title,
          selection: String(window.getSelection() || "").slice(0, 1000),
          text: (document.body && document.body.innerText || "").slice(0, 2500),
        }),
      });
      return res && res.result ? res.result : null;
    } catch { return null; }
  }

  // ── Send / stream ──
  async function send(text) {
    text = (text || "").trim();
    if (!text || state.streaming) return;
    if (!state.sessionId) await startSession();

    addMsg("user", esc(text));
    els.input.value = "";
    els.send.disabled = true;
    state.streaming = true;
    state.content = "";

    // Assistant bubble with a collapsible trace log + content area.
    state.bubble = addMsg("assistant", `<div id="t" class="trace-log" style="max-height:160px; overflow:auto; font-family:var(--font-mono); font-size:10px; opacity:.8;"></div><div id="c"></div>`);
    state.traceEl = state.bubble.querySelector("#t");
    state.contentEl = state.bubble.querySelector("#c");

    const page = await pageContext();
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "shell-stream",
        session_id: state.sessionId,
        message: text,
        context: { source: "browser-extension-shell", page },
      });
      if (!resp || !resp.streaming) {
        finish(resp && resp.error ? `Error: ${resp.error}` : "No response.");
      }
    } catch (e) {
      finish(`Error: ${e.message}`);
    }
  }

  function finish(errMsg) {
    if (errMsg && state.contentEl) state.contentEl.innerHTML = `<span style="color:#f87171">${esc(errMsg)}</span>`;
    state.streaming = false;
    els.send.disabled = false;
    state.bubble = state.traceEl = state.contentEl = null;
    scroll();
  }

  async function steer(action) {
    if (!state.sessionId) return;
    let message = "";
    if (action === "append") {
      message = prompt("Follow-up to inject into the running turn:") || "";
      if (!message) return;
    }
    try { await chrome.runtime.sendMessage({ type: "shell-steer", session_id: state.sessionId, message, action }); }
    catch { /* */ }
    trace("steer", action, message || "(cancel)");
  }

  // ── Streamed events (own channel) ──
  chrome.runtime.onMessage.addListener((m) => {
    if (!m || m.type !== "shell-event" || !state.streaming) return;
    const ev = m.event || (m.data && m.data.type) || "";
    const d = m.data || {};
    switch (ev) {
      case "token":
        state.content += (d.t || d.token || "");
        if (state.contentEl) { state.contentEl.textContent = state.content; scroll(); }
        break;
      case "message": case "answer": case "final_answer":
        if (!state.content) {
          state.content = String(d.answer || d.content || d.message || "");
          if (state.contentEl) state.contentEl.textContent = state.content;
        }
        break;
      case "tool_call": {
        const tools = d.tools || d.tool_calls || [];
        for (const t of tools) trace("tool", t.name || (t.function && t.function.name) || "tool", "");
        break;
      }
      case "thinking": {
        // Live reasoning deltas (poll-progress) — without this case they fell
        // to default and rendered useless "thinking: streaming" lines.
        const frag = String(d.content || d.text || "").slice(0, 80);
        const label = d.tokens_so_far ? `think ${d.tokens_so_far}t` : "think";
        if (frag || d.tokens_so_far) trace("think", label, frag || "…");
        break;
      }
      case "complete": case "done":
        if (d.content && !state.content && state.contentEl) state.contentEl.textContent = String(d.content);
        finish(null);
        break;
      case "error":
        finish(d.error || d.message || "stream error");
        break;
      case "session_start": case "heartbeat": case "keepalive":
        break;
      default:
        if (ev) trace("trace", ev, String(d.message || d.stage || d.phase || "").slice(0, 80));
    }
  });

  // ── Wiring ──
  els.send.addEventListener("click", () => send(els.input.value));
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(els.input.value); }
  });
  if (els.steer) els.steer.addEventListener("click", () => steer("append"));
  if (els.cancel) els.cancel.addEventListener("click", () => steer("cancel"));
  // Lazy-init the session the first time the Shell tab is opened.
  if (els.tabBtn) els.tabBtn.addEventListener("click", () => { startSession(); });
  window.addEventListener("beforeunload", endSession);
})();
