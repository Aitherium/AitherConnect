// Awconnect — Aither Command Bar for social surfaces (x.com, linkedin.com…).
// A bottom command bar (aitherium.com style) that turns the site you log into
// into a content-management surface. NOTHING is hardcoded: schedules, prompts,
// topics, budgets and toggles all live in chrome.storage under `socialStrategy`,
// editable here by the human AND writable by the fleet agents (Atlas/Lyra/Hera/…)
// so they can plan, schedule and adjust strategies autonomously.
//
// Automation model: on-page platforms (LinkedIn) run their DOM actions here in
// the content script; X actions run in the service worker (message x-run-now).
// The bar is the single surface for both.
(() => {
  if (window.__aitherCmdBar) return;
  window.__aitherCmdBar = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const PLATFORM = /linkedin\.com$/.test(HOST) ? "linkedin" : (/x\.com$|twitter\.com$/.test(HOST) ? "x" : "web");
  // EVERY WEBSITE EXCEPT THE OS. The whole aitherium.com family (apex + portal/demo/
  // tunnel/veil subdomains) already renders the real dock and brain bar; this bar under
  // it was two taskbars in one viewport. background.js also refuses to inject here, but
  // the guard is repeated because this file is injected from several call sites
  // (context menus, activeTab grants) and only one of them went through that check.
  if (/(^|\.)aitherium\.com$/.test(HOST)) return;

  // Build stamp — bumped on every change. If this number doesn't change after you
  // reload the extension, the reload didn't take (reload the EXTENSION in
  // edge://extensions, not just the page — Edge caches content scripts at load).
  const BUILD = "3.6.9·0853";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, props = {}, css = "") => { const e = document.createElement(tag); Object.assign(e, props); if (css) e.style.cssText = css; return e; };
  const ask = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch { res({}); } });

  /**
   * Post a message to a relay channel. Relay must be connected (sidepanel).
   * @param {string} channel - The channel to post to (e.g., "#general", "#dev")
   * @param {string} content - The message content
   * @returns {Promise<{ok: boolean}>} Success status
   */
  const postToRelay = (channel, content) => ask({
    type: "relay-send",
    data: { type: "message", channel, content },
  });

  /**
   * Post a page finding/analysis to relay. Includes page context.
   * @param {string} title - Finding title/summary
   * @param {string} detail - Detailed finding
   * @param {string} channel - Target channel (default: "#general")
   * @returns {Promise<{ok: boolean}>} Success status
   */
  const postFindingToRelay = (title, detail, channel = "#general") => {
    const finding = `[${PLATFORM}:${location.hostname}] ${title}: ${detail}`;
    return postToRelay(channel, finding);
  };

  // Expose relay API to window so page scripts and console can call:
  // window.aither.relayPost("#channel", "message")
  // window.aither.relayFinding("title", "detail", "#channel")
  window.aither = window.aither || {};
  Object.assign(window.aither, {
    relayPost: postToRelay,
    relayFinding: postFindingToRelay,
  });

  // ── Config: defaults merged with stored socialStrategy ──────────────────────
  const DEFAULTS = {
    x: {
      post:     { enabled: true, everyMin: 180, prompt: "Write ONE original tweet (<260 chars) in Aither's first-person voice about AI infrastructure, agents, or building in public. No hashtags. Return only the tweet.", angles: ["a builder's note on shipping self-running AI", "one non-obvious lesson on autonomous agents", "why local-first, self-hosted AI matters"] },
      engage:   { enabled: true, everyMin: 60,  maxLikes: 3, reply: true, prompt: "Pick up to {maxLikes} tweets to like (AI/infra/agents/building) and optionally one genuine short reply (<200 chars, no hashtags). Return JSON {likes:[idx],reply:{idx,text}|null}." },
      discover: { enabled: true, everyMin: 150, topics: ["AI agents","LLM infrastructure","self-hosted AI","autonomous agents","MLOps","open source AI"], maxFollowsPerTick: 3, dailyCap: 15 },
    },
    linkedin: {
      post:     { enabled: true, everyMin: 360, prompt: "Write ONE professional LinkedIn post (2-4 short lines) in Aither's voice about AI infrastructure or building autonomous systems. No hashtags.", angles: [] },
      engage:   { enabled: true, everyMin: 120, maxLikes: 3, reply: true, prompt: "" },
      discover: { enabled: true, everyMin: 240, topics: ["AI infrastructure","AI agents","machine learning platform","enterprise AI"], maxFollowsPerTick: 3, dailyCap: 10 },
    },
  };
  let CFG = null;
  async function loadCfg() {
    const s = await chrome.storage.local.get(["socialStrategy"]);
    const stored = s.socialStrategy || {};
    // deep-merge defaults <- stored
    CFG = JSON.parse(JSON.stringify(DEFAULTS));
    for (const plat of Object.keys(CFG)) {
      for (const loop of Object.keys(CFG[plat])) {
        Object.assign(CFG[plat][loop], (stored[plat] && stored[plat][loop]) || {});
      }
    }
    return CFG;
  }
  async function saveCfg() { await chrome.storage.local.set({ socialStrategy: CFG }); ask({ type: "social-strategy-changed", strategy: CFG }); }
  const P = () => CFG[PLATFORM];

  // ── LinkedIn in-page automation (button-anchored) ───────────────────────────
  const li = {
    likeButtons() {
      return Array.from(document.querySelectorAll("button")).filter((b) => {
        const l = (b.getAttribute("aria-label") || "").toLowerCase();
        return b.getAttribute("aria-pressed") !== "true" && (l.startsWith("like") || l.startsWith("react like"));
      });
    },
    container(btn) {
      let p = btn;
      for (let i = 0; i < 16 && p; i++) { p = p.parentElement; if (!p) break; const c = (p.className || "").toString(); if ((p.getAttribute && p.getAttribute("data-urn")) || /feed-shared-update|fie-impression|update-v2|occludable/.test(c)) return p; }
      return btn.closest('[role="article"], article') || btn.parentElement;
    },
    readFeed(limit) {
      const b = this.likeButtons(); const out = [];
      for (let i = 0; i < b.length && out.length < limit; i++) { const p = this.container(b[i]); const t = ((p && p.innerText) || "").replace(/\s+/g, " ").trim(); if (t.length > 25) out.push({ idx: i, id: i, handle: null, text: t.slice(0, 300) }); }
      return out;
    },
    async doEngage(plan) {
      let liked = 0, replied = false; const b = this.likeButtons();
      for (const idx of (plan.likes || [])) { try { if (b[idx]) { b[idx].click(); liked++; await sleep(1800 + Math.random() * 2500); } } catch {} }
      if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
        try { const p = b[plan.reply.idx] && this.container(b[plan.reply.idx]); const cb = p && Array.from(p.querySelectorAll("button")).find((x) => /comment/i.test(x.getAttribute("aria-label") || ""));
          if (cb) { cb.click(); await sleep(2200); const box = document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
            if (box) { box.focus(); document.execCommand("insertText", false, plan.reply.text); await sleep(1200); let pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]'); for (let i = 0; i < 25 && (!pb || pb.disabled); i++) { await sleep(200); pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]'); } if (pb && !pb.disabled) { pb.click(); replied = true; await sleep(2000); } } } } catch {}
      }
      return { liked, replied };
    },
    async doPost(text) {
      const wait = async (sels, ms) => { const end = Date.now() + ms; while (Date.now() < end) { for (const s of sels) { const e = document.querySelector(s); if (e) return e; } await sleep(250); } return null; };
      const st = await wait(['button.share-box-feed-entry__trigger', 'button[class*="share-box-feed-entry"]'], 8000); if (st) st.click();
      const box = await wait(['.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'], 10000); if (!box) return { ok: false, reason: "no_composer" };
      box.focus(); document.execCommand("insertText", false, text); await sleep(1200);
      let pb = await wait(['button.share-actions__primary-action', 'button[class*="share-actions__primary"]'], 5000); for (let i = 0; i < 20 && (!pb || pb.disabled); i++) { await sleep(250); pb = document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]'); }
      if (!pb || pb.disabled) return { ok: false, reason: "post_button_disabled" }; pb.click(); await sleep(3000); return { ok: true };
    },
  };

  // ── X in-page automation (open composer via the sidebar button, so Post works
  //    from ANY x.com page — not only the profile, which was the bug). ─────────
  const x = {
    ownHandle() {
      const e = document.querySelector('button[data-testid="SideNav_AccountSwitcher_Button"]');
      const m = (e ? e.innerText : "").match(/@([A-Za-z0-9_]{1,15})/);
      return m ? m[1].toLowerCase() : null;
    },
    authorOf(a) {
      const un = a.querySelector('div[data-testid="User-Name"]');
      const m = (un ? un.innerText : "").match(/@([A-Za-z0-9_]{1,15})/);
      return m ? m[1].toLowerCase() : null;
    },
    // The candidate posts to engage: OTHER people's, not already liked, with text.
    // On a profile page this is empty (all own posts) — which is correct; engage
    // belongs on the home feed.
    feedArticles(limit) {
      const me = this.ownHandle();
      const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      const out = [];
      for (const a of arts) {
        if (a.querySelector('button[data-testid="unlike"]')) continue;   // already liked
        if (!a.querySelector('div[data-testid="tweetText"]')) continue;   // no text
        const author = this.authorOf(a);
        if (me && author === me) continue;                                // NEVER like own posts
        out.push(a);
        if (out.length >= (limit || 15)) break;
      }
      return out;
    },
    likeButtons() { return this.feedArticles(30).map((a) => a.querySelector('button[data-testid="like"]')).filter(Boolean); },
    readFeed(limit) {
      return this.feedArticles(limit).map((a, idx) => {
        const t = a.querySelector('div[data-testid="tweetText"]');
        return { idx, id: idx, handle: this.authorOf(a), text: t ? (t.innerText || "").slice(0, 280) : "" };
      });
    },
    async doEngage(plan) {
      const arts = this.feedArticles(15);   // same filtered order readFeed produced
      let liked = 0, replied = false;
      for (const idx of (plan.likes || [])) {
        try { const a = arts[idx]; const b = a && a.querySelector('button[data-testid="like"]'); if (b) { b.click(); liked++; await sleep(1500 + Math.random() * 2200); } } catch {}
      }
      if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
        try {
          const a = arts[plan.reply.idx]; const rb = a && a.querySelector('button[data-testid="reply"]');
          if (rb) { rb.click(); await sleep(2000);
            const box = document.querySelector('div[data-testid="tweetTextarea_0"]');
            if (box) { box.focus(); document.execCommand("insertText", false, plan.reply.text); await sleep(1000);
              let pb = document.querySelector('button[data-testid="tweetButton"]');
              for (let i = 0; i < 25 && (!pb || pb.disabled); i++) { await sleep(200); pb = document.querySelector('button[data-testid="tweetButton"]'); }
              if (pb && !pb.disabled) { pb.click(); replied = true; await sleep(2000); } } }
        } catch {}
      }
      return { liked, replied };
    },
    async doPost(text) {
      // An enabled X Post button is aria-disabled="false" (X uses aria-disabled,
      // NOT the native disabled attr). Checking only `.disabled` returned an
      // inert button — the click did nothing and the text sat "ready to post
      // again" while Aither reported success.
      const enabled = (e) => e && !e.disabled && e.getAttribute("aria-disabled") !== "true";
      const wait = async (sels, ms) => { const end = Date.now() + ms; while (Date.now() < end) { for (const s of sels) { const e = document.querySelector(s); if (enabled(e)) return e; } await sleep(200); } return null; };
      let box = document.querySelector('div[data-testid="tweetTextarea_0"]');
      if (!box) { const nt = document.querySelector('a[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"], a[aria-label="Post"]'); if (nt) nt.click(); box = await wait(['div[data-testid="tweetTextarea_0"]'], 6000); }
      if (!box) return { ok: false, reason: "no_composer" };
      box.focus();
      // Clear any leftover draft first, or a failed attempt's text gets typed twice.
      try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); await sleep(150); } catch {}
      document.execCommand("insertText", false, text); await sleep(1000);
      const pb = await wait(['button[data-testid="tweetButton"]', 'button[data-testid="tweetButtonInline"]'], 5000);
      if (!pb) return { ok: false, reason: "no_post_button" };
      pb.click();
      // The tweet is real only when the composer clears (modal closed / route
      // changed) or X confirms with a toast. Poll for either; if neither lands,
      // wipe the composer so it can never sit loaded and ready to double-post.
      let cleared = false, confirmed = false;
      for (let i = 0; i < 40; i++) { // up to ~8s
        await sleep(200);
        const bx = document.querySelector('div[data-testid="tweetTextarea_0"]');
        cleared = !bx || (bx.innerText || "").trim().length === 0;
        confirmed = cleared || Array.from(document.querySelectorAll('[data-testid="toast"], div[role="status"]')).some((n) => /sent|posted|shared/i.test(n.innerText || ""));
        if (confirmed) break;
      }
      const wipe = () => { const bx = document.querySelector('div[data-testid="tweetTextarea_0"]'); if (!bx || (bx.innerText || "").trim().length === 0) return; bx.focus(); try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch {} };
      if (!confirmed) {
        wipe();
        const dup = Array.from(document.querySelectorAll('div[role="alert"], [data-testid="toast"]')).some((n) => /already said that|duplicate/i.test(n.innerText || ""));
        if (dup) return { ok: false, reason: "duplicate" };
        return { ok: false, reason: "composer_not_cleared" };
      }
      if (!cleared) wipe(); // posted but the composer kept the draft — kill the double-post
      return { ok: true };
    },
  };

  const A = PLATFORM === "x" ? x : li;      // platform automation, both in-page
  const platLog = PLATFORM;

  // ── Run a loop (in-page for post/engage; X discover needs the service worker) ─
  async function run(which) {
    if (which === "post") {
      const c = await ask({ type: "social-compose", prompt: P().post.prompt });
      const text = c && c.text && String(c.text).trim();
      if (!text) return "Skipped — Aither's composer isn't reachable yet (no fallbacks). Nothing posted.";
      const r = await A.doPost(text);
      if (r.ok) ask({ type: "social-log", platform: platLog, entry: { type: "post", text: text.slice(0, 200) } });
      if (r.reason === "duplicate") return "X rejected it as a duplicate — Aither needs to write fresh text.";
      return r.ok ? `Posted: ${text.slice(0, 40)}…` : `Post failed: ${r.reason}`;
    }
    if (which === "engage") {
      const feed = A.readFeed(15);
      if (!feed.length) {
        // On X this is almost always "you're on your profile / a search page".
        // A silent no-op every cycle is exactly the "it never interacts with the
        // feed" the owner keeps hitting — hand the work to the SW, which opens
        // the Home feed and engages there.
        if (PLATFORM === "x") {
          await ask({ type: "x-run-now", which: "engage", force: true });
          return "No feed on this page — handed engagement to the SW (Home feed).";
        }
        return `No posts visible (${A.likeButtons().length} likeable) — scroll the feed and retry`;
      }
      const p = await ask({ type: "social-engage-plan", feed, prompt: P().engage.prompt });
      // NO BLIND FALLBACK — this used to be
      //   (p && p.plan) || { likes: feed.slice(0, maxLikes).map(z => z.idx), reply: null }
      // i.e. when no model answered, like the first N posts in view and reply to
      // nothing. That is not a degraded plan, it is indiscriminate liking on the
      // owner's account, and it also disguises a total brain outage as a working
      // engagement loop — which is exactly how "it never replies" went unexplained.
      // The `post` branch above already gets this right ("no fallbacks. Nothing
      // posted."); this is the same rule.
      const plan = p && p.plan;
      if (!plan) return "Skipped — Aither's brain isn't reachable (no fallbacks). Engaged nothing.";
      const done = await A.doEngage(plan);
      if (done.liked || done.replied) ask({ type: "social-log", platform: platLog, entry: { type: "engage", liked: done.liked, replied: done.replied ? 1 : 0 } });
      return done.liked || done.replied ? `Liked ${done.liked}${done.replied ? " + reply" : ""}` : `Found ${feed.length} posts but engaged 0 (selector may have moved — tell Aither)`;
    }
    if (which === "discover") {
      if (PLATFORM === "x") { const r = await ask({ type: "x-run-now", which: "discover" }); return r && r.ran ? "Discovering…" : "Discover queued"; }
      return "Discover: open LinkedIn people-search for a topic, then Engage.";
    }
    return "unknown action";
  }

  // ══ Aither OS shell: a taskbar on EVERY page + windows drawn over it. ════════
  // The page you're browsing is the desktop; Aither draws its bar and its windows
  // on top. Awconnect options and aitherium.com surfaces all launch from here.
  let statusEl = null;
  const setStatus = (t) => { if (statusEl) { statusEl.textContent = t; statusEl.title = t; } };

  const Z = 2147483000;
  let winSeq = 0;

  // The brain the shell composes/answers with (persisted; also read by the SW).
  // The brain the shell composes/answers with. On-device options are the SAME
  // Bonsai sizes aitherium.com runs (in-browser, WebGPU); the rest are fleet/cloud.
  const BACKENDS = [
    { id: "local:bonsai-1.7b",     label: "🧠 Bonsai 1.7B · on-device" },
    { id: "local:bonsai-4b",       label: "🧠 Bonsai 4B · on-device" },
    { id: "local:bonsai-8b",       label: "🧠 Bonsai 8B · on-device" },
    { id: "local:bonsai-27b-text", label: "🧠 Bonsai 27B · on-device" },
    { id: "aither-genesis", label: "Local Genesis" },
    { id: "aither-node",    label: "Local awnode" },
    { id: "aither-gateway", label: "Gateway (cloud)" },
    { id: "aither-mcp",     label: "MCP (cloud)" },
  ];
  // Default to the FAST in-browser brain. 4B/545MB was the old default and on
  // this shared 5090 it decodes ~10-15 tok/s (measured 2026-07-31: 76ms/token
  // attention + sample, contention-dominated); the owner remembered "30+ tok/s"
  // from the 1.7B lane. 1.7B/236MB loads in under half the time AND decodes
  // ~2.3x faster. The heavier sizes stay one click away in the selector.
  let BACKEND = "local:bonsai-1.7b";

  // ── Floating window manager (draggable, closeable, drawn over the page) ──────
  function openWindow(title, build, opts) {
    opts = opts || {};
    if (opts.id) { const ex = document.getElementById(opts.id); if (ex) { ex.style.zIndex = String(Z + (++winSeq)); return ex; } }
    const w = el("div", opts.id ? { id: opts.id } : {}, `position:fixed; z-index:${Z + (++winSeq)};
      left:${opts.x != null ? opts.x : 70}px; top:${opts.y != null ? opts.y : 60}px;
      width:${opts.w || 440}px; height:${opts.h || 560}px; max-width:95vw; max-height:80vh;
      display:flex; flex-direction:column; background:#19202c; color:#e9e9ea; border:1px solid #2a3742;
      border-radius:12px; overflow:hidden; box-shadow:0 20px 70px rgba(0,0,0,.6);
      font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;`);
    const head = el("div", {}, "display:flex;align-items:center;gap:8px;padding:8px 10px;background:#121821;border-bottom:1px solid #232c3b;cursor:move;user-select:none;flex:0 0 auto;");
    head.appendChild(el("span", { textContent: title }, "font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"));
    if (opts.openUrl) { const o = el("button", { textContent: "↗", title: "open in a tab" }, "background:#232c3b;color:#e9e9ea;border:1px solid #2a3742;border-radius:6px;width:26px;height:24px;cursor:pointer;"); o.addEventListener("click", () => ask({ type: "open-tab", url: opts.openUrl })); head.appendChild(o); }
    const cl = el("button", { textContent: "✕" }, "background:#232c3b;color:#e9e9ea;border:1px solid #2a3742;border-radius:6px;width:26px;height:24px;cursor:pointer;");
    cl.addEventListener("click", () => w.remove()); head.appendChild(cl);
    const body = el("div", {}, "flex:1 1 auto;overflow:auto;position:relative;");
    w.appendChild(head); w.appendChild(body);
    let dragging = false, ox = 0, oy = 0;
    head.addEventListener("mousedown", (e) => { dragging = true; ox = e.clientX - w.offsetLeft; oy = e.clientY - w.offsetTop; e.preventDefault(); });
    window.addEventListener("mousemove", (e) => { if (!dragging) return; w.style.left = Math.max(0, e.clientX - ox) + "px"; w.style.top = Math.max(0, e.clientY - oy) + "px"; });
    window.addEventListener("mouseup", () => { dragging = false; });
    w.addEventListener("mousedown", () => { w.style.zIndex = String(Z + (++winSeq)); });
    try { build(body, w); } catch (e) { body.appendChild(el("div", { textContent: String(e) }, "padding:12px;color:#ef4444")); }
    document.documentElement.appendChild(w);
    return w;
  }
  function openApp(title, url, opts) {
    // Our own extension pages (chat / relay / settings) embed cleanly as windows.
    // External sites (aitherium.com surfaces) send frame-ancestors/X-Frame-Options
    // and refuse to embed, so open those in a tab rather than a broken window.
    if (url.indexOf(chrome.runtime.getURL("")) !== 0) { ask({ type: "open-tab", url }); return null; }
    return openWindow(title, (body) => {
      body.appendChild(el("iframe", { src: url }, "width:100%;height:100%;border:0;background:#0b0d10;display:block;"));
    }, Object.assign({ openUrl: url, w: 980, h: 640, x: 56, y: 40 }, opts || {}));
  }
  // Chat window that talks to the SELECTED backend.
  function openChat(seed) {
    openWindow("Ask Aither", (body) => {
      body.style.display = "flex"; body.style.flexDirection = "column";
      const log = el("div", {}, "flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;");
      const row = el("div", {}, "display:flex;gap:6px;padding:8px;border-top:1px solid #232c3b;");
      const inp = el("input", { placeholder: "Ask Aither…", value: seed || "" }, "flex:1;background:#121821;color:#e9e9ea;border:1px solid #2a3742;border-radius:8px;padding:8px 10px;font:13px inherit;");
      const send = chip("Send", submit, true);
      row.appendChild(inp); row.appendChild(send);
      body.appendChild(log); body.appendChild(row);
      const bubble = (who, text, muted) => { const b = el("div", {}, `align-self:${who === "you" ? "flex-end" : "flex-start"};max-width:84%;background:${who === "you" ? "#1d3a52" : "#1b1f24"};border:1px solid #2a3742;border-radius:10px;padding:8px 10px;white-space:pre-wrap;${muted ? "opacity:.7;font-style:italic;" : ""}`); b.textContent = text; log.appendChild(b); log.scrollTop = log.scrollHeight; return b; };
      async function submit() {
        const q = inp.value.trim(); if (!q) return; inp.value = "";
        bubble("you", q);
        const wait = bubble("aither", `thinking… (${BACKEND})`, true);
        let r; try { r = await ask({ type: "ask-aither", prompt: q, backend: BACKEND }); } catch (e) { r = { error: String(e) }; }
        wait.remove();
        bubble("aither", (r && r.text) || `⚠ ${(r && r.error) || "no response from " + BACKEND}`);
      }
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      setTimeout(() => inp.focus(), 50);
      if (seed) submit();
    }, { id: "aither-chat-win", w: 440, h: 560, x: 80, y: 60 });
  }

  // ── Launcher (Start menu): Awconnect options + aitherium.com apps ────────
  // Reuse the REAL Awconnect chat client — the side panel (chat + AitherRelay
  // + shell + search, with its own provider selection) — drawn as a window over
  // the page instead of a bespoke box.
  const SIDEPANEL = chrome.runtime.getURL("sidepanel/sidepanel.html");
  const APPS = [
    { icon: "💬", label: "Chat", run: () => ask({ type: "open-sidepanel" }) },
    { icon: "📡", label: "AitherRelay", run: () => ask({ type: "open-sidepanel" }) },
    { icon: "⚙", label: "Settings", run: () => ask({ type: "open-options" }) },
    { icon: "🖥", label: "AitherOS Overlay", run: () => ask({ type: "inject-overlay" }) },
    { icon: "🔌", label: "Connect Machine", run: () => ask({ type: "inject-machine-panel" }) },
    { icon: "🔐", label: "Backups", run: () => ask({ type: "inject-backups-panel" }) },
    { icon: "🌐", label: "Portal", run: () => openApp("Portal", "https://portal.aitherium.com/") },
    { icon: "🛰", label: "Tunnel", run: () => openApp("Tunnel", "https://tunnel.aitherium.com/") },
  ];
  let launcher = null;
  function toggleLauncher() {
    if (launcher) { launcher.remove(); launcher = null; return; }
    launcher = el("div", {}, `position:fixed;left:10px;bottom:52px;z-index:${Z + 1};width:280px;
      background:#19202c;border:1px solid #2a3742;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.6);
      padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;`);
    APPS.forEach((a) => {
      const b = el("button", {}, "display:flex;flex-direction:column;align-items:center;gap:5px;background:#1b1f24;border:1px solid #232c3b;border-radius:10px;padding:12px 6px;color:#e9e9ea;cursor:pointer;font:12px inherit;");
      b.appendChild(el("div", { textContent: a.icon }, "font-size:20px"));
      b.appendChild(el("div", { textContent: a.label }, "text-align:center;line-height:1.2"));
      b.addEventListener("click", () => { a.run(); if (launcher) { launcher.remove(); launcher = null; } });
      launcher.appendChild(b);
    });
    document.documentElement.appendChild(launcher);
  }

  // ── Reserve the bar's strip so it NEVER covers page content ─────────────────
  // `body { padding-bottom }` alone is a NO-OP on SPA shells that fill the
  // viewport and scroll inside their OWN container — measured on x.com:
  // after body.paddingBottom="48px" the scrollHeight stayed 900 (unchanged),
  // so the fixed bar sat over the feed and "covered shit". Pad html + body AND
  // every real scroll container, and re-apply briefly so late SPA mounts get
  // padded too. x.com's primary column is what actually scrolls; padding it
  // pushes the feed clear of the bar.
  const BAR_H = 46;
  let _padTimer = null;
  const padEl = (el, on) => { try { el.style.paddingBottom = on ? (BAR_H + 6) + "px" : ""; } catch { /* noop */ } };
  function reserveSpace(on) {
    // When the REAL OS overlay is live it is the single padder — it reserves the
    // dock AND this bar's strip above it (social pages). Defer entirely, or the
    // two would overwrite each other on the same containers every 1.5s.
    if (window.__aitherOverlayLive === true) return;
    const apply = () => {
      padEl(document.documentElement, on);
      padEl(document.body, on);
      let n = 0;
      // Target likely scroll containers (main / role=main / [data-testid]) — a
      // blanket `div` sweep calls getComputedStyle on thousands of nodes per
      // tick and thrashes the layout on heavy pages.
      for (const el of document.querySelectorAll("main, [role='main'], [data-testid], section")) {
        const o = getComputedStyle(el).overflowY;
        const isScroll = o === "auto" || o === "scroll" || (o === "hidden" && el.scrollHeight > el.clientHeight + 10);
        if (!isScroll) continue;
        if (on && !(el.scrollHeight > el.clientHeight + 10)) continue; // only real scrollers when padding
        padEl(el, on);
        if (++n >= 24) break;
      }
    };
    apply();
    if (_padTimer) { clearInterval(_padTimer); _padTimer = null; }
    if (on) {
      let ticks = 0;
      _padTimer = setInterval(() => { apply(); if (++ticks > 8) { clearInterval(_padTimer); _padTimer = null; } }, 1500);
    }
  }
  reserveSpace(true);

  // ── The taskbar itself (full-width, bottom, OS style) ───────────────────────
  const bar = el("div", { id: "aither-cmd-bar" }, `position:fixed;left:0;right:0;bottom:0;z-index:${Z};
    display:flex;align-items:center;gap:8px;height:46px;padding:0 10px;padding-right:44px;box-sizing:border-box;
    background:rgba(10,14,20,.97);backdrop-filter:blur(14px);border-top:1px solid rgba(244,183,64,.28);color:#e9e9ea;
    font:13px/1 -apple-system,Segoe UI,Roboto,sans-serif;`);

  // #1d9bf0 was TWITTER BLUE — a leftover from this bar's origin as an x.com growth panel,
  // and it read as someone else's brand pasted onto the OS. The bar is supposed to look like
  // aitherium.com's own: dark surface, cyan accent, monospace lowercase. No fill, so it sits
  // in the bar rather than shouting over it.
  const startBtn = el("button", {}, `display:flex;align-items:center;gap:7px;background:rgba(91,157,255,.10);
    color:#5b9dff;border:1px solid rgba(91,157,255,.35);border-radius:8px;padding:6px 12px;
    font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;
    cursor:pointer;flex:0 0 auto;transition:background .15s ease,border-color .15s ease;`);
  startBtn.addEventListener("mouseenter", () => {
    startBtn.style.background = "rgba(91,157,255,.18)";
    startBtn.style.borderColor = "rgba(91,157,255,.6)";
  });
  startBtn.addEventListener("mouseleave", () => {
    startBtn.style.background = "rgba(91,157,255,.10)";
    startBtn.style.borderColor = "rgba(91,157,255,.35)";
  });
  startBtn.appendChild(el("span", { textContent: "aither" }));
  startBtn.title = "Awconnect · build " + BUILD + " · loaded from D:\\AitherOS-Fresh\\Awconnect";
  startBtn.addEventListener("click", toggleLauncher);
  bar.appendChild(startBtn);

  const backendSel = el("select", {}, "background:#121821;color:#e9e9ea;border:1px solid #2a3742;border-radius:8px;padding:6px 8px;font:12px inherit;cursor:pointer;flex:0 0 auto;");
  BACKENDS.forEach((b) => backendSel.appendChild(el("option", { value: b.id, textContent: b.label })));
  // The one path that grows the in-browser Bonsai brain. Shared by the selector's
  // change handler and the boot-time auto-preload so the brain is "already there"
  // on every page instead of sitting at "no brain" until the user picks a size.
  let _brainLoading = null;   // modelId currently loading, to dedupe concurrent calls
  function startBrainLoad(m) {
    if (_brainLoading === m) return _brainLoading;  // already loading this size
    _brainLoading = m;
    ask({ type: "set-backend", backend: "aither-local" });
    ask({ type: "set-webml-model", modelId: m });
    try { brainChip.set("#5b9dff", "loading brain…"); } catch { /* chip not built yet */ }
    setStatus("Loading brain " + m + "…");
    ask({ type: "webml-preload", modelId: m }).then((r) => {
      _brainLoading = null;
      if (r && r.ok) { try { brainChip.set("#34d399", "local brain online"); } catch {} setStatus("brain ready ✅"); }
      else { const err = (r && r.error) || "load failed (no response)"; try { brainChip.set("#f59e0b", "brain error"); } catch {} setStatus("brain: " + err); }
    });
    return m;
  }
  backendSel.addEventListener("change", () => {
    const v = backendSel.value; BACKEND = v;
    try { chrome.storage.local.set({ aitherBrain: v }); } catch { /* noop */ }
    if (v.indexOf("local:") === 0) startBrainLoad(v.slice(6));
    else { ask({ type: "set-backend", backend: v }); setStatus("brain · " + backendSel.options[backendSel.selectedIndex].text); }
  });
  bar.appendChild(backendSel);

  const quick = el("input", { placeholder: "Ask Aither…" }, "flex:1 1 auto;min-width:70px;background:#121821;color:#e9e9ea;border:1px solid #2a3742;border-radius:8px;padding:7px 10px;font:12px inherit;");
  quick.addEventListener("keydown", (e) => { if (e.key === "Enter" && quick.value.trim()) { ask({ type: "open-sidepanel" }); quick.value = ""; } });
  bar.appendChild(quick);

  const chip = (label, onClick, accent) => {
    const b = el("button", { textContent: label }, `
      background:${accent ? "rgba(91,157,255,.14)" : "#232c3b"}; color:${accent ? "#5b9dff" : "#e9e9ea"};
      border:1px solid ${accent ? "rgba(91,157,255,.45)" : "#2a3742"}; border-radius:10px; padding:6px 11px;
      font-weight:600; cursor:pointer; white-space:nowrap;`);
    b.addEventListener("click", onClick); return b;
  };

  // Platform automation lives on the taskbar only where it applies (x/linkedin).
  const mkRun = (label, which) => chip(label, async (e) => {
    const b = e.target; const o = b.textContent; b.textContent = "…"; b.disabled = true;
    setStatus(await run(which)); b.textContent = o; b.disabled = false;
  });
  // No "Connect session" step: Aither drives THIS browser, where you're already
  // logged into X — Post/Engage act directly on the page. (Seeding the fleet's
  // own headless browser is a separate, opt-in thing, not a prerequisite here.)
  if (PLATFORM === "x" || PLATFORM === "linkedin") {
    bar.appendChild(mkRun("Post", "post"));
    bar.appendChild(mkRun("Engage", "engage"));
    if (PLATFORM === "x") bar.appendChild(mkRun("Discover", "discover"));
    bar.appendChild(chip("⚙", () => openDrawer(), false));
  }

  statusEl = el("div", { textContent: "ready" }, "color:#8a99a8;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;flex:0 1 auto;");
  bar.appendChild(statusEl);

  // ── System tray — matches aitherium.com's dock (brain · node · sign-in) ──────
  const trayChip = (dotColor, label, title, onClick) => {
    const c = el("button", { title: title || "" }, "display:flex;align-items:center;gap:5px;background:transparent;border:0;border-radius:8px;padding:5px 8px;cursor:pointer;color:#8a99a8;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;flex:0 0 auto;");
    const dot = el("span", {}, `width:7px;height:7px;border-radius:50%;background:${dotColor};flex:0 0 auto;`);
    const t = el("span", { textContent: label }, "white-space:nowrap;");
    c.appendChild(dot); c.appendChild(t);
    c.addEventListener("mouseenter", () => { c.style.background = "rgba(255,255,255,.06)"; });
    c.addEventListener("mouseleave", () => { c.style.background = "transparent"; });
    if (onClick) c.addEventListener("click", onClick);
    return { el: c, set: (col, lab) => { dot.style.background = col; dot.style.boxShadow = col === "#3a4048" ? "none" : "0 0 6px " + col; if (lab != null) t.textContent = lab; } };
  };

  // Brain chip — the in-browser Bonsai model state (cyan loading, emerald ready).
  const brainChip = trayChip("#3a4048", "no brain", "The in-browser Bonsai model on YOUR GPU — pick a size in the selector to grow it", () => { try { backendSel.focus(); } catch { /* noop */ } });
  bar.appendChild(brainChip.el);
  chrome.runtime.onMessage.addListener((m) => {
    if (!m || m.type !== "webml-progress") return;
    if (m.done) brainChip.set("#34d399", "local brain online");
    else if (typeof m.progress === "number") brainChip.set("#5b9dff", `growing brain ${Math.round(m.progress)}%`);
  });

  // Node chip — probes the local awnode / adk daemon (via the SW, no CORS).
  let _nodeBase = null;
  const nodeChip = trayChip("#3a4048", "no node", "Local awnode / adk agent on your machine — click to open it when online", () => { if (_nodeBase) ask({ type: "open-tab", url: _nodeBase }); });
  bar.appendChild(nodeChip.el);
  // Two strikes before showing "no node": the probe goes through the service
  // worker, so a single slow round-trip (SW wake, a busy /health) read as a
  // DOWN and the chip flipped online/offline every 20 s — the "node online is
  // flapping" the owner kept seeing. One miss is a coin-flip; two in a row is real.
  let _nodeMisses = 0;
  const probeNode = () => ask({ type: "probe-node" }).then((r) => {
    if (r && r.online) {
      _nodeMisses = 0;
      _nodeBase = r.baseUrl || null;
      nodeChip.set("#34d399", "node online");
      nodeChip.el.title = "Local agent online" + (r.baseUrl ? " (" + r.baseUrl + ")" : "") + " — click to open";
    } else {
      _nodeMisses++;
      if (_nodeMisses >= 2) { _nodeBase = null; nodeChip.set("#3a4048", "no node"); }
    }
  });
  probeNode(); setInterval(probeNode, 20000);

  // Sign-in chip — one sign-in for the whole OS (opens portal).
  const authChip = trayChip("#3a4048", "sign in", "Sign in once — opens in the side panel, not a new tab", () => ask({ type: "open-sidepanel" }));
  bar.appendChild(authChip.el);

  const clock = el("div", {}, "color:#cbd5e1;font-variant-numeric:tabular-nums;padding:0 6px;flex:0 0 auto;font:11px/1 ui-monospace,Menlo,monospace;");
  const tickClock = () => { const d = new Date(); clock.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  tickClock(); setInterval(tickClock, 30000);
  bar.appendChild(clock);

  // ── Hide / show — persisted; a small ⚡ handle brings it back, no reload ─────
  const handle = el("button", { textContent: "⚡", title: "show the Aither bar" }, `position:fixed;right:12px;bottom:10px;z-index:${Z};display:none;
    width:34px;height:34px;border-radius:50%;background:rgba(14,16,20,.97);color:#5b9dff;border:1px solid rgba(91,157,255,.45);cursor:pointer;font-size:15px;box-shadow:0 6px 20px rgba(0,0,0,.5);`);
  function showBar() { bar.style.display = "flex"; handle.style.display = "none"; reserveSpace(true); try { chrome.storage.local.set({ aitherBarHidden: false }); } catch { /* noop */ } }
  function hideBar() { bar.style.display = "none"; handle.style.display = "flex"; reserveSpace(false); try { chrome.storage.local.set({ aitherBarHidden: true }); } catch { /* noop */ } }
  handle.addEventListener("click", showBar);

  // The minimize button is absolutely positioned at the bar's right edge so a
  // crowded bar / narrow window can NEVER clip it out of the viewport (the
  // "no real way to minimize" report), and the restore handle sits in the SAME
  // corner so minimize/restore are one fixed spot.
  const hide = el("button", { textContent: "▾", title: "Minimize the Aither bar (⚡ in the same corner restores it — no reload)" }, "position:absolute;right:8px;top:50%;transform:translateY(-50%);background:#232c3b;color:#e9e9ea;border:1px solid #2a3742;border-radius:8px;width:28px;height:28px;cursor:pointer;");
  hide.addEventListener("click", hideBar);
  bar.appendChild(hide);

  document.documentElement.appendChild(bar);
  document.documentElement.appendChild(handle);

  // Surface on-device brain download/load progress in the status line. We do NOT
  // auto-download a multi-hundred-MB model on page load — the owner picks a Bonsai
  // size in the selector (or clicks Post), which warms it, exactly like
  // aitherium.com's "double-click it to run it on your own machine".
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (!m || m.type !== "webml-progress") return;
      if (m.done) setStatus("On-device brain ready ✅");
      else if (typeof m.progress === "number") setStatus(`Loading brain… ${Math.round(m.progress)}%`);
    });
  } catch { /* no runtime */ }

  // ── Config drawer ───────────────────────────────────────────────────────────
  function openDrawer() {
    const back = el("div", {}, "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;");
    const d = el("div", {}, `width:min(560px,92vw); max-height:86vh; overflow:auto; background:#15181c; color:#e9e9ea;
      border:1px solid #2a3742; border-radius:16px; padding:18px 20px; font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;`);
    d.appendChild(el("div", { textContent: `Aither content strategy — ${PLATFORM}` }, "font-size:16px;font-weight:800;margin-bottom:4px"));
    d.appendChild(el("div", { textContent: "Everything here is stored in the extension and readable/writable by the fleet agents (Atlas/Lyra/Hera) — so they can plan and adjust autonomously. Edit and Save.", }, "color:#8a99a8;font-size:11px;margin-bottom:14px"));

    const field = (label, node) => { const w = el("div", {}, "margin:10px 0"); w.appendChild(el("label", { textContent: label }, "display:block;font-weight:700;margin-bottom:4px;font-size:12px")); w.appendChild(node); return w; };
    const inputCss = "width:100%;box-sizing:border-box;background:#121821;color:#e9e9ea;border:1px solid #2a3742;border-radius:8px;padding:7px 9px;font:12px/1.4 inherit;";

    const loops = ["post", "engage", "discover"];
    const refs = {};
    loops.forEach((loop) => {
      const cfg = P()[loop];
      const sec = el("div", {}, "border:1px solid #232c3b;border-radius:12px;padding:10px 12px;margin:10px 0;");
      const hdr = el("div", {}, "display:flex;align-items:center;gap:8px;margin-bottom:6px");
      const en = el("input", { type: "checkbox", checked: cfg.enabled !== false }, "accent-color:#5b9dff;width:16px;height:16px;");
      hdr.appendChild(en); hdr.appendChild(el("span", { textContent: loop.toUpperCase() }, "font-weight:800;flex:1"));
      const runNow = chip("Run now", async () => { setStatus(await run(loop)); }, true); hdr.appendChild(runNow);
      sec.appendChild(hdr);
      const every = el("input", { type: "number", value: cfg.everyMin, min: 5 }, inputCss);
      sec.appendChild(field("Every N minutes", every));
      let prompt = null, topics = null, maxLikes = null, cap = null;
      if (loop === "post" || loop === "engage") { prompt = el("textarea", { value: cfg.prompt || "", rows: 3 }, inputCss); sec.appendChild(field("Prompt (Aither's brief)", prompt)); }
      if (loop === "engage") { maxLikes = el("input", { type: "number", value: cfg.maxLikes, min: 0, max: 10 }, inputCss); sec.appendChild(field("Max likes per run", maxLikes)); }
      if (loop === "discover") {
        topics = el("textarea", { value: (cfg.topics || []).join(", "), rows: 2 }, inputCss); sec.appendChild(field("Topics (comma-separated)", topics));
        cap = el("input", { type: "number", value: cfg.dailyCap, min: 0 }, inputCss); sec.appendChild(field("Daily follow cap", cap));
      }
      refs[loop] = { en, every, prompt, topics, maxLikes, cap };
      d.appendChild(sec);
    });

    const foot = el("div", {}, "display:flex;gap:8px;margin-top:14px");
    const save = chip("Save strategy", async () => {
      loops.forEach((loop) => {
        const r = refs[loop]; const cfg = P()[loop];
        cfg.enabled = r.en.checked; cfg.everyMin = Math.max(5, Number(r.every.value) || cfg.everyMin);
        if (r.prompt) cfg.prompt = r.prompt.value;
        if (r.maxLikes) cfg.maxLikes = Number(r.maxLikes.value);
        if (r.topics) cfg.topics = r.topics.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (r.cap) cfg.dailyCap = Number(r.cap.value);
      });
      await saveCfg(); setStatus("strategy saved"); back.remove();
    }, true);
    foot.appendChild(save);
    foot.appendChild(chip("Cancel", () => back.remove(), false));
    d.appendChild(foot);
    back.appendChild(d);
    back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
    document.documentElement.appendChild(back);
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  (async () => {
    // Restore the selected brain + whether the owner hid the bar on this browser.
    try { const s = await chrome.storage.local.get(["aitherBrain", "aitherBarHidden"]); if (s.aitherBrain) { BACKEND = s.aitherBrain; backendSel.value = BACKEND; } if (s.aitherBarHidden) hideBar(); } catch { /* defaults stay */ }
    // remove any legacy floating panels from earlier builds
    ["aither-x-panel", "aither-li-panel"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });

    // Auto-grow the in-browser brain so it is "already there" — the owner's ask.
    // The default backend has been local:bonsai-4b but NOTHING ever loaded it, so
    // the chip sat at "no brain" until the user manually picked a size. Fire the
    // same preload the selector uses; the background skips the round-trip when the
    // model is already warm in the offscreen doc, so this is a one-time ~4-6s load
    // on first use and a fast no-op thereafter. sessionStorage guards per-tab.
    if (BACKEND.indexOf("local:") === 0) {
      const m = BACKEND.slice(6);
      try {
        if (!sessionStorage.getItem("aitherBrainWarm")) {
          sessionStorage.setItem("aitherBrainWarm", "1");
          startBrainLoad(m);
        }
      } catch { /* storage unavailable — try anyway */ startBrainLoad(m); }
    }

    // Social automation + scheduler only where it applies (x / linkedin).
    if (PLATFORM === "x" || PLATFORM === "linkedin") {
      window.__aitherLiAgent = true; // suppress the old LinkedIn agent if it also injects
      await loadCfg();
      const eng = P().engage, post = P().post;
      if (eng.enabled !== false) { setInterval(() => run("engage").then(setStatus), Math.max(5, eng.everyMin) * 60000); setTimeout(() => run("engage").then(setStatus), 25000); }
      if (post.enabled !== false) setInterval(() => run("post").then(setStatus), Math.max(5, post.everyMin) * 60000);
      // On X the service worker ALSO has post/engage alarms. We must not double-post,
      // so this bar claims the driver role — but as a LEASE, not by writing the
      // user's kill switch.
      //
      // This used to be `chrome.storage.local.set({ xAutopostEnabled:false, xEngageEnabled:false })`,
      // and that one line cost the owner weeks of silence. Those two keys are the
      // USER's kill switch (background.js xAutopostTick: `if (s.xAutopostEnabled === false) return`).
      // Writing them from here overloaded a user-facing control as internal
      // coordination, and the write is STICKY — it outlives the page, the tab and
      // the browser. So when the bar itself was later disabled (commandBarEnabled
      // defaulted to false with no UI to turn it back on) BOTH drivers were off:
      // the bar never injected, and the service worker obeyed a "kill switch" the
      // user never touched. Zero posts, zero replies, no error, nothing to see in
      // any log. A lease expires on its own; a kill switch does not.
      if (PLATFORM === "x" || PLATFORM === "linkedin") {
        // A LEASE, not a kill switch: claims the driver role so the SW loops
        // back off while this bar is alive, and EXPIRES on its own if the bar
        // dies. Writing xAutopostEnabled:false here was the sticky kill switch
        // that cost the owner weeks of silence.
        const key = PLATFORM === "x" ? "xPageDriverAt" : "liPageDriverAt";
        const claim = () => { try { chrome.storage.local.set({ [key]: Date.now() }); } catch { /* page unloading */ } };
        claim();
        setInterval(claim, 60000); // renew while this tab is alive
      }
      // Seed the fleet's X session AUTOMATICALLY via the local adk-daemon (no
      // button, no download). Once per page-session; silent unless it lands.
      if (PLATFORM === "x" && !sessionStorage.getItem("aitherXSynced")) {
        sessionStorage.setItem("aitherXSynced", "1");
        ask({ type: "x-session-sync" }).then((r) => { if (r && r.ok) setStatus("✓ X session seeded (" + (r.via || "fleet") + ")"); });
      }
    }
    setStatus((PLATFORM === "web" ? "Aither OS" : "ready · " + PLATFORM) + " · build " + BUILD);
  })();
})();
