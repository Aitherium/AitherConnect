/* global chrome, window, document, globalThis, Node, InputEvent, Event, DataTransfer, ClipboardEvent */
// Aither at the caret -- the in-page pop-up (AitherConnect content script, plain JS, no imports).
//
// Injected ON DEMAND by the service worker (chrome.scripting.executeScript, activeTab) when the
// user presses Alt+Shift+J or picks "Aither: help me write here" / an Aither verb from the right-
// click menu. It is never an always-on content script and adds no host permission.
//
//   * Opens in a CLOSED shadow root at the caret of the focused text field (input, textarea,
//     contenteditable including Discord's Slate editor) or on the selection.
//   * Captures context ONLY now, on that gesture: the selection, the field's text, the last <= 12
//     messages of a thread (adapter selectors the worker passes in) or a capped page text.
//   * REFUSES a password / one-time-code / card field: shows a notice and captures nothing.
//   * Talks ONLY to the service worker (chrome.runtime.sendMessage); the worker relays to the
//     desk (POST /assist/*), which runs the verb on the owner's own models and logs it. The page
//     can neither call this script nor read what it receives: no window.postMessage, no events.
//   * Nothing is sent until the user presses Enter / a verb. Accept inserts at the caret
//     (execCommand insertText -- works with Slate and React -- else a native fallback); Undo undoes.
;(() => {
  'use strict'
  const MSG = 'awconnect:assist'
  const OPEN = 'awconnect:assist-open'
  const STATUS = 'awconnect:assist-status'
  const MAX_PAGE = 6000
  const MAX_FIELD = 6000
  const MAX_SELECTION = 12000
  const MAX_THREAD = 12
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel'])
  const SELECTION_VERBS = [
    ['explain', 'Explain'],
    ['rewrite', 'Rewrite'],
    ['translate', 'Translate'],
    ['summarize', 'Summarize'],
    ['reply', 'Reply'],
    ['ask-agent', 'Ask an agent'],
    ['send-agent', 'Send to an agent'],
    ['send-workflow', 'Send to a workflow'],
    ['save-memory', 'Save to memory'],
    ['save-note', 'Save to a note'],
  ]
  const ROUTE_VERBS = new Set(['ask-agent', 'send-agent', 'send-workflow', 'save-memory', 'save-note'])

  // ── pure-ish helpers (also exported for the unit tests) ───────────────────────

  // A field whose NAME says it is a secret is refused even when it is type=text (show-password toggles).
  const SENSITIVE_NAME = /pass(word|wd|code)?|pwd|secret|token|otp|2fa|cvv|card.?number|ssn/i

  /** A field the overlay must not read: password, one-time code, card number / cvc, or secret-named. */
  function isSensitiveEl(el) {
    if (!el) return false
    const get = (n) => String((el.getAttribute && el.getAttribute(n)) || '')
    const type = String(el.type || get('type')).toLowerCase()
    const ac = String(get('autocomplete') || el.autocomplete || '').toLowerCase()
    if (type === 'password') return true
    if (/(^|\s)(cc-[a-z-]+|one-time-code|current-password|new-password)(\s|$)/.test(ac)) return true
    return SENSITIVE_NAME.test([get('name'), get('id'), get('aria-label'), get('placeholder')].join(' '))
  }

  /** The text-entry element that currently has focus, piercing open shadow roots; else null. */
  function focusedField(doc) {
    let a = doc.activeElement
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement
    if (!a || a === doc.body || a === doc.documentElement) return null
    const tag = String(a.tagName || '').toLowerCase()
    if (tag === 'iframe' || tag === 'frame') return null
    if (tag === 'textarea') return a
    if (tag === 'input') return TEXT_INPUT_TYPES.has(String(a.type || '').toLowerCase()) || isSensitiveEl(a) ? a : null
    if (a.isContentEditable) {
      // The editing host is the OUTERMOST contenteditable ancestor (Slate nests spans in it).
      let host = a
      while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement
      return host
    }
    return null
  }

  const isInputLike = (el) => !!el && /^(input|textarea)$/i.test(String(el.tagName || ''))

  function labelOf(el) {
    if (!el || !el.getAttribute) return ''
    return String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '')
      .trim()
      .slice(0, 160)
  }

  /** Read selection + field text out of a focused field. Never called for a sensitive field. */
  function readField(el, win) {
    if (!el) return { selection: '', field: '', start: 0, end: 0 }
    if (isInputLike(el)) {
      const v = String(el.value || '')
      const s = Math.max(0, Number(el.selectionStart) || 0)
      const e = Math.max(s, Number(el.selectionEnd) || s)
      return { selection: v.slice(s, e).slice(0, MAX_SELECTION), field: v.slice(0, MAX_FIELD), start: s, end: e }
    }
    const sel = win && win.getSelection ? win.getSelection() : null
    const inside = sel && sel.rangeCount && el.contains(sel.anchorNode)
    return {
      selection: inside ? String(sel.toString()).slice(0, MAX_SELECTION) : '',
      field: String(el.innerText || el.textContent || '').slice(0, MAX_FIELD),
      start: 0,
      end: 0,
    }
  }

  /**
   * The last messages of a thread from an adapter's `message_list` selectors. Generic on purpose:
   * author = first username-like node, text = message-content-like node, consecutive messages
   * from one author inherit it (Discord groups them). Returns [] when the list is not found.
   */
  function extractThread(doc, selectors, max) {
    const out = []
    let list = null
    for (const sel of Array.isArray(selectors) ? selectors.slice(0, 6) : []) {
      try {
        list = doc.querySelector(String(sel))
      } catch {
        list = null
      }
      if (list) break
    }
    if (!list) return out
    const items = Array.prototype.slice.call(list.children || [], -40)
    let author = ''
    for (const li of items) {
      const a = li.querySelector && li.querySelector("[class*='username'], [data-author], h3 span")
      const t = li.querySelector && li.querySelector("[id^='message-content-'], [class*='messageContent'], [class*='markup']")
      const text = String((t && (t.innerText || t.textContent)) || '').trim()
      if (a) author = String(a.innerText || a.textContent || '').trim().slice(0, 80)
      if (text) out.push({ author, text: text.slice(0, 1200) })
    }
    return out.slice(-(max || MAX_THREAD))
  }

  /** Whole-page fallback, capped. */
  function pageText(doc) {
    return String((doc.body && doc.body.innerText) || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_PAGE)
  }

  /** Native value setter: React/Vue controlled inputs ignore a plain `el.value = x`. */
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el)
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
  }

  /**
   * Put `text` at the caret / over the selection. `target` = {el, start, end, range}.
   * Returns {ok, how, prev}. how: 'exec' (undoable with execCommand('undo')), 'native' (restored
   * from `prev`), 'paste' (a synthetic paste event; contenteditable fallback).
   */
  function insertText(target, text, doc, win) {
    const el = target && target.el
    if (!el || !text) return { ok: false, how: '', error: 'nothing to insert' }
    try {
      el.focus()
    } catch {
      /* focus can throw on detached nodes; the checks below catch it */
    }
    if (isInputLike(el)) {
      const prev = { value: String(el.value || ''), start: target.start, end: target.end }
      try {
        el.setSelectionRange(target.start, target.end)
      } catch {
        /* some input types have no selection API */
      }
      if (doc.execCommand && doc.execCommand('insertText', false, text)) return { ok: true, how: 'exec', prev }
      const next = prev.value.slice(0, target.start) + text + prev.value.slice(target.end)
      setNativeValue(el, next)
      const caret = target.start + text.length
      try {
        el.setSelectionRange(caret, caret)
      } catch {
        /* ignore */
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      return { ok: true, how: 'native', prev }
    }
    // contenteditable: the page selection moved into our shadow input; put it back first.
    const sel = win && win.getSelection ? win.getSelection() : null
    if (sel && target.range) {
      sel.removeAllRanges()
      sel.addRange(target.range)
    }
    if (doc.execCommand && doc.execCommand('insertText', false, text)) return { ok: true, how: 'exec' }
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
      el.dispatchEvent(ev)
      return { ok: true, how: 'paste' }
    } catch {
      return { ok: false, how: '', error: 'this editor would not take the text' }
    }
  }

  /** Undo the last insert. */
  function undoInsert(target, state, doc) {
    const el = target && target.el
    if (!el || !state || !state.ok) return { ok: false }
    try {
      el.focus()
    } catch {
      /* see insertText */
    }
    if (state.how === 'native' && state.prev) {
      setNativeValue(el, state.prev.value)
      try {
        el.setSelectionRange(state.prev.start, state.prev.end)
      } catch {
        /* ignore */
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'historyUndo' }))
      return { ok: true }
    }
    return { ok: !!(doc.execCommand && doc.execCommand('undo')) }
  }

  /** Where the pop-up opens: under the caret / selection end, flipped above near the bottom edge. */
  function placePopup(anchor, size, view) {
    const m = 8
    let x = anchor.left
    let y = anchor.bottom + m
    if (y + size.h > view.h - m) y = anchor.top - size.h - m
    x = Math.max(m, Math.min(x, view.w - size.w - m))
    y = Math.max(m, Math.min(y, view.h - size.h - m))
    return { x: Math.round(x), y: Math.round(y) }
  }

  const core = { isSensitiveEl, focusedField, readField, extractThread, pageText, insertText, undoInsert, placePopup, labelOf, setNativeValue }
  if (typeof globalThis.__AWC_ASSIST_TEST__ !== 'undefined') {
    globalThis.__awcAssistCore = core
    return
  }
  if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime) return
  if (window.__awcAssist) return // already injected: the existing listener handles this open
  window.__awcAssist = true

  // ── the pop-up ────────────────────────────────────────────────────────────────

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    #card { width: 440px; max-height: 420px; padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow: auto;
      background: rgba(20,22,28,.97); border: 1px solid rgba(255,255,255,.14); border-radius: 22px; color: #e8eaee;
      font: 13px/1.35 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
    #row { display: flex; gap: 8px; align-items: center; background: #2a3144; border-radius: 999px; padding: 4px 6px 4px 16px; }
    #prompt { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #e8eaee; font: inherit; font-size: 14px; padding: 8px 0; }
    #prompt::placeholder { color: #9aa6c4; }
    button { font: inherit; color: #e8eaee; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
    button:hover:not(:disabled) { border-color: #8ab4ff; }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: #8ab4ff; color: #0d1220; border-color: transparent; font-weight: 600; }
    #go { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; background: #8ab4ff; color: #0d1220; border: 0; font-weight: 700; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { font-size: 13px; padding: 5px 12px; border-radius: 12px; color: #c3cbe0; }
    .verbs .chip { border-radius: 999px; font-size: 12px; padding: 3px 10px; color: #98a0ae; }
    #notice { color: #ff8a8a; padding: 6px 4px; }
    #route { display: none; gap: 6px; align-items: center; }
    #route input { flex: 1; min-width: 0; background: #2a3144; color: #e8eaee; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 5px 12px; font: inherit; outline: 0; }
    #result { display: none; flex-direction: column; gap: 6px; }
    #out { min-height: 80px; resize: vertical; width: 100%; background: rgba(255,255,255,.04); color: #e8eaee; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 8px 10px; font: inherit; outline: 0; }
    #actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #actions .sp { flex: 1; }
    #foot { color: #98a0ae; font-size: 11.5px; padding: 0 4px; }
    #status { min-height: 16px; padding: 0 4px; font-size: 12px; color: #98a0ae; }
    #status.err { color: #ff8a8a; } #status.ok { color: #5bd08a; }
  `
  const HTML = `
    <div id="card" role="dialog" aria-label="Aither">
      <div id="row"><input id="prompt" type="text" autocomplete="off" spellcheck="false" placeholder="Ask Aither to help me write"><button id="go" title="Send (Enter)">&#8593;</button></div>
      <div id="notice" hidden></div>
      <div class="chips" id="chips"></div>
      <div class="chips verbs" id="verbs"></div>
      <div id="route"><span id="route-label"></span><input id="route-input" type="text" autocomplete="off" spellcheck="false"><button id="route-go" class="primary">Send</button></div>
      <div id="result"><textarea id="out" spellcheck="true"></textarea>
        <div id="actions"><button id="accept" class="primary">Accept</button><button id="retry">Retry</button><button id="undo" disabled>Undo</button><button id="copy">Copy</button><span class="sp"></span><button id="close">Close</button></div></div>
      <div id="status"></div>
      <button id="repair" class="primary" hidden>Pair again</button>
      <div id="foot"></div>
    </div>`

  let ui = null // {host, root, q}
  let session = null // {target, ctx, last, inserted, busy, adapterRoles}

  function ask(route, body) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: MSG, route, body }, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve({ ok: false, error: 'Start the Aither desk app: AitherConnect sends nothing anywhere else.' })
          } else resolve(res)
        })
      } catch {
        resolve({ ok: false, error: 'Start the Aither desk app: AitherConnect sends nothing anywhere else.' })
      }
    })
  }

  function captureContext(target, adapterRoles, framed) {
    const read = target ? readField(target.el, window) : { selection: String(window.getSelection ? window.getSelection().toString() : '').slice(0, MAX_SELECTION), field: '', start: 0, end: 0 }
    // In (or beside) an iframe the surrounding page is not what the user is working in: send only what
    // they typed or selected here, never the top frame's text or thread.
    const thread = !framed && adapterRoles && adapterRoles.message_list ? extractThread(document, adapterRoles.message_list, MAX_THREAD) : []
    return {
      host: location.host,
      title: String(document.title || '').slice(0, 240),
      url: `${location.origin}${location.pathname}`,
      selection: read.selection,
      field: read.field,
      fieldLabel: target ? labelOf(target.el) : '',
      thread,
      page: framed || thread.length || read.selection ? '' : pageText(document),
      sensitive: false,
      canInsert: !!target,
    }
  }

  function status(text, kind) {
    ui.q.status.textContent = text || ''
    ui.q.status.className = kind || ''
  }

  // A failed reply: the plain-words error, and, when the desk is not the one that was paired, a Pair again button
  // (a click is the user's consent; the worker pairs, the owner confirms the code on the desk).
  function fail(res) {
    status(res.error || 'That did not work.', 'err')
    if (ui) ui.q.repair.hidden = !res.needsRepair
  }

  function chip(label, onClick) {
    const b = document.createElement('button')
    b.className = 'chip'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  function show(text, last) {
    const q = ui.q
    q.result.style.display = 'flex'
    q.out.value = text
    if (last) session.last = last
    session.inserted = false
    q.retry.disabled = !(session.last && session.last.verb)
    q.undo.disabled = true
    q.accept.style.display = session.last && session.last.kind === 'transform' && session.ctx.canInsert ? '' : 'none'
    q.accept.textContent = session.ctx.selection ? 'Replace selection' : 'Insert'
  }

  async function submit(verb, prompt, arg) {
    if (session.busy) return
    session.busy = true
    status('Thinking...', '')
    const res = await ask('run', { ctx: session.ctx, verb, prompt: prompt || '', arg: arg || '', ...(session.last && session.last.id && verb === session.last.verb ? { retryOf: session.last.id } : {}) })
    session.busy = false
    if (!res.ok) return fail(res)
    show(String(res.text || ''), { id: res.id, verb: res.verb || verb, prompt: prompt || '', arg: arg || '', kind: res.kind })
    status(`Answer via ${res.destination || 'your agents'}`, 'ok')
  }

  function openRoute(v, label) {
    const q = ui.q
    session.pending = v
    q.route.style.display = 'flex'
    q.routeLabel.textContent = label
    q.routeInput.value = ''
    q.routeInput.placeholder = v === 'translate' ? 'English, Spanish, ...' : v === 'send-workflow' ? 'workflow / swarm name' : 'agent (blank = your default)'
    q.routeInput.focus()
  }

  async function routeGo() {
    const v = session.pending
    if (!v || session.busy) return
    const val = ui.q.routeInput.value.trim()
    if (v === 'translate') {
      ui.q.route.style.display = 'none'
      return submit('translate', '', val || 'English')
    }
    session.busy = true
    status('Sending...', '')
    const res = await ask('route', { ctx: session.ctx, verb: v, agent: v === 'send-workflow' ? '' : val, name: v === 'send-workflow' ? val : '' })
    session.busy = false
    if (!res.ok) return fail(res)
    ui.q.route.style.display = 'none'
    if (res.text) show(String(res.text), { id: res.id, verb: v, kind: 'answer' })
    status(res.text ? `Answer from ${res.destination}` : `Done: sent to ${res.destination || 'your agent'}`, 'ok')
  }

  function pick(v) {
    if (v === 'translate') return openRoute('translate', 'Translate to')
    if (ROUTE_VERBS.has(v)) {
      if (v === 'save-memory' || v === 'save-note') return routeNow(v)
      return openRoute(v, 'Agent:')
    }
    return submit(v, '', '')
  }

  async function routeNow(v) {
    session.pending = v
    session.busy = true
    status('Saving...', '')
    const res = await ask('route', { ctx: session.ctx, verb: v })
    session.busy = false
    if (!res.ok) return fail(res)
    status(`Done: saved (${v === 'save-memory' ? 'memory' : 'a note on your desk'})`, 'ok')
  }

  function renderChips(chips) {
    const q = ui.q
    q.chips.textContent = ''
    for (const c of chips || []) {
      q.chips.appendChild(
        chip(c.text, () => {
          q.prompt.value = c.text
          void submit(c.verb || 'write', c.text, '')
        }),
      )
    }
  }

  function note(outcome) {
    if (!session.last) return
    void ask('note', { ctx: session.ctx, outcome, id: session.last.id, verb: session.last.verb, ...(outcome === 'accepted' ? { text: ui.q.out.value } : {}) })
  }

  function close() {
    if (!ui) return
    if (session && session.last && !session.inserted && !session.closedNoted) {
      session.closedNoted = true
      note('cancelled')
    }
    document.removeEventListener('mousedown', onOutside, true)
    ui.host.remove()
    ui = null
    session = null
  }

  function onOutside(e) {
    if (ui && !e.composedPath().includes(ui.host)) close()
  }

  function build(anchor) {
    const host = document.createElement('div')
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;'
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = CSS
    const wrap = document.createElement('div')
    wrap.innerHTML = HTML // static template: nothing from the page or the desk is ever interpolated into it
    root.append(style, wrap)
    const $ = (id) => root.getElementById ? root.getElementById(id) : wrap.querySelector('#' + id)
    const q = {
      prompt: $('prompt'), go: $('go'), notice: $('notice'), chips: $('chips'), verbs: $('verbs'), route: $('route'),
      routeLabel: $('route-label'), routeInput: $('route-input'), routeGo: $('route-go'), result: $('result'), out: $('out'),
      accept: $('accept'), retry: $('retry'), undo: $('undo'), copy: $('copy'), closeBtn: $('close'), status: $('status'), foot: $('foot'), repair: $('repair'),
    }
    document.documentElement.appendChild(host)
    const card = root.querySelector('#card')
    const r = card.getBoundingClientRect()
    const at = placePopup(anchor, { w: r.width || 440, h: Math.min(r.height || 200, 420) }, { w: window.innerWidth, h: window.innerHeight })
    host.style.left = `${at.x}px`
    host.style.top = `${at.y}px`
    ui = { host, root, q }
    // Keys typed in the pop-up are not the page's keys.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation())
    q.prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void submit('write', q.prompt.value.trim(), '') }
      if (e.key === 'Escape') close()
    })
    q.routeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void routeGo(); if (e.key === 'Escape') q.route.style.display = 'none' })
    q.go.addEventListener('click', () => void submit('write', q.prompt.value.trim(), ''))
    q.routeGo.addEventListener('click', () => void routeGo())
    q.accept.addEventListener('click', () => {
      const text = q.out.value
      if (!text.trim()) return status('There is nothing to insert.', 'err')
      const res = insertText(session.target, text, document, window)
      if (!res.ok) return status(res.error || 'Could not insert. Use Copy.', 'err')
      session.inserted = true
      session.insertState = res
      note('accepted')
      q.undo.disabled = false
      status('Inserted. Undo if it is not right.', 'ok')
    })
    q.retry.addEventListener('click', () => { if (session.last && session.last.verb) void submit(session.last.verb, session.last.prompt, session.last.arg) })
    q.undo.addEventListener('click', () => {
      const res = undoInsert(session.target, session.insertState, document)
      if (!res.ok) return status('Could not undo. Press Ctrl+Z in the field.', 'err')
      session.inserted = false
      q.undo.disabled = true
      void ask('note', { ctx: session.ctx, outcome: 'undone', id: session.last && session.last.id, verb: session.last && session.last.verb })
      status('Undone.', 'ok')
    })
    q.copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(q.out.value).then(() => status('Copied.', 'ok'), () => { q.out.select(); status('Press Ctrl+C to copy.', '') })
    })
    q.closeBtn.addEventListener('click', close)
    q.repair.addEventListener('click', () => {
      q.repair.hidden = true
      status('Starting pairing...', '')
      void ask('repair', {}).then((res) => {
        if (res.ok) status(res.text || 'Paired. Press Enter to try again.', 'ok')
        else fail(res)
      })
    })
    document.addEventListener('mousedown', onOutside, true)
    return q
  }

  function anchorRect(target) {
    try {
      const sel = window.getSelection && window.getSelection()
      if (target && !isInputLike(target.el) && sel && sel.rangeCount) {
        const rects = sel.getRangeAt(0).getClientRects()
        const last = rects[rects.length - 1]
        if (last && (last.width || last.height)) return last
      }
      if (target) return target.el.getBoundingClientRect()
      if (sel && sel.rangeCount) {
        const rects = sel.getRangeAt(0).getClientRects()
        if (rects.length) return rects[rects.length - 1]
      }
    } catch {
      /* fall through to the viewport */
    }
    return { left: window.innerWidth / 2 - 220, top: window.innerHeight / 3, bottom: window.innerHeight / 3, right: 0 }
  }

  async function open(verb, adapterRoles) {
    // A frame that does not own the focus stays quiet (the worker may inject every frame).
    const el = focusedField(document)
    const hasSel = !!(window.getSelection && String(window.getSelection().toString()).trim())
    const topFrame = window.top === window
    if (!el && !hasSel && !topFrame) return
    if (ui) close()
    let target = null
    if (el) {
      const read = readField(el, window)
      let range = null
      try {
        const s = window.getSelection()
        range = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null
      } catch {
        range = null
      }
      target = { el, start: read.start, end: read.end, range }
    }
    const q = build(anchorRect(target))
    session = { target, ctx: null, last: null, inserted: false, busy: false, adapterRoles }
    if (el && isSensitiveEl(el)) {
      // Refused: nothing is captured, nothing is sent.
      q.notice.hidden = false
      q.notice.textContent = 'This looks like a password or one-time-code field. Aither does not read or send those.'
      ui.root.querySelector('#row').style.display = 'none'
      session.ctx = { canInsert: false, selection: '' }
      return
    }
    const framed = !topFrame || String((document.activeElement && document.activeElement.tagName) || '').toLowerCase() === 'iframe'
    session.ctx = captureContext(target, adapterRoles, framed)
    q.prompt.focus()
    const sug = await ask('suggest', { ctx: session.ctx })
    if (!ui) return
    if (!sug.ok) {
      fail(sug)
      if (sug.refused) ui.root.querySelector('#row').style.display = 'none'
      return
    }
    renderChips(sug.chips)
    q.foot.textContent = sug.send && sug.send.text ? sug.send.text : ''
    if (session.ctx.selection.trim()) {
      for (const [id, label] of SELECTION_VERBS) {
        if (id === 'reply' && !session.ctx.selection.trim() && !session.ctx.thread.length) continue
        q.verbs.appendChild(chip(label, () => pick(id)))
      }
    }
    if (verb) pick(verb)
    if (sug.canRefine) {
      const ref = await ask('refine', { ctx: session.ctx })
      if (ui && ref.ok && ref.chips && ref.chips.length) renderChips(ref.chips)
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    // The worker's status line (the desk pairing code the user must confirm on the desk).
    if (msg && msg.type === STATUS) {
      if (ui && typeof msg.text === 'string') status(msg.text.slice(0, 200), '')
      return false
    }
    if (!msg || msg.type !== OPEN) return false
    void open(typeof msg.verb === 'string' ? msg.verb : '', msg.adapter && typeof msg.adapter === 'object' ? msg.adapter : null)
    return false
  })
})()
