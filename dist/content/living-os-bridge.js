/* global chrome, window, document, location, setTimeout, clearTimeout, setInterval, clearInterval, getComputedStyle, KeyboardEvent, Event */
// awconnect -- AitherOS Online: the Living OS over any page.
// =============================================================================
// Ported from awconnect/content/aither-overlay-bridge.js. Injects aitherium.com's
// REAL Living OS as a TRANSPARENT iframe over the page: the page stays usable
// underneath, the OS floats on top. This is not a hand-rolled taskbar, it IS
// aitherium.com (same dock, apps, brain bar, sign-in), so it is always in sync.
// The OS drives the page underneath through a postMessage bridge (os->page /
// page->os) using the page-automation primitives below.
//
// Needs living-os-core.js first (the pure geometry + routing; unit-tested).
//
// aitherium.com must allow being framed: no X-Frame-Options and a frame-ancestors
// that admits the page (AitherVeil next.config.ts, the '/' headers entry). If the
// OS does not answer os-ready within the budget, the overlay removes itself and
// says so in a one-line hint.
//
// How it gets here (src/background/livingOs.ts):
//   Alt+O / "Show AitherOS here"   activeTab + scripting, the ACTIVE tab only
//   "AitherOS dock on every page"  a dynamic content script, registered only after
//                                  the user grants the optional <all_urls> host
//                                  permission from that toggle
;(() => {
  'use strict'
  const core = window.__awcLivingOsCore
  if (!core) return
  if (window.__aitherOverlay) return
  // Never over the OS itself, never on the social surfaces (repeated here because the
  // activeTab path reaches pages the registered script's excludeMatches never sees).
  if (core.guardedHost(location.hostname)) return
  if (window.top !== window) return

  window.__aitherOverlay = true
  const { OS_ORIGIN, OS_URL } = core
  const Z = 2147483600
  const LIVING_OS_MESSAGE = 'awconnect:living-os'
  const CONTROL_MESSAGE = 'awconnect:living-os-control'
  const AUTH_KEY = 'awc_auth'

  // ── Page-automation primitives the OS drives ────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  async function waitFor(sel, ms = 6000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const el = document.querySelector(sel)
      if (el) return el
      await sleep(120)
    }
    return null
  }
  const pageBridge = {
    async click(sel) {
      const el = await waitFor(sel)
      if (!el) return { ok: false, error: 'not found: ' + sel }
      el.scrollIntoView({ block: 'center' })
      el.click()
      return { ok: true }
    },
    async type(sel, text) {
      const el = await waitFor(sel)
      if (!el) return { ok: false, error: 'not found: ' + sel }
      el.focus()
      // execCommand works on plain inputs and rich (Draft.js/contenteditable) editors.
      try {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, String(text))
      } catch {
        el.value = String(text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return { ok: true }
    },
    async read(sel) {
      const el = sel ? document.querySelector(sel) : document.body
      return { ok: true, text: (el ? el.innerText : '').slice(0, 8000) }
    },
    async scroll(sel) {
      if (sel) {
        const el = document.querySelector(sel)
        if (el) el.scrollIntoView({ block: 'center' })
      } else {
        window.scrollBy(0, window.innerHeight * 0.8)
      }
      return { ok: true }
    },
    async key(sel, key) {
      const el = sel ? await waitFor(sel) : document.activeElement
      if (!el) return { ok: false, error: 'not found: ' + sel }
      el.focus()
      // A real sequence: rich editors (Slate, Draft.js) listen on keypress/keyup too.
      const opts = { key, code: key === 'Enter' ? 'Enter' : undefined, bubbles: true, cancelable: true }
      for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, opts))
      return { ok: true }
    },
    async info() {
      return { ok: true, url: location.href, title: document.title }
    },
  }
  async function runPageAction(m) {
    try {
      switch (m.action) {
        case 'click':
          return await pageBridge.click(m.selector)
        case 'type':
          return await pageBridge.type(m.selector, m.text)
        case 'read':
          return await pageBridge.read(m.selector)
        case 'scroll':
          return await pageBridge.scroll(m.selector)
        case 'info':
          return await pageBridge.info()
        case 'key':
          return await pageBridge.key(m.selector, m.key || 'Enter')
        default:
          return { ok: false, error: 'unknown action: ' + m.action }
      }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  // ── Ambient page context (pushed to the OS, only to OS_ORIGIN, capped) ──────
  const CONTEXT_TEXT_CAP = 4000
  function collectPageContext() {
    let selection = ''
    try {
      selection = String(window.getSelection() || '').slice(0, 1000)
    } catch {
      /* denied */
    }
    const meta = (name) => {
      const el = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`)
      return el ? String(el.getAttribute('content') || '').slice(0, 400) : ''
    }
    const root = document.querySelector('main, article, [role=main]') || document.body
    let text = ''
    try {
      text = String((root && root.innerText) || '')
        .replace(/\n{3,}/g, '\n\n')
        .slice(0, CONTEXT_TEXT_CAP)
    } catch {
      /* detached */
    }
    const headings = []
    try {
      document.querySelectorAll('h1, h2').forEach((h) => {
        if (headings.length < 20) {
          const t = String(h.innerText || '').trim().slice(0, 120)
          if (t) headings.push(t)
        }
      })
    } catch {
      /* detached */
    }
    return {
      url: location.href,
      host: location.hostname,
      title: document.title,
      description: meta('description'),
      selection,
      headings,
      text,
      truncated: text.length >= CONTEXT_TEXT_CAP,
      at: Date.now(),
    }
  }

  let lastContextSig = ''
  function publishPageContext(force) {
    if (!ready) return
    const ctx = collectPageContext()
    // The signature excludes `at` and the body: a quiet page posts nothing.
    const sig = ctx.url + '|' + ctx.title + '|' + ctx.selection + '|' + ctx.text.length
    if (!force && sig === lastContextSig) return
    lastContextSig = sig
    postToOs({ __aither: 'os-page-context', context: ctx })
  }

  /** Ask the service worker (the one context that can reach loopback and the sign-in). */
  function relayToSW(op, payload, reply) {
    try {
      chrome.runtime.sendMessage({ type: LIVING_OS_MESSAGE, op, ...(payload || {}) }, (res) => {
        // Report a sleeping/gone worker instead of dropping the callback: a silent
        // drop leaves the OS spinning.
        if (chrome.runtime.lastError) {
          reply({ ok: false, error: String(chrome.runtime.lastError.message || 'extension unavailable') })
          return
        }
        reply(res || { ok: false, error: 'no response from extension' })
      })
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) })
    }
  }

  // targetOrigin is ALWAYS OS_ORIGIN, never '*': page text and the bearer go only
  // to aitherium.com, never to whatever the host page might frame.
  function postToOs(payload) {
    try {
      frame.contentWindow.postMessage(payload, OS_ORIGIN)
    } catch {
      /* frame gone */
    }
  }

  let lastAdapterUrl = ''
  // True while the current page has a site adapter (Discord, …): see publishSiteAdapter.
  let siteAdapterLive = false

  function publishSiteAdapter(force) {
    if (!ready) return
    if (!force && location.href === lastAdapterUrl) return
    lastAdapterUrl = location.href
    relayToSW('site-adapter', { host: location.hostname, url: location.href }, (res) => {
      // Remembered so the right-click below only takes over on adapter pages.
      siteAdapterLive = !!(res && res.ok && res.adapter)
      // adapter:null is a normal answer; posted so the OS clears stale actions.
      postToOs({
        __aither: 'os-site-adapter',
        adapter: res && res.ok ? res.adapter : null,
        error: res && !res.ok ? res.error : undefined,
      })
    })
  }

  function publishLocalNode() {
    relayToSW('probe-node', null, (res) => {
      postToOs({ __aither: 'os-local-node', node: res && res.online ? { online: true, baseUrl: res.baseUrl } : { online: false } })
    })
  }

  // `signOut`: the auth record changed (side panel sign-in/out). An explicit empty
  // answer then posts identity:null / token:null so the OS clears its host session
  // and bearer (contract C2) instead of keeping a signed-out user signed in.
  function publishIdentity(signOut) {
    relayToSW('identity', null, (res) => {
      const m = core.authHandoff('identity', res, !!signOut)
      if (m) postToOs(m)
    })
  }
  function publishToken(signOut) {
    relayToSW('token', null, (res) => {
      const m = core.authHandoff('token', res, !!signOut)
      if (m) postToOs(m)
    })
  }

  // ── Overlay container + transparent OS iframe ───────────────────────────────
  const host = document.createElement('div')
  host.id = 'aither-os-overlay'
  // opacity:0 until os-ready: no flash of a "refused to connect" frame.
  host.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none;background:transparent;opacity:0;transition:opacity .25s ease;`
  const frame = document.createElement('iframe')
  frame.id = 'aither-os-frame'
  frame.src = OS_URL
  frame.allow = 'clipboard-write; microphone; camera; fullscreen; autoplay'
  frame.setAttribute('allowtransparency', 'true')
  frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent;color-scheme:normal;pointer-events:none;'
  host.appendChild(frame)

  const hint = document.createElement('div')
  hint.id = 'aither-os-hint'
  hint.textContent = 'AitherOS overlay (Alt+` to interact)'
  hint.style.cssText = `position:fixed;left:12px;bottom:12px;z-index:${Z + 1};pointer-events:none;
    background:rgba(14,16,20,.9);color:#8a99a8;font:11px ui-monospace,Menlo,monospace;
    padding:5px 9px;border:1px solid #333a44;border-radius:8px;opacity:0;transition:opacity .4s ease;`

  // Visible minimize / close. A keyboard toggle is not enough: keys stop reaching
  // this page the moment the cross-origin OS frame has focus.
  const btnCss = `position:fixed;left:12px;bottom:10px;z-index:${Z + 1};display:none;
    width:26px;height:26px;border-radius:7px;background:rgba(14,16,20,.9);color:#8a99a8;
    border:1px solid #333a44;cursor:pointer;line-height:1;padding:0;`
  const minBtn = document.createElement('button')
  minBtn.id = 'aither-os-min'
  minBtn.textContent = '▾'
  minBtn.title = 'Minimize the AitherOS toolbar'
  minBtn.style.cssText = btnCss + 'font-size:13px;'
  const closeBtn = document.createElement('button')
  closeBtn.id = 'aither-os-close'
  closeBtn.textContent = '×'
  closeBtn.title = 'Close AitherOS on this tab (Alt+O to reopen)'
  closeBtn.style.cssText = btnCss + 'font-size:15px;'
  // The minimized handle is a thin edge tab, draggable up/down, dimmed until hovered.
  // Resting size/opacity raised 2026-10-06: at 14px and .45 the owner could not FIND
  // the tab after minimizing ("i minimise the awconnect taskbar but now i cant bring
  // it back") — a restore control nobody can see is a one-way door.
  const restoreBtn = document.createElement('button')
  restoreBtn.id = 'aither-os-restore'
  restoreBtn.textContent = '⚡'
  restoreBtn.title = 'Show the AitherOS toolbar (drag to move)'
  restoreBtn.style.cssText = `position:fixed;left:0;top:60%;z-index:${Z + 1};display:none;
    width:18px;height:48px;padding:0;border-radius:0 10px 10px 0;background:rgba(14,16,20,.92);color:#22d3ee;
    border:1px solid rgba(34,211,238,.65);border-left:0;cursor:pointer;font-size:13px;line-height:1;
    opacity:.75;transition:opacity .15s ease,width .15s ease;touch-action:none;`
  restoreBtn.addEventListener('mouseenter', () => {
    restoreBtn.style.opacity = '1'
    restoreBtn.style.width = '26px'
  })
  restoreBtn.addEventListener('mouseleave', () => {
    restoreBtn.style.opacity = '.75'
    restoreBtn.style.width = '18px'
  })

  const UI_KEY = 'aither-overlay-ui'
  let handleTopPct = 60
  function saveUi() {
    try {
      chrome.storage.local.set({ [UI_KEY]: { minimized, handleTopPct } })
    } catch {
      /* not in extension context */
    }
  }
  function placeHandle() {
    restoreBtn.style.top = `calc(${handleTopPct}% - 22px)`
  }

  let drag = null
  restoreBtn.addEventListener('pointerdown', (e) => {
    drag = { y0: e.clientY, moved: false }
    try {
      restoreBtn.setPointerCapture(e.pointerId)
    } catch {
      /* old engine */
    }
  })
  restoreBtn.addEventListener('pointermove', (e) => {
    if (!drag) return
    if (Math.abs(e.clientY - drag.y0) > 4) drag.moved = true
    if (!drag.moved) return
    handleTopPct = Math.min(95, Math.max(5, (e.clientY / Math.max(1, window.innerHeight)) * 100))
    placeHandle()
  })
  restoreBtn.addEventListener('pointerup', () => {
    const moved = drag && drag.moved
    drag = null
    if (moved) {
      saveUi()
      return
    }
    minimized = false
    saveUi()
    renderMode()
  })

  // ── State + rendering (the decisions live in living-os-core.js) ─────────────
  let ready = false
  let interactive = false
  let minimized = false
  let regions = []
  let dockHint = { ...core.DEFAULT_DOCK }
  let hintTimer = null
  let lastMode = null

  function showHint(text, ms = 5000) {
    hint.textContent = text
    hint.style.opacity = '1'
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      hint.style.opacity = '0'
    }, ms)
  }

  const viewState = () => ({
    ready,
    interactive,
    minimized,
    regions,
    dock: dockHint,
    vw: window.innerWidth,
    vh: window.innerHeight,
  })

  function placeControls() {
    const p = core.controlsPlacement(dockHint, ready && !minimized)
    minBtn.style.left = p.left + 'px'
    minBtn.style.bottom = p.bottom + 'px'
    closeBtn.style.left = p.left + 30 + 'px'
    closeBtn.style.bottom = p.bottom + 'px'
    placeHandle()
    hint.style.left = p.left + 'px'
    hint.style.bottom = p.bottom + 36 + 'px'
  }

  // Push the page's content clear of the dock (owner: "push the page up, not float
  // over it"). html AND body, plus the SPA's own scroll containers.
  const EDGE_PAD_PROP = { bottom: 'paddingBottom', top: 'paddingTop', left: 'paddingLeft', right: 'paddingRight' }
  const padded = new Set()
  function applyPagePad() {
    const prop = EDGE_PAD_PROP[dockHint.edge]
    const horizontal = dockHint.edge === 'left' || dockHint.edge === 'right'
    const pad = core.pagePad(viewState())
    const px = pad ? pad + 'px' : ''
    // Clear everything we padded before (the dock may have moved edges, a scroller
    // may have stopped scrolling), then pad afresh.
    for (const [el, p] of padded) {
      try {
        el.style[p] = ''
      } catch {
        /* gone */
      }
    }
    padded.clear()
    if (!pad) return
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue
      el.style[prop] = px
      padded.add([el, prop])
    }
    let n = 0
    for (const el of document.querySelectorAll('div, main, section')) {
      const o = getComputedStyle(el)[horizontal ? 'overflowX' : 'overflowY']
      const overflows = horizontal ? el.scrollWidth > el.clientWidth + 10 : el.scrollHeight > el.clientHeight + 10
      if (!(o === 'auto' || o === 'scroll' || o === 'hidden') || !overflows) continue
      try {
        el.style[prop] = px
        padded.add([el, prop])
      } catch {
        /* noop */
      }
      if (++n >= 24) break
    }
  }

  const MODE_TEXT = {
    loading: 'AitherOS overlay (Alt+` to interact)',
    minimized: 'AitherOS toolbar minimized (⚡ to restore)',
    interactive: 'AitherOS: interacting (Alt+` or Alt+O to use the page)',
    clipped: 'AitherOS: dock live, page pass-through (Alt+` to switch)',
    waiting: 'AitherOS overlay (Alt+` to interact)',
  }

  function renderMode() {
    if (torn) return
    host.style.pointerEvents = 'none'
    const plan = core.renderPlan(viewState())
    frame.style.clipPath = plan.clip
    frame.style.pointerEvents = plan.pointer
    host.dataset.mode = plan.mode
    if (plan.mode !== lastMode) {
      lastMode = plan.mode
      showHint(MODE_TEXT[plan.mode])
    }
    minBtn.style.display = ready && !minimized ? 'block' : 'none'
    closeBtn.style.display = ready && !minimized ? 'block' : 'none'
    restoreBtn.style.display = ready && minimized ? 'block' : 'none'
    placeControls()
    applyPagePad()
  }

  minBtn.addEventListener('click', () => {
    minimized = true
    saveUi()
    renderMode()
  })
  closeBtn.addEventListener('click', () => teardown())

  // Leave the page as we found it; release the latch so Alt+O can summon a fresh one.
  let torn = false
  let contextTimer = null
  let readyTimeout = null
  function teardown() {
    if (torn) return
    ready = false
    try {
      applyPagePad()
    } catch {
      /* page gone */
    }
    torn = true
    clearTimeout(readyTimeout)
    clearTimeout(hintTimer)
    clearInterval(contextTimer)
    for (const el of [host, hint, minBtn, closeBtn, restoreBtn]) el.remove()
    window.__aitherOverlay = false
  }

  function setInteractive(on) {
    interactive = on
    renderMode()
  }

  // The worker's control plane: Alt+O on a tab that already has the overlay flips
  // interact/pass-through (a browser shortcut works even while the OS frame has
  // focus, unlike the page's Alt+`); "Show AitherOS here" dismisses.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (torn || !msg || msg.type !== CONTROL_MESSAGE) return
      if (msg.op === 'ping') sendResponse({ ok: true, ready, interactive, mode: lastMode })
      else if (msg.op === 'toggle-interactive') {
        setInteractive(!interactive)
        sendResponse({ ok: true, interactive })
      } else if (msg.op === 'dismiss') {
        /* SUMMON SEMANTICS (owner report 2026-10-06: "i minimise the awconnect
         * taskbar but now i cant bring it back"). Alt+O and the menu both land
         * HERE, and pressing them on a MINIMIZED overlay means "give me the
         * toolbar back" — never "destroy this". Blind teardown was a do-nothing
         * loop: the minimized flag is PERSISTED (chrome.storage aither-overlay-ui),
         * so the reinjected overlay came back minimized and the summon appeared
         * to do nothing, twice in a row. Restore in place; the worker maps
         * `restored` to state:'shown' (livingOs.ts showOrHide). */
        if (minimized) {
          minimized = false
          saveUi()
          renderMode()
          showHint('AitherOS toolbar restored')
          sendResponse({ ok: true, restored: true })
        } else {
          teardown()
          sendResponse({ ok: true, dismissed: true })
        }
      }
      return false
    })
  } catch {
    /* not in extension context */
  }
  try {
    chrome.storage.local.get(UI_KEY, (got) => {
      const ui = got && got[UI_KEY]
      if (!ui || torn) return
      if (typeof ui.handleTopPct === 'number') handleTopPct = ui.handleTopPct
      minimized = !!ui.minimized
      renderMode()
    })
    // Signed in or out from the side panel: hand the OS the new identity + bearer,
    // or the nulls that sign it out.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (torn || !ready || area !== 'local' || !(AUTH_KEY in changes)) return
      publishIdentity(true)
      publishToken(true)
    })
  } catch {
    /* not in extension context */
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (torn) return
      // Alt+` toggles interact/pass-through (NOT Alt+Space: Windows eats it).
      if (e.altKey && (e.code === 'Backquote' || e.key === '`')) {
        e.preventDefault()
        setInteractive(!interactive)
      }
      // Alt+Shift+H hides the overlay entirely.
      if (e.altKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) teardown()
    },
    true,
  )

  /* ── Stage Manager: a click on the PAGE is a focus change ──────────────────
   * The frame is clipped to the OS's own chrome rects (os-regions), so any
   * pointerdown that reaches THIS document missed every piece of OS chrome —
   * dock, windows, menus. That is the background click, and macOS Stage Manager
   * answers exactly this gesture: the moment attention leaves, the windows
   * sweep aside. The OS (veil desktop.tsx) collapses its window layer into the
   * stage strip on `os-host-focus`; clicking the dock or a strip chip brings it
   * back, and transient menus (the site chip's action panel) close on the same
   * signal. Our own controls are exempt — they are OS chrome too.
   *
   * Capture phase: ahead of the page's own listeners so a handler that stops
   * propagation cannot eat the signal. Only posted once the OS is live. */
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (torn || !ready) return
      for (const el of [host, hint, minBtn, closeBtn, restoreBtn]) {
        if (el === e.target || el.contains(e.target)) return
      }
      postToOs({ __aither: 'os-host-focus', focused: false })
    },
    true,
  )

  /* ── Right-click = this page's actions ──────────────────────────────────────
   * Owner, 2026-10-07: "the 'Discord' context menu should appear when right
   * clicking anywhere in Discord, same for other websites" — not a chip that
   * floats over the page forever. On a page with a site adapter, a right-click
   * asks the OS to open that page's action menu at the pointer. The browser's
   * own menu is kept wherever it does a job ours does not: shift+right-click
   * (the escape hatch), an editable field (paste/spellcheck) and a text
   * selection (copy). Pages with no adapter are never touched. */
  function isEditable(el) {
    for (let n = el; n && n !== document; n = n.parentNode) {
      if (n.nodeType !== 1) continue
      const tag = n.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (n.isContentEditable) return true
    }
    return false
  }
  window.addEventListener(
    'contextmenu',
    (e) => {
      const sel = window.getSelection && window.getSelection()
      const take = core.takesContextMenu({
        ready,
        torn,
        adapterLive: siteAdapterLive,
        shiftKey: e.shiftKey,
        editable: isEditable(e.target),
        hasSelection: !!(sel && !sel.isCollapsed && String(sel).trim()),
        onOwnControl: [host, hint, minBtn, closeBtn, restoreBtn].some(
          (el) => el && (el === e.target || el.contains(e.target))),
      })
      if (!take) return
      e.preventDefault()
      postToOs({ __aither: 'os-host-contextmenu', x: e.clientX, y: e.clientY })
    },
    true,
  )

  // ── The bridge: OS (iframe) <-> this page ───────────────────────────────────
  let sawOs = false
  // os-ready is posted after aitherium.com hydrates inside the frame; on a cold
  // cache that is well past 5 s, so the budget is generous and re-arms on load.
  const READY_BUDGET_MS = 20000
  function startReadyTimeout() {
    clearTimeout(readyTimeout)
    readyTimeout = setTimeout(() => {
      if (sawOs || torn) return
      // aitherium.com did not frame (refused by frame-ancestors / X-Frame-Options,
      // offline, or not deployed). Say so once, then leave the page alone.
      showHint('AitherOS could not load over this page (aitherium.com did not answer)', 6000)
      host.remove()
      setTimeout(() => teardown(), 6500)
    }, READY_BUDGET_MS)
  }
  frame.addEventListener('load', () => {
    if (!sawOs) startReadyTimeout()
  })

  window.addEventListener('message', async (e) => {
    if (torn || e.source !== frame.contentWindow) return
    const r = core.routeOsMessage(e.origin, e.data)
    if (!r) return
    switch (r.kind) {
      case 'ready':
        clearTimeout(readyTimeout)
        sawOs = true
        ready = true
        window.__aitherOverlayLive = true
        host.style.opacity = '1'
        renderMode()
        // Pushed without being asked: what page it floats over, what runs locally,
        // who is signed in.
        publishPageContext(true)
        publishLocalNode()
        publishSiteAdapter(true)
        startContextWatch()
        return
      case 'regions':
        regions = r.regions
        if (r.dock) dockHint = r.dock
        renderMode()
        return
      case 'page-action': {
        const result = await runPageAction(r)
        postToOs({ __aither: 'page→os', reqId: r.reqId, ...result })
        return
      }
      case 'page-context':
        publishPageContext(true)
        return
      case 'site-adapter':
        publishSiteAdapter(true)
        return
      case 'relay':
        if (r.op === 'probe-node') {
          publishLocalNode()
          return
        }
        relayToSW(r.op, r.payload, (res) => postToOs({ __aither: r.reply, reqId: r.reqId, ...(res || {}) }))
        return
      case 'interactive':
        setInteractive(r.on)
        return
      case 'identity':
        publishIdentity()
        return
      case 'token':
        publishToken()
        return
    }
  })

  // Keep the ambient context current: selection, SPA route changes (pushState fires
  // no event, so the URL is polled), and late-hydrating content.
  let contextWatchStarted = false
  function startContextWatch() {
    if (contextWatchStarted) return
    contextWatchStarted = true
    let lastUrl = location.href
    let selTimer = null
    document.addEventListener(
      'selectionchange',
      () => {
        clearTimeout(selTimer)
        selTimer = setTimeout(() => publishPageContext(false), 400)
      },
      { passive: true },
    )
    contextTimer = setInterval(() => {
      if (torn) return
      if (location.href !== lastUrl) {
        lastUrl = location.href
        publishPageContext(true)
        publishSiteAdapter(false)
        return
      }
      publishPageContext(false)
    }, 3000)
  }

  startReadyTimeout()

  function mount() {
    if (torn) return
    ;(document.body || document.documentElement).appendChild(host)
    for (const el of [hint, minBtn, closeBtn, restoreBtn]) document.documentElement.appendChild(el)
    renderMode()
    showHint('AitherOS overlay (Alt+` to interact)', 8000)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()
