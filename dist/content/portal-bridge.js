/* global chrome, window, location, document */
// awconnect <-> portal bridge (content script, https://*.aitherium.com only).
// Ported from awconnect/content/portal-bridge.js. Lets an Aitherium page talk to the
// extension without knowing its id: the page posts a window message, this script
// relays an ALLOWLISTED op to the service worker and posts the answer back.
//
//   page -> ext : { __aither: "portal→ext", reqId, type, payload }
//   ext  -> page: { __aither: "ext→portal", reqId, response }
//   announce    : { __aither: "ext→portal", type: "aitherconnect-present", version }
//   identity    : { __aither: "os-identity", identity }   (Living OS pages only)
//
// Only messages from THIS window are accepted, only the ops below are relayed, and
// the op is WRAPPED ({type:'awconnect:portal', op, payload}) so a page payload can
// never set the message type the extension routes on. The worker re-checks the
// sender host and the op (src/background/portal.ts). Any other type is answered at
// once with {ok:false, error:'unsupported: <type>'}: a silent drop left the site
// waiting out its whole timeout before it could fall back (contract C3).
//
// Runs on the five manifest hosts, and on the Living OS apex (aitherium.com) only
// when the person granted it there: src/background/apexBridge.ts registers this file
// at runtime, because a new manifest host would disable every store install.
;(() => {
  'use strict'
  const HOSTS = ['www', 'api', 'idp', 'desktop', 'weights'].map((h) => h + '.aitherium.com')
  const APEX = 'aitherium.com'
  if (location.protocol !== 'https:' || !(HOSTS.includes(location.hostname) || location.hostname === APEX)) return
  if (window.__awconnectPortalBridge) return
  window.__awconnectPortalBridge = true

  // fleet-sync: the Living OS's local-first PIM sync seam (AitherVeil
  // src/lib/local-pim/sync.ts). The worker maps the op through an exact op -> path
  // allowlist and calls the platform with the user's bearer; a page never names a path.
  const OPS = new Set(['aitherconnect-ping', 'open-panel', 'fleet-sync'])
  // Where the Living OS runs top-level and reads a host identity (os-session.ts
  // listenForHostIdentity accepts e.source === window). Never the bearer.
  const OS_HOSTS = new Set([APEX, 'www.aitherium.com', 'desktop.aitherium.com'])
  const AUTH_KEY = 'awc_auth'
  const version = (() => {
    try {
      return chrome.runtime.getManifest().version
    } catch {
      return ''
    }
  })()

  function toWorker(op, payload, done) {
    try {
      chrome.runtime.sendMessage({ type: 'awconnect:portal', op, payload }, (response) => {
        const err = chrome.runtime.lastError
        done(err ? { ok: false, error: err.message } : (response ?? { ok: false, error: 'no response' }))
      })
    } catch (e) {
      // The extension was reloaded under this page: the context is gone.
      done({ ok: false, error: String((e && e.message) || e) })
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const msg = event.data
    if (!msg || msg.__aither !== 'portal→ext') return
    const reqId = msg.reqId
    const reply = (response) =>
      window.postMessage({ __aither: 'ext→portal', reqId, response }, window.location.origin)
    if (!OPS.has(msg.type)) {
      reply({ ok: false, error: 'unsupported: ' + String(msg.type).slice(0, 64) })
      return
    }
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {}
    toWorker(msg.type, payload, reply)
  })

  // The signed-in identity for a top-level Living OS page (legacy behaviour 4.x had
  // dropped). Posted only when there is one; a null goes out only to retract an
  // identity THIS bridge asserted, so an extension that was never signed in cannot
  // sign the OS's own session out.
  let asserted = false
  function publishIdentity() {
    if (!OS_HOSTS.has(location.hostname)) return
    toWorker('os-identity', {}, (res) => {
      if (!res || res.ok !== true) return // worker unreachable: say nothing rather than guess
      if (res.identity) {
        asserted = true
        window.postMessage({ __aither: 'os-identity', identity: res.identity }, window.location.origin)
      } else if (asserted) {
        asserted = false
        window.postMessage({ __aither: 'os-identity', identity: null }, window.location.origin)
      }
    })
  }

  try {
    document.documentElement.dataset.aitherconnect = version
  } catch {
    /* dataset unavailable: the announce still fires */
  }
  window.postMessage({ __aither: 'ext→portal', type: 'aitherconnect-present', version }, window.location.origin)
  publishIdentity()
  try {
    // Signed in or out from the side panel while this page is open.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && AUTH_KEY in changes) publishIdentity()
    })
  } catch {
    /* not in extension context */
  }
})()
