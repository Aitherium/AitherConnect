// models.iife.js — GENERATED from portal-kit dist/webml/models.js — DO NOT EDIT.
// Synced from awkit dist/webml — do not drift.
// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).
(function () {
  "use strict";

  // WebML model registry — the single source of truth for in-browser (WebGPU) models
  // shared across Veil, portal-kit apps, and the awdk local GUI.
  //
  // Each entry declares a `runtime` so consumers stay identical while the underlying
  // execution differs: `transformers-js` is the standard transformers.js/WebGPU path
  // (drop-in); `bonsai-kernels` / `bonsai-image` are custom-WebGPU-kernel runtimes that
  // load PrismML's 1-bit GGUF and are wired in later phases. Adding a model = a new row.
  const WEBML_MODELS = [
      // Bonsai models via our own clean-room WGSL kernels (ported from the PrismML llama.cpp fork).
      // Aitherium's kernels, running on YOUR GPU, in your browser. Four sizes, all live as of 2026-07-28.
      {
          id: "bonsai-1.7b",
          label: "Bonsai 1.7B (Phone)",
          repo: "prism-ml/Bonsai-1.7B-gguf",
          runtime: "bonsai-kernels",
          task: "text-generation",
          approxDownloadMB: 236,
          blurb: "Lightest size — 236 MB, designed for phones and older devices.",
          ready: true,
      },
      {
          id: "bonsai-4b",
          label: "Bonsai 4B (Default)",
          repo: "prism-ml/Bonsai-4B-gguf",
          runtime: "bonsai-kernels",
          task: "text-generation",
          approxDownloadMB: 545,
          blurb: "Balanced: smart and fast — the recommended in-browser model.",
          ready: true,
      },
      {
          id: "bonsai-8b",
          label: "Bonsai 8B (Desktop)",
          repo: "prism-ml/Bonsai-8B-gguf",
          runtime: "bonsai-kernels",
          task: "text-generation",
          approxDownloadMB: 1104,
          blurb: "Better reasoning, ~1 GB. Desktop GPU with 8+ GB RAM.",
          ready: true,
      },
      {
          id: "bonsai-27b-text",
          label: "Bonsai 27B (Reasoning)",
          repo: "prism-ml/Bonsai-27B-gguf",
          runtime: "bonsai-kernels",
          task: "text-generation",
          approxDownloadMB: 3800,
          blurb: "Full reasoning brain. 3.6 GB, needs a real desktop GPU (e.g., RTX 4090).",
          ready: true,
      },
      {
          // Gemma via transformers.js needs an ONNX build; the mobile-QAT repo has none
          // (it's for custom kernels, like the webml-community Space). Not runnable on
          // the transformers.js path — kept as a slot until we ship Gemma WGSL kernels.
          id: "gemma-4-e2b",
          label: "Gemma 4 (E2B, mobile)",
          repo: "google/gemma-4-E2B-it-qat-mobile-transformers",
          runtime: "transformers-js",
          task: "text-generation",
          dtype: "q4",
          approxDownloadMB: 900,
          blurb: "Google's QAT mobile Gemma 4 — needs its own WebGPU kernels (coming).",
          ready: false,
      },
      {
          id: "bonsai-image",
          label: "Bonsai Image",
          repo: "prism-ml/Bonsai-27B-gguf",
          runtime: "bonsai-image",
          task: "text-to-image",
          approxDownloadMB: 3800,
          blurb: "In-browser image generation via custom WebGPU kernels (Phase 4 — not yet wired).",
          ready: false,
      },
  ];
  const DEFAULT_WEBML_MODEL_ID = "bonsai-27b-text";
  function getWebMLModel(id) {
      return WEBML_MODELS.find((m) => m.id === id);
  }
  /** Models whose runtime is actually implemented — what the picker should offer. */
  function readyWebMLModels() {
      return WEBML_MODELS.filter((m) => m.ready);
  }
  /** Runtime WebGPU capability check (call in the browser). */
  function isWebGPUAvailable() {
      return typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
  }

  self.AitherWebMLModels = {
    WEBML_MODELS,
    DEFAULT_WEBML_MODEL_ID,
    getWebMLModel,
    readyWebMLModels,
    isWebGPUAvailable,
  };
})();
