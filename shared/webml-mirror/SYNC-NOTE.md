# WebML Mirror — synced from `awkit` `dist/webml/`

**DO NOT EDIT BY HAND** — regenerate via `node tools/sync-webml.mjs`.

These files are a verbatim mirror of portal-kit's *compiled* WebML stack
(the single source of truth for in-browser WebGPU models and their wire
protocol), with two mechanical transforms applied by the sync script:

1. **Import extensions rewritten** for native browser ESM
   (`from "./models"` → `from "./models.js"` — the extension has no bundler).
2. **`models.iife.js` is generated** from `models.js` so classic-script
   consumers (`background.js` via `importScripts`, `options.html` via
   `<script src>`) can read `self.AitherWebMLModels`.

`SYNC.json` records sha256 hashes of the **source** dist files plus the
portal-kit commit they came from. Drift guard: `tests/webml-sync.test.js`
re-hashes the source (when the AitherOS repo is present on the machine) and
fails with "run node tools/sync-webml.mjs" on mismatch.

Never edit `portal-kit/src/webml/*` from this repo — the extension mirrors
dist output only.
