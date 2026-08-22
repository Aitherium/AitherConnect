// Awconnect — LinkedIn on-page agent + control panel.
// Runs as a content script ON linkedin.com, so the DOM automation lives here in
// the page (not in the service worker). Aither's brain (compose + engagement
// decisions) is asked over messages to the background; the clicking/typing
// happens here. Post + Engage work on the feed page without navigation.
(() => {
  if (window.__aitherLiAgent) return;
  window.__aitherLiAgent = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (tag, props = {}, css = "") => {
    const el = document.createElement(tag);
    Object.assign(el, props); if (css) el.style.cssText = css; return el;
  };
  const ask = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch { res({}); }
  });
  const waitFor = async (sels, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { for (const s of sels) { const el = document.querySelector(s); if (el) return el; } await sleep(250); }
    return null;
  };

  // ── LinkedIn DOM actions (button-anchored — robust to class churn) ──────────
  // Anchor on the Like buttons (their aria-labels are stable) and walk up to the
  // post container, rather than depending on LinkedIn's volatile CSS classes.
  function likeButtons() {
    return Array.from(document.querySelectorAll("button")).filter((b) => {
      const l = (b.getAttribute("aria-label") || "").toLowerCase();
      const pressed = b.getAttribute("aria-pressed") === "true";
      return !pressed && (l.startsWith("like") || l.startsWith("react like") || l === "like");
    });
  }
  function commentButtonsFor(container) {
    return Array.from((container || document).querySelectorAll("button")).find((b) =>
      /^comment/i.test(b.getAttribute("aria-label") || "") || /comment/i.test(b.getAttribute("aria-label") || ""));
  }
  function postContainer(btn) {
    let p = btn;
    for (let i = 0; i < 16 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      const cls = (p.className && p.className.toString()) || "";
      if ((p.getAttribute && p.getAttribute("data-urn")) || /feed-shared-update|fie-impression|update-v2|occludable/.test(cls)) return p;
    }
    return btn.closest('[role="article"], article') || btn.parentElement;
  }
  function readFeed(limit) {
    const btns = likeButtons();
    const out = [];
    for (let i = 0; i < btns.length && out.length < limit; i++) {
      const p = postContainer(btns[i]);
      const txt = ((p && p.innerText) || "").replace(/\s+/g, " ").trim();
      if (txt.length > 25) out.push({ idx: i, id: i, handle: null, text: txt.slice(0, 300) });
    }
    return out;
  }

  async function doEngage(plan) {
    let liked = 0, replied = false;
    const btns = likeButtons(); // same index space readFeed produced
    for (const idx of (plan.likes || [])) {
      try { const b = btns[idx]; if (b) { b.click(); liked++; await sleep(1800 + Math.random() * 2500); } } catch {}
    }
    if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
      try {
        const b = btns[plan.reply.idx];
        const p = b && postContainer(b);
        const cb = p && commentButtonsFor(p);
        if (cb) {
          cb.click(); await sleep(2200);
          const box = document.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
          if (box) {
            box.focus(); document.execCommand("insertText", false, plan.reply.text); await sleep(1200);
            let pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]');
            for (let i = 0; i < 25 && (!pb || pb.disabled); i++) { await sleep(200); pb = document.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]'); }
            if (pb && !pb.disabled) { pb.click(); replied = true; await sleep(2000); }
          }
        }
      } catch {}
    }
    return { liked, replied };
  }

  async function doPost(text) {
    const starter = await waitFor(['button.share-box-feed-entry__trigger', 'button[class*="share-box-feed-entry"]'], 8000);
    if (starter) starter.click();
    const box = await waitFor(['.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'], 10000);
    if (!box) return { ok: false, reason: "no_composer" };
    box.focus(); document.execCommand("insertText", false, text); await sleep(1200);
    let pb = await waitFor(['button.share-actions__primary-action', 'button[class*="share-actions__primary"]'], 5000);
    for (let i = 0; i < 20 && (!pb || pb.disabled); i++) { await sleep(250); pb = document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]'); }
    if (!pb || pb.disabled) return { ok: false, reason: "post_button_disabled" };
    pb.click(); await sleep(3000); return { ok: true };
  }

  async function runPost() {
    const c = await ask({ type: "social-compose" });
    const text = (c && c.text) || "Building AI infrastructure that runs itself. More soon.";
    const r = await doPost(text);
    await ask({ type: "social-log", platform: "linkedin", entry: { type: "post", text: text.slice(0, 200) } });
    return r.ok ? `Posted: ${text.slice(0, 50)}…` : `Post failed (${r.reason})`;
  }
  async function runEngage() {
    const feed = readFeed(15);
    if (!feed.length) return "No feed posts found";
    const p = await ask({ type: "social-engage-plan", feed });
    // NO BLIND FALLBACK — see the same rule in aither-command-bar.js. Liking the
    // first two posts in view because no model answered is an unjudged action on
    // the owner's real account, and it makes a brain outage read as a working
    // loop. (This file is legacy — the command bar supersedes it and sets
    // `window.__aitherLiAgent` to suppress it — but it is still on disk and
    // still injectable, so it does not get to keep the defect.)
    const plan = p && p.plan;
    if (!plan) return "Skipped — Aither's brain isn't reachable (no fallbacks). Engaged nothing.";
    const done = await doEngage(plan);
    await ask({ type: "social-log", platform: "linkedin", entry: { type: "engage", liked: done.liked, replied: done.replied ? 1 : 0 } });
    return `Liked ${done.liked}${done.replied ? " + comment" : ""}`;
  }

  // ── Panel UI ────────────────────────────────────────────────────────────────
  const panel = $("div", { id: "aither-li-panel" }, `
    position:fixed; top:80px; right:16px; z-index:2147483646; width:230px;
    background:#1b1f23; color:#e9e9ea; font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
    border:1px solid #38434f; border-radius:12px; box-shadow:0 8px 26px rgba(0,0,0,.5); overflow:hidden;`);
  const head = $("div", {}, "display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(180deg,#0a66c233,#1b1f23);border-bottom:1px solid #38434f;cursor:grab;");
  head.appendChild($("span", { textContent: "in" }, "font-weight:800;color:#70b5f9"));
  head.appendChild($("span", { textContent: "Aither · LinkedIn", }, "font-weight:700;flex:1"));
  const dot = $("span", {}, "width:8px;height:8px;border-radius:50%;background:#57d38c");
  head.appendChild(dot);
  panel.appendChild(head);
  const body = $("div", {}, "padding:10px 12px;display:flex;flex-direction:column;gap:8px;");
  const status = $("div", { textContent: "Ready. Actions run on this feed." }, "font-size:11px;color:#8a99a8");
  body.appendChild(status);

  const mkBtn = (label, fn) => {
    const b = $("button", { textContent: label }, "background:#0a66c2;color:#fff;border:0;border-radius:999px;padding:7px 10px;font-weight:700;cursor:pointer;font-size:12px;");
    b.addEventListener("click", async () => {
      b.disabled = true; const old = b.textContent; b.textContent = "Running…";
      try { status.textContent = await fn(); } catch (e) { status.textContent = "Error: " + e; }
      b.textContent = old; b.disabled = false;
    });
    return b;
  };
  body.appendChild(mkBtn("✍️  Post now (Aither writes it)", runPost));
  body.appendChild(mkBtn("❤️  Engage feed now", runEngage));
  body.appendChild($("div", { textContent: "Auto-runs while this tab is open. LinkedIn's DOM shifts — if a button does nothing, the selector moved; tell Aither.", }, "font-size:10px;color:#6a7986;padding-top:2px"));
  panel.appendChild(body);
  document.documentElement.appendChild(panel);

  // drag
  let drag = null;
  head.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, r: panel.getBoundingClientRect() }; });
  window.addEventListener("mousemove", (e) => { if (!drag) return; panel.style.left = drag.r.left + (e.clientX - drag.x) + "px"; panel.style.top = drag.r.top + (e.clientY - drag.y) + "px"; panel.style.right = "auto"; });
  window.addEventListener("mouseup", () => { drag = null; });

  // ── Autonomous timers (in-page; only while this tab lives) ───────────────────
  // A light self-scheduler so it runs hands-off, not only on button click.
  (async () => {
    const cfg = await ask({ type: "social-config" });
    const engMin = (cfg && cfg.liEngageIntervalMin) || 120;
    const postMin = (cfg && cfg.liAutopostIntervalMin) || 360;
    setInterval(() => { runEngage().then((s) => (status.textContent = s)); }, engMin * 60000);
    setInterval(() => { runPost().then((s) => (status.textContent = s)); }, postMin * 60000);
    // first engage shortly after load so it's visibly alive
    setTimeout(() => runEngage().then((s) => (status.textContent = s)), 20000);
  })();
})();
