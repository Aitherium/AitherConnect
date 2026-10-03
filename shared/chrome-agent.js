/**
 * chrome-agent: an agent drives the owner's OWN Chrome, one APPROVED tab at a time.
 *
 * Owner, 2026-10-03: "Yes, but ask each time". The desk's agent tools (awdesk
 * chrome_* MCP tools) queue requests on the desk; this module long-polls them
 * (DeskBridge.nextChromeRequest) and answers each one. It is the side that holds
 * the rule, because it is the side the owner's signed-in sessions live in:
 *
 *   - chrome_tabs lists tabs (id, title, host, approved) -- no page content.
 *   - chrome_request_tab raises a notification ON THE OWNER'S SCREEN: "Allow on
 *     this tab" / "Deny". Nothing else grants a tab.
 *   - every page action on a tab the owner has not approved is REFUSED. An
 *     approval is for one tab AND one site: navigating that tab to another origin
 *     (or closing it) drops it, so an approval for a search page is never an
 *     approval for the bank the agent clicks through to.
 *   - an approved tab wears an "AI" badge on the awconnect icon while active.
 *
 * Approvals live in chrome.storage.session: gone when the browser closes.
 */

(() => {
  "use strict";

  const APPROVALS_KEY = "chromeAgentApprovals";
  const ASK_TIMEOUT_MS = 60_000;
  const PAGE_ACTIONS = ["read", "snapshot", "click", "type", "select", "check"];
  const deps = {
    chrome: typeof chrome !== "undefined" ? chrome : null,
    bridge: () => (typeof self !== "undefined" ? self.DeskBridge : null),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  function originOf(url) {
    try {
      const u = new URL(String(url || ""));
      return u.protocol === "http:" || u.protocol === "https:" ? u.origin : "";
    } catch {
      return "";
    }
  }

  async function approvals() {
    const got = await deps.chrome.storage.session.get(APPROVALS_KEY);
    return (got && got[APPROVALS_KEY]) || {};
  }

  async function setApprovals(map) {
    await deps.chrome.storage.session.set({ [APPROVALS_KEY]: map });
  }

  async function badge(tabId, on) {
    try {
      await deps.chrome.action.setBadgeText({ tabId, text: on ? "AI" : "" });
      if (on) await deps.chrome.action.setBadgeBackgroundColor({ tabId, color: "#7c3aed" });
    } catch { /* a closed tab has no badge to set */ }
  }

  async function revoke(tabId) {
    const map = await approvals();
    if (!(tabId in map)) return;
    delete map[tabId];
    await setApprovals(map);
    await badge(tabId, false);
  }

  /** The tab, if the owner approved it on the site it is on NOW. */
  async function approvedTab(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id) || id < 0) return { ok: false, error: "tab must be a tab id from chrome_tabs" };
    let tab = null;
    try { tab = await deps.chrome.tabs.get(id); } catch { tab = null; }
    if (!tab) return { ok: false, error: `no tab ${id}` };
    const origin = originOf(tab.url);
    const map = await approvals();
    if (!origin || map[id] !== origin) {
      const moved = map[id] && map[id] !== origin ? ` (it was approved on ${map[id]}, and has since changed site)` : "";
      return { ok: false, refused: true,
        error: `REFUSED: the owner has not approved tab ${id}${moved}. Call chrome_request_tab and wait for their answer.` };
    }
    return { ok: true, tab };
  }

  async function listTabs() {
    const map = await approvals();
    const tabs = await deps.chrome.tabs.query({});
    return {
      ok: true,
      tabs: tabs.filter((t) => originOf(t.url)).map((t) => ({
        id: t.id,
        title: String(t.title || "").slice(0, 120),
        host: new URL(t.url).host,
        active: Boolean(t.active),
        approved: map[t.id] === originOf(t.url),
      })),
    };
  }

  /** Ask the owner on their screen. Resolves true only on "Allow on this tab". */
  function askOwner(tab, reason) {
    const c = deps.chrome;
    const nid = `chrome-agent-${tab.id}-${Date.now()}`;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        c.notifications.onButtonClicked.removeListener(onButton);
        c.notifications.onClosed.removeListener(onClosed);
        clearTimeout(timer);
        c.notifications.clear(nid, () => {});
        resolve(value);
      };
      const onButton = (id, index) => { if (id === nid) finish(index === 0); };
      const onClosed = (id) => { if (id === nid) finish(false); };
      const timer = setTimeout(() => finish(false), ASK_TIMEOUT_MS);
      c.notifications.onButtonClicked.addListener(onButton);
      c.notifications.onClosed.addListener(onClosed);
      c.notifications.create(nid, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "An agent wants to use one of your tabs",
        message: `${new URL(tab.url).host}: ${String(reason || "no reason given").slice(0, 160)}`,
        buttons: [{ title: "Allow on this tab" }, { title: "Deny" }],
        requireInteraction: true,
        priority: 2,
      }, () => {});
    });
  }

  async function requestTab(tabId, reason) {
    const id = Number(tabId);
    let tab = null;
    try { tab = await deps.chrome.tabs.get(id); } catch { tab = null; }
    if (!tab) return { ok: false, error: `no tab ${id}` };
    const origin = originOf(tab.url);
    if (!origin) return { ok: false, error: "only http(s) tabs can be driven" };
    const map = await approvals();
    if (map[id] === origin) return { ok: true, approved: true, already: true };
    const allowed = await askOwner(tab, reason);
    if (!allowed) return { ok: false, approved: false, error: "the owner did not allow it (denied, dismissed or no answer in 60 s)" };
    map[id] = origin;
    await setApprovals(map);
    await badge(id, true);
    return { ok: true, approved: true, host: new URL(tab.url).host };
  }

  /**
   * Runs IN THE PAGE (an isolated world): must be self-contained, so it is
   * serialized by chrome.scripting. Refs live on the isolated window and die
   * with a navigation, like the desk's browser_snapshot refs.
   */
  function pageAction(action, args) {
    const clean = (t, n = 120) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, n);
    const labelOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && clean(aria)) return clean(aria);
      if (el.id) {
        try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && clean(l.textContent)) return clean(l.textContent); }
        catch (e) { /* an id CSS.escape cannot handle */ }
      }
      const wrap = el.closest("label");
      if (wrap) {
        const copy = wrap.cloneNode(true);
        copy.querySelectorAll("select, textarea, input, button, option").forEach((n) => n.remove());
        if (clean(copy.textContent)) return clean(copy.textContent);
      }
      if (el.placeholder) return clean(el.placeholder);
      const t = clean(el.innerText || el.value);
      return t || clean(el.title || el.name);
    };
    if (action === "read") {
      return { ok: true, url: location.href, title: document.title,
        text: (document.body ? document.body.innerText : "").slice(0, 20000) };
    }
    if (action === "snapshot") {
      const refs = new Map();
      window.__aitherChromeRefs = refs;
      const SEL = 'input:not([type=hidden]), textarea, select, button, a[href], [role=button], [role=link], '
        + '[role=checkbox], [role=radio], [role=switch], [contenteditable="true"]';
      const out = [];
      for (const el of document.querySelectorAll(SEL)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || out.length >= 200) continue;
        const ref = "e" + (out.length + 1);
        refs.set(ref, el);
        const tag = el.tagName.toLowerCase();
        const item = { ref, tag, label: labelOf(el) };
        if (tag === "input") item.type = String(el.type || "text").toLowerCase();
        if (item.type === "checkbox" || item.type === "radio") item.checked = el.checked;
        else if (tag === "select") item.options = Array.from(el.options).slice(0, 30).map((o) => clean(o.text, 80));
        else if (tag === "input" || tag === "textarea") item.value = item.type === "password" ? (el.value ? "(filled)" : "") : clean(el.value, 160);
        out.push(item);
      }
      return { ok: true, url: location.href, title: document.title, count: out.length, elements: out };
    }
    const target = args || {};
    let el = null;
    if (target.ref) {
      const hit = window.__aitherChromeRefs && window.__aitherChromeRefs.get(target.ref);
      if (!hit || !hit.isConnected) return { ok: false, error: `ref ${target.ref} is stale; call chrome_snapshot again` };
      el = hit;
    } else {
      try { el = document.querySelector(String(target.selector || "")); } catch (e) { return { ok: false, error: "invalid selector" }; }
      if (!el) return { ok: false, error: "no element matches the selector" };
    }
    const label = labelOf(el);
    el.scrollIntoView({ block: "center" });
    if (action === "click") { el.click(); return { ok: true, label }; }
    if (action === "type") {
      if (!("value" in el)) return { ok: false, error: "element is not a text field", label };
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (desc && desc.set) desc.set.call(el, String(target.text ?? "")); else el.value = String(target.text ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: el.value === String(target.text ?? ""), label };
    }
    if (action === "select") {
      if (el.tagName !== "SELECT") return { ok: false, error: "element is not a <select>", label };
      const want = clean(target.option).toLowerCase();
      const opts = Array.from(el.options);
      let i = opts.findIndex((o) => o.value === target.option);
      if (i < 0) i = opts.findIndex((o) => clean(o.text).toLowerCase() === want);
      if (i < 0) i = opts.findIndex((o) => clean(o.text).toLowerCase().includes(want));
      if (i < 0) return { ok: false, error: "no option matches", label };
      el.selectedIndex = i;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, selected: clean(opts[i].text, 80), label };
    }
    if (action === "check") {
      const want = Boolean(target.checked);
      if (typeof el.checked !== "boolean") return { ok: false, error: "element is not a checkbox or radio", label };
      if (el.checked !== want) el.click();
      return { ok: el.checked === want, checked: el.checked, label };
    }
    return { ok: false, error: `unknown page action ${action}` };
  }

  /** Answer one desk request. Never throws. */
  async function handle(request) {
    const action = request && request.action;
    const args = (request && request.args) || {};
    try {
      if (action === "tabs") return await listTabs();
      if (action === "request_tab") return await requestTab(args.tab, args.reason);
      if (!PAGE_ACTIONS.includes(action)) return { ok: false, error: `unknown chrome action ${action}` };
      const gate = await approvedTab(args.tab);
      if (!gate.ok) return gate;
      const [res] = await deps.chrome.scripting.executeScript({
        target: { tabId: gate.tab.id },
        func: pageAction,
        args: [action, { ref: args.ref, selector: args.selector, text: args.text, option: args.option, checked: args.checked }],
      });
      return (res && res.result) || { ok: false, error: "the page returned nothing" };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
    }
  }

  let running = false;
  /** The long-poll loop. Idempotent: a second start() while one runs is a no-op. */
  async function start() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const bridge = deps.bridge();
        if (!bridge) return;
        const next = await bridge.nextChromeRequest();
        if (!next.ok) { await deps.sleep(15_000); continue; } // desk not running: back off
        if (!next.request) continue; // the long-poll ran out with nothing to do
        const result = await handle(next.request);
        await bridge.postChromeResult(next.request.id, result);
      }
    } finally {
      running = false;
    }
  }

  function wire() {
    const c = deps.chrome;
    if (!c || !c.tabs) return;
    c.tabs.onRemoved.addListener((tabId) => revoke(tabId));
    c.tabs.onUpdated.addListener(async (tabId, info) => {
      if (!info.url) return;
      const map = await approvals();
      if (map[tabId] && map[tabId] !== originOf(info.url)) await revoke(tabId);
    });
  }

  function _configure(overrides = {}) {
    Object.assign(deps, overrides);
  }

  self.ChromeAgent = { handle, requestTab, listTabs, approvedTab, pageAction, start, wire, originOf, _configure };
})();
