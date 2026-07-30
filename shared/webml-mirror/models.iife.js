// models.iife.js — GENERATED from portal-kit dist/webml/models.js — DO NOT EDIT.
// Synced from @aitheros/portal-kit dist/webml — do not drift.
// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).
(function () {
  "use strict";

  // WebML model registry — the single source of truth for in-browser (WebGPU) models
  // shared across Veil, portal-kit apps, and the aither-adk local GUI.
  //
  // Each entry declares a `runtime` so consumers stay identical while the underlying
  // execution differs: `transformers-js` is the standard transformers.js/WebGPU path
  // (drop-in); `bonsai-kernels` / `bonsai-image` are custom-WebGPU-kernel runtimes that
  // load PrismML's 1-bit GGUF and are wired in later phases. Adding a model = a new row.
  const WEBML_MODELS = [
      {
          id: "gemma-4-e2b",
          label: "Gemma 4 (E2B, mobile)",
          repo: "google/gemma-4-E2B-it-qat-mobile-transformers",
          runtime: "transformers-js",
          task: "text-generation",
          dtype: "q4",
          approxDownloadMB: 900,
          blurb: "Google's QAT mobile Gemma 4 — runs on your GPU, in your browser, no server.",
          ready: true,
      },
      {
          id: "bonsai-27b-text",
          label: "Bonsai 27B (1-bit)",
          repo: "prism-ml/Bonsai-27B-gguf",
          runtime: "bonsai-kernels",
          task: "text-generation",
          approxDownloadMB: 3800,
          blurb: "PrismML's 1-bit 27B via custom WebGPU kernels (Phase 3 — not yet wired).",
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
  const DEFAULT_WEBML_MODEL_ID = "gemma-4-e2b";
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
