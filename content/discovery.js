/**
 * AitherConnect — FormBridge Discovery (DOM scrape + collector, isolated world).
 *
 * Discovery mode: builds an inventory of what's readable on the EHR so the
 * operator can map fields → logical names and auto-generate the pack's
 * source.fields. Two sources:
 *   - DOM: every input/textarea/select (a stable selector, nearby label, type,
 *     current value) — password/hidden excluded;
 *   - API: flattened JSON key-paths from the page's own fetch/XHR responses,
 *     forwarded by discovery-net.js (MAIN world) over window.postMessage.
 * Batches are sent to the local engine via the service worker. A visible badge
 * shows discovery is on. Registered ONLY when Discovery mode is enabled.
 */
(() => {
  "use strict";
  if (window.__aitherDisco) return;
  window.__aitherDisco = true;

  const apiFields = [];
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__aitherDisco !== "api") return;
    for (const f of (e.data.fields || [])) {
      apiFields.push({ url: e.data.url, path: f.path, sample: f.sample });
    }
  });

  function bestSelector(el) {
    if (el.id) return "#" + el.id;
    if (el.name) return `${el.tagName.toLowerCase()}[name=${el.name}]`;
    const cls = (typeof el.className === "string" && el.className.trim())
      ? "." + el.className.trim().split(/\s+/)[0] : "";
    return el.tagName.toLowerCase() + cls;
  }

  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent.trim().slice(0, 120);
    }
    const wrap = el.closest && el.closest("label");
    if (wrap) return wrap.textContent.trim().slice(0, 120);
    return (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("placeholder"))) || "";
  }

  function scrapeDom() {
    const out = [];
    document.querySelectorAll("input,textarea,select").forEach((el) => {
      const t = (el.type || "").toLowerCase();
      if (t === "password" || t === "hidden") return;
      out.push({
        selector: bestSelector(el),
        label: labelFor(el),
        type: t || el.tagName.toLowerCase(),
        sample: (el.value || el.textContent || "").toString().slice(0, 200),
      });
    });
    return out;
  }

  function flush() {
    const dom = scrapeDom();
    const api = apiFields.splice(0, apiFields.length);
    if (!dom.length && !api.length) return;
    try {
      chrome.runtime.sendMessage({ type: "form-discover", origin: location.origin, dom, api });
    } catch { /* SW asleep — next tick */ }
  }

  const badge = document.createElement("div");
  badge.style.cssText = [
    "position:fixed", "bottom:14px", "left:14px", "z-index:2147483647",
    "font:12px/1.4 'Segoe UI',system-ui,sans-serif", "color:#fff", "background:#7c2d12",
    "border-radius:16px", "padding:6px 12px", "box-shadow:0 2px 8px rgba(0,0,0,.35)",
  ].join(";");
  badge.textContent = "🔎 FormBridge discovering fields";
  document.documentElement.appendChild(badge);

  flush();
  setInterval(flush, 3000);  // re-scrape + drain API fields as the user navigates
})();
