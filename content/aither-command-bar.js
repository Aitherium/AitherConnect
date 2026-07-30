// AitherConnect — Aither Command Bar for social surfaces (x.com, linkedin.com…).
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
  const PLATFORM = /linkedin\.com$/.test(HOST) ? "linkedin" : (/x\.com$|twitter\.com$/.test(HOST) ? "x" : null);
  if (!PLATFORM) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, props = {}, css = "") => { const e = document.createElement(tag); Object.assign(e, props); if (css) e.style.cssText = css; return e; };
  const ask = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch { res({}); } });

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
      const wait = async (sels, ms) => { const end = Date.now() + ms; while (Date.now() < end) { for (const s of sels) { const e = document.querySelector(s); if (e && (!e.disabled)) return e; } await sleep(200); } return null; };
      let box = document.querySelector('div[data-testid="tweetTextarea_0"]');
      if (!box) { const nt = document.querySelector('a[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"], a[aria-label="Post"]'); if (nt) nt.click(); box = await wait(['div[data-testid="tweetTextarea_0"]'], 6000); }
      if (!box) return { ok: false, reason: "no_composer" };
      box.focus();
      // Clear any leftover draft first, or a failed attempt's text gets typed twice.
      try { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); await sleep(150); } catch {}
      document.execCommand("insertText", false, text); await sleep(1000);
      const pb = await wait(['button[data-testid="tweetButton"]', 'button[data-testid="tweetButtonInline"]'], 5000);
      if (!pb) return { ok: false, reason: "no_post_button" };
      pb.click(); await sleep(3000);
      // X shows "You already said that" on a duplicate — detect it so we don't
      // report a failed duplicate as a success (and so the caller can vary text).
      const dup = Array.from(document.querySelectorAll('div[role="alert"], [data-testid="toast"]')).some((n) => /already said that|duplicate/i.test(n.innerText || ""));
      if (dup) return { ok: false, reason: "duplicate" };
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
      if (!feed.length) return PLATFORM === "x"
        ? `No OTHER-people posts here (${A.likeButtons().length} likeable) — open your Home feed, not your profile`
        : `No posts visible (${A.likeButtons().length} likeable) — scroll the feed and retry`;
      const p = await ask({ type: "social-engage-plan", feed, prompt: P().engage.prompt });
      const plan = (p && p.plan) || { likes: feed.slice(0, P().engage.maxLikes).map((z) => z.idx), reply: null };
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

  // ── UI: bottom command bar ──────────────────────────────────────────────────
  const bar = el("div", { id: "aither-cmd-bar" }, `
    position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147483647;
    display:flex; align-items:center; gap:6px; padding:7px 10px; max-width:94vw;
    background:rgba(20,22,27,.92); backdrop-filter:blur(12px); color:#e9e9ea;
    border:1px solid #333a44; border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.55);
    font:13px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;`);
  const brand = el("div", {}, "display:flex;align-items:center;gap:6px;padding:0 6px 0 2px;border-right:1px solid #333a44;margin-right:2px;");
  brand.appendChild(el("span", { textContent: "⚡" }));
  brand.appendChild(el("span", { textContent: PLATFORM === "linkedin" ? "Aither · LinkedIn" : "Aither · X" }, "font-weight:700"));
  bar.appendChild(brand);

  const chip = (label, onClick, accent) => {
    const b = el("button", { textContent: label }, `
      background:${accent ? "#1d9bf0" : "#262a30"}; color:${accent ? "#fff" : "#e9e9ea"};
      border:1px solid ${accent ? "#1d9bf0" : "#333a44"}; border-radius:10px; padding:6px 11px;
      font-weight:600; cursor:pointer; white-space:nowrap;`);
    b.addEventListener("click", onClick); return b;
  };

  const mkRun = (label, which) => chip(label, async (e) => {
    const b = e.target; const old = b.textContent; b.textContent = "…"; b.disabled = true;
    setStatus(await run(which)); b.textContent = old; b.disabled = false;
  });
  bar.appendChild(mkRun("Post", "post"));
  bar.appendChild(mkRun("Engage", "engage"));
  if (PLATFORM === "x") bar.appendChild(mkRun("Discover", "discover"));

  const statusEl = el("div", { textContent: "ready" }, "padding:0 8px; color:#8a99a8; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;");
  bar.appendChild(statusEl);
  const setStatus = (t) => { statusEl.textContent = t; statusEl.title = t; };

  bar.appendChild(chip("⚙ Configure", () => openDrawer(), false));
  const hide = chip("✕", () => bar.remove(), false); hide.title = "hide (reload page to bring back)";
  bar.appendChild(hide);
  document.documentElement.appendChild(bar);

  // ── Config drawer ───────────────────────────────────────────────────────────
  function openDrawer() {
    const back = el("div", {}, "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;");
    const d = el("div", {}, `width:min(560px,92vw); max-height:86vh; overflow:auto; background:#15181c; color:#e9e9ea;
      border:1px solid #333a44; border-radius:16px; padding:18px 20px; font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;`);
    d.appendChild(el("div", { textContent: `Aither content strategy — ${PLATFORM}` }, "font-size:16px;font-weight:800;margin-bottom:4px"));
    d.appendChild(el("div", { textContent: "Everything here is stored in the extension and readable/writable by the fleet agents (Atlas/Lyra/Hera) — so they can plan and adjust autonomously. Edit and Save.", }, "color:#8a99a8;font-size:11px;margin-bottom:14px"));

    const field = (label, node) => { const w = el("div", {}, "margin:10px 0"); w.appendChild(el("label", { textContent: label }, "display:block;font-weight:700;margin-bottom:4px;font-size:12px")); w.appendChild(node); return w; };
    const inputCss = "width:100%;box-sizing:border-box;background:#0f1114;color:#e9e9ea;border:1px solid #333a44;border-radius:8px;padding:7px 9px;font:12px/1.4 inherit;";

    const loops = ["post", "engage", "discover"];
    const refs = {};
    loops.forEach((loop) => {
      const cfg = P()[loop];
      const sec = el("div", {}, "border:1px solid #262a30;border-radius:12px;padding:10px 12px;margin:10px 0;");
      const hdr = el("div", {}, "display:flex;align-items:center;gap:8px;margin-bottom:6px");
      const en = el("input", { type: "checkbox", checked: cfg.enabled !== false }, "accent-color:#1d9bf0;width:16px;height:16px;");
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
    await loadCfg();
    // remove any legacy floating panels from earlier builds
    ["aither-x-panel", "aither-li-panel"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    window.__aitherLiAgent = true; // suppress the old LinkedIn agent if it also injects
    // In-page scheduler for BOTH platforms — post/engage run here (reliable, no
    // tab-navigation), on the configured cadence.
    const eng = P().engage, post = P().post;
    if (eng.enabled !== false) { setInterval(() => run("engage").then(setStatus), Math.max(5, eng.everyMin) * 60000); setTimeout(() => run("engage").then(setStatus), 25000); }
    if (post.enabled !== false) setInterval(() => run("post").then(setStatus), Math.max(5, post.everyMin) * 60000);
    // On X, the service worker also has post/engage alarms — silence them so we
    // don't double-post; the command bar drives post+engage in-page. Discover
    // stays in the worker (it needs to navigate to search).
    if (PLATFORM === "x") chrome.storage.local.set({ xAutopostEnabled: false, xEngageEnabled: false });
    setStatus("ready · " + PLATFORM);
  })();
})();
