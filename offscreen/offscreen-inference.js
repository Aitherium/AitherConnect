/**
 * Awconnect Offscreen Document — On-Device WebGPU Inference Host
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

// ── Bonsai (1-bit, custom-WGSL) runtime — the SAME one aitherium.com runs, bundled
// from apps/AitherVeil/src/lib/bonsai-webgpu. It lives in a dedicated module worker
// and speaks the identical load|generate → progress|ready|token|done|error protocol,
// so we just relay its messages back to the port (stamped for the active flow). ──
// ── CONSENT ─────────────────────────────────────────────────────────────────────────
// An extension has no page to put a dialog on and no visitor watching when its alarms fire,
// so the "ask" has to be a SETTING the owner turned on once, not a prompt nobody sees. The
// control is `On-device model (Bonsai)` in options.html; this is the gate. AC001: the two
// ship together, because a flag with no control is deleted code.
//
// UNSET IS OFF, and unreadable is OFF. Every other toggle in this extension defaults ON via
// `!== false`; copying that here would make an unattended multi-gigabyte download the
// shipped default, which is exactly the thing being fixed.
const BONSAI_ON_DEVICE_KEY = "bonsaiOnDeviceEnabled";

async function onDeviceModelAllowed() {
  try {
    const s = await chrome.storage.local.get(BONSAI_ON_DEVICE_KEY);
    return s[BONSAI_ON_DEVICE_KEY] === true;
  } catch {
    return false;
  }
}

/** Tell the caller WHY, on the port it is already listening to. */
function refuseModelLoad(flowId) {
  try {
    _port?.postMessage({
      type: "error",
      message:
        "On-device inference is off. Turn on \"On-device model (Bonsai)\" in AitherConnect " +
        "options to let this extension download a model and run it on your GPU.",
      flowId: flowId ?? null,
    });
  } catch { /* port gone */ }
}

let _bonsaiWorker = null;
let _bonsaiActive = false;
function ensureBonsaiWorker() {
  if (_bonsaiWorker) return _bonsaiWorker;
  _bonsaiWorker = new Worker(chrome.runtime.getURL("shared/webml-mirror/bonsai-worker.js"), { type: "module" });
  _bonsaiWorker.onmessage = (e) => {
    const msg = e.data;
    const out = (_currentFlowId != null && msg && msg.flowId === undefined) ? { ...msg, flowId: _currentFlowId } : msg;
    try { _port?.postMessage(out); } catch { /* port gone */ }
  };
  _bonsaiWorker.onerror = (e) => {
    try { _port?.postMessage({ type: "error", message: "bonsai worker: " + (e.message || "load error"), flowId: _currentFlowId }); } catch { /* port gone */ }
  };
  return _bonsaiWorker;
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

    // Bonsai (1-bit, custom-WGSL) models run in the dedicated bonsai worker — the
    // SAME runtime aitherium.com uses. Route load/generate/interrupt there.
    if (msg.type === "load") {
      const model = getWebMLModel(msg.modelId);
      // EVERY load, not just the Bonsai one: the transformers.js lane below downloads
      // weights from a CDN just as unaskedly. Gating only the runtime that happens to be in
      // the bug report is how the next lane goes unguarded.
      if (model && model.runtime === "bonsai-kernels") {
        onDeviceModelAllowed().then((allowed) => {
          if (!allowed) { refuseModelLoad(msg.flowId); return; }
          _bonsaiActive = true;
          ensureBonsaiWorker().postMessage({ type: "load", modelId: msg.modelId, flowId: msg.flowId });
        });
        return;
      }
      _bonsaiActive = false;
      // Guard: transformers-js models whose runtime hasn't landed yet.
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
    if ((msg.type === "generate" || msg.type === "interrupt") && _bonsaiActive) {
      try { ensureBonsaiWorker().postMessage(msg); } catch { /* worker gone */ }
      return;
    }

    // Everything else → the transformers.js worker-core. A `load` here fetches weights from
    // a CDN, so it passes the same gate; anything that is not a load (generate, interrupt,
    // capability probes) moves no bytes and goes straight through.
    if (msg.type === "load") {
      onDeviceModelAllowed().then((allowed) => {
        if (!allowed) { refuseModelLoad(msg.flowId); return; }
        dispatchToCore(msg);
      });
      return;
    }
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
