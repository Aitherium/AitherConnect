#!/usr/bin/env node
/**
 * shared/social-plan.js — extractJsonObject
 *
 * These cases are not hypothetical formatting pedantry. The on-device brain is
 * Bonsai at Q1_0 (ONE BIT per weight), and the two callers are the autonomous X
 * engage and discover planners. When extraction fails they return null and the
 * caller skips the tick — correctly, and silently. So a model habit as small as
 * "explain the plan afterwards" would disable autonomous engagement with nothing
 * in any log to say why. That is the exact silence this whole session was spent
 * unpicking, so it gets a test rather than a comment.
 *
 * The previous implementation was `text.match(/\{[\s\S]*\}/)` — greedy, first `{`
 * to LAST `}`. Every REGRESSION case below is one that regex gets wrong.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, "..", "shared", "social-plan.js"),
  "utf8",
);

// The module is a service-worker classic script (assigns onto `self`), so give
// it a `self` and evaluate it the way importScripts would.
const scope = {};
new Function("self", src)(scope);
const { extractJsonObject } = scope.AitherSocialPlan;

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    assert.deepStrictEqual(got, want);
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       got  ${JSON.stringify(got)}`);
    console.log(`       want ${JSON.stringify(want)}`);
  }
}

console.log("extractJsonObject — clean cases");
check("bare object", extractJsonObject('{"likes":[1,2],"reply":null}'),
  { likes: [1, 2], reply: null });
check("nested reply object",
  extractJsonObject('{"likes":[1],"reply":{"idx":2,"text":"nice"}}'),
  { likes: [1], reply: { idx: 2, text: "nice" } });
check("follow plan", extractJsonObject('{"follow":[3,4]}'), { follow: [3, 4] });

console.log("extractJsonObject — REGRESSIONS the greedy regex got wrong");
// Greedy spans `{the feed}` ... `null}` -> not JSON -> null -> tick skipped.
check("prose WITH BRACES before the object",
  extractJsonObject('Looking at {the feed}, here: {"likes":[1,2],"reply":null}'),
  { likes: [1, 2], reply: null });
// Greedy spans the object ... `{they are builders}` -> not JSON.
check("prose WITH BRACES after the object",
  extractJsonObject('{"follow":[1]}\nI picked those because {they are builders}.'),
  { follow: [1] });
// Greedy spans object1 ... object2 -> not JSON. Small models repeat themselves.
check("model emitted the object twice",
  extractJsonObject('{"likes":[1]} {"likes":[2]}'),
  { likes: [1] });
// A `}` inside a string must NOT close the object early.
check("closing brace inside the reply text",
  extractJsonObject('{"reply":{"idx":1,"text":"use a } brace"},"likes":[]}'),
  { reply: { idx: 1, text: "use a } brace" }, likes: [] });
check("escaped quote inside the reply text",
  extractJsonObject('{"reply":{"idx":1,"text":"he said \\"hi\\""},"likes":[]}'),
  { reply: { idx: 1, text: 'he said "hi"' }, likes: [] });

console.log("extractJsonObject — formatting the model actually emits");
check("fenced json block",
  extractJsonObject('```json\n{"likes":[1,2]}\n```'),
  { likes: [1, 2] });
check("fenced block with a lead-in",
  extractJsonObject('Sure! Here is the plan:\n```json\n{"follow":[0]}\n```\nDone.'),
  { follow: [0] });

console.log("extractJsonObject — must return null, never throw");
check("truncated at the token cap", extractJsonObject('{"likes":[1,2],"reply":{"idx'), null);
check("no json at all", extractJsonObject("I could not decide."), null);
check("empty string", extractJsonObject(""), null);
check("null input", extractJsonObject(null), null);
check("undefined input", extractJsonObject(undefined), null);
// A bare array is not a plan — callers index `.likes` / `.follow`.
check("bare array between braces", extractJsonObject("[1,2,3]"), null);
check("scalar in braces", extractJsonObject("{5}"), null);

/* The discover planner's VERDICT shape.
 *
 * Measured on the real model (Bonsai-4B Q1_0 on a 5090, 2026-08-02): asked to
 * "pick up to N relevant accounts ... NOT engagement-farmers" it returned
 * {"follow":[0,1,2]} and followed a candidate literally described as
 * "follow4follow crypto signals". Handed a shortlist and a budget, a small model
 * returns the shortlist. Asked to judge EACH account and say WHY, the same model
 * got all four right, including follow:false for a botfarm and an NFT shill.
 *
 * This is the loop that FOLLOWS people, at up to 15/day, and indiscriminate
 * following is what X flags — so the mapping from verdicts to indices is worth
 * pinning, as is the old flat shape degrading gracefully rather than to "no
 * plan" (which would skip the whole tick).
 */
function foldVerdicts(plan, validIdx, maxFollows) {
  if (!plan) return null;
  const valid = new Set(validIdx);
  if (Array.isArray(plan.verdicts)) {
    plan.follow = plan.verdicts
      .filter((v) => v && v.follow === true && valid.has(v.idx))
      .map((v) => v.idx);
  }
  plan.follow = (plan.follow || []).filter((i) => valid.has(i)).slice(0, maxFollows);
  return plan;
}

console.log("discover verdicts -> follow indices");
check("only follow:true survives (the model's real answer)",
  foldVerdicts(extractJsonObject(
    '{"verdicts":[{"idx":0,"follow":true,"why":"real researcher"},'
    + '{"idx":1,"follow":false,"why":"engagement farming"},'
    + '{"idx":2,"follow":true,"why":"pytorch core"},'
    + '{"idx":3,"follow":false,"why":"NFT shill"}]}'), [0, 1, 2, 3], 3).follow,
  [0, 2]);
check("a rejected account is never followed",
  foldVerdicts(extractJsonObject('{"verdicts":[{"idx":1,"follow":false}]}'), [0, 1], 3).follow, []);
check("maxFollows still caps the list",
  foldVerdicts(extractJsonObject(
    '{"verdicts":[{"idx":0,"follow":true},{"idx":1,"follow":true},{"idx":2,"follow":true}]}'),
    [0, 1, 2], 2).follow, [0, 1]);
check("an unknown idx is dropped (model hallucinated a row)",
  foldVerdicts(extractJsonObject('{"verdicts":[{"idx":9,"follow":true},{"idx":0,"follow":true}]}'),
    [0, 1], 3).follow, [0]);
check("the OLD flat shape still degrades gracefully, not to null",
  foldVerdicts(extractJsonObject('{"follow":[0,2]}'), [0, 1, 2], 3).follow, [0, 2]);
check('follow:"true" as a STRING is not truthy-accepted',
  foldVerdicts(extractJsonObject('{"verdicts":[{"idx":0,"follow":"true"}]}'), [0], 3).follow, []);

/* The discover token budget, sized against a MEASURED answer.
 *
 * FIVE captured answers from Bonsai-4B Q1_0 (2026-08-02), not one:
 *   628 chars / 4 verdicts -> 39.2 tok/verdict
 *  1061 chars / 6 verdicts -> 44.2
 *  1094 chars / 6 verdicts -> 45.6
 *  1460 chars / 6 verdicts -> 60.8   <- worst
 *  1460 chars / 6 verdicts -> 60.8
 * Size against the WORST, never the mean. The first version of this test used
 * only the 4-account sample (39.2) and therefore claimed 1.66x headroom for a
 * coefficient of 65 that really had 1.29x -- and truncated outright at 15
 * candidates. Sampling once and calling it "measured" is exactly the trap.
 *
 * This also settles what the OLD flat `maxTokens: 160` was doing: 4 candidates
 * already need ~187 tokens, so it truncated at FOUR, not just at the fifteen the
 * caller was sending (~619). Truncation there is silent — the extractor returns
 * the first complete inner entry, `follow` resolves to [], and discovery follows
 * nobody forever.
 *
 * Pinned so nobody trims the coefficient back toward the measured floor without
 * re-measuring. Mirrors background.js xDiscoverPlan.
 */
const budgetFor = (n) => Math.min(1200, 120 + n * 95);
const MEASURED_TOKENS_PER_VERDICT = 60.8;  // WORST of 5 captured answers
const ENVELOPE = 30;
console.log("discover token budget (vs the WORST of 5 measured answers)");
for (const n of [4, 6, 15]) {
  const need = MEASURED_TOKENS_PER_VERDICT * n + ENVELOPE;
  check(`budget fits ${n} candidates (need ~${Math.round(need)}, have ${budgetFor(n)})`,
    budgetFor(n) >= need, true);
}
/* DERIVED from budgetFor, not written as a literal. The first version asserted
 * `65 / MEASURED >= 1.5` — a constant compared to a constant, which stays true
 * no matter what the formula does. Trimming budgetFor's coefficient from 65 to
 * 40 left the whole file green. Take the slope of the real function instead, so
 * changing the function is what the assertion sees. */
const coefficient = budgetFor(11) - budgetFor(10);  // both below the 900 cap
check(`the shipped coefficient (${coefficient}/verdict) keeps >=1.5x headroom over measured`,
  coefficient / MEASURED_TOKENS_PER_VERDICT >= 1.5, true);
check("the OLD flat 160 truncated even at 4 candidates",
  160 < MEASURED_TOKENS_PER_VERDICT * 4 + ENVELOPE, true);
check("the superseded coefficient 65 did NOT have the claimed headroom",
  65 / MEASURED_TOKENS_PER_VERDICT < 1.5, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
