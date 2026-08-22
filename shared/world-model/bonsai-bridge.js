/**
 * ArcBonsai — thin adapter for the EXISTING in-browser Bonsai runtime.
 *
 * This does NOT implement Bonsai. It drives the runtime the platform already
 * ships and runs at aitherium.com: shared/webml-mirror/bonsai-worker.js
 * (bundled from apps/AitherVeil/src/lib/bonsai-webgpu). The bridge only:
 *   1. GATES WebGPU first (the TDR lesson — never spin up GPU work without a
 *      usable adapter; a no-GPU machine gets a clean "disabled" state, never a
 *      crash and never a driver reset),
 *   2. creates the module worker, and
 *   3. routes the worker's wire protocol:
 *        in:  {type:"load", modelId} | {type:"generate", messages, maxTokens?, temperature?}
 *             | {type:"interrupt"}
 *        out: {type:"progress", progress, file} | {type:"ready", modelId}
 *             | {type:"token", text} | {type:"done", text, reasoning?, tokensPerSecond}
 *             | {type:"error", message} | {type:"tool_action", actions}
 *
 * Small-model default is bonsai-1.7b (the lightest, "runs right here in your
 * browser, quick enough on a phone") — the TDR-consistent choice. Override via
 * createBonsaiBridge(worker, {modelId}) / load(modelId).
 *
 * Flows are SERIALIZED: one load/generate at a time (the worker hosts a single
 * runtime). A second flow while one is in flight throws.
 *
 * UMD: attaches self.ArcBonsai in a browser, module.exports under node. The
 * worker is injected by the caller (browser: new Worker(url, {type:"module"}),
 * tests: a fake) so the protocol logic is fully node-testable.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ArcBonsai = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SMALL_MODEL_ID = "bonsai-1.7b";

  /**
   * WebGPU capability probe — fail-closed. Resolves {available, adapter?, reason?}.
   * Pass `nav` in tests to inject navigator.
   */
  function probeWebGPU(nav) {
    const n = nav || (typeof navigator !== "undefined" ? navigator : null);
    if (!n || !n.gpu) {
      return Promise.resolve({ available: false, reason: "no navigator.gpu" });
    }
    return n.gpu
      .requestAdapter({ powerPreference: "high-performance" })
      .then((adapter) =>
        adapter
          ? { available: true, adapter }
          : { available: false, reason: "requestAdapter returned null (no usable adapter)" }
      )
      .catch((err) => ({
        available: false,
        reason: String((err && err.message) || err),
      }));
  }

  /**
   * Wrap a Bonsai module worker (browser: new Worker(url, {type:"module"})).
   * worker must expose postMessage(msg), addEventListener("message"|"error", cb).
   */
  function createBonsaiBridge(worker, opts) {
    opts = opts || {};
    const modelId = opts.modelId || SMALL_MODEL_ID;
    let seq = 0;
    let activeFlow = null;
    const listeners = new Set();

    worker.addEventListener("message", (e) => {
      let msg = e.data || {};
      // The worker does not stamp flowId; attribute emissions to the active flow.
      if (msg && msg.type && activeFlow && msg.flowId === undefined) {
        msg = Object.assign({}, msg, { flowId: activeFlow });
      }
      for (const l of listeners) l(msg);
    });
    worker.addEventListener("error", (e) => {
      const msg = {
        type: "error",
        message: "bonsai worker error: " + ((e && e.message) || "unknown"),
        flowId: activeFlow,
      };
      for (const l of listeners) l(msg);
    });

    function nextFlow() {
      return "arc-bonsai-" + ++seq;
    }

    function beginFlow() {
      if (activeFlow) {
        throw new Error("ArcBonsai: a load/generate is already in flight (serialize flows)");
      }
      activeFlow = nextFlow();
      return activeFlow;
    }

    function endFlow(flowId) {
      if (activeFlow === flowId) activeFlow = null;
    }

    /** Load a model. Resolves on {type:"ready"}, rejects on {type:"error"}. */
    function load(id) {
      const flowId = beginFlow();
      return new Promise((resolve, reject) => {
        const onMsg = (msg) => {
          if (msg.flowId !== flowId) return;
          if (msg.type === "ready") {
            listeners.delete(onMsg);
            endFlow(flowId);
            resolve(msg);
          } else if (msg.type === "error") {
            listeners.delete(onMsg);
            endFlow(flowId);
            reject(new Error(msg.message || "load failed"));
          }
        };
        listeners.add(onMsg);
        worker.postMessage({ type: "load", modelId: id || modelId, flowId });
      });
    }

    /**
     * Generate a completion. handlers: {onToken(text), onProgress(pct, file),
     * onDone(doneMsg), onError(err), onToolAction(actions), onMessage(any)}.
     * Returns {flowId, interrupt()} — call interrupt() to stop generation.
     */
    function generate(req, handlers) {
      handlers = handlers || {};
      const flowId = beginFlow();
      const onMsg = (msg) => {
        if (msg.flowId !== flowId) return;
        if (msg.type === "token") handlers.onToken && handlers.onToken(msg.text, msg);
        else if (msg.type === "progress") handlers.onProgress && handlers.onProgress(msg.progress, msg.file, msg);
        else if (msg.type === "done") {
          listeners.delete(onMsg);
          endFlow(flowId);
          handlers.onDone && handlers.onDone(msg);
        } else if (msg.type === "error") {
          listeners.delete(onMsg);
          endFlow(flowId);
          handlers.onError && handlers.onError(new Error(msg.message || "generate failed"));
        } else if (msg.type === "tool_action") handlers.onToolAction && handlers.onToolAction(msg.actions, msg);
        else handlers.onMessage && handlers.onMessage(msg);
      };
      listeners.add(onMsg);
      worker.postMessage(Object.assign({ type: "generate" }, req, { flowId }));
      return {
        flowId,
        interrupt: () => worker.postMessage({ type: "interrupt" }),
      };
    }

    return {
      modelId,
      load,
      generate,
      dispose() {
        listeners.clear();
        activeFlow = null;
        try {
          if (worker.terminate) worker.terminate();
        } catch (e) { /* already gone */ }
      },
    };
  }

  return {
    SMALL_MODEL_ID,
    probeWebGPU,
    createBonsaiBridge,
  };
});
