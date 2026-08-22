/**
 * ArcSurprise tests. Plain node (no framework): `node sparkline.test.js`.
 * Exits non-zero on any failure — a check that can fail.
 *
 * The headline assertion is the program's core claim: surprise DROPS as the
 * model learns the player's pattern (per-pass mean 1.0 -> 0.5 -> 1/3).
 */
"use strict";
const assert = require("assert");
const { WorldModel } = require("./world-model.js");
const {
  surpriseForMove,
  learnFromMoves,
  renderSparkline,
  sparklineSummary,
  SURPRISE_NOVEL,
  SURPRISE_CONTRADICTION,
} = require("./surprise-sparkline.js");

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

t("novel (state, action) is maximum surprise", () => {
  const wm = new WorldModel();
  assert.strictEqual(surpriseForMove(wm, "A", "setX", "B"), SURPRISE_NOVEL);
  assert.strictEqual(SURPRISE_NOVEL, 1.0);
});

t("contradiction (wrong predicted next state) is 0.75", () => {
  const wm = new WorldModel();
  wm.observe("A", "setX", "B", 1, false); // model now expects B
  assert.strictEqual(surpriseForMove(wm, "A", "setX", "C"), SURPRISE_CONTRADICTION);
  assert.strictEqual(SURPRISE_CONTRADICTION, 0.75);
});

t("correct prediction surprise decays as 1/(1+count)", () => {
  const wm = new WorldModel();
  wm.observe("A", "setX", "B", 1, false); // count 1
  assert.ok(Math.abs(surpriseForMove(wm, "A", "setX", "B") - 1 / 2) < 1e-12);
  wm.observe("A", "setX", "B", 1, false); // count 2
  assert.ok(Math.abs(surpriseForMove(wm, "A", "setX", "B") - 1 / 3) < 1e-12);
});

t("surprise DROPS as a pattern is learned (program's core claim)", () => {
  const wm = new WorldModel();
  const pattern = [
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
  ];
  const means = [];
  for (let pass = 0; pass < 3; pass++) {
    const events = learnFromMoves(wm, pattern);
    const mean = events.reduce((s, e) => s + e.surprise, 0) / events.length;
    means.push(mean);
    assert.ok(events.every((e) => e.surprise > 0), "surprise stays positive");
  }
  // pass 1: both novel -> 1.0; pass 2: both correct, count 1 -> 0.5; pass 3: -> 1/3.
  assert.strictEqual(means[0], 1.0);
  assert.strictEqual(means[1], 0.5);
  assert.ok(Math.abs(means[2] - 1 / 3) < 1e-12);
  assert.ok(means[0] > means[1] && means[1] > means[2], "monotonic decline");
});

t("learnFromMoves records as it evaluates (merged counts across passes)", () => {
  const wm = new WorldModel();
  learnFromMoves(wm, [
    { state: "A", action: "setX", nextState: "B" },
    { state: "A", action: "setX", nextState: "B" },
  ]);
  // Two identical transitions merge into one record with count 2.
  assert.strictEqual(wm.getTransitionCount(), 1);
});

t("renderSparkline returns SVG with raw + moving-average polylines", () => {
  const wm = new WorldModel();
  const events = learnFromMoves(wm, [
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
  ]);
  const svg = renderSparkline(events, { width: 360, height: 88, window: 2 });
  assert.ok(svg.startsWith("<svg"), "starts with <svg");
  assert.ok(svg.includes('width="360"'), "width applied");
  assert.ok(svg.split("<polyline").length - 1 >= 2, "raw + moving-average polylines");
  assert.ok(svg.includes("<line "), "guide lines present");
});

t("renderSparkline: empty and single-event series do not crash", () => {
  const empty = renderSparkline([]);
  assert.ok(empty.startsWith("<svg"));
  const one = renderSparkline([{ surprise: 0.5 }]);
  assert.ok(one.startsWith("<svg"));
  assert.ok(one.includes("<polyline"), "single point still draws a polyline");
});

t("sparklineSummary: moving average falls after learning", () => {
  const wm = new WorldModel();
  const events = learnFromMoves(wm, [
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
    { state: "A", action: "setX", nextState: "B" },
    { state: "B", action: "setZ", nextState: "A" },
  ]);
  const s = sparklineSummary(events, 3);
  assert.strictEqual(s.count, 6);
  assert.strictEqual(s.firstAvg, 1.0);
  assert.ok(s.lastAvg < s.firstAvg, "moving average falls as it learns");
});

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Failures: " + failures.join(", "));
  process.exit(1);
}
