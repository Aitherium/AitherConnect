/**
 * ArcSurprise — the "surprise sparkline" for in-browser ARC learning.
 *
 * Scores each game move with a VoE-flavored surprise and renders the series as
 * a dependency-free inline SVG. Mirrors the service's surprise pipeline
 * (get_voe_history -> lib.cognitive.LatentPredictor VoE events: z-scores,
 * severities, timestamps); the browser journal produces the same event-series
 * shape, so the same visualization can be fed from either source.
 *
 * Surprise semantics (state-transition based; reward is recorded, not scored):
 *   - novel (state, action) never seen            -> 1.0   (max surprise)
 *   - contradiction (a DIFFERENT next state was predicted) -> 0.75
 *   - correct prediction                          -> 1 / (1 + count)
 *     — surprise shrinks as the same transition is observed repeatedly.
 *
 * The core claim of the BYO-cognition program — "surprise drops as the model
 * learns" — is asserted by sparkline.test.js: a repeated pattern drives the
 * per-pass mean down 1.0 -> 0.5 -> 1/3 -> ...
 *
 * Load world-model.js FIRST in a browser (this module resolves ArcWorldModel).
 * UMD: attaches self.ArcSurprise in a browser, module.exports under node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ArcSurprise = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const WM = (typeof module === "object" && module.exports)
    ? require("./world-model.js")
    : (globalThis.ArcWorldModel || {}); // `root` is NOT in scope here — it is the
    // outer IIFE's param, not this factory's. Resolve the engine from
    // globalThis, which is in scope in both browser and node.

  const SURPRISE_NOVEL = 1.0;
  const SURPRISE_CONTRADICTION = 0.75;

  /** Surprise of moving from `state` via `action` to `nextState`, given wm. */
  function surpriseForMove(wm, state, action, nextState) {
    if (!WM.stableHash) {
      throw new Error("ArcSurprise: load world-model.js before surprise-sparkline.js");
    }
    const sh = WM.stableHash(state);
    const nh = WM.stableHash(nextState);
    const count = wm.predictCount(sh, action);
    if (count === 0) return SURPRISE_NOVEL;
    const pred = wm.predict(sh, action);
    if (!pred || pred.nextStateHash !== nh) return SURPRISE_CONTRADICTION;
    return 1 / (1 + count);
  }

  /**
   * Evaluate-then-learn over a move log. Each move's surprise is scored against
   * the model as it stands BEFORE that move is recorded — i.e. true prediction
   * error — then observe() learns from it. Returns the event series.
   * moves: [{state, action, nextState, reward?, done?, resultType?, label?, timestamp?}]
   */
  function learnFromMoves(wm, moves) {
    const events = [];
    for (const m of moves) {
      events.push({
        surprise: surpriseForMove(wm, m.state, m.action, m.nextState),
        move: m.label || String(m.action),
        timestamp: m.timestamp == null ? null : m.timestamp,
      });
      wm.observe(m.state, m.action, m.nextState, m.reward || 0, !!m.done, m.resultType);
    }
    return events;
  }

  function movingAverage(values, window) {
    const w = Math.max(1, window | 0);
    return values.map((_, i) => {
      const lo = Math.max(0, i - w + 1);
      let s = 0;
      for (let j = lo; j <= i; j++) s += values[j];
      return s / (i - lo + 1);
    });
  }

  /**
   * Render the surprise series as an inline SVG string. Two strokes: the raw
   * per-move surprise and a moving-average line (the visible "learning" trend).
   * The y-scale spans [0, 1] (surprise is bounded), with dashed guides at the
   * contradiction (0.75) and novel (1.0) levels.
   */
  function renderSparkline(events, opts) {
    opts = opts || {};
    const width = opts.width || 360;
    const height = opts.height || 88;
    const padL = opts.padLeft != null ? opts.padLeft : 4;
    const padR = opts.padRight != null ? opts.padRight : 4;
    const padT = opts.padTop != null ? opts.padTop : 8;
    const padB = opts.padBottom != null ? opts.padBottom : 4;
    const stroke = opts.stroke || "#34d399";
    const maStroke = opts.maStroke || "#a7f3d0";
    const bg = opts.background || "#0d1526";
    const window = opts.window || 5;
    const values = events.map((e) => Number(e.surprise)).filter((v) => Number.isFinite(v));

    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = values.length;
    const min = n ? Math.min(0, ...values) : 0;
    const max = n ? Math.max(1, ...values) : 1;
    const span = (max - min) || 1;
    const x = (i) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
    const y = (v) => padT + (1 - (v - min) / span) * innerH;
    const fmt = (v) => v.toFixed(1);

    let body = "";
    if (n > 0) {
      const pts = values.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(" ");
      body +=
        `<polygon points="${padL},${height - padB} ${pts} ${width - padR},${height - padB}" fill="${stroke}" opacity="0.10"/>` +
        `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n >= window) {
        const maPts = movingAverage(values, window)
          .map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(" ");
        body += `<polyline points="${maPts}" fill="none" stroke="${maStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
      }
      body +=
        `<line x1="${padL}" y1="${fmt(y(SURPRISE_NOVEL))}" x2="${width - padR}" y2="${fmt(y(SURPRISE_NOVEL))}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 4" opacity="0.35"/>` +
        `<line x1="${padL}" y1="${fmt(y(SURPRISE_CONTRADICTION))}" x2="${width - padR}" y2="${fmt(y(SURPRISE_CONTRADICTION))}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 4" opacity="0.2"/>`;
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="surprise over time">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>` +
      body +
      `</svg>`
    );
  }

  /** Tiny summary for a stat line: first vs last moving-average surprise. */
  function sparklineSummary(events, window) {
    const values = events.map((e) => Number(e.surprise)).filter((v) => Number.isFinite(v));
    if (values.length === 0) return { count: 0, firstAvg: null, lastAvg: null };
    const ma = movingAverage(values, window || 5);
    return {
      count: values.length,
      firstAvg: ma[0],
      lastAvg: ma[ma.length - 1],
    };
  }

  return {
    SURPRISE_NOVEL,
    SURPRISE_CONTRADICTION,
    surpriseForMove,
    learnFromMoves,
    renderSparkline,
    sparklineSummary,
  };
});
