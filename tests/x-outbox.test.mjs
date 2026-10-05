#!/usr/bin/env node
/**
 * shared/x-outbox.js — runOutboxTick
 *
 * The tick posts an owner-approved thread from the owner's own browser. The
 * cases pin what makes that safe to run unattended every minute:
 *   - a thread is part 1 + each further part replying to the PREVIOUS tweet;
 *   - a failure stops the thread, notifies, reports, and is never retried;
 *   - a run that died mid-thread is reported as interrupted, never re-posted;
 *   - a report that could not be delivered is re-sent, the post is not.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "shared", "x-outbox.js"), "utf8");
const scope = {};
new Function("self", src)(scope);
const { runOutboxTick, statusId, matchKey, STALE_MS } = scope.AitherXOutbox;

const URL = (n) => `https://x.com/me/status/${n}`;

function harness({ item = null, failAt = -1, noUrlAt = -1, reportOk = true, pending = null, now = 1e9 } = {}) {
  const calls = { posts: [], reports: [], notes: [], fetched: 0 };
  let stored = pending;
  let queue = item ? [item] : [];
  let n = 100;
  const post = (kind) => async (a, b) => {
    const i = calls.posts.length;
    calls.posts.push(kind === "first" ? { kind, text: a } : { kind, prev: a, text: b });
    if (i === failAt) return { ok: false, reason: "composer missing" };
    return { ok: true, url: i === noUrlAt ? "" : URL(++n) };
  };
  const deps = {
    fetchNext: async () => { calls.fetched++; return queue.shift() || null; },
    postFirst: post("first"),
    postReply: post("reply"),
    report: async (body) => { calls.reports.push(body); return reportOk; },
    notify: (msg, ok) => calls.notes.push({ msg, ok }),
    store: {
      get: async () => stored && JSON.parse(JSON.stringify(stored)),
      set: async (v) => { stored = JSON.parse(JSON.stringify(v)); },
      clear: async () => { stored = null; },
    },
    now: () => now,
  };
  return { deps, calls, stored: () => stored, setReportOk: (v) => { reportOk = v; } };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("idle when the outbox is empty", async () => {
  const h = harness();
  assert.deepStrictEqual(await runOutboxTick(h.deps), { action: "idle" });
  assert.strictEqual(h.calls.posts.length, 0);
});

await test("a thread replies each part to the previous tweet and reports every URL", async () => {
  const h = harness({ item: { id: "o1", parts: ["one", "two", "three"] } });
  const out = await runOutboxTick(h.deps);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(h.calls.posts, [
    { kind: "first", text: "one" },
    { kind: "reply", prev: URL(101), text: "two" },
    { kind: "reply", prev: URL(102), text: "three" },
  ]);
  assert.deepStrictEqual(h.calls.reports, [
    { outbox_id: "o1", ok: true, urls: [URL(101), URL(102), URL(103)], error: "" },
  ]);
  assert.strictEqual(h.stored(), null, "a delivered report clears the in-flight record");
  assert.ok(h.calls.notes[0].ok);
});

await test("a failed part stops the thread, notifies loudly and reports the partial URLs", async () => {
  const h = harness({ item: { id: "o1", parts: ["one", "two", "three"] }, failAt: 1 });
  await runOutboxTick(h.deps);
  assert.strictEqual(h.calls.posts.length, 2, "part 3 is never attempted after part 2 failed");
  const r = h.calls.reports[0];
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.urls, [URL(101)]);
  assert.match(r.error, /part 2\/3 not posted: composer missing/);
  assert.ok(!h.calls.notes[0].ok && /NOT fully posted/.test(h.calls.notes[0].msg));
  // The next tick claims fresh work; it does not post this item again.
  await runOutboxTick(h.deps);
  assert.strictEqual(h.calls.posts.length, 2);
});

await test("a posted part whose URL cannot be read stops the thread (nothing to reply to)", async () => {
  const h = harness({ item: { id: "o1", parts: ["one", "two"] }, noUrlAt: 0 });
  await runOutboxTick(h.deps);
  assert.strictEqual(h.calls.posts.length, 1);
  assert.match(h.calls.reports[0].error, /posted but its tweet URL was not found/);
});

await test("an undelivered report is re-sent next tick without posting again", async () => {
  const h = harness({ item: { id: "o1", parts: ["one"] }, reportOk: false });
  await runOutboxTick(h.deps);
  assert.strictEqual(h.calls.reports.length, 1);
  assert.ok(h.stored(), "the result is kept until Genesis has it");
  h.setReportOk(true);
  const out = await runOutboxTick(h.deps);
  assert.strictEqual(out.action, "reported");
  assert.strictEqual(h.calls.posts.length, 1, "re-reporting never re-posts");
  assert.strictEqual(h.calls.fetched, 1, "no new claim while a report is pending");
  assert.deepStrictEqual(h.calls.reports[1].urls, [URL(101)]);
});

await test("a run that died mid-thread is reported as interrupted, never resumed", async () => {
  const pending = { outbox_id: "o9", total: 3, urls: [URL(7)], done: false, updated_at: 0 };
  const h = harness({ pending, now: STALE_MS + 1 });
  const out = await runOutboxTick(h.deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(h.calls.posts.length, 0);
  assert.strictEqual(h.calls.fetched, 0);
  assert.match(h.calls.reports[0].error, /interrupted after 1 of 3/);
  assert.deepStrictEqual(h.calls.reports[0].urls, [URL(7)]);
});

await test("a fresh in-flight record is left alone (a live run owns it)", async () => {
  const pending = { outbox_id: "o9", total: 3, urls: [], done: false, updated_at: 1e9 - 1000 };
  const h = harness({ pending, now: 1e9 });
  assert.deepStrictEqual(await runOutboxTick(h.deps), { action: "busy" });
  assert.strictEqual(h.calls.reports.length + h.calls.posts.length + h.calls.fetched, 0);
});

await test("statusId and matchKey", async () => {
  assert.strictEqual(statusId("https://x.com/me/status/123?s=20"), "123");
  assert.strictEqual(statusId("https://x.com/me"), "");
  assert.strictEqual(matchKey("What broke?\nAn  update https://t.co/x left it"), "What broke? An update left it");
});

console.log(`x-outbox: ${passed} passed`);
