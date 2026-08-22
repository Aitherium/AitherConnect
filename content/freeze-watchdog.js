// freeze-watchdog.js — main-thread block + liveness watchdog for THIS tab.
//
// Real-world counterpart to AitherBrowser's crash probe: a page that freezes
// (renderer main thread blocked — the "works fine for a bit, then the browser
// dies" class) is reported so the stack can correlate it with a URL and diagnose
// it. Two signals:
//   1. AC_FROZEN — a requestAnimationFrame gap > 3s while the tab is VISIBLE
//      (background tabs have rAF throttled by Chrome, so visibility is required
//      to avoid false positives).
//   2. AC_ALIVE — a periodic liveness ping; if it stops, the background knows the
//      tab became unresponsive and reports it.
//
// The script never guesses — it reports measured gaps and actual pings, and only
// while the page is visible.
(() => {
  "use strict";
  if (window.__acFreezeWatchdog) return;   // one watchdog per document
  window.__acFreezeWatchdog = true;

  const THRESHOLD_MS = 3000;               // a rAF gap > this = main thread blocked
  const PING_MS = 15000;                   // liveness heartbeat cadence
  const seenFreezes = new Set();           // dedupe by duration bucket

  let lastTs = 0;

  // Reset the anchor on visibility changes so a long-hidden tab never reports a
  // "freeze" the moment it becomes visible again.
  document.addEventListener("visibilitychange", () => { lastTs = 0; });

  const frame = (ts) => {
    if (document.visibilityState === "visible") {
      if (lastTs && (ts - lastTs) >= THRESHOLD_MS) {
        const dur = Math.round(ts - lastTs);
        const key = Math.round(dur / 500) * 500;
        if (!seenFreezes.has(key)) {
          seenFreezes.add(key);
          try {
            chrome.runtime.sendMessage({
              type: "AC_FROZEN",
              url: location.href,
              host: location.hostname,
              freeze_ms: dur,
              ts: Date.now(),
            });
          } catch { /* service worker not ready */ }
        }
      }
      lastTs = ts;
    } else {
      lastTs = 0;                          // hidden: don't accumulate a bogus gap
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Liveness heartbeat for the background's per-tab watchdog.
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({
        type: "AC_ALIVE",
        url: location.href,
        host: location.hostname,
        ts: Date.now(),
      });
    } catch { /* service worker not ready */ }
  }, PING_MS);
})();
