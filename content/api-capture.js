/**
 * AitherConnect — FormBridge API Capture (isolated world, relay to service worker).
 *
 * Listens for {__aitherApi:'response'} messages from the MAIN world (api-capture-net.js),
 * collects them, and forwards to the service worker via chrome.runtime.sendMessage.
 * The service worker then POSTs to the local FormBridge engine.
 *
 * Also displays a small visible badge indicating that API capture is active.
 * Registered ONLY when an API-capture pack is configured for this origin.
 */
(() => {
  "use strict";
  if (window.__aitherApiRelay) return;
  window.__aitherApiRelay = true;

  const collectedResponses = [];
  const FLUSH_INTERVAL_MS = 2000;  // Batch responses every 2s

  // Listen for API responses from the MAIN world
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__aitherApi !== "response") return;

    collectedResponses.push({
      url: e.data.url,
      body: e.data.body,
      rtf: e.data.rtf,
    });
  });

  // Periodically flush collected responses to the service worker
  function flush() {
    if (collectedResponses.length === 0) return;

    const batch = collectedResponses.splice(0, collectedResponses.length);
    try {
      for (const resp of batch) {
        chrome.runtime.sendMessage({
          type: "form-capture-api",
          url: resp.url,
          body: resp.body,
          rtf: resp.rtf,
          source_origin: location.origin,
        });
      }
    } catch { /* service worker asleep — next flush will retry */ }
  }

  // Show a visible badge
  const badge = document.createElement("div");
  badge.style.cssText = [
    "position:fixed", "bottom:14px", "right:14px", "z-index:2147483647",
    "font:12px/1.4 'Segoe UI',system-ui,sans-serif", "color:#fff", "background:#059669",
    "border-radius:16px", "padding:6px 12px", "box-shadow:0 2px 8px rgba(0,0,0,.35)",
  ].join(";");
  badge.textContent = "🔌 FormBridge: API connected";
  document.documentElement.appendChild(badge);

  // Start periodic flush
  setInterval(flush, FLUSH_INTERVAL_MS);
  // Also flush on page unload
  window.addEventListener("beforeunload", flush);
})();
