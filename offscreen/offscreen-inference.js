/**
 * AitherConnect Offscreen Document — On-Device WebGPU Inference Host
 * ===================================================================
 * ES module companion to offscreen.js (audio). Hosts the transformers.js
 * WebGPU runtime driven by portal-kit's worker-core, speaking the portal-kit
 * WebML wire protocol (see shared/webml-mirror/protocol.js) over a
 * chrome.runtime.Port named "offscreen-inference".
 *
 * The offscreen document is a page context (navigator.gpu available) that
 * survives sidepanel close — the loaded pipeline stays warm across chats.
 * background.js owns dispatch; this file only hosts the runtime.
 */

import { pipeline, TextStreamer, env } from "../shared/vendor/webml/transformers.min.js";
import { runWebMLWorker } from "../shared/webml-mirror/worker-core.js";
import { getWebMLModel } from "../shared/webml-mirror/models.js";

// ── ORT/transformers environment (MV3-safe) ────────────────────────────────
// wasm assets resolve to the vendored copies — no CDN, no remote code.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("shared/vendor/webml/");
env.backends.onnx.wasm.numThreads = 1;   // MV3 CSP blocks blob: pthread workers
env.backends.onnx.wasm.proxy = false;    // proxy path references unshipped ort.bundle.min.mjs
env.allowLocalModels = false;            // weights come from HF, not the extension package
// env.useBrowserCache stays default true → caches.open("transformers-cache")

// ── worker-core shim scope (no Worker — offscreen has no UI to jank) ───────
// worker-core expects a Worker-like scope: postMessage out, addEventListener in.
let _port = null;
const _handlers = [];
// The id of the flow (load/generate request) currently being serviced.
// worker-core hosts a single pipeline and background serializes flows over the
// shared port, so this unambiguously tags every async emission back to the
// flow that triggered it — letting concurrent background handlers (a chat vs. an
// options-page download) ignore messages that aren't theirs.
let _currentFlowId = null;

const shimScope = {
  postMessage: (msg) => {
    try {
      const out = (_currentFlowId != null && msg && msg.flowId === undefined)
        ? { ...msg, flowId: _currentFlowId }
        : msg;
      _port?.postMessage(out);
    } catch { /* port gone — drop */ }
  },
  addEventListener: (type, cb) => {
    if (type === "message") _handlers.push(cb);
  },
};

runWebMLWorker(shimScope, {
  loadTransformers: async () => ({ pipeline, TextStreamer }),
});

/** Feed a protocol request into worker-core's registered handlers. */
function dispatchToCore(msg) {
  for (const cb of _handlers) cb({ data: msg });
}

// ── Capability probe (extension-local request type, not in portal-kit) ─────
async function probeCapabilities() {
  try {
    const a = await navigator.gpu?.requestAdapter();
    return {
      type: "capability-result",
      webgpu: !!a,
      f16: a?.features?.has("shader-f16") ?? false,
      subgroups: a?.features?.has("subgroups") ?? false,
      adapter: a?.info?.vendor ?? null,
    };
  } catch (e) {
    return { type: "capability-result", webgpu: false, f16: false, subgroups: false, adapter: null, error: e.message };
  }
}

// ── Port lifecycle ─────────────────────────────────────────────────────────
function connect() {
  if (_port) return;
  _port = chrome.runtime.connect({ name: "offscreen-inference" });

  _port.onMessage.addListener(async (msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === "capability") {
      const caps = await probeCapabilities();
      try { _port?.postMessage(caps); } catch { /* port gone */ }
      return;
    }

    // Remember which flow this request belongs to so worker-core's async
    // emissions (progress/ready/token/done/error) can be stamped back to it.
    if (msg.type === "load" || msg.type === "generate") {
      _currentFlowId = msg.flowId ?? null;
    }

    // Guard: models whose runtime hasn't landed yet ("summoning soon" slots)
    if (msg.type === "load") {
      const model = getWebMLModel(msg.modelId);
      if (model && model.ready !== true) {
        try {
          _port?.postMessage({
            type: "error",
            message: `${model.label} is summoning soon — runtime not yet landed`,
            flowId: msg.flowId,
          });
        } catch { /* port gone */ }
        return;
      }
    }

    // load / generate / interrupt go straight to worker-core
    dispatchToCore(msg);
  });

  _port.onDisconnect.addListener(() => {
    // Background went away (SW restart or explicit disconnect). Stop token
    // emission but keep the loaded pipeline singleton warm for reconnects.
    dispatchToCore({ type: "interrupt" });
    _port = null;
  });
}

// Background pokes us when it needs the port re-established after an SW
// restart (a fresh doc connects on load; an existing doc reconnects here).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "webml-reconnect") {
    connect();
    sendResponse({ ok: true });
  }
  // no async response
});

// Connect to background immediately on load
connect();
