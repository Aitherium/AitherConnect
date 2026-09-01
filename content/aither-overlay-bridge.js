// Awconnect — AitherOS Holographic Overlay
// =============================================================================
// Injects aitherium.com's REAL Living OS as a TRANSPARENT iframe over any web
// page: the page stays usable in the background, the OS floats on top like a
// hologram. This is NOT a hand-rolled taskbar — it IS aitherium.com, so it's
// always in sync (same dock, apps, brain bar, sign-in). The OS drives the
// underlying page through a postMessage bridge (os→page / page→os) using the
// generalized page-automation primitives below.
//
// Requires aitherium.com to serve `/` with `frame-ancestors 'self'
// chrome-extension://<this-ext-id>` and NO X-Frame-Options (see next.config.ts).
// Until that deploys, the iframe stays blank and we show a one-line hint.
(() => {
  if (window.__aitherOverlay) return;

  const OS_ORIGIN = "https://aitherium.com";
  // Framing the OS OVER the OS is a recursive shell — aitherium.com inside aitherium.com,
  // each one posting os-ready to the other. There is nothing to overlay here: this page is
  // already the thing the overlay exists to deliver.
  if (/^(www\.)?aitherium\.com$/.test(location.hostname)) return;
  // Social surfaces keep the command bar (the post/engage driver), not this
  // overlay — this bridge's os-ready handler removes the bar, and on x/linkedin
  // the bar is the only in-page automation surface. background.js injectInto
  // already gates this, but the bridge is also injected from context-menu and
  // activeTab paths that bypass that check, so repeat the guard here.
  if (/(^|\.)(x\.com|twitter\.com|linkedin\.com)$/.test(location.hostname.replace(/^www\./, ""))) return;

  window.__aitherOverlay = true;
  const OS_URL = OS_ORIGIN + "/?mode=overlay";
  const Z = 2147483600;

  // ── Page-automation primitives the OS drives (AitherBrowser-in-the-page) ────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(sel, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const el = document.querySelector(sel); if (el) return el; await sleep(120); }
    return null;
  }
  const pageBridge = {
    async click(sel) { const el = await waitFor(sel); if (!el) return { ok: false, error: "not found: " + sel }; el.scrollIntoView({ block: "center" }); el.click(); return { ok: true }; },
    async type(sel, text) {
      const el = await waitFor(sel); if (!el) return { ok: false, error: "not found: " + sel };
      el.focus();
      // execCommand works on both plain inputs and rich (Draft.js/contenteditable) editors.
      try { document.execCommand("selectAll", false, null); document.execCommand("insertText", false, String(text)); }
      catch { el.value = String(text); el.dispatchEvent(new Event("input", { bubbles: true })); }
      return { ok: true };
    },
    async read(sel) { const el = sel ? document.querySelector(sel) : document.body; return { ok: true, text: (el ? el.innerText : "").slice(0, 8000) }; },
    async scroll(sel) { if (sel) { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: "center" }); } else { window.scrollBy(0, window.innerHeight * 0.8); } return { ok: true }; },
    async key(sel, key) {
      const el = sel ? await waitFor(sel) : document.activeElement;
      if (!el) return { ok: false, error: "not found: " + sel };
      el.focus();
      // A real key sequence, not just keydown: rich editors (Discord's Slate,
      // Draft.js) listen on keypress/keyup too, and a lone keydown is ignored by
      // some of them -- which reads as "the send did nothing".
      const opts = { key, code: key === "Enter" ? "Enter" : undefined, bubbles: true, cancelable: true };
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, opts));
      }
      return { ok: true };
    },
    async info() { return { ok: true, url: location.href, title: document.title }; },
  };
  async function runPageAction(msg) {
    const { action, selector, text } = msg;
    try {
      switch (action) {
        case "click": return await pageBridge.click(selector);
        case "type": return await pageBridge.type(selector, text);
        case "read": return await pageBridge.read(selector);
        case "scroll": return await pageBridge.scroll(selector);
        case "info": return await pageBridge.info();
        case "key": return await pageBridge.key(selector, msg.key || "Enter");
        default: return { ok: false, error: "unknown action: " + action };
      }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }

  // ── AMBIENT PAGE CONTEXT ───────────────────────────────────────────────────
  // The OS floats over the page; without this it cannot SEE the page it floats
  // over, so every question the user asks it starts from nothing and the "it
  // knows what you're looking at" promise is just a taskbar in front of a
  // website. The automation primitives above are PULL-only, so a context the OS
  // never thought to ask for did not exist.
  //
  // Pushed, not polled: the OS cannot know when an SPA route changed, and a
  // pull-only design makes every consumer re-implement that detection.
  //
  // Sent ONLY to OS_ORIGIN (postMessage targetOrigin), never '*'. This carries
  // page text, so a wildcard target would hand the visible content of every page
  // to whatever happens to be framed. Capped, and selection is included because
  // "what I highlighted" is the single highest-signal thing a user means by
  // "this".
  const CONTEXT_TEXT_CAP = 4000;
  function collectPageContext() {
    let selection = "";
    try { selection = String(window.getSelection() || "").slice(0, 1000); } catch { /* denied */ }
    const meta = (name) => {
      const el = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
      return el ? String(el.getAttribute("content") || "").slice(0, 400) : "";
    };
    // Prefer the semantic content root; a whole-body innerText on a modern page
    // is mostly nav, cookie banners and footer boilerplate.
    const root = document.querySelector("main, article, [role=main]") || document.body;
    let text = "";
    try { text = String((root && root.innerText) || "").replace(/\n{3,}/g, "\n\n").slice(0, CONTEXT_TEXT_CAP); } catch { /* detached */ }
    const headings = [];
    try {
      document.querySelectorAll("h1, h2").forEach((h) => {
        if (headings.length < 20) {
          const t = String(h.innerText || "").trim().slice(0, 120);
          if (t) headings.push(t);
        }
      });
    } catch { /* detached */ }
    return {
      url: location.href,
      host: location.hostname,
      title: document.title,
      description: meta("description"),
      selection,
      headings,
      text,
      truncated: text.length >= CONTEXT_TEXT_CAP,
      at: Date.now(),
    };
  }

  let lastContextSig = "";
  function publishPageContext(force) {
    if (!ready) return;                       // the OS is not there to receive it
    const ctx = collectPageContext();
    // Signature EXCLUDES `at` and the full text body — otherwise every tick is a
    // change and the OS is re-notified 20x/minute on a page nobody touched.
    const sig = ctx.url + "|" + ctx.title + "|" + ctx.selection + "|" + ctx.text.length;
    if (!force && sig === lastContextSig) return;
    lastContextSig = sig;
    try { frame.contentWindow.postMessage({ __aither: "os-page-context", context: ctx }, OS_ORIGIN); } catch { /* frame gone */ }
  }

  // ── LOCAL NODE / TOOLS ─────────────────────────────────────────────────────
  // The OS iframe CANNOT probe loopback itself, and that is not a bug to work
  // around in the page: it is a third-party frame, so (a) its localStorage is
  // partitioned — the local-node opt-in granted on aitherium.com top-level is
  // invisible here — and (b) Chrome gates public→private requests behind Local
  // Network Access, which a cross-origin frame without user activation loses.
  // Veil's own use-local-node therefore reports "no node" in the overlay while a
  // node is running two ports away.
  //
  // The extension is the one context that CAN: a service worker with
  // host_permissions is subject to neither page CORS nor PNA. So the OS asks us,
  // we ask the SW, and the answer goes back over the same postMessage plane as
  // identity — the mechanism that already exists for exactly this shape of
  // "the frame cannot see it, the extension can".
  function relayToSW(message, reply) {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        // lastError is set when the SW is asleep/gone. Report it rather than
        // dropping the callback: a silent drop leaves the OS spinning forever,
        // which is the exact class the overlay's own 20s budget exists for.
        if (chrome.runtime.lastError) {
          reply({ ok: false, error: String(chrome.runtime.lastError.message || "extension unavailable") });
          return;
        }
        reply(res || { ok: false, error: "no response from extension" });
      });
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function postToOs(payload) {
    try { frame.contentWindow.postMessage(payload, OS_ORIGIN); } catch { /* frame gone */ }
  }

  // ── SITE ADAPTER ───────────────────────────────────────────────────────────
  // What can the OS DO on this particular page? Declared as data
  // (adapters/<site>.json), not code: adding Discord is a JSON file, not another
  // bespoke content script, and the selector fallback lists survive the constant
  // DOM churn of a big web app better than one hardcoded query.
  //
  // The SW reads it -- see background.js "site-adapter" for why it is not fetched
  // from the page.
  let lastAdapterUrl = "";
  function publishSiteAdapter(force) {
    if (!ready) return;
    if (!force && location.href === lastAdapterUrl) return;
    lastAdapterUrl = location.href;
    relayToSW({ type: "site-adapter", host: location.hostname, url: location.href }, (res) => {
      // `adapter: null` is a NORMAL answer (most of the web has no adapter) and
      // is posted anyway, so the OS can clear stale actions from the last site
      // instead of offering Discord actions on a page that is not Discord.
      postToOs({ __aither: "os-site-adapter", adapter: (res && res.ok) ? res.adapter : null,
                 error: (res && !res.ok) ? res.error : undefined });
    });
  }

  function publishLocalNode() {
    relayToSW({ type: "probe-node" }, (res) => {
      postToOs({ __aither: "os-local-node", node: res && res.online ? { online: true, baseUrl: res.baseUrl } : { online: false } });
    });
  }

  // ── Overlay container + transparent OS iframe ───────────────────────────────
  const host = document.createElement("div");
  host.id = "aither-os-overlay";
  // opacity:0 until os-ready so pre-deploy (aitherium.com still refusing to frame)
  // there's no flash of a cross-origin "refused to connect" page — the 5s timeout
  // then removes it silently. Becomes visible only when the real OS frames.
  host.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none;background:transparent;opacity:0;transition:opacity .25s ease;`;
  const frame = document.createElement("iframe");
  frame.src = OS_URL;
  frame.allow = "clipboard-write; microphone; camera; fullscreen; autoplay";
  frame.style.cssText = "width:100%;height:100%;border:0;background:transparent;color-scheme:normal;";
  host.appendChild(frame);

  // A tiny hint — auto-dismissed a few seconds after it appears so it never
  // sits on top of the page's content. The previous version lived permanently at
  // bottom-left and covered the host page's bottom-left corner.
  const hint = document.createElement("div");
  // Id'd so the background's toggle-overlay teardown can remove it along with the host.
  hint.id = "aither-os-hint";
  hint.textContent = "⚡ Aither OS overlay — Alt+` to interact";
  // left/bottom are set by placeControls() — the dock is moveable and a fixed
  // corner lands INSIDE whichever strip the OS parked there.
  hint.style.cssText = `position:fixed;left:12px;bottom:12px;z-index:${Z + 1};pointer-events:none;
    background:rgba(14,16,20,.9);color:#8a99a8;font:11px ui-monospace,Menlo,monospace;
    padding:5px 9px;border:1px solid #333a44;border-radius:8px;opacity:0;transition:opacity .4s ease;`;

  // Visible minimize / restore control. A keyboard toggle is NOT sufficient:
  // Alt+Space is Windows' window-menu shortcut (the browser page never receives
  // it), and any key combination stops working the moment the OS iframe has
  // focus (keystrokes go to the cross-origin frame, not this page). A button
  // works in both cases. "Minimize" hides the bottom dock/toolbar so it stops
  // covering the page; windows stay open. ⚡ restores it.
  const minBtn = document.createElement("button");
  minBtn.textContent = "▾";
  minBtn.title = "Minimize the Aither OS toolbar";
  minBtn.style.cssText = `position:fixed;left:12px;bottom:10px;z-index:${Z + 1};display:none;
    width:26px;height:26px;border-radius:7px;background:rgba(14,16,20,.9);color:#8a99a8;
    border:1px solid #333a44;cursor:pointer;font-size:13px;line-height:1;`;
  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "⚡";
  restoreBtn.title = "Show the Aither OS toolbar";
  restoreBtn.style.cssText = `position:fixed;left:12px;bottom:10px;z-index:${Z + 1};display:none;
    width:26px;height:26px;border-radius:7px;background:rgba(34,211,238,.15);color:#22d3ee;
    border:1px solid rgba(34,211,238,.45);cursor:pointer;font-size:14px;line-height:1;`;

  // ── Pointer-events model (v2 = clip to OS chrome) ──────────────────────────
  // The OS publishes `os-regions` — the live rects of its dock and open windows
  // (overlay-mode.ts watchOverlayRegions, 250 ms poll). We clip the iframe to
  // exactly those rects with clip-path:path(), so the OS chrome is live while
  // every other pixel passes through to the page underneath: you can read and
  // use the full page AND open/click OS apps without a keyboard toggle.
  //
  // `clip-path` participates in hit-testing in Chromium, so `pointer-events:auto`
  // on the host only captures clicks inside the clip. Alt+` (backtick) remains
  // as an escape hatch to flip the whole overlay interactive/pass-through.
  let ready = false;        // os-ready received → reveal
  let interactive = false;  // escape-hatch: whole overlay interactive
  let minimized = false;    // dock/toolbar hidden
  let regions = [];         // last known OS chrome rects
  // The dock is MOVEABLE (owner ask 2026-08-08). The OS ships its current edge
  // in every os-regions message (overlay-mode.ts getOverlayDockHint) so this
  // bridge pads the matching side of the host page and skips the right rect
  // when minimized — it cannot infer "left dock" from geometry once the dock is
  // hidden. Default bottom/56 matches dock.tsx EDGE_ROOT before the first paint.
  let dockHint = { edge: "bottom", thickness: 56 };
  let hintTimer = null;
  let lastMode = null;      // show the hint only when the MODE changes

  function showHint(text, ms = 5000) {
    hint.textContent = text;
    hint.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.style.opacity = "0"; }, ms);
  }

  // The dock is the strip at the CURRENT edge (dockHint.edge). Reported in the
  // same viewport as the host, so a bottom dock is y+h ≈ innerHeight and a top
  // dock is y ≈ 0; a left/right dock spans the full height. The top dock sits
  // BELOW the pulse ticker (desktop.tsx TICKER_AREA → top-[26px]), which is not
  // OS chrome, so a small epsilon covers it.
  function isDockRect(r) {
    if (!r || !(r.w > 0) || !(r.h > 0)) return false;
    const edge = dockHint.edge;
    if (edge === "bottom") return (r.y + r.h) >= (window.innerHeight - 24) && r.w >= (window.innerWidth - 24);
    if (edge === "top") return r.y <= 48 && r.w >= (window.innerWidth - 24);
    if (edge === "left") return r.x <= 24 && r.h >= (window.innerHeight - 24);
    return (r.x + r.w) >= (window.innerWidth - 24) && r.h >= (window.innerHeight - 24); // right
  }

  /* KEEP OUR OWN CONTROLS OFF THE OS's CHROME.
   *
   * These were pinned to `right:12px;bottom:10px`, which is INSIDE a bottom dock
   * (dock.tsx EDGE_ROOT is h-14 = 56px at that edge) and directly on top of the
   * room pill the OS parks in the same corner. The result was the reported
   * overlap: our 26px minimize square sat over the pill and clipped its label
   * mid-word, and the dock's own tray controls underneath were unreachable.
   *
   * We already receive the dock's edge and thickness in every os-regions message
   * (dockHint), so the controls clear whichever strip the OS is actually using
   * rather than one hardcoded guess. Left-anchored, because the OS parks the room
   * bottom-RIGHT; the hint stacks above the button so the two never collide
   * either. */
  function placeControls() {
    const t = Math.max(0, Math.round((dockHint && dockHint.thickness) || 0));
    const edge = (dockHint && dockHint.edge) || "bottom";
    const showDock = ready && !minimized;
    const left = (showDock && edge === "left" ? t : 0) + 12;
    const bottom = (showDock && edge === "bottom" ? t : 0) + 10;
    for (const el of [minBtn, restoreBtn]) {
      el.style.left = left + "px";
      el.style.right = "auto";
      el.style.bottom = bottom + "px";
    }
    hint.style.left = left + "px";
    hint.style.bottom = (bottom + 36) + "px";
  }

  function clipToRegions() {
    const subs = [];
    for (const r of regions) {
      if (!r || !(r.w > 0) || !(r.h > 0)) continue;
      if (minimized && isDockRect(r)) continue;   // toolbar hidden
      const x = Math.round(r.x || 0), y = Math.round(r.y || 0), w = Math.round(r.w), h = Math.round(r.h);
      // One closed subpath per rect — a single `polygon()` would trace connecting
      // lines between disjoint rects and fill the gaps; `path()` keeps them separate.
      subs.push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
    }
    if (!subs.length) return false;
    frame.style.clipPath = `path("${subs.join('')}")`;
    return true;
  }
  function clearClip() { frame.style.clipPath = ''; }

  // Push the page's content up above the floating dock so the toolbar never
  // covers the bottom of a webpage — the owner asked for "push the page up, not
  // float over it". Same trick the command bar uses (body padding-bottom).
  // Pad BOTH <html> and <body>: SPA roots that style html or use height:100%
  // (Next.js __next, create-react-app #root, MUI CssBaseline) are pushed by
  // the element the page actually scrolls, which is often html, not body. A
  // page that only pads one gets its content covered again — the exact
  // "it covers shit right now" report.
  // The dock is MOVEABLE (owner ask 2026-08-08): the padded side follows
  // dockHint.edge, and side docks pad horizontal scrollers (overflowX), not the
  // vertical ones a bottom dock pads.
  const EDGE_PAD_PROP = { bottom: "paddingBottom", top: "paddingTop", left: "paddingLeft", right: "paddingRight" };
  function applyPagePad() {
    const prop = EDGE_PAD_PROP[dockHint.edge];
    const horizontal = dockHint.edge === "left" || dockHint.edge === "right";
    let pad = 0;
    if (ready && !minimized && !interactive) {
      const dock = regions.find(isDockRect);
      if (dock) pad = Math.round(horizontal ? dock.w : dock.h);
    }
    const px = pad ? pad + "px" : "";
    try { document.documentElement.style[prop] = px; } catch { /* no doc yet */ }
    try { document.body.style[prop] = px; } catch { /* no body yet */ }
    // Same no-op trap as the command bar: html/body padding does nothing on SPA
    // shells that fill the viewport and scroll inside their OWN container
    // (measured on x.com: scrollHeight unchanged by body padding). Pad those
    // containers too so the dock never covers the host page's content.
    let n = 0;
    for (const el of document.querySelectorAll("div, main, section")) {
      const o = getComputedStyle(el)[horizontal ? "overflowX" : "overflowY"];
      const isScroll = o === "auto" || o === "scroll" || (o === "hidden" && (horizontal ? el.scrollWidth > el.clientWidth + 10 : el.scrollHeight > el.clientHeight + 10));
      if (!isScroll) continue;
      if (pad && !(horizontal ? el.scrollWidth > el.clientWidth + 10 : el.scrollHeight > el.clientHeight + 10)) continue; // only real scrollers when padding
      try { el.style[prop] = px; } catch { /* noop */ }
      if (++n >= 24) break;
    }
  }

  function renderMode() {
    // The host is ALWAYS pointer-events:none — it must never swallow a click over
    // a pixel that is not OS chrome. Only the IFRAME carries pointer-events, and
    // its clip-path restricts hit-testing to the OS chrome rects, so everything
    // outside those rects falls through to the page underneath.
    host.style.pointerEvents = "none";
    let mode, text;
    if (!ready) { frame.style.pointerEvents = "none"; mode = "loading"; text = "⚡ Aither OS overlay — Alt+` to interact"; }
    else if (minimized) {
      // Minimized hides ONLY the bottom dock/toolbar — open OS windows stay
      // visible and interactive. This must call clipToRegions(), whose
      // `if (minimized && isDockRect(r)) continue` already drops dock rects,
      // NOT clearClip(): clearing the clip leaves the WHOLE OS visible but
      // inert, which looks identical to the restored state — so ▾ did nothing
      // visible and ⚡ "restores" to the same screen. That is the "click the
      // lightning button and nothing happens" bug.
      if (clipToRegions()) frame.style.pointerEvents = "auto";
      else { clearClip(); frame.style.pointerEvents = "none"; } // only chrome was the dock
      mode = "minimized"; text = "Aither OS toolbar minimized — ⚡ to restore";
    }
    else if (interactive) { clearClip(); frame.style.pointerEvents = "auto"; mode = "interactive"; text = "⚡ Aither OS — interacting (Alt+` to use the page)"; }
    else if (regions.length && clipToRegions()) { frame.style.pointerEvents = "auto"; mode = "clipped"; text = "⚡ Aither OS — chrome interactive, page pass-through (Alt+` to switch)"; }
    else { clearClip(); frame.style.pointerEvents = "none"; mode = "waiting"; text = "⚡ Aither OS overlay — Alt+` to interact"; }
    if (mode !== lastMode) { lastMode = mode; showHint(text); }
    minBtn.style.display = (ready && !minimized) ? "block" : "none";
    restoreBtn.style.display = (ready && minimized) ? "block" : "none";
    placeControls();
    applyPagePad();
  }

  minBtn.addEventListener("click", () => { minimized = true; renderMode(); });
  restoreBtn.addEventListener("click", () => { minimized = false; renderMode(); });

  window.addEventListener("keydown", (e) => {
    // Alt+` (backtick) toggles interact/pass-through. NOT Alt+Space: on Windows
    // that is the window-menu system shortcut and never reaches the page.
    if (e.altKey && (e.code === "Backquote" || e.key === "`")) { e.preventDefault(); interactive = !interactive; renderMode(); }
    // Alt+Shift+H hides the overlay entirely (Escape from any weirdness).
    if (e.altKey && e.shiftKey && (e.key === "H" || e.key === "h")) { host.remove(); hint.remove(); minBtn.remove(); restoreBtn.remove(); window.__aitherOverlay = false; }
  }, true);

  // ── The bridge: OS (iframe) → this page's DOM, and back ──────────────────────
  let sawOs = false;
  let readyTimeout = null;

  /* GIVE-UP TIMER.
   *
   * This was 5s measured from SCRIPT INJECTION, and that is why the owner saw the fallback
   * command bar on every page instead of the OS. os-ready is posted from OSClient's mount
   * effect, so it cannot arrive until aitherium.com's Next bundle has been fetched, parsed
   * and hydrated inside the iframe — on a cold cache that is routinely past 5s, and the
   * overlay had already destroyed itself. A working feature looked like an unshipped one,
   * and the "temporary" fallback became what the product looked like.
   *
   * Two changes: a realistic budget, and the clock RE-ARMS on the iframe's load event so the
   * budget covers hydration rather than being eaten by the download. The fallback still
   * exists — if the OS genuinely cannot frame, the command bar is the right answer — it just
   * no longer fires while the OS is still on its way.
   */
  const READY_BUDGET_MS = 20000;
  function startReadyTimeout() {
    clearTimeout(readyTimeout);
    readyTimeout = setTimeout(() => {
      if (!sawOs) {
        // OS did not frame (blocked by frame-ancestors, offline, or not deployed) — remove
        // the overlay and let the command bar stand.
        host.remove();
        hint.remove();
        window.__aitherOverlay = false;
      }
    }, READY_BUDGET_MS);
  }
  // The document arrived; hydration has not run yet. Restart the budget from here so a slow
  // network cannot consume the window that hydration needs.
  frame.addEventListener("load", () => { if (!sawOs) startReadyTimeout(); });

  window.addEventListener("message", async (e) => {
    if (e.origin !== OS_ORIGIN) return;               // only trust the real OS origin
    const d = e.data;
    if (!d || d.__aither == null) return;
    if (d.__aither === "os-ready") {
      clearTimeout(readyTimeout);
      sawOs = true;
      window.__aitherOverlayLive = true;
      ready = true;
      host.style.opacity = "1";   // reveal now that the real OS is live
      // Hide the command bar now that the real OS is live.
      const cmdBar = document.getElementById("aither-cmd-bar");
      if (cmdBar) cmdBar.remove();
      // Also set the guard so the command bar script won't re-add itself.
      window.__aitherCmdBar = true;
      renderMode();
      // The OS is live — hand it the two things it cannot get for itself: what
      // page it is floating over, and what is running on this machine. Pushed
      // WITHOUT being asked, because an OS that must know to ask has to be
      // taught about every host capability separately, and anything it does not
      // ask for silently does not exist (that is precisely how the os→page
      // protocol shipped with zero callers).
      publishPageContext(true);
      publishLocalNode();
      publishSiteAdapter(true);
      startContextWatch();
      return;
    }
    if (d.__aither === "os-regions" && Array.isArray(d.regions)) {
      regions = d.regions;
      // The OS moved the dock to another edge — follow it, or the host would
      // keep padding the bottom and skipping the bottom rect while the dock
      // (and the pad) sit somewhere else.
      if (d.dock && EDGE_PAD_PROP[d.dock.edge] && d.dock.thickness > 0) {
        dockHint = { edge: d.dock.edge, thickness: d.dock.thickness };
      }
      renderMode();
      return;
    }
    if (d.__aither === "os→page") {
      const result = await runPageAction(d);
      try { frame.contentWindow.postMessage({ __aither: "page→os", reqId: d.reqId, ...result }, OS_ORIGIN); } catch { /* frame gone */ }
      return;
    }
    // The OS asks for the page it is floating over, on demand (it also gets a
    // push on ready, navigation and selection — see publishPageContext).
    if (d.__aither === "os-page-context-request") { publishPageContext(true); return; }
    // The OS asks whether this machine is running adk / awnode / a bare
    // llama-server. Answered by the SW, which is the only context that can look.
    if (d.__aither === "os-node-probe") { publishLocalNode(); return; }
    if (d.__aither === "os-site-adapter-request") { publishSiteAdapter(true); return; }
    // On-device composition. Relayed to the SW because the Bonsai worker, its
    // model cache and the WebGPU adapter all live there -- the OS iframe would
    // otherwise have to download and hold a second copy of the model.
    if (d.__aither === "os-compose") {
      relayToSW(
        { type: "os-compose", prompt: d.prompt, maxTokens: d.maxTokens, temperature: d.temperature },
        (res) => postToOs({ __aither: "os-compose-result", reqId: d.reqId, ...(res || {}) }),
      );
      return;
    }
    // The OS calls the local daemon (models, tools, the desktop). Relayed
    // through the SW: the daemon's CORS allowlist deliberately excludes
    // arbitrary origins, and it should stay that way — the daemon spawns agents
    // with filesystem access, so widening it to admit any web page is the wrong
    // trade. The SW is exempt from CORS via host_permissions, and it enforces an
    // EXACT path allowlist so this can never become "the OS can call anything on
    // your loopback".
    if (d.__aither === "os-daemon-call") {
      relayToSW(
        { type: "daemon-call", method: d.method, path: d.path, body: d.body },
        (res) => postToOs({ __aither: "os-daemon-result", reqId: d.reqId, ...(res || {}) }),
      );
      return;
    }
    // The OS can request interact/pass-through explicitly (e.g. when a window is focused).
    if (d.__aither === "os-interactive" && typeof d.on === "boolean") { interactive = d.on; renderMode(); }
    // The OS asks who is signed in (the overlay iframe cannot see the portal
    // session cookie — cross-site context — so background.js resolves it and we
    // relay it in). background replies with the last verified identity.
    if (d.__aither === "os-identity-request") {
      try {
        chrome.runtime.sendMessage({ type: "os-identity-request" }, (identity) => {
          if (chrome.runtime.lastError) return;
          if (identity && identity.identity) {
            try { frame.contentWindow.postMessage({ __aither: "os-identity", identity: identity.identity }, OS_ORIGIN); } catch { /* frame gone */ }
          }
        });
      } catch { /* not in extension context */ }
      return;
    }
    /* The OS asks for a CREDENTIAL, not just a name.
     *
     * os-identity above tells the taskbar who you are. It carries nothing the OS
     * can authenticate WITH, so the overlay could show "david" while every API
     * call 401'd — reported 2026-08-19 as "im signed in but aithershell still
     * doesn't work". The session cookie is SameSite=Lax and the overlay's
     * top-level site is the page you are on, so the OS iframe is third-party and
     * Chrome will never send it. background.js resolves a bearer instead.
     *
     * targetOrigin is OS_ORIGIN, NEVER '*'. That is the whole security argument:
     * the token is delivered only to aitherium.com, so the host page this overlay
     * is injected over — youtube.com, anything — cannot read it. A '*' here would
     * hand the platform bearer to every site the user visits. */
    if (d.__aither === "os-token-request") {
      try {
        chrome.runtime.sendMessage({ type: "os-token-request" }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res && res.token) {
            try { frame.contentWindow.postMessage({ __aither: "os-token", token: res.token }, OS_ORIGIN); } catch { /* frame gone */ }
          }
        });
      } catch { /* not in extension context */ }
      return;
    }
  });

  // background.js pushes a freshly-resolved identity into the overlay (after
  // install, startup, a portal login, or a manual Sign-in) so the OS taskbar
  // reflects who is actually signed in without waiting for a request.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.action !== "os-identity" || !msg.identity) return;
      try { frame.contentWindow.postMessage({ __aither: "os-identity", identity: msg.identity }, OS_ORIGIN); } catch { /* frame gone */ }
      sendResponse({ ok: true });
      return false;
    });
  } catch { /* not in extension context */ }

  // Keep the ambient context current. Three triggers, because no single one
  // covers a modern page:
  //   • selectionchange — "this" almost always means what the user highlighted;
  //   • an SPA route change — pushState/replaceState fire NO event, and popstate
  //     misses them entirely, so the URL is polled. Without this the OS holds
  //     the context of whatever page was open when the tab first loaded and is
  //     confidently wrong rather than merely stale.
  //   • a slow interval — late-hydrating content that arrives after ready.
  // publishPageContext dedupes on a signature, so a quiet page costs one
  // string compare per tick and posts nothing.
  let contextWatchStarted = false;
  function startContextWatch() {
    if (contextWatchStarted) return;
    contextWatchStarted = true;
    let lastUrl = location.href;
    let selTimer = null;
    document.addEventListener("selectionchange", () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => publishPageContext(false), 400);   // debounce a drag-select
    }, { passive: true });
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; publishPageContext(true); publishSiteAdapter(false); return; }
      publishPageContext(false);
    }, 3000);
  }

  startReadyTimeout();

  function mount() {
    (document.body || document.documentElement).appendChild(host);
    document.documentElement.appendChild(hint);
    document.documentElement.appendChild(minBtn);
    document.documentElement.appendChild(restoreBtn);
    // Brief pre-ready hint so the user knows the OS is coming (auto-dismisses).
    showHint("⚡ Aither OS overlay — Alt+` to interact", 8000);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
