/**
 * AitherConnect — FormBridge API Capture (network interceptor, MAIN world).
 *
 * Runs in the PAGE'S world (not the isolated content-script world) so it can wrap
 * the page's own fetch + XMLHttpRequest. The EHR (e.g., ChiroTouch Cloud) fetches
 * its data with the user's authenticated session; we read those responses, extract
 * the JSON body or RTF text, and hand them to the isolated api-capture script via
 * window.postMessage. We never make our own requests — we only observe the page's.
 *
 * Registered (world: "MAIN", run_at: document_start) ONLY when an API-capture pack
 * is active for this origin. Read-only: it does not modify requests or responses.
 */
(() => {
  "use strict";
  if (window.__aitherApiNet) return;
  window.__aitherApiNet = true;

  const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB cap

  function report(url, body, rtf) {
    try {
      // Validate URL
      const urlStr = String(url || "").slice(0, 500);
      if (!urlStr) return;

      // Send to isolated world via postMessage
      window.postMessage({
        __aitherApi: "response",
        url: urlStr,
        body: body || null,
        rtf: rtf || null,
      }, "*");
    } catch { /* ignore errors */ }
  }

  // Wrap window.fetch
  const _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function (...args) {
      const p = _fetch.apply(this, args);
      p.then((resp) => {
        try {
          // Only capture 2xx responses
          if (resp.status < 200 || resp.status >= 300) return;

          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          const url = (args[0] && typeof args[0] === "object" && args[0].url)
            || (typeof args[0] === "string" ? args[0] : null)
            || resp.url;

          if (ct.includes("application/json")) {
            // Capture JSON response
            resp.clone().text().then((text) => {
              if (text && text.length <= MAX_BODY_SIZE) {
                try {
                  JSON.parse(text);  // Validate JSON
                  report(url, text, null);
                } catch { /* not valid JSON */ }
              }
            }).catch(() => {});
          } else if (ct.includes("text/rtf") || ct.includes("application/rtf")) {
            // Capture RTF response
            resp.clone().text().then((text) => {
              if (text && text.length <= MAX_BODY_SIZE) {
                report(url, null, text);
              }
            }).catch(() => {});
          }
        } catch { /* opaque/cors */ }
      }).catch(() => {});
      return p;
    };
  }

  // Wrap XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aitherUrl = url;
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        // Only capture 2xx responses
        if (this.status < 200 || this.status >= 300) return;

        const ct = (this.getResponseHeader("content-type") || "").toLowerCase();
        if (typeof this.responseText !== "string") return;

        if (ct.includes("application/json")) {
          // Capture JSON response
          if (this.responseText.length <= MAX_BODY_SIZE) {
            try {
              JSON.parse(this.responseText);  // Validate JSON
              report(this.__aitherUrl, this.responseText, null);
            } catch { /* not valid JSON */ }
          }
        } else if (ct.includes("text/rtf") || ct.includes("application/rtf")) {
          // Capture RTF response
          if (this.responseText.length <= MAX_BODY_SIZE) {
            report(this.__aitherUrl, null, this.responseText);
          }
        }
      } catch { /* ignore */ }
    });
    return _send.apply(this, arguments);
  };
})();
