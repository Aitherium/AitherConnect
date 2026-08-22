/**
 * ArcContribute bridge tests. Plain node (no framework): `node contribute-bridge.test.js`.
 * Exits non-zero on any failure — a check that can fail.
 *
 * The bridge is the token boundary: the shipped JS holds NO contributor token.
 * These tests lock the opt-in gate, the raw-transition capture, the POST shape,
 * and the fail-soft contract (a dead relay never loses or crashes — the queue
 * is retained).
 */
"use strict";
const assert = require("assert");
const { createContributeBridge, DEFAULT_OPT_KEY } = require("./contribute-bridge.js");

let passed = 0;
let failed = 0;
const failures = [];

const tests = [];

function t(name, fn) {
  tests.push([name, fn]);
}

async function run() {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log("PASS " + name);
    } catch (err) {
      failed += 1;
      failures.push(name);
      console.log("FAIL " + name + " :: " + err.message);
    }
  }
  console.log("");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures: " + failures.join(", "));
    process.exit(1);
  }
}

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, v); },
    _m: m,
  };
}

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const TRANS = [
  { state: [[0, 1], [1, 0]], action: "ACTION6(2,3)", next_state: [[1, 1], [0, 0]], game: "ls20" },
  { state: [[1, 0], [0, 1]], action: "ACTION3", next_state: [[0, 1], [1, 1]], game: "ls20" },
];

t("opt-in is OFF by default and persists via the store", () => {
  const store = fakeStore();
  const b = createContributeBridge({ relayUrl: "http://relay", store });
  assert.strictEqual(b.isOptedIn(), false);
  b.setOptIn(true);
  assert.strictEqual(b.isOptedIn(), true);
  assert.strictEqual(store.getItem(DEFAULT_OPT_KEY), "1");
  // A new bridge over the same store re-reads the persisted choice.
  const b2 = createContributeBridge({ relayUrl: "http://relay", store });
  assert.strictEqual(b2.isOptedIn(), true);
});

t("capture queues raw triples with game/ts passthrough, bounded", () => {
  const b = createContributeBridge({ relayUrl: "http://relay", store: fakeStore(), maxPending: 3 });
  for (let i = 0; i < 5; i++) {
    b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state, { game: "ls20", ts: i });
  }
  assert.strictEqual(b.queueLength(), 3, "queue capped at maxPending");
});

t("flush without opt-in returns ok:false and keeps the queue", async () => {
  const b = createContributeBridge({ relayUrl: "http://relay", store: fakeStore(), fetch: fakeFetch(200, {}) });
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state);
  const r = await b.flush();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "not opted in");
  assert.strictEqual(b.queueLength(), 1, "queue untouched");
});

t("flush without a relay returns ok:false (the server is the token boundary)", async () => {
  const b = createContributeBridge({ store: fakeStore(), fetch: fakeFetch(200, {}) });
  b.setOptIn(true);
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state);
  const r = await b.flush();
  assert.strictEqual(r.ok, false);
  assert.ok(/no relay/.test(r.error));
  assert.strictEqual(b.queueLength(), 1, "queue untouched");
});

t("flush POSTs the transitions and returns quarantine counts", async () => {
  let seenBody = null;
  const fetchImpl = async (url, init) => {
    seenBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ quarantined: 2, accepted: 0, rejected: 0 }) };
  };
  const b = createContributeBridge({ relayUrl: "http://relay/observe", store: fakeStore(), fetch: fetchImpl });
  b.setOptIn(true);
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state, { game: "ls20" });
  b.capture(TRANS[1].state, TRANS[1].action, TRANS[1].next_state, { game: "ls20" });

  const r = await b.flush();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.quarantined, 2);
  assert.strictEqual(r.rejected, 0);
  assert.strictEqual(b.queueLength(), 0, "queue drained on success");
  assert.strictEqual(seenBody.transitions.length, 2);
  assert.deepStrictEqual(seenBody.transitions[0].state, TRANS[0].state);
  assert.strictEqual(seenBody.transitions[0].action, "ACTION6(2,3)");
  assert.deepStrictEqual(seenBody.transitions[0].next_state, TRANS[0].next_state);
  assert.strictEqual(typeof seenBody.client_ts, "number");
});

t("flush fail-soft: network error retains the queue", async () => {
  const b = createContributeBridge({
    relayUrl: "http://relay", store: fakeStore(),
    fetch: async () => { throw new Error("ECONNREFUSED"); },
  });
  b.setOptIn(true);
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state);
  const r = await b.flush();
  assert.strictEqual(r.ok, false);
  assert.ok(/ECONNREFUSED/.test(r.error));
  assert.strictEqual(b.queueLength(), 1, "queue retained for retry");
});

t("flush fail-soft: relay 4xx retains the queue", async () => {
  const b = createContributeBridge({
    relayUrl: "http://relay", store: fakeStore(), fetch: fakeFetch(502, {}),
  });
  b.setOptIn(true);
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state);
  const r = await b.flush();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "relay 502");
  assert.strictEqual(b.queueLength(), 1, "queue retained");
});

t("flush fail-soft: a hung relay times out and retains the queue", async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("AbortError: timed out")));
    // never resolves on its own — only the bridge's AbortController can end it
  });
  const b = createContributeBridge({
    relayUrl: "http://relay", store: fakeStore(), fetch: hanging, fetchTimeoutMs: 20,
  });
  b.setOptIn(true);
  b.capture(TRANS[0].state, TRANS[0].action, TRANS[0].next_state);
  const r = await b.flush();
  assert.strictEqual(r.ok, false);
  assert.ok(/AbortError/.test(r.error), r.error);
  assert.strictEqual(b.queueLength(), 1, "queue retained after timeout, not lost");
});

t("flush with an empty queue and opt-in returns zeros, no fetch", async () => {
  let called = false;
  const b = createContributeBridge({
    relayUrl: "http://relay", store: fakeStore(),
    fetch: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  b.setOptIn(true);
  const r = await b.flush();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.quarantined, 0);
  assert.strictEqual(called, false, "no request for an empty queue");
});

run();
