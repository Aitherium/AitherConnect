// AitherConnect ↔ portal bridge (content script, *.aitherium.com + local Veil)
// ---------------------------------------------------------------------------
// Lets portal pages talk to the extension WITHOUT knowing its extension id
// (unpacked dev installs have a machine-specific id, so onMessageExternal
// alone can't provide a universal handoff). The page posts a window message;
// this script relays an ALLOWLISTED subset to the background service worker
// and posts the response back.
//
// Protocol (all frames use window.postMessage on the page's own origin):
//   page → ext : { __aither: "portal→ext", reqId, type, payload }
//   ext  → page: { __aither: "ext→portal", reqId, response }
//   announce   : { __aither: "ext→portal", type: "aitherconnect-present", version }
//
// Security: only messages from THIS window (event.source === window) are
// accepted — no cross-frame or cross-origin input — and only the two types
// below are relayed. The install ladder in the background is fail-closed
// (paid packs the caller doesn't own resolve to license-required, never a
// silent install), so the bridge adds reach, not authority.

(() => {
  "use strict";

  const RELAY_TYPES = new Set(["marketplace-install", "aitherconnect-ping"]);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__aither !== "portal→ext" || !RELAY_TYPES.has(msg.type)) return;
    const reqId = msg.reqId;

    const payload = (msg.payload && typeof msg.payload === "object") ? msg.payload : {};
    chrome.runtime.sendMessage(
      { type: msg.type, ...payload },
      (response) => {
        const err = chrome.runtime.lastError;
        window.postMessage({
          __aither: "ext→portal",
          reqId,
          response: err ? { ok: false, error: err.message } : (response ?? { ok: false, error: "no response" }),
        }, window.location.origin);
      },
    );
  });

  // Presence marker: a data attribute React can read synchronously, plus an
  // announce message for pages that mounted before checking the attribute.
  try {
    document.documentElement.dataset.aitherconnect = chrome.runtime.getManifest().version;
  } catch { /* dataset unavailable — announce still fires */ }
  window.postMessage({
    __aither: "ext→portal",
    type: "aitherconnect-present",
    version: (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })(),
  }, window.location.origin);
})();
