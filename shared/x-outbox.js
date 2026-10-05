/**
 * The X outbox tick: post an owner-approved thread from the owner's own browser.
 * =============================================================================
 *
 * There are no X API credentials. When the owner approves an X post, the fleet
 * queues it in the Genesis X outbox; this tick (an alarm, about once a minute)
 * claims the next item, posts part 1 in the logged-in x.com tab, posts each
 * further part as a reply to the previous tweet (a thread), and reports the
 * tweet URLs back.
 *
 * PUBLISH-ONCE. Genesis never hands out a claimed item twice, and this tick
 * never re-posts: a failure is notified and reported, then left for a human.
 * Progress is written to storage after EVERY part, so a service worker that
 * dies mid-thread leaves a record; the next tick reports it as interrupted
 * (with the URLs that did post) instead of starting the thread again.
 *
 * Every side effect is injected, so tests/x-outbox.test.mjs drives the real
 * function with fakes:
 *   fetchNext()            -> item {id, parts[]} | null
 *   postFirst(text)        -> {ok, url, reason}
 *   postReply(prevUrl, t)  -> {ok, url, reason}
 *   report(body)           -> true when Genesis answered definitively
 *   notify(msg, ok, url)
 *   store {get, set, clear} the in-flight record (chrome.storage.local)
 *   now()                  -> ms
 */
(function (root) {
  "use strict";

  // A run that has not touched its record for this long is dead, not slow:
  // one part is a navigation plus a post plus a URL lookup (~30 s).
  const STALE_MS = 10 * 60 * 1000;
  let busy = false;

  async function flushPending(deps, rec) {
    if (!rec.done) {
      rec.done = true;
      rec.ok = false;
      rec.error = `interrupted after ${rec.urls.length} of ${rec.total} part(s); not retried`;
      await deps.store.set(rec);
      deps.notify(`X thread was interrupted: ${rec.error}.`, false, rec.urls[0]);
    }
    const sent = await deps.report({
      outbox_id: rec.outbox_id, ok: !!rec.ok, urls: rec.urls, error: rec.error || "",
    });
    if (sent) await deps.store.clear();
    return { action: sent ? "reported" : "report-pending", outbox_id: rec.outbox_id, ok: !!rec.ok };
  }

  async function runOutboxTick(deps) {
    if (busy) return { action: "busy" };
    busy = true;
    try {
      const now = deps.now ? deps.now() : Date.now();
      const pending = await deps.store.get();
      if (pending && pending.outbox_id) {
        // A record still being written by a live run is left alone.
        if (!pending.done && now - (pending.updated_at || 0) < STALE_MS) return { action: "busy" };
        return await flushPending(deps, pending);
      }

      const item = await deps.fetchNext();
      if (!item || !item.id) return { action: "idle" };
      const parts = (item.parts || []).filter((p) => typeof p === "string" && p.trim());
      const rec = {
        outbox_id: item.id, total: parts.length, urls: [], done: false, updated_at: now,
      };
      await deps.store.set(rec);

      let error = parts.length ? "" : "outbox item has no parts";
      for (let i = 0; i < parts.length && !error; i++) {
        let res;
        try {
          res = i === 0 ? await deps.postFirst(parts[0]) : await deps.postReply(rec.urls[i - 1], parts[i]);
        } catch (e) {
          res = { ok: false, reason: `exception: ${String(e && e.message || e).slice(0, 160)}` };
        }
        if (!res || !res.ok) {
          error = `part ${i + 1}/${parts.length} not posted: ${(res && res.reason) || "no result"}`;
        } else if (!res.url) {
          // It posted, but without its URL the next part cannot reply to it.
          error = `part ${i + 1}/${parts.length} posted but its tweet URL was not found`;
        } else {
          rec.urls.push(res.url);
        }
        rec.updated_at = deps.now ? deps.now() : Date.now();
        await deps.store.set(rec);
      }

      rec.done = true;
      rec.ok = !error;
      rec.error = error;
      await deps.store.set(rec);
      if (rec.ok) {
        deps.notify(`Posted your approved X thread (${rec.urls.length} part(s)).`, true, rec.urls[0]);
      } else {
        deps.notify(`X thread NOT fully posted: ${error}. Nothing will retry it.`, false, rec.urls[0]);
      }
      return await flushPending(deps, rec);
    } finally {
      busy = false;
    }
  }

  /** The numeric id of a tweet URL, or "" (the reply intent needs it). */
  function statusId(url) {
    const m = String(url || "").match(/\/status\/(\d+)/);
    return m ? m[1] : "";
  }

  /** Collapse whitespace and drop links: what a part's text looks like in the timeline. */
  function matchKey(text, len = 60) {
    return String(text || "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, len);
  }

  root.AitherXOutbox = { runOutboxTick, statusId, matchKey, STALE_MS };
})(typeof self !== "undefined" ? self : globalThis);
