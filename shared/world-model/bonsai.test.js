/**
 * ArcBonsai bridge tests. Plain node (no framework): `node bonsai.test.js`.
 * Exits non-zero on any failure — a check that can fail.
 *
 * The bridge is a thin protocol adapter over the EXISTING aitherium.com Bonsai
 * worker; these tests lock the gate (fail-closed WebGPU probe) and the
 * load|generate -> ready|token|done|error routing with a mock worker. The
 * actual inference runtime is the aitherium.com-proven one — not rebuilt here.
 */
"use strict";
const assert = require("assert");
const {
  SMALL_MODEL_ID,
  probeWebGPU,
  createBonsaiBridge,
} = require("./bonsai-bridge.js");

const tests = [];

function t(name, fn) {
  tests.push([name, fn]);
}

async function run() {
  let passed = 0;
  let failed = 0;
  const failures = [];
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

function fakeWorker() {
  const handlers = { message: new Set(), error: new Set() };
  const sent = [];
  return {
    addEventListener(type, cb) {
      (handlers[type] ||= new Set()).add(cb);
    },
    postMessage(msg) {
      sent.push(msg);
    },
    terminate() {},
    emit(msg) {
      for (const cb of handlers.message) cb({ data: msg });
    },
    emitError(e) {
      for (const cb of handlers.error) cb(e || new Error("worker died"));
    },
    sent,
  };
}

async function resolveLoad(bridge, fw) {
  const p = bridge.load();
  fw.emit({ type: "ready" });
  await p;
}

// ---------------------------------------------------------------------------
// WebGPU gate — fail-closed
// ---------------------------------------------------------------------------

t("probeWebGPU: no navigator.gpu -> unavailable", async () => {
  const cap = await probeWebGPU({});
  assert.strictEqual(cap.available, false);
  assert.ok(cap.reason, "reason is set");
});

t("probeWebGPU: no navigator at all -> unavailable", async () => {
  const cap = await probeWebGPU(null);
  assert.strictEqual(cap.available, false);
});

t("probeWebGPU: adapter null -> unavailable (TDR gate)", async () => {
  const cap = await probeWebGPU({ gpu: { requestAdapter: async () => null } });
  assert.strictEqual(cap.available, false);
  assert.ok(/adapter/.test(cap.reason));
});

t("probeWebGPU: adapter present -> available", async () => {
  const cap = await probeWebGPU({ gpu: { requestAdapter: async () => ({ info: {} }) } });
  assert.strictEqual(cap.available, true);
});

t("probeWebGPU: requestAdapter throws -> unavailable (never allow on error)", async () => {
  const cap = await probeWebGPU({
    gpu: { requestAdapter: async () => { throw new Error("boom"); } },
  });
  assert.strictEqual(cap.available, false);
  assert.ok(/boom/.test(cap.reason));
});

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

t("load posts {type:'load', modelId} and resolves on ready", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw, { modelId: SMALL_MODEL_ID });
  const p = bridge.load();
  assert.strictEqual(fw.sent[0].type, "load");
  assert.strictEqual(fw.sent[0].modelId, SMALL_MODEL_ID);
  assert.ok(fw.sent[0].flowId, "flowId stamped");
  fw.emit({ type: "ready", modelId: SMALL_MODEL_ID });
  const res = await p;
  assert.strictEqual(res.modelId, SMALL_MODEL_ID);
});

t("load rejects on error emission", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  const p = bridge.load("bonsai-1.7b");
  fw.emit({ type: "error", message: "no WebGPU adapter" });
  await assert.rejects(p, /no WebGPU adapter/);
});

t("single active flow is enforced", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  const p = bridge.load();
  assert.throws(
    () => bridge.generate({ messages: [{ role: "user", content: "x" }] }, {}),
    /already in flight/
  );
  fw.emit({ type: "ready" });
  await p;
});

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

t("generate posts {type:'generate', messages} and routes token/done", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  await resolveLoad(bridge, fw);

  const tokens = [];
  let done = null;
  const gen = bridge.generate(
    { messages: [{ role: "user", content: "suggest a move" }], maxTokens: 4 },
    { onToken: (txt) => tokens.push(txt), onDone: (m) => { done = m; } }
  );

  assert.strictEqual(fw.sent[1].type, "generate");
  assert.deepStrictEqual(fw.sent[1].messages, [{ role: "user", content: "suggest a move" }]);
  assert.strictEqual(fw.sent[1].maxTokens, 4);

  fw.emit({ type: "token", text: "try" });
  fw.emit({ type: "token", text: " setX" });
  fw.emit({ type: "done", text: "try setX", tokensPerSecond: 2.5 });
  assert.deepStrictEqual(tokens, ["try", " setX"]);
  assert.strictEqual(done.text, "try setX");
  assert.strictEqual(done.tokensPerSecond, 2.5);
});

t("generate progress routes to onProgress", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  await resolveLoad(bridge, fw);
  const seen = [];
  bridge.generate({ messages: [] }, { onProgress: (pct, file) => seen.push([pct, file]) });
  fw.emit({ type: "progress", progress: 42, file: "warming layer 3/24" });
  assert.deepStrictEqual(seen, [[42, "warming layer 3/24"]]);
});

t("generate error routes to onError and does not throw", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  await resolveLoad(bridge, fw);
  let err = null;
  bridge.generate({ messages: [] }, { onError: (e) => { err = e; } });
  fw.emit({ type: "error", message: "generate failed: OOM" });
  assert.ok(err, "onError called");
  assert.ok(/OOM/.test(err.message));
});

t("interrupt posts {type:'interrupt'}", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  await resolveLoad(bridge, fw);
  const gen = bridge.generate({ messages: [] }, {});
  gen.interrupt();
  assert.strictEqual(fw.sent[fw.sent.length - 1].type, "interrupt");
});

t("worker error event is surfaced to listeners", async () => {
  const fw = fakeWorker();
  const bridge = createBonsaiBridge(fw);
  await resolveLoad(bridge, fw);
  let err = null;
  bridge.generate({ messages: [] }, { onError: (e) => { err = e; } });
  fw.emitError(new Error("worker died"));
  assert.ok(err, "worker error reached onError");
  assert.ok(/worker died/.test(err.message));
});

run();
