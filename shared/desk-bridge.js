/**
 * awdesk bridge (loopback, default 127.0.0.1:47931): make the desk avatar speak
 * or react, and push the current page into the desk as context.
 *
 * awdesk trusts this extension's pinned origin on exactly these routes
 * (/speak, /events, /desktop/*, /console/open, /browser/open, /decisions,
 * /health); fleet
 * verbs and /command stay behind its bearer. An awdesk older than that answers
 * 403 to a chrome-extension origin, which is reported as "update awdesk".
 */

(() => {
  "use strict";

  const DEFAULT_BASE = "http://127.0.0.1:47931";
  const SELECTION_MAX = 4000;
  const TOO_OLD = "awdesk too old: update awdesk";
  const OFFLINE = "awdesk is not running on this machine";

  const deps = { fetch: (...a) => fetch(...a) };

  async function baseUrl() {
    const resolver = (typeof globalThis !== "undefined" && globalThis.AitherLocalEndpoints)
      || (typeof self !== "undefined" && self.AitherLocalEndpoints);
    if (!resolver) return DEFAULT_BASE;
    try {
      return (await resolver.endpointFor("awdesk")) || DEFAULT_BASE;
    } catch {
      return DEFAULT_BASE;
    }
  }

  async function post(path, body) {
    let resp;
    try {
      resp = await deps.fetch(`${await baseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
    } catch {
      return { ok: false, error: OFFLINE };
    }
    if (resp.status === 403) return { ok: false, status: 403, error: TOO_OLD };
    if (!resp.ok) return { ok: false, status: resp.status, error: `awdesk answered HTTP ${resp.status}` };
    return { ok: true, status: resp.status };
  }

  function speak(text) {
    const t = String(text || "").trim();
    if (!t) return Promise.resolve({ ok: false, error: "nothing to say" });
    return post("/speak", { text: t.slice(0, 2000) });
  }

  function sendPage({ url, title = "", selection = "" } = {}) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      return Promise.resolve({ ok: false, error: "only http(s) pages can be sent to the desk" });
    }
    const body = { type: "page", url: String(url), title: String(title || "").slice(0, 300) };
    const sel = String(selection || "").trim();
    if (sel) body.selection = sel.slice(0, SELECTION_MAX);
    return post("/events", body);
  }

  /** Open an http(s) page in a new tab of the owner's Aither Browser on the desk. */
  function openInBrowser(url) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      return Promise.resolve({ ok: false, error: "only http(s) pages can be opened in the Aither Browser" });
    }
    return post("/browser/open", { url: String(url) });
  }

  function react(emotionOrAnimation) {
    const v = String(emotionOrAnimation || "").trim();
    if (!v) return Promise.resolve({ ok: false, error: "no reaction named" });
    return post("/events", /^[A-Z_]+$/.test(v) ? { type: "react", animation: v } : { type: "react", emotion: v });
  }

  function _configure(overrides = {}) {
    Object.assign(deps, overrides);
  }

  self.DeskBridge = { speak, sendPage, openInBrowser, react, TOO_OLD, OFFLINE, SELECTION_MAX, _configure };
})();
