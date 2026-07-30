/**
 * AitherConnect — CTA autofill engine (generic, adapter-driven).
 *
 * Runs on a civic form page the user was linked to. If the URL carries an
 * `#aither_cta=<base64 json>` fragment (put there by the AitherDiscord bot), it
 * decodes the user's own drafted values, resolves the site ADAPTER (declarative
 * JSON), waits for the form to render (SPA-safe), and fills it BY ROLE against
 * the live page — comment body, email, and (best effort) the "I am an…" identity.
 * Then it STOPS.
 *
 * HARD RULES:
 *   - NEVER fill password fields
 *   - NEVER click the adapter's submit element or call form.submit()
 *   - NEVER touch the CAPTCHA
 *   - The engine only fills form fields + informs the user
 *
 * Payload: { v:1, c:"<comment>", e:"<email>", id:"individual|organization|anonymous" }
 */
(() => {
  "use strict";
  if (window.__aitherCtaEngine) return;
  window.__aitherCtaEngine = true;

  const m = location.hash.match(/aither_cta=([^&]+)/);
  if (!m) return; // no CTA payload on this page — do nothing

  let data;
  try {
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    data = JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return; // malformed payload — bail silently
  }

  // Strip the fragment from the URL + history so the draft isn't left in the bar.
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    /* non-fatal */
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Fetch adapters from the bundled index.json, then load each adapter.
   * Merge in any fleet-served adapters from chrome.storage.local.
   * Returns the full list of adapters, or [] on failure.
   */
  async function loadAdapters() {
    const adapters = [];
    try {
      const indexUrl = chrome.runtime.getURL("adapters/index.json");
      const indexResp = await fetch(indexUrl);
      if (!indexResp.ok) return adapters;
      const index = await indexResp.json();
      if (!Array.isArray(index.adapters)) return adapters;

      // Load each bundled adapter
      for (const id of index.adapters) {
        try {
          const url = chrome.runtime.getURL(`adapters/${id}.json`);
          const resp = await fetch(url);
          if (resp.ok) {
            const adapter = await resp.json();
            adapters.push(adapter);
          }
        } catch {
          /* adapter fetch failed — skip */
        }
      }
    } catch {
      /* index fetch failed */
    }

    // Merge fleet-served adapters from storage
    try {
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get("aither-cta-adapters", (data) => {
          resolve(data && data["aither-cta-adapters"] ? data["aither-cta-adapters"] : []);
        });
      });
      if (Array.isArray(stored)) {
        adapters.push(...stored);
      }
    } catch {
      /* storage access failed */
    }

    return adapters;
  }

  /**
   * Simple match-pattern test: returns true if url matches the pattern.
   * Pattern supports * wildcard for any characters.
   */
  function matchPattern(url, pattern) {
    const re = new RegExp(
      "^" +
        pattern
          .split("*")
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$"
    );
    return re.test(url);
  }

  /**
   * Find the matching adapter for this page's URL.
   * Returns the adapter object, or a DEFAULT adapter if none match.
   */
  async function resolveAdapter() {
    const adapters = await loadAdapters();
    const url = location.href;

    for (const adapter of adapters) {
      if (!Array.isArray(adapter.match)) continue;
      for (const pattern of adapter.match) {
        if (matchPattern(url, pattern)) {
          return adapter;
        }
      }
    }

    // Fallback: built-in DEFAULT adapter (best-effort comment + email)
    return {
      id: "_default",
      version: 1,
      name: "Default (best-effort)",
      match: ["*"],
      waitFor: "textarea[placeholder*='comment' i]",
      roles: {
        comment_body: [
          "textarea[placeholder*='comment' i]",
          "textarea[aria-label*='comment' i]",
          "textarea[name*='comment' i]",
          "textarea",
        ],
        email: ["input[type='email']", "input[placeholder*='email' i]", "input[name*='email' i]"],
      },
      identity: {
        kind: "text-cards",
        options: {
          individual: "An Individual",
          organization: "An Organization",
          anonymous: "Anonymous",
        },
      },
    };
  }

  /**
   * Find the first visible, non-password element matching any of the selectors.
   */
  function findField(selectors) {
    for (const sel of selectors || []) {
      let el;
      try {
        el = document.querySelector(sel);
      } catch {
        continue;
      }
      if (el && el.type !== "password" && el.offsetParent !== null) return el;
    }
    return null;
  }

  /**
   * Set the value of a field, dispatching input/change/blur events
   * so React/Vue/etc. register the change.
   */
  function setValue(el, value) {
    if (!el) return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  /**
   * Click the identity card (text card selector).
   * Matches text first directly on an element's own text nodes, then on a descendant leaf.
   * Clicks the nearest clickable ancestor (button/[role=button]/label/div).
   * Best-effort — never throw.
   */
  function clickIdentity(adapter, id) {
    const labels = adapter.identity && adapter.identity.options ? adapter.identity.options : {};
    const label = labels[id];
    if (!label) return false;

    try {
      // Find the SMALLEST element whose normalized text contains the label. An
      // exact leaf wins immediately; otherwise the shortest container (the card
      // title, not the whole card which also holds the description) is used.
      // Whitespace is normalized so nbsp/newlines don't defeat the match, and
      // the element set is broad (headings/p included) since card titles are
      // often not span/div. Clicking a descendant bubbles to the card's handler.
      const nodes = Array.from(
        document.querySelectorAll("div,button,label,span,a,p,h1,h2,h3,h4,h5,h6")
      );
      let target = null;
      let bestLen = Infinity;
      for (const n of nodes) {
        const text = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (text === label) {
          target = n;
          break;
        }
        if (text.includes(label) && text.length < bestLen) {
          target = n;
          bestLen = text.length;
        }
      }

      if (target) {
        const clickable = target.closest("button,[role=button],label") || target;
        clickable.click();
        return true;
      }
    } catch {
      /* any error: best-effort, don't throw */
    }
    return false;
  }

  /**
   * Show or update a fixed top banner.
   */
  function banner(text) {
    let el = document.getElementById("aither-cta-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "aither-cta-banner";
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1e3a8a;color:#fff;" +
        "padding:12px 16px;font:13px system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
  }

  /**
   * Main engine: resolve adapter, wait for form, fill by role.
   */
  async function run() {
    banner("AitherConnect is filling your comment…");

    const adapter = await resolveAdapter();
    const roles = adapter.roles || {};
    const waitSelector = adapter.waitFor || (roles.comment_body && roles.comment_body[0]);

    // Wait for the form to render (SPA hydration). Poll up to ~20s.
    let commentField = null;
    for (let i = 0; i < 40; i++) {
      if (waitSelector) {
        try {
          commentField = document.querySelector(waitSelector);
        } catch {
          /* bad selector */
        }
      }
      if (commentField) break;
      await sleep(500);
    }

    if (!commentField) {
      banner("AitherConnect couldn't find the comment box — paste your draft manually.");
      return;
    }

    // Fill by role: comment_body, email
    if (data.c && roles.comment_body) {
      const field = findField(roles.comment_body);
      if (field) setValue(field, data.c);
    }

    if (data.e && roles.email) {
      const field = findField(roles.email);
      if (field) setValue(field, data.e);
    }

    // Click identity card (best-effort)
    if (data.id && adapter.identity && adapter.identity.kind === "text-cards") {
      clickIdentity(adapter, data.id);
    }

    banner(
      "AitherConnect filled your comment. Review it, pick your identity if needed, " +
        "solve the CAPTCHA, and click Submit yourself — nothing has been sent."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
