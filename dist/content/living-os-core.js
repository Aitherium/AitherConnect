/* global module */
// awconnect -- Living OS overlay, the PURE half.
// =============================================================================
// The geometry and routing decisions of living-os-bridge.js, with no DOM and no
// chrome.*: the bridge calls these, and src/background/__tests__/livingOsCore.test.ts
// loads this exact file in a Node vm and asserts them. Ported from
// awconnect/content/aither-overlay-bridge.js (isDockRect, clipToRegions,
// placeControls, renderMode, the os-message switch) without changing behaviour.
//
// Injected BEFORE the bridge (executeScript files: [core, bridge]; the dynamic
// content script lists both), and publishes itself as globalThis.__awcLivingOsCore
// in the content script's isolated world -- the page cannot see or replace it.
;(function (root) {
  'use strict'

  const OS_ORIGIN = 'https://aitherium.com'
  const OS_URL = OS_ORIGIN + '/?mode=overlay'
  const EDGES = ['bottom', 'top', 'left', 'right']
  /** dock.tsx EDGE_ROOT before the first paint. */
  const DEFAULT_DOCK = Object.freeze({ edge: 'bottom', thickness: 56 })

  /**
   * The page this bridge must NOT run on: 'os' = aitherium.com itself (framing the OS
   * over the OS is a recursive shell), 'social' = x/twitter/linkedin (those surfaces
   * keep their own in-page driver). null = fine.
   */
  function guardedHost(hostname) {
    const h = String(hostname || '').toLowerCase()
    if (/^(www\.)?aitherium\.com$/.test(h)) return 'os'
    if (/(^|\.)(x\.com|twitter\.com|linkedin\.com)$/.test(h.replace(/^www\./, ''))) return 'social'
    return null
  }

  function validRect(r) {
    return !!r && r.w > 0 && r.h > 0
  }

  /**
   * Is `r` the dock strip at the dock's CURRENT edge? A bottom dock ends at the
   * viewport bottom and spans its width; a top dock sits under the 26px pulse ticker
   * (so y <= 48); a side dock spans the full height.
   */
  function isDockRect(r, dock, vw, vh) {
    if (!validRect(r)) return false
    const edge = (dock && dock.edge) || 'bottom'
    if (edge === 'bottom') return r.y + r.h >= vh - 24 && r.w >= vw - 24
    if (edge === 'top') return r.y <= 48 && r.w >= vw - 24
    if (edge === 'left') return r.x <= 24 && r.h >= vh - 24
    return r.x + r.w >= vw - 24 && r.h >= vh - 24 // right
  }

  /**
   * The clip-path for the OS chrome: ONE closed subpath per rect (a single polygon()
   * would trace lines between disjoint rects and fill the gaps). Minimized drops the
   * dock rect only; open windows stay live. null = nothing to clip to.
   */
  function regionsClipPath(regions, opts) {
    const o = opts || {}
    const subs = []
    for (const r of Array.isArray(regions) ? regions : []) {
      if (!validRect(r)) continue
      if (o.minimized && isDockRect(r, o.dock, o.vw, o.vh)) continue
      const x = Math.round(r.x || 0)
      const y = Math.round(r.y || 0)
      const w = Math.round(r.w)
      const h = Math.round(r.h)
      subs.push('M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h) + 'H' + x + 'Z')
    }
    return subs.length ? 'path("' + subs.join('') + '")' : null
  }

  /**
   * What the frame should be. The HOST is always pointer-events:none; only the iframe
   * carries pointer-events, and its clip-path limits hit-testing to the OS chrome, so
   * every other pixel falls through to the page.
   *   loading     not ready: inert, invisible
   *   minimized   clipped to the non-dock regions (inert if the dock was all there was)
   *   interactive the whole frame takes input (Alt+` / Alt+O / os-interactive)
   *   clipped     live chrome, page pass-through
   *   waiting     ready but no regions yet: inert AND hidden
   */
  /** A clip-path that shows nothing (never '' -- that shows everything). */
  const HIDDEN = 'inset(100%)'

  function renderPlan(s) {
    const clip = regionsClipPath(s.regions, s)
    if (!s.ready) return { mode: 'loading', pointer: 'none', clip: '' }
    // Minimized with nothing but the dock on screen leaves NO rect to show. An empty
    // clip-path means "unclipped", which drew the WHOLE frame -- dock included, inert
    // and over the page with the page pad removed (owner, 2026-10-07: "taskbar is not
    // minimizable and it covers part of the bottom of web pages"). Hide it outright.
    if (s.minimized) return clip ? { mode: 'minimized', pointer: 'auto', clip: clip } : { mode: 'minimized', pointer: 'none', clip: HIDDEN }
    if (s.interactive) return { mode: 'interactive', pointer: 'auto', clip: '' }
    if (clip) return { mode: 'clipped', pointer: 'auto', clip: clip }
    // Ready but no regions: HIDDEN, never ''. An unclipped frame paints whatever the OS
    // draws over the whole page, and inert does not mean invisible -- when the OS lost its
    // dock (Veil #12280 hid it in overlay mode) the page went blank white under an inert
    // frame (owner 2026-10-09). The controls still show; the dock appears with its rect.
    return { mode: 'waiting', pointer: 'none', clip: HIDDEN }
  }

  /** Our own controls clear whichever strip the dock occupies; left-anchored (the OS parks the room bottom-right). */
  function controlsPlacement(dock, showDock) {
    const t = Math.max(0, Math.round((dock && dock.thickness) || 0))
    const edge = (dock && dock.edge) || 'bottom'
    return {
      left: (showDock && edge === 'left' ? t : 0) + 12,
      bottom: (showDock && edge === 'bottom' ? t : 0) + 10,
    }
  }

  /** How much to pad the page so the dock never covers content (0 = none). */
  function pagePad(s) {
    if (!s.ready || s.minimized || s.interactive) return 0
    const horizontal = s.dock.edge === 'left' || s.dock.edge === 'right'
    const dockRect = (s.regions || []).find((r) => isDockRect(r, s.dock, s.vw, s.vh))
    return dockRect ? Math.round(horizontal ? dockRect.w : dockRect.h) : 0
  }

  /** A dock hint from an os-regions message, or null to keep the current one. */
  function parseDock(d) {
    if (d && EDGES.includes(d.edge) && d.thickness > 0) return { edge: d.edge, thickness: d.thickness }
    return null
  }

  /**
   * One window message -> what the bridge does. Anything not from the REAL OS origin,
   * or not an {__aither} envelope, is ignored. Unknown kinds are ignored too.
   */
  function routeOsMessage(origin, data) {
    if (origin !== OS_ORIGIN) return null
    if (!data || typeof data !== 'object' || data.__aither == null) return null
    switch (data.__aither) {
      case 'os-ready':
        return { kind: 'ready' }
      case 'os-regions':
        return Array.isArray(data.regions) ? { kind: 'regions', regions: data.regions, dock: parseDock(data.dock) } : null
      case 'os→page':
        return { kind: 'page-action', reqId: data.reqId, action: data.action, selector: data.selector, text: data.text, key: data.key }
      case 'os-page-context-request':
        return { kind: 'page-context' }
      case 'os-node-probe':
        return { kind: 'relay', op: 'probe-node', reply: 'os-local-node' }
      case 'os-site-adapter-request':
        return { kind: 'site-adapter' }
      case 'os-compose':
        return {
          kind: 'relay',
          op: 'os-compose',
          reqId: data.reqId,
          reply: 'os-compose-result',
          payload: { prompt: data.prompt, maxTokens: data.maxTokens, temperature: data.temperature },
        }
      case 'os-daemon-call':
        return {
          kind: 'relay',
          op: 'daemon-call',
          reqId: data.reqId,
          reply: 'os-daemon-result',
          payload: { method: data.method, path: data.path, body: data.body },
        }
      case 'os-interactive':
        return typeof data.on === 'boolean' ? { kind: 'interactive', on: data.on } : null
      case 'os-identity-request':
        return { kind: 'identity' }
      case 'os-token-request':
        return { kind: 'token' }
      default:
        return null
    }
  }

  /**
   * A worker identity/token answer -> the message for the OS frame, or null to post
   * nothing. `clearOnEmpty` is the sign-out path (contract C2): the worker's explicit
   * {identity:null} / {token:null} becomes a null post so the OS drops its host
   * identity and bearer. An error or a missing answer is never read as a sign-out.
   */
  function authHandoff(kind, res, clearOnEmpty) {
    const key = kind === 'token' ? 'token' : 'identity'
    const type = kind === 'token' ? 'os-token' : 'os-identity'
    if (!res || typeof res !== 'object') return null
    if (res[key]) return { __aither: type, [key]: res[key] }
    if (clearOnEmpty && key in res && res[key] === null) return { __aither: type, [key]: null }
    return null
  }

  /**
   * Should a right-click on the HOST page open the OS's site-action menu instead
   * of the browser's? Owner, 2026-10-07: the 'Discord' menu belongs on a
   * right-click anywhere on the page, not on a chip that floats there forever.
   * Only on a page the platform has an adapter for, never during the OS's own
   * loading, and never where the browser menu does a job ours does not:
   * shift+right-click (the escape hatch), an editable field (paste, spellcheck)
   * or a text selection (copy). Pure: the bridge measures, this decides.
   */
  function takesContextMenu(s) {
    if (!s || !s.ready || s.torn) return false
    if (!s.adapterLive) return false
    if (s.shiftKey || s.editable || s.hasSelection || s.onOwnControl) return false
    return true
  }

  const core = {
    OS_ORIGIN,
    OS_URL,
    DEFAULT_DOCK,
    guardedHost,
    isDockRect,
    regionsClipPath,
    renderPlan,
    controlsPlacement,
    pagePad,
    parseDock,
    routeOsMessage,
    authHandoff,
    takesContextMenu,
  }
  root.__awcLivingOsCore = core
  if (typeof module === 'object' && module && module.exports) module.exports = core
})(typeof globalThis !== 'undefined' ? globalThis : this)
