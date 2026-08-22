// worker-core.js — synced from awkit dist/webml — DO NOT DRIFT.
// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).
// Import extensions are rewritten for native browser ESM.
// Worker-side logic for the WebGPU runtimes, shared across consumers.
//
// It does NOT create the Worker (that must be done by the consuming app with a
// bundler-resolvable `new URL('./entry', import.meta.url)` — workers can't be
// instantiated from a bare package specifier). Instead each consumer ships a worker
// entry that imports and dispatches to this module:
//
//   import { runWebMLWorker } from "awkit/webml/worker-core";
//   runWebMLWorker(self as any, { loadTransformers: () => import("@huggingface/transformers") });
//
// The consumer injects `loadTransformers` because it owns the (large, optional)
// transformers.js dependency; portal-kit never imports it directly.
//
// Supported runtimes:
// - `transformers-js`: HuggingFace transformers + WebGPU (via injected loader)
// - `bonsai-kernels`: Aitherium's clean-room WGSL kernels + PrismML GGUF models
import { getWebMLModel } from "./models.js";
export function runWebMLWorker(scope, deps) {
    // Set up a dispatcher that routes to the appropriate runtime based on first load.
    // Both runtimes implement the same protocol, so we delegate all messages after
    // the first load to the runtime-specific handler.
    let runtimeHandler = null;
    async function handleFirstLoad(modelId) {
        const model = getWebMLModel(modelId);
        if (!model) {
            scope.postMessage({
                type: "error",
                message: `unknown model '${modelId}'`,
            });
            return;
        }
        if (model.runtime === "transformers-js") {
            const handler = await initTransformersRuntime(scope, deps);
            runtimeHandler = handler;
            handler({ type: "load", modelId });
        }
        else if (model.runtime === "bonsai-kernels") {
            const handler = await initBonsaiRuntime(scope);
            runtimeHandler = handler;
            handler({ type: "load", modelId });
        }
        else {
            scope.postMessage({
                type: "error",
                message: `model '${modelId}' uses the '${model.runtime}' runtime, not wired in this worker yet`,
            });
        }
    }
    scope.addEventListener("message", (e) => {
        const req = e.data;
        if (!runtimeHandler) {
            if (req.type === "load") {
                void handleFirstLoad(req.modelId);
            }
        }
        else {
            runtimeHandler(req);
        }
    });
}
/**
 * Initialize transformers.js runtime. Returns a handler for subsequent messages.
 */
async function initTransformersRuntime(scope, deps) {
    let pipe = null;
    let stopped = false;
    const post = (msg) => scope.postMessage(msg);
    async function load(modelId) {
        const model = getWebMLModel(modelId);
        if (!model)
            return post({ type: "error", message: `unknown model '${modelId}'` });
        try {
            const { pipeline } = await deps.loadTransformers();
            pipe = await pipeline(model.task, model.repo, {
                device: "webgpu",
                dtype: model.dtype ?? "q4",
                progress_callback: (p) => {
                    if (p && p.status === "progress")
                        post({ ...p, type: "progress" });
                },
            });
            post({ type: "ready", modelId });
        }
        catch (e) {
            post({ type: "error", message: `load failed: ${e.message}` });
        }
    }
    async function generate(req) {
        if (!pipe)
            return post({ type: "error", message: "no model loaded — send {type:'load'} first" });
        stopped = false;
        try {
            const { TextStreamer } = await deps.loadTransformers();
            const generator = pipe;
            let count = 0;
            const start = performance.now();
            const streamer = new TextStreamer(generator.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (text) => {
                    if (stopped)
                        return;
                    count += 1;
                    post({ type: "token", text });
                },
            });
            const out = await generator(req.messages, {
                max_new_tokens: req.maxTokens ?? 512,
                do_sample: (req.temperature ?? 0) > 0,
                temperature: req.temperature ?? 1.0,
                streamer,
            });
            const seconds = (performance.now() - start) / 1000;
            const last = out?.[0]?.generated_text;
            const text = Array.isArray(last) && last.length
                ? String(last[last.length - 1]?.content ?? "")
                : String(last ?? "");
            post({ type: "done", text, tokensPerSecond: seconds > 0 ? count / seconds : undefined });
        }
        catch (e) {
            post({ type: "error", message: `generate failed: ${e.message}` });
        }
    }
    return (req) => {
        if (req.type === "load")
            void load(req.modelId);
        else if (req.type === "generate")
            void generate(req);
        else if (req.type === "interrupt")
            stopped = true;
    };
}
/**
 * Initialize Bonsai runtime. Returns a handler for subsequent messages.
 */
async function initBonsaiRuntime(scope) {
    const { initBonsaiRuntime: createBonsaiHandler } = await import("./bonsai-worker-core");
    const handler = await createBonsaiHandler(scope);
    return (req) => {
        if (req.type === "load")
            void handler.load(req.modelId);
        else if (req.type === "generate")
            void handler.generate(req);
        else if (req.type === "interrupt")
            handler.interrupt();
    };
}
