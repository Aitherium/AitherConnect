// worker-core.js — synced from @aitheros/portal-kit dist/webml — DO NOT DRIFT.
// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).
// Import extensions are rewritten for native browser ESM.
// Worker-side logic for the transformers.js WebGPU runtime, shared across consumers.
//
// It does NOT create the Worker (that must be done by the consuming app with a
// bundler-resolvable `new URL('./entry', import.meta.url)` — workers can't be
// instantiated from a bare package specifier). Instead each consumer ships a 2-line
// worker entry:
//
//   import { runWebMLWorker } from "@aitheros/portal-kit/webml/worker-core";
//   runWebMLWorker(self as any, { loadTransformers: () => import("@huggingface/transformers") });
//
// The consumer injects `loadTransformers` because it owns the (large, optional) dependency;
// portal-kit never imports it directly, so nothing forces it into portal-kit's node_modules.
//
// Only the `transformers-js` runtime is handled here; `bonsai-kernels` / `bonsai-image`
// get their own worker-core modules in later phases.
import { getWebMLModel } from "./models.js";
export function runWebMLWorker(scope, deps) {
    // Lazily imported so the (large) transformers.js bundle only loads once a model is
    // requested, and so importing this module never pulls it onto the main thread.
    let pipe = null;
    let stopped = false;
    const post = (msg) => scope.postMessage(msg);
    async function load(modelId) {
        const model = getWebMLModel(modelId);
        if (!model)
            return post({ type: "error", message: `unknown model '${modelId}'` });
        if (model.runtime !== "transformers-js") {
            return post({
                type: "error",
                message: `model '${modelId}' uses the '${model.runtime}' runtime, not wired in this worker yet`,
            });
        }
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
    scope.addEventListener("message", (e) => {
        const req = e.data;
        if (req.type === "load")
            void load(req.modelId);
        else if (req.type === "generate")
            void generate(req);
        else if (req.type === "interrupt")
            stopped = true;
    });
}
