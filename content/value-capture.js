/**
 * Awconnect — FormBridge value capture (origin-scoped, anchor-gated).
 *
 * Registered dynamically (id "aither-formbridge") ONLY for the origin named in
 * the installed mapping pack — never broad-matched. Captures input/textarea/
 * select VALUES as staff edit them, batches on a debounce, and hands batches
 * to the background service worker, which forwards them to the LOCAL
 * (127.0.0.1) FormBridge engine. Hard rules (06-SECURITY-MODEL):
 *   - batches without a patient-context anchor are buffered, never sent
 *   - input[type=password] + pack `ignore` selectors are never read
 *   - a persistent on-page indicator shows capture state, one click pauses it
 */
(() => {
  "use strict";
  if (window.__aitherFormBridgeActive) return;
  window.__aitherFormBridgeActive = true;

  const DEBOUNCE_MS = 1500;

  let cfg = null;            // { origin, anchor:{selector,key_selector}, ignore:[] }
  let paused = false;
  let pending = new Map();   // fieldPath -> value (current debounce window)
  let buffered = new Map();  // captured-before-anchor fields
  let lastAnchorKey = null;  // last patient context we sent under (wrong-patient guard)
  let timer = null;
  let indicator = null;

  // ── Config ──────────────────────────────────────────────────────────────

  chrome.storage.local.get("aither-formbridge-pack", (data) => {
    cfg = data && data["aither-formbridge-pack"];
    if (!cfg || !cfg.anchor || !cfg.anchor.selector) {
      // No pack configured — do nothing (registration shouldn't have happened,
      // but never capture without an explicit pack).
      return;
    }
    attach();
    mountIndicator();
    reportSelectorsSeen();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["aither-formbridge-pack"]) {
      cfg = changes["aither-formbridge-pack"].newValue || null;
    }
  });

  // ── Capture ─────────────────────────────────────────────────────────────

  function isDenied(el) {
    if (!el || !el.matches) return true;
    if (el.type === "password") return true;
    for (const sel of (cfg.ignore || [])) {
      try { if (el.matches(sel)) return true; } catch { /* bad selector in pack */ }
    }
    return false;
  }

  // ── Tabbed single editors (the ChiroTouch Chart Notes shape) ────────────
  // S/O/A/P tabs over ONE text field: blur doesn't fire between tabs, so we
  // flush on tab-click (capture phase, before the app swaps content) and
  // attribute the text to the ACTIVE tab's logical name via the pack map.
  // Pack config:
  //   tabbed_editors: [{ editor: "#note", tabs: ".soap-tab",
  //     active: ".soap-tab.active", map: { "Subjective": "soap.subjective", ... } }]

  function editorValue(el) {
    if (!el) return null;
    if (el.value != null && el.tagName !== "DIV") return String(el.value);
    return el.textContent != null ? String(el.textContent) : null;
  }

  function tabbedEntryFor(el) {
    for (const entry of (cfg.tabbed_editors || [])) {
      try { if (el.matches && el.matches(entry.editor)) return entry; } catch { /* bad selector */ }
    }
    return null;
  }

  function flushTabbedEditor(entry) {
    const activeTab = document.querySelector(entry.active);
    const label = activeTab ? activeTab.textContent.trim() : "";
    const logical = (entry.map || {})[label];
    if (!logical) return;                       // unmapped tab — never guess
    const editorEl = document.querySelector(entry.editor);
    if (!editorEl || isDenied(editorEl)) return;
    const val = editorValue(editorEl);
    if (val == null) return;
    pending.set(logical, val);                  // logical name — passes ingest verbatim
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function onTabClick(ev) {
    if (paused || !cfg) return;
    const t = ev.target;
    if (!t || !t.matches) return;
    for (const entry of (cfg.tabbed_editors || [])) {
      let tabEl = null;
      try {
        tabEl = t.closest ? t.closest(entry.tabs) : (t.matches(entry.tabs) ? t : null);
      } catch { /* bad selector */ }
      // Flush the OUTGOING tab's content before the app swaps it.
      if (tabEl) flushTabbedEditor(entry);
    }
  }

  function fieldPath(el) {
    // Stable-ish identity for the mapper: id > name > a positional fallback.
    if (el.id) return `#${el.id}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name=${el.name}]`;
    const all = Array.from(document.querySelectorAll(el.tagName));
    return `${el.tagName.toLowerCase()}:nth-of-type(${all.indexOf(el) + 1})`;
  }

  function anchor() {
    const nameEl = document.querySelector(cfg.anchor.selector);
    const keyEl = cfg.anchor.key_selector ? document.querySelector(cfg.anchor.key_selector) : null;
    const displayName = nameEl ? nameEl.textContent.trim() : "";
    const key = keyEl ? keyEl.textContent.trim() : displayName;
    return key ? { patientKey: key, displayName } : null;
  }

  function onEdit(ev) {
    if (paused || !cfg) return;
    const el = ev.target;
    if (!el) return;
    // Tabbed editors capture under the ACTIVE tab's logical name, whatever
    // the element type (textarea or contenteditable div).
    const tabbed = el.matches ? tabbedEntryFor(el) : null;
    if (tabbed) {
      flushTabbedEditor(tabbed);
      return;
    }
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
    if (isDenied(el)) return;
    pending.set(fieldPath(el), el.value != null ? String(el.value) : "");
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    timer = null;
    if (!pending.size && !buffered.size) return;
    const a = anchor();
    if (!a) {
      // No patient context on screen — buffer, never send unanchored data.
      for (const [k, v] of pending) buffered.set(k, v);
      pending = new Map();
      setIndicatorState("buffering");
      return;
    }
    // Wrong-patient guard (06-SECURITY-MODEL #1 hazard): no-anchor data was
    // buffered without knowing the patient. If the patient context CHANGED since
    // we last sent, that buffered data cannot be safely attributed to THIS
    // patient — drop it rather than bleed it across records.
    if (buffered.size && lastAnchorKey !== null && a.patientKey !== lastAnchorKey) {
      buffered = new Map();
    }
    lastAnchorKey = a.patientKey;
    const fields = [];
    for (const [k, v] of buffered) fields.push({ path: k, value: v });
    for (const [k, v] of pending) fields.push({ path: k, value: v });
    buffered = new Map();
    pending = new Map();

    chrome.runtime.sendMessage({
      type: "form-capture",
      batch: {
        patient_key: a.patientKey,
        display_name: a.displayName,
        source_origin: location.origin,
        fields,
      },
    }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        setIndicatorState("queued");   // SW queues + retries while engine is down
      } else {
        setIndicatorState("on");
      }
    });
  }

  function attach() {
    // focusout covers typed fields on blur; change covers selects/checkboxes.
    document.addEventListener("focusout", onEdit, true);
    document.addEventListener("change", onEdit, true);
    // Tab clicks flush the outgoing tab's editor content (capture phase runs
    // before the app's own handler swaps the text).
    if ((cfg.tabbed_editors || []).length) {
      document.addEventListener("click", onTabClick, true);
    }
  }

  // Self-check support: report which of the pack's expected selectors exist
  // on this page so the engine can flag selector drift after EHR updates.
  function reportSelectorsSeen() {
    const expected = [];
    for (const probe of (cfg.self_check || [])) {
      for (const sel of (probe.expect || [])) expected.push(sel);
    }
    if (!expected.length) return;
    const seen = expected.filter((sel) => {
      try { return !!document.querySelector(sel); } catch { return false; }
    });
    chrome.runtime.sendMessage({ type: "form-capture-selfcheck", seen_selectors: seen });
  }

  // ── Indicator (always-visible capture state + pause) ────────────────────

  function mountIndicator() {
    indicator = document.createElement("div");
    indicator.id = "aither-formbridge-indicator";
    indicator.style.cssText = [
      "position:fixed", "bottom:14px", "right:14px", "z-index:2147483647",
      "font:12px/1.4 'Segoe UI',system-ui,sans-serif", "color:#fff",
      "background:#102a54", "border-radius:16px", "padding:6px 12px",
      "box-shadow:0 2px 8px rgba(0,0,0,.35)", "cursor:pointer",
      "display:flex", "align-items:center", "gap:6px", "user-select:none",
    ].join(";");
    indicator.title = "AitherFormBridge — click to pause/resume capture on this site";
    indicator.addEventListener("click", () => {
      paused = !paused;
      if (paused) { pending = new Map(); if (timer) clearTimeout(timer); }
      setIndicatorState(paused ? "paused" : "on");
    });
    document.documentElement.appendChild(indicator);
    setIndicatorState("on");
  }

  function setIndicatorState(state) {
    if (!indicator) return;
    const dot = (color) => `<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>`;
    const states = {
      on:        { html: `${dot("#22c55e")} FormBridge capturing`, bg: "#102a54" },
      paused:    { html: `${dot("#94a3b8")} FormBridge paused`,    bg: "#334155" },
      buffering: { html: `${dot("#eab308")} Waiting for patient`,  bg: "#102a54" },
      queued:    { html: `${dot("#eab308")} Engine offline — queued`, bg: "#7c2d12" },
    };
    const s = states[state] || states.on;
    indicator.innerHTML = s.html;
    indicator.style.background = s.bg;
  }
})();
