/**
 * AitherConnect — HAR Recorder relay (ISOLATED world).
 *
 * The recorder (har-recorder.js) runs in the page's MAIN world and cannot reach
 * chrome.runtime. This isolated-world companion listens for its window messages
 * and forwards each HAR entry to the service worker, which accumulates them into
 * the capture session's log. Injected/removed alongside the recorder by
 * background.js on capture start/stop.
 */
(() => {
  "use strict";
  if (window.__aitherHarRelay) return;
  window.__aitherHarRelay = true;

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__aitherHar !== "entry") return;
    try {
      chrome.runtime.sendMessage({
        type: "har-entry",
        entry: e.data.entry,
        page_url: location.href,
      });
    } catch { /* service worker asleep — entry dropped; capture continues */ }
  });
})();
