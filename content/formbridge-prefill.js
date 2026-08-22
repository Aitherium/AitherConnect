/**
 * Awconnect — FormBridge prefill (origin-scoped, no-submit).
 *
 * Fills a web form from a pre-fill package WITHOUT clicking submit, WITHOUT
 * touching password fields, WITHOUT interacting with CAPTCHAs. The user reviews
 * the prefilled form and clicks Submit themselves.
 *
 * Hard rules (NEVER violated):
 *   - Prefill is origin-scoped: origin in pkg MUST match location.origin
 *   - Never fill input[type=password] — only text/email/tel/etc. + textarea/select
 *   - Never click submit button or call form.submit()
 *   - Never interact with CAPTCHA (only highlight it if present)
 *   - On-page banner warns if CAPTCHA is detected so user completes it manually
 *   - Reads pkg from window.__aitherPrefillPkg (set by background before injection)
 *     or from chrome.storage.local key aither-cta-prefill:<origin>
 *   - Dispatches 'input' + 'change' events so React/Vue register field changes
 */
(() => {
  "use strict";
  if (window.__aitherPrefillActive) return;
  window.__aitherPrefillActive = true;

  let pkg = null;
  let banner = null;

  // Role → candidate selectors, tried IN the live (hydrated) page when the
  // package's server-provided selector misses. Server-side scouting cannot see
  // JS-SPA forms (e.g. regulations.gov), so role heuristics are the real path.
  const ROLE_FALLBACKS = {
    comment_body: [
      'textarea[placeholder*="comment" i]',
      'textarea[aria-label*="comment" i]',
      'textarea[name*="comment" i]',
      "textarea",
    ],
    email: ['input[type="email"]', 'input[placeholder*="email" i]', 'input[name*="email" i]'],
    subject: ['input[name*="subject" i]', 'input[placeholder*="subject" i]'],
    first_name: ['input[name*="first" i]', 'input[placeholder*="first" i]'],
    last_name: ['input[name*="last" i]', 'input[placeholder*="last" i]'],
    full_name: ['input[name*="name" i]', 'input[placeholder*="name" i]'],
    zip: ['input[name*="zip" i]', 'input[name*="postal" i]', 'input[placeholder*="zip" i]'],
    phone: ['input[type="tel"]', 'input[name*="phone" i]'],
    organization: ['input[name*="organization" i]', 'input[name*="company" i]'],
  };

  // Resolve a field to a page element: the package selector first, then role
  // heuristics. Skips password fields entirely.
  function resolveField(field) {
    const tryList = [];
    if (field.selector) tryList.push(field.selector);
    for (const s of ROLE_FALLBACKS[field.role] || []) tryList.push(s);
    for (const sel of tryList) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        continue;
      }
      if (el && el.type !== "password") return el;
    }
    return null;
  }

  /**
   * Main entry point: apply the prefill package to the current page.
   * Called by background.js after injection, or on-demand from chrome.storage.
   */
  window.applyPrefill = async function (prefillPackage) {
    if (!prefillPackage) return;
    pkg = prefillPackage;

    // Origin-scoped validation: ALWAYS CHECK.
    if (location.origin !== pkg.origin) {
      console.warn(
        "[Awconnect FormBridge] Origin mismatch: page is",
        location.origin,
        "but package is for",
        pkg.origin,
        "— refusing prefill for security."
      );
      return;
    }

    // Fill fields: resolve each by selector-or-role in the LIVE page, set value.
    for (const field of pkg.fields || []) {
      try {
        const el = resolveField(field);
        if (!el) continue; // no matching field on this page

        // resolveField already excludes password fields; belt-and-suspenders:
        if (el.type === "password") continue;

        if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.tagName === "INPUT") {
          el.value = field.value || "";
          dispatchEvents(el);
        }
      } catch (e) {
        console.debug(
          "[Awconnect FormBridge] Error filling field",
          field.role,
          ":",
          e.message
        );
      }
    }

    // Show the banner with prefill confirmation + CAPTCHA warning if needed.
    mountBanner();

    // If a submit button hint is provided, find and highlight it (visual hint only).
    if (pkg.submit_hint) {
      try {
        const submitEl = document.querySelector(pkg.submit_hint);
        if (submitEl) {
          highlightSubmitButton(submitEl);
        }
      } catch (e) {
        console.debug("[Awconnect FormBridge] Error highlighting submit button:", e.message);
      }
    }
  };

  /**
   * Dispatch input and change events so React/Vue frameworks detect the value change.
   */
  function dispatchEvents(el) {
    if (!el) return;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Some frameworks (e.g., Angular) also listen to blur
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /**
   * Highlight the submit button with a visual outline and scroll to it.
   * NEVER click it.
   */
  function highlightSubmitButton(submitEl) {
    // Add a noticeable outline
    submitEl.style.outline = "3px solid #ff6b6b";
    submitEl.style.outlineOffset = "2px";

    // Scroll into view
    try {
      submitEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Fallback for older browsers or edge cases
      submitEl.scrollIntoView();
    }
  }

  /**
   * Mount a persistent banner showing prefill status.
   */
  function mountBanner() {
    if (banner) return; // Already mounted

    banner = document.createElement("div");
    banner.id = "aither-formbridge-prefill-banner";
    banner.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "background:#1e3a8a",
      "color:#fff",
      "padding:12px 16px",
      "font:13px/1.5 'Segoe UI',system-ui,sans-serif",
      "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:16px",
      "user-select:none",
    ].join(";");

    const messageEl = document.createElement("div");
    messageEl.style.flex = "1";
    const bannerText = pkg.banner || "AitherOS pre-filled this form. Review and submit yourself.";
    messageEl.textContent = bannerText;

    // If a CAPTCHA is detected, add a warning
    if (pkg.captcha_present) {
      const captchaWarning = document.createElement("div");
      captchaWarning.style.cssText = "margin-top:6px;font-size:12px;opacity:0.9";
      captchaWarning.textContent =
        "⚠ This form has a CAPTCHA — complete it, then click Submit.";
      messageEl.appendChild(captchaWarning);
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.type = "button";
    closeBtn.style.cssText = [
      "background:none",
      "border:none",
      "color:#fff",
      "font:16px/1 system-ui",
      "cursor:pointer",
      "padding:0",
      "flex-shrink:0",
    ].join(";");
    closeBtn.onclick = () => {
      if (banner) banner.remove();
      banner = null;
    };

    banner.appendChild(messageEl);
    banner.appendChild(closeBtn);
    document.documentElement.appendChild(banner);
  }

  // ── Load package on startup ──────────────────────────────────────────
  // If window.__aitherPrefillPkg is set by background.js, use it immediately.
  // Otherwise, try to load from chrome.storage.local key aither-cta-prefill:<origin>.

  if (window.__aitherPrefillPkg) {
    window.applyPrefill(window.__aitherPrefillPkg);
  } else {
    // Try to load from storage (legacy fallback or deferred injection)
    try {
      chrome.storage.local.get(
        `aither-cta-prefill:${location.origin}`,
        (data) => {
          const storagePkg = data && data[`aither-cta-prefill:${location.origin}`];
          if (storagePkg) {
            window.applyPrefill(storagePkg);
          }
        }
      );
    } catch (e) {
      console.debug("[Awconnect FormBridge] Storage load failed:", e.message);
    }
  }
})();
