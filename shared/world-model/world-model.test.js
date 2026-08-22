/**
 * ArcWorldModel tests. Plain node (no framework): `node world-model.test.js`.
 * Exits non-zero on any failure — a check that can fail.
 *
 * Parity vectors are produced by the SERVICE's own code:
 *   python -c "import hashlib; raw='\x1f'.join(str(p) for p in PARTS); \
 *              print(hashlib.sha256(raw.encode()).hexdigest()[:16])"
 * If the JS stableHash ever stops matching Python _stable_hash, these fail.
 */
"use strict";
const assert = require("assert");
const { sha256Bytes, stableHash, WorldModel, createJournal, loadWorldModel } =
  require("./world-model.js");

let passed = 0;
let failed = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log("FAIL " + name + " :: " + err.message);
  }
}

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// sha256 correctness vs known vectors
// ---------------------------------------------------------------------------

t("sha256('') matches FIPS vector", () => {
  const hex = sha256Bytes(new TextEncoder().encode(""));
  assert.strictEqual(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

t("sha256('abc') matches FIPS vector", () => {
  const hex = sha256Bytes(new TextEncoder().encode("abc"));
  assert.strictEqual(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

t("sha256 matches python for the _stable_hash join raw", () => {
  const raw = ["a", "b", "c"].map(String).join("\x1f");
  const hex = sha256Bytes(new TextEncoder().encode(raw));
  assert.strictEqual(hex.slice(0, 16), "e0dee694aed26d32");
});

// ---------------------------------------------------------------------------
// stableHash parity with Python _stable_hash (cross-language)
// ---------------------------------------------------------------------------

t("stableHash parity: ('a','b','c')", () => {
  assert.strictEqual(stableHash("a", "b", "c"), "e0dee694aed26d32");
});

t("stableHash parity: ('grid:3x3') single part", () => {
  assert.strictEqual(stableHash("grid:3x3"), "92b3f5477b2fa973");
});

t("stableHash parity: ('s', 42) number part", () => {
  assert.strictEqual(stableHash("s", 42), "526ea65ec6aca308");
});

t("stableHash parity: ('x', True) BOOLEAN is Python-cased", () => {
  // Python str(True) == "True", NOT JS String(true) == "true". This is the trap.
  assert.strictEqual(stableHash("x", true), "8bcf5c6622bdaffc");
});

t("stableHash parity: ('v', 0.95) float part", () => {
  assert.strictEqual(stableHash("v", 0.95), "10790bfbdcb94181");
});

t("stableHash parity: (1, 2) two numbers", () => {
  assert.strictEqual(stableHash(1, 2), "11f0530a8259fffb");
});

t("stableHash is deterministic across calls", () => {
  const a = stableHash("grid:3x3", "set(0,0,red)");
  const b = stableHash("grid:3x3", "set(0,0,red)");
  assert.strictEqual(a, b);
});

// ---------------------------------------------------------------------------
// Engine behaviour (port of UnifiedMCTS.WorldModel)
// ---------------------------------------------------------------------------

t("record running average and count", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  const nh = stableHash("n1");
  wm.record(sh, "A", nh, 0, false);
  wm.record(sh, "A", nh, 1, false);
  let p = wm.predict(sh, "A");
  assert.strictEqual(p.reward, 0.5);
  assert.strictEqual(p.nextStateHash, nh);
  wm.record(sh, "A", nh, 1, false);
  p = wm.predict(sh, "A");
  assert.ok(Math.abs(p.reward - 2 / 3) < 1e-12, "reward should be 2/3, got " + p.reward);
  assert.strictEqual(wm.getTransitionCount(), 1);
});

t("predict returns most-observed transition (max count)", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  const nh1 = stableHash("n1");
  const nh2 = stableHash("n2");
  wm.record(sh, "A", nh1, 0.5, false, "FAILURE");
  wm.record(sh, "A", nh2, 1.0, true, "SUCCESS");
  wm.record(sh, "A", nh2, 1.0, true, "SUCCESS");
  wm.record(sh, "A", nh2, 1.0, true, "SUCCESS");
  const p = wm.predict(sh, "A");
  assert.strictEqual(p.nextStateHash, nh2);
  assert.strictEqual(p.done, true);
  assert.strictEqual(wm.predictResultType(sh, "A"), "SUCCESS");
  // 2 RECORDS: nh1 (count 1) + nh2 (count 3) — the three nh2 calls merge into one.
  assert.strictEqual(wm.getTransitionCount(), 2);
});

t("predict returns null for unseen (state, action)", () => {
  const wm = new WorldModel();
  assert.strictEqual(wm.predict(stableHash("s1"), "A"), null);
  assert.strictEqual(wm.predictResultType(stableHash("s1"), "A"), null);
});

t("hasPrediction and getNovelActions", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  wm.record(sh, "A", stableHash("n1"), 0, false);
  assert.strictEqual(wm.hasPrediction(sh, "A"), true);
  assert.strictEqual(wm.hasPrediction(sh, "B"), false);
  assert.deepStrictEqual(wm.getNovelActions(sh, ["A", "B", "C"]), ["B", "C"]);
});

t("state value EMA is 0.7*old + 0.3*new", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  wm.recordStateValue(sh, 1.0);
  assert.strictEqual(wm.getStateValue(sh), 1.0);
  wm.recordStateValue(sh, 0.0);
  assert.ok(Math.abs(wm.getStateValue(sh) - 0.7) < 1e-12);
});

t("decay scales rewards and state values by 0.95", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  const nh = stableHash("n1");
  wm.record(sh, "A", nh, 1.0, false);
  wm.recordStateValue(sh, 1.0);
  wm.decay(0.95);
  const p = wm.predict(sh, "A");
  assert.ok(Math.abs(p.reward - 0.95) < 1e-12);
  assert.ok(Math.abs(wm.getStateValue(sh) - 0.95) < 1e-12);
});

t("predictCount: 0 unseen, best-record count otherwise", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  assert.strictEqual(wm.predictCount(sh, "A"), 0);
  wm.record(sh, "A", stableHash("n1"), 0, false);
  wm.record(sh, "A", stableHash("n2"), 1, false);
  wm.record(sh, "A", stableHash("n2"), 1, false);
  assert.strictEqual(wm.predictCount(sh, "A"), 2); // n2 (count 2) beats n1 (count 1)
});

t("observe() hashes raw states with stableHash", () => {
  const wm = new WorldModel();
  wm.observe("gridA", "set(2,3,4)", "gridB", 1, true);
  const p = wm.predict(stableHash("gridA"), "set(2,3,4)");
  assert.strictEqual(p.nextStateHash, stableHash("gridB"));
  assert.strictEqual(p.done, true);
});

// ---------------------------------------------------------------------------
// JSONL round-trip (schema parity with WorldModel.save/load)
// ---------------------------------------------------------------------------

t("serialize/fromJsonl round-trips transitions and state values", () => {
  const wm = new WorldModel();
  const sh = stableHash("s1");
  const nh1 = stableHash("n1");
  const nh2 = stableHash("n2");
  wm.record(sh, "A", nh1, 0.5, false, "FAILURE");
  wm.record(sh, "A", nh2, 1.0, true, "SUCCESS");
  wm.record(sh, "A", nh2, 1.0, true, "SUCCESS"); // merges into nh2 -> count 2, wins over nh1
  wm.record(sh, "B", nh2, 0.0, false, "SUCCESS");
  wm.recordStateValue(sh, 0.25);

  const jsonl = wm.serialize();
  const lines = jsonl.split("\n").filter(Boolean);
  assert.strictEqual(lines.length, 4);

  for (const line of lines) {
    const o = JSON.parse(line);
    assert.strictEqual(typeof o.state_hash, "string");
    assert.strictEqual(o.state_hash.length, 16, "hash is the 16-hex-char form");
  }

  const wm2 = WorldModel.fromJsonl(jsonl);
  assert.strictEqual(wm2.getTransitionCount(), 3);
  assert.deepStrictEqual(wm2.predict(sh, "A"), wm.predict(sh, "A"));
  assert.strictEqual(wm2.getStateValue(sh), 0.25);
  assert.strictEqual(wm2.predictResultType(sh, "A"), "SUCCESS");
});

t("fromJsonl is tolerant of garbage and empty input", () => {
  const wm = WorldModel.fromJsonl("");
  assert.strictEqual(wm.getTransitionCount(), 0);
  const wm2 = WorldModel.fromJsonl("not json\n{valid}\n");
  assert.strictEqual(wm2.getTransitionCount(), 0);
});

// ---------------------------------------------------------------------------
// Journal throttle (port of _mark_worldmodel_dirty / save_worldmodel)
// ---------------------------------------------------------------------------

t("journal auto-saves every saveEvery transitions, manual save on demand", () => {
  const storage = fakeStorage();
  const wm = loadWorldModel(storage, "wm");
  const j = createJournal(wm, storage, "wm", 2);
  const sh = stableHash("s1");

  j.record(sh, "A", stableHash("n1"), 1, false); // dirty=1
  j.record(sh, "A", stableHash("n2"), 1, true); // dirty=2 -> auto-save
  j.record(sh, "A", stableHash("n3"), 1, true); // dirty=1, not yet saved

  // One auto-save happened, at count 2 -> 2 transition lines.
  assert.strictEqual(storage._store.size, 1);
  assert.strictEqual(storage._store.get("wm").split("\n").filter(Boolean).length, 2);

  const ok = j.save();
  assert.strictEqual(ok, true);
  assert.strictEqual(storage._store.get("wm").split("\n").filter(Boolean).length, 3);

  // Reload reconstructs the same model. (3-way tie among n1/n2/n3 -> predict
  // returns the FIRST-observed, matching Python's max()-keeps-first tie.)
  const reloaded = loadWorldModel(storage, "wm");
  assert.strictEqual(reloaded.getTransitionCount(), 3);
  assert.strictEqual(reloaded.predict(sh, "A").nextStateHash, wm.predict(sh, "A").nextStateHash);
});

t("journal.save returns false (never throws) when storage rejects", () => {
  const badStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceeded"); },
  };
  const wm = new WorldModel();
  const j = createJournal(wm, badStorage, "wm");
  j.record(stableHash("s1"), "A", stableHash("n1"), 1, false);
  assert.strictEqual(j.save(), false);
  // In-memory model is still authoritative despite the failed persist.
  assert.strictEqual(wm.getTransitionCount(), 1);
});

// ---------------------------------------------------------------------------

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Failures: " + failures.join(", "));
  process.exit(1);
}
