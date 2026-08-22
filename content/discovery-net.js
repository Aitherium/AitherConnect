/**
 * Awconnect — FormBridge Discovery (network interceptor, MAIN world).
 *
 * Runs in the PAGE'S world (not the isolated content-script world) so it can wrap
 * the page's own fetch + XMLHttpRequest. The EHR fetches its data with the user's
 * already-authenticated session; we read those JSON RESPONSES, flatten them to
 * key-paths + sample values, and hand them to the isolated discovery script via
 * window.postMessage. We never make our own requests — we only observe the page's.
 *
 * Registered (world: "MAIN", run_at: document_start) ONLY when Discovery mode is
 * on for this origin. Read-only: it does not modify requests or responses.
 */
(() => {
  "use strict";
  if (window.__aitherDiscoNet) return;
  window.__aitherDiscoNet = true;
  const MAX_FIELDS = 100;

  function flatten(obj, prefix, out, depth) {
    if (depth > 6 || out.length >= MAX_FIELDS || obj == null) return;
    if (Array.isArray(obj)) {
      if (obj.length) flatten(obj[0], prefix + "[]", out, depth + 1);
      return;
    }
    if (typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        if (out.length >= MAX_FIELDS) break;
        flatten(obj[k], prefix ? prefix + "." + k : k, out, depth + 1);
      }
      return;
    }
    const s = String(obj);
    if (s.length > 0 && s.length < 200) out.push({ path: prefix, sample: s });
  }

  function report(url, text) {
    try {
      const fields = [];
      flatten(JSON.parse(text), "", fields, 0);
      if (fields.length) {
        window.postMessage({ __aitherDisco: "api", url: String(url || "").slice(0, 200), fields }, "*");
      }
    } catch { /* not JSON — ignore */ }
  }

  const _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function (...args) {
      const p = _fetch.apply(this, args);
      p.then((resp) => {
        try {
          const ct = resp.headers.get("content-type") || "";
          if (ct.includes("json")) {
            const url = (args[0] && args[0].url) || args[0] || resp.url;
            resp.clone().text().then((t) => report(url, t)).catch(() => {});
          }
        } catch { /* opaque/cors */ }
      }).catch(() => {});
      return p;
    };
  }

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aitherUrl = url;
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (ct.includes("json") && typeof this.responseText === "string") {
          report(this.__aitherUrl, this.responseText);
        }
      } catch { /* ignore */ }
    });
    return _send.apply(this, arguments);
  };
})();
