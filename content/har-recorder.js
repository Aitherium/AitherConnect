/**
 * AitherConnect — HAR Session Recorder (MAIN world).
 *
 * Records the page's own fetch() + XMLHttpRequest traffic into HAR 1.2 entries
 * so a customer can capture a real working session of their web app and hand it
 * to Aitherium for building automations/integrations. Runs in the PAGE's world
 * so it can wrap the page's networking; it is READ-ONLY — it never issues its own
 * requests and never alters the page's requests or responses.
 *
 * This is a CONSENTED capture: it is injected only after the user explicitly
 * starts a capture (background.js → chrome.scripting), shows a visible banner
 * the whole time, and stops when the user stops. It captures XHR/fetch calls
 * (the API traffic that matters for integrations) — NOT a full browser HAR
 * (no document/image/font loads, no timings beyond wall-clock), which would
 * require the chrome.debugger API and its alarming "started debugging" banner.
 *
 * SECRET SAFETY: sensitive request/response headers (Authorization, Cookie,
 * Set-Cookie, api keys, tokens) are REDACTED to "[REDACTED]" before an entry
 * leaves the page. We record that the header was PRESENT and its name, never its
 * secret value. Redaction can be disabled by the user for their own workspace
 * uploads via the __aitherHarConfig.redact flag passed on start.
 *
 * Entries are streamed one-at-a-time to the isolated relay (har-relay.js) via
 * window.postMessage, which forwards them to the service worker. Streaming (vs
 * buffering in-page) means entries survive same-capture navigations — the page
 * context resets on navigation but the accumulated log lives in the SW.
 */
(() => {
  "use strict";
  if (window.__aitherHarRecorder) return;
  window.__aitherHarRecorder = true;

  const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB per request/response body cap
  const cfg = window.__aitherHarConfig || {};
  const REDACT = cfg.redact !== false; // default ON

  // Header names whose VALUES are secrets — redacted unless the user opts out.
  const SECRET_HEADERS = new Set([
    "authorization", "cookie", "set-cookie", "proxy-authorization",
    "x-api-key", "x-auth-token", "x-access-token", "x-csrf-token",
    "x-xsrf-token", "api-key", "authentication", "x-amz-security-token",
  ]);

  function redactHeaders(pairs) {
    return pairs.map(({ name, value }) => {
      if (REDACT && SECRET_HEADERS.has(String(name).toLowerCase())) {
        return { name, value: "[REDACTED]" };
      }
      return { name, value: String(value ?? "") };
    });
  }

  function headersToPairs(h) {
    const out = [];
    try {
      if (!h) return out;
      if (typeof h.forEach === "function") {
        h.forEach((value, name) => out.push({ name, value }));
      } else if (Array.isArray(h)) {
        for (const [name, value] of h) out.push({ name, value });
      } else if (typeof h === "object") {
        for (const name of Object.keys(h)) out.push({ name, value: h[name] });
      }
    } catch { /* best-effort */ }
    return out;
  }

  function parseRawHeaderString(raw) {
    const out = [];
    if (!raw) return out;
    for (const line of String(raw).trim().split(/[\r\n]+/)) {
      const i = line.indexOf(":");
      if (i > 0) out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
    }
    return out;
  }

  function queryStringFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      return [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
    } catch { return []; }
  }

  function capBody(text) {
    if (typeof text !== "string") return { text: "", truncated: false };
    if (text.length <= MAX_BODY_BYTES) return { text, truncated: false };
    return { text: text.slice(0, MAX_BODY_BYTES), truncated: true };
  }

  function emit(entry) {
    try {
      window.postMessage({ __aitherHar: "entry", entry }, "*");
    } catch { /* drop on serialization failure */ }
  }

  function nowIso() {
    // Deliberately using Date here — this is the browser page world, not the
    // sandboxed workflow VM; wall-clock timestamps are exactly what HAR wants.
    return new Date().toISOString();
  }

  // ── fetch wrapper ─────────────────────────────────────────────────────────
  const _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function (...args) {
      const started = nowIso();
      const t0 = performance.now();
      const input = args[0];
      const init = args[1] || {};
      const method = (init.method || (input && input.method) || "GET").toUpperCase();
      const url = (input && typeof input === "object" && input.url)
        || (typeof input === "string" ? input : String(input || ""));
      const reqHeaders = headersToPairs(init.headers || (input && input.headers));
      let postData = null;
      if (init.body && typeof init.body === "string") {
        const { text } = capBody(init.body);
        postData = { mimeType: "application/octet-stream", text };
      }

      const p = _fetch.apply(this, args);
      p.then((resp) => {
        try {
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          const respHeaders = headersToPairs(resp.headers);
          resp.clone().text().then((bodyText) => {
            const { text, truncated } = capBody(bodyText);
            emit({
              startedDateTime: started,
              time: Math.round(performance.now() - t0),
              request: {
                method, url: String(url).slice(0, 2000),
                httpVersion: "HTTP/1.1",
                headers: redactHeaders(reqHeaders),
                queryString: queryStringFromUrl(url),
                postData: postData ? { ...postData } : undefined,
                headersSize: -1, bodySize: postData ? postData.text.length : 0,
              },
              response: {
                status: resp.status, statusText: resp.statusText || "",
                httpVersion: "HTTP/1.1",
                headers: redactHeaders(respHeaders),
                content: {
                  size: text.length, mimeType: ct || "application/octet-stream",
                  text, comment: truncated ? "truncated at 2MB" : undefined,
                },
                redirectURL: resp.headers.get("location") || "",
                headersSize: -1, bodySize: text.length,
              },
              cache: {},
              timings: { send: 0, wait: Math.round(performance.now() - t0), receive: 0 },
              _resourceType: "fetch",
            });
          }).catch(() => {});
        } catch { /* opaque/cors — skip */ }
      }).catch(() => {});
      return p;
    };
  }

  // ── XMLHttpRequest wrapper ────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aitherHar = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
      reqHeaders: [],
      started: nowIso(),
      t0: performance.now(),
    };
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__aitherHar) this.__aitherHar.reqHeaders.push({ name, value });
    } catch { /* ignore */ }
    return _setHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__aitherHar;
    if (meta && typeof body === "string") {
      meta.postData = capBody(body).text;
    }
    this.addEventListener("load", () => {
      if (!meta) return;
      try {
        const respHeaders = parseRawHeaderString(this.getAllResponseHeaders());
        const ct = (this.getResponseHeader("content-type") || "").toLowerCase();
        let bodyText = "";
        try { bodyText = typeof this.responseText === "string" ? this.responseText : ""; } catch { bodyText = ""; }
        const { text, truncated } = capBody(bodyText);
        emit({
          startedDateTime: meta.started,
          time: Math.round(performance.now() - meta.t0),
          request: {
            method: meta.method, url: meta.url.slice(0, 2000),
            httpVersion: "HTTP/1.1",
            headers: redactHeaders(meta.reqHeaders),
            queryString: queryStringFromUrl(meta.url),
            postData: meta.postData ? { mimeType: "application/octet-stream", text: meta.postData } : undefined,
            headersSize: -1, bodySize: meta.postData ? meta.postData.length : 0,
          },
          response: {
            status: this.status, statusText: this.statusText || "",
            httpVersion: "HTTP/1.1",
            headers: redactHeaders(respHeaders),
            content: {
              size: text.length, mimeType: ct || "application/octet-stream",
              text, comment: truncated ? "truncated at 2MB" : undefined,
            },
            redirectURL: "", headersSize: -1, bodySize: text.length,
          },
          cache: {},
          timings: { send: 0, wait: Math.round(performance.now() - meta.t0), receive: 0 },
          _resourceType: "xhr",
        });
      } catch { /* ignore */ }
    });
    return _send.apply(this, arguments);
  };

  // ── Visible consent banner (present the entire time capture is active) ──────
  try {
    const banner = document.createElement("div");
    banner.id = "__aither-har-banner";
    banner.style.cssText = [
      "position:fixed", "bottom:14px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483647", "font:12px/1.4 'Segoe UI',system-ui,sans-serif",
      "color:#fff", "background:#b45309", "border-radius:16px", "padding:7px 14px",
      "box-shadow:0 2px 10px rgba(0,0,0,.4)", "pointer-events:none",
    ].join(";");
    banner.textContent = REDACT
      ? "● AitherConnect is recording API calls on this tab (secrets redacted)"
      : "● AitherConnect is recording API calls on this tab (RAW — secrets included)";
    const mount = () => { if (document.body) document.body.appendChild(banner); };
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  } catch { /* no DOM yet */ }
})();
