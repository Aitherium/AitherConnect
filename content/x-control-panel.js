// Awconnect — on-page X growth control panel.
// Injected into x.com so the owner sees and drives Aither's autonomous loops
// (post / engage / discover) right on the page — no console, no popup. Talks to
// the service worker via chrome.runtime.sendMessage. Same pattern as the
// Roboflow/vision on-page surfaces.
(() => {
  if (window.__aitherXPanel) return;          // guard double-injection
  window.__aitherXPanel = true;

  const $ = (tag, props = {}, css = "") => {
    const el = document.createElement(tag);
    Object.assign(el, props);
    if (css) el.style.cssText = css;
    return el;
  };
  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); }
    catch { res({}); }
  });

  const panel = $("div", { id: "aither-x-panel" }, `
    position:fixed; top:72px; right:16px; z-index:2147483646;
    width:236px; background:#15181c; color:#e7e9ea; font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
    border:1px solid #2f3336; border-radius:14px; box-shadow:0 8px 28px rgba(0,0,0,.55);
    overflow:hidden; user-select:none;`);

  const head = $("div", {}, `
    display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:grab;
    background:linear-gradient(180deg,#1d9bf022,#15181c); border-bottom:1px solid #2f3336;`);
  head.appendChild($("span", { textContent: "⚡" }, "font-size:14px"));
  head.appendChild($("span", { textContent: "Aither Growth" }, "font-weight:700; flex:1"));
  const dot = $("span", {}, "width:8px;height:8px;border-radius:50%;background:#00ba7c;box-shadow:0 0 6px #00ba7c");
  head.appendChild(dot);
  const min = $("span", { textContent: "–", title: "minimize" }, "cursor:pointer;padding:0 4px;font-size:16px;opacity:.7");
  head.appendChild(min);
  panel.appendChild(head);

  const body = $("div", {}, "padding:10px 12px; display:flex; flex-direction:column; gap:8px;");

  const stats = $("div", {}, `
    display:grid; grid-template-columns:1fr 1fr; gap:4px 8px; padding:8px; background:#1b1f24;
    border-radius:10px; font-variant-numeric:tabular-nums;`);
  body.appendChild(stats);

  const followerLine = $("div", { textContent: "Followers: —" }, "font-weight:700;color:#1d9bf0;padding:2px 2px 0");
  body.appendChild(followerLine);

  // loops: [key, label]
  const loops = [
    ["xAutopostEnabled", "Post", "post"],
    ["xEngageEnabled", "Engage", "engage"],
    ["xDiscoverEnabled", "Discover", "discover"],
  ];
  const toggleEls = {};
  loops.forEach(([key, label, which]) => {
    const row = $("div", {}, "display:flex; align-items:center; gap:8px;");
    const sw = $("input", { type: "checkbox", checked: true });
    sw.style.cssText = "accent-color:#1d9bf0; width:15px; height:15px; cursor:pointer;";
    sw.addEventListener("change", () => send({ type: "x-toggle", key, enabled: sw.checked }));
    toggleEls[key] = sw;
    row.appendChild(sw);
    row.appendChild($("span", { textContent: label }, "flex:1"));
    const run = $("button", { textContent: "Run now" }, `
      background:#1d9bf0;color:#fff;border:0;border-radius:999px;padding:4px 10px;font-size:11px;
      font-weight:700;cursor:pointer;`);
    run.addEventListener("click", async () => {
      run.textContent = "Running…"; run.disabled = true;
      await send({ type: "x-run-now", which });
      run.textContent = "Run now"; run.disabled = false;
      refresh();
    });
    row.appendChild(run);
    body.appendChild(row);
  });

  const foot = $("div", {}, "display:flex; gap:8px; align-items:center; padding-top:2px;");
  const refreshBtn = $("button", { textContent: "↻ Refresh" }, `
    background:#26292d;color:#e7e9ea;border:1px solid #2f3336;border-radius:999px;padding:4px 10px;
    font-size:11px;cursor:pointer;flex:1;`);
  refreshBtn.addEventListener("click", () => refresh());
  foot.appendChild(refreshBtn);
  body.appendChild(foot);

  panel.appendChild(body);
  document.documentElement.appendChild(panel);

  // minimize / restore
  let collapsed = false;
  min.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "flex";
    min.textContent = collapsed ? "+" : "–";
  });

  // drag
  let drag = null;
  head.addEventListener("mousedown", (e) => {
    if (e.target === min) return;
    drag = { x: e.clientX, y: e.clientY, r: panel.getBoundingClientRect() };
    head.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    panel.style.left = drag.r.left + (e.clientX - drag.x) + "px";
    panel.style.top = drag.r.top + (e.clientY - drag.y) + "px";
    panel.style.right = "auto";
  });
  window.addEventListener("mouseup", () => { if (drag) { drag = null; head.style.cursor = "grab"; } });

  const cell = (label, val) => {
    const c = $("div", {}, "display:flex;justify-content:space-between");
    c.appendChild($("span", { textContent: label }, "color:#71767b"));
    c.appendChild($("span", { textContent: String(val) }, "font-weight:700"));
    return c;
  };

  async function refresh() {
    const s = await send({ type: "x-summary" });
    stats.innerHTML = "";
    stats.appendChild(cell("Posts", s.posts ?? 0));
    stats.appendChild(cell("Likes", s.likes ?? 0));
    stats.appendChild(cell("Replies", s.replies ?? 0));
    stats.appendChild(cell("Follows", s.follows ?? 0));
    followerLine.textContent = "Followers: " + (s.followers != null ? s.followers : "—");
    const st = await send({ type: "x-state" });
    if (st && st.flags) {
      for (const [k, sw] of Object.entries(toggleEls)) {
        sw.checked = st.flags[k] !== false;
      }
    }
  }

  refresh();
  setInterval(refresh, 30000);
})();
