/**
 * Extract a JSON object from a language model's answer.
 * =====================================================
 *
 * The social loops ask Aither for a plan and get back free text that is supposed
 * to contain JSON. Both planners used to find it with:
 *
 *     text.match(/\{[\s\S]*\}/)
 *
 * which is GREEDY: it spans the FIRST `{` to the LAST `}` in the whole answer.
 * That works only when the model emits the object and nothing else with braces.
 *
 * It will not hold here. The on-device brain is Bonsai at **Q1_0 — one bit per
 * weight** — and small aggressively-quantized models routinely wrap an answer in
 * prose, repeat themselves, or explain their reasoning afterwards. Any of:
 *
 *     Looking at {the feed}, here is my plan: {"likes":[1,2],"reply":null}
 *     {"likes":[1,2],"reply":null}
 *     I picked those because {they are builders}.
 *     ```json
 *     {"likes":[1]}
 *     ```
 *     {"likes":[1]} {"likes":[2]}
 *
 * makes the greedy match return something that is not valid JSON, `JSON.parse`
 * throws, the planner reports "no plan", and the caller correctly skips. So the
 * loop would run, do nothing, and log nothing wrong — the same silence that made
 * "it engages but never replies" take weeks to explain. A brace in a sentence
 * would have been enough to disable autonomous engagement entirely.
 *
 * This scans each `{` in turn, walks to its BALANCED close (respecting strings
 * and escapes so a `}` inside a reply's text cannot end the object early), and
 * tries to parse that span. First one that parses wins. Fenced blocks, preamble,
 * postamble and repeated objects all fall out of that for free.
 *
 * Returns the parsed object, or null when the text contains no parseable object.
 * Never throws — callers treat null as "no plan" and skip the tick.
 *
 * Asserted by tests/social-plan.test.mjs.
 */
(function (root) {
  function extractJsonObject(text) {
    if (text === null || text === undefined) return null;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== "{") continue;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === "{") { depth++; continue; }
        if (c !== "}") continue;
        depth--;
        if (depth > 0) continue;
        try {
          const parsed = JSON.parse(s.slice(i, j + 1));
          // Only OBJECTS are plans. A bare array or scalar that happens to sit
          // between braces is not what the caller asked for.
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
        } catch { /* not this one — advance to the next `{` */ }
        break; // this span closed and did not parse; try a later opening brace
      }
    }
    return null;
  }

  root.AitherSocialPlan = { extractJsonObject };
})(typeof self !== "undefined" ? self : globalThis);
