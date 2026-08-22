/**
 * Awconnect run-trace event formatting
 * =======================================
 * Turns a Genesis SSE event into the {tagClass, tag, msg} triple the chat
 * trace log renders.
 *
 * Why this exists: the runtime emits a rich play-by-play during a turn —
 * turn_start, facet_start/end, speculative_fire, tool timings, budget pressure —
 * and the side panel handled NONE of them. It rendered only `thinking`,
 * `tool_call`, `tool_result` and `progress`, so after "Planning faceted
 * execution..." the UI went silent until a thinking token happened to arrive.
 * Nothing was hung; the client simply was not listening, and a long-but-healthy
 * turn was indistinguishable from a dead one.
 *
 * It also handles the stage COMPLETION events, which carry no `message` — the
 * old handler was `if (msg)`, so an event describing how long a stage took was
 * dropped precisely when the user most needed it.
 *
 * Pure and dependency-free so it can be unit-tested and shared by the side
 * panel (classic script) and the Node test harness.
 */

/** Round a millisecond duration to something a human reads at a glance. */
function formatElapsed(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

/**
 * Describe one SSE event as a trace line.
 *
 * @param {string} event  SSE event name
 * @param {object} data   parsed event payload
 * @returns {{tagClass: string, tag: string, msg: string}|null}
 *          null when the event should not produce a trace line.
 */
function describeTraceEvent(event, data) {
  const d = data || {};
  const el = formatElapsed(d.elapsed_ms);

  switch (event) {
    case "progress": {
      // A start event carries the human message. A completion event carries
      // only phase + elapsed, and must still render — that timing IS the
      // answer to "what is it doing".
      if (d.message) return { tagClass: "progress", tag: "progress", msg: d.message };
      const phase = d.phase || d.stage || "";
      if (!phase) return null;
      const bits = [phase];
      if (el) bits.push(el);
      // Say WHY a stage degraded rather than reporting a suspiciously round
      // elapsed and letting it pass for a healthy read.
      if (d.degraded) bits.push(`degraded: ${d.degraded}`);
      return { tagClass: "progress", tag: "progress", msg: bits.join(" — ") };
    }

    case "turn_start":
      return {
        tagClass: "turn", tag: "turn",
        msg: `turn ${d.turn ?? "?"}${d.max_turns ? ` / ${d.max_turns}` : ""}`,
      };

    case "turn_end": {
      const bits = [`turn ${d.turn ?? "?"} done`];
      if (el) bits.push(el);
      return { tagClass: "turn", tag: "turn", msg: bits.join(" — ") };
    }

    case "turn_budget_pressure":
      return {
        tagClass: "warn", tag: "budget",
        msg: d.message || d.reason || "approaching turn budget",
      };

    case "facet_start":
      return {
        tagClass: "facet", tag: "facet",
        msg: `${d.name || d.facet || "facet"}${d.index != null ? ` (${d.index + 1}${d.total ? `/${d.total}` : ""})` : ""}`,
      };

    case "facet_crystallize":
      return { tagClass: "facet", tag: "facet", msg: `crystallizing ${d.name || d.facet || ""}`.trim() };

    case "facet_end": {
      const bits = [`${d.name || d.facet || "facet"} done`];
      if (el) bits.push(el);
      return { tagClass: "facet", tag: "facet", msg: bits.join(" — ") };
    }

    case "speculative_fire": {
      const tools = Array.isArray(d.tools) ? d.tools : [];
      if (!tools.length) return null;
      return { tagClass: "tool", tag: "prefire", msg: tools.join(", ") };
    }

    case "speculative_fire_done": {
      const ok = Array.isArray(d.succeeded) ? d.succeeded.length : (d.succeeded ?? 0);
      const failed = Array.isArray(d.failed) ? d.failed.length : (d.failed ?? 0);
      const bits = [`${ok} ok${failed ? `, ${failed} failed` : ""}`];
      if (el) bits.push(el);
      return { tagClass: failed ? "tool-fail" : "tool-ok", tag: "prefire", msg: bits.join(" — ") };
    }

    default:
      return null;
  }
}

/**
 * Classify a service-probe outcome into the status the Setup panel renders.
 *
 * Kept here (pure, testable) because collapsing these four cases into
 * up/down is what made a fully healthy fleet render as a wall of red: every
 * service answered 200, several just took longer than the old 4s budget.
 *
 * @param {{ok?: boolean, status?: number, ms?: number, error?: string}} r
 * @param {{slowMs?: number}} [opts]
 * @returns {"up"|"slow"|"timeout"|"error"|"down"}
 */
function classifyProbe(r, opts) {
  const slowMs = (opts && opts.slowMs) || 2000;
  const res = r || {};
  if (res.error) {
    return res.error === "TimeoutError" || res.error === "AbortError" ? "timeout" : "down";
  }
  if (!res.ok) return "error";
  return typeof res.ms === "number" && res.ms >= slowMs ? "slow" : "up";
}

/** Whether a probe outcome means the service is RUNNING (slow still counts). */
function probeIsRunning(status) {
  return status === "up" || status === "slow";
}

/** Whether a probe outcome is a CONFIRMED failure (a timeout is inconclusive). */
function probeIsBroken(status) {
  return status === "down" || status === "error";
}

if (typeof self !== "undefined") {
  self.AitherTraceEvents = {
    describeTraceEvent, formatElapsed, classifyProbe, probeIsRunning, probeIsBroken,
  };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    describeTraceEvent, formatElapsed, classifyProbe, probeIsRunning, probeIsBroken,
  };
}
