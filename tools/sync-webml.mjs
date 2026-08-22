#!/usr/bin/env node
/**
 * sync-webml.mjs — Mirror portal-kit's compiled WebML stack into the extension.
 * ============================================================================
 * Source of truth: portal-kit's compiled dist/webml/ output (in the
 * platform monorepo) — NEVER edit portal-kit/src/webml/* from here; this
 * script only consumes what `npm run build` in portal-kit produced).
 *
 * What it does:
 *   1. Copies models.js / protocol.js / worker-core.js into
 *      shared/webml-mirror/, prepending a do-not-drift header and rewriting
 *      extensionless relative imports ("./models" -> "./models.js") so the
 *      files load as native browser ESM (no bundler in the extension).
 *   2. Generates shared/webml-mirror/models.iife.js — a classic-script
 *      wrapper exposing self.AitherWebMLModels for importScripts()
 *      (background.js) and <script src> (options.html) consumers.
 *   3. Writes shared/webml-mirror/SYNC.json with sha256 hashes of the SOURCE
 *      dist files, so tests/webml-sync.test.js can detect drift.
 *
 * Usage: node tools/sync-webml.mjs
 *   Env: AITHEROS_ROOT — path to the AitherOS repo root
 *        (default: D:\AitherOS-Fresh\AitherOS)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(__dirname, "..");
const aitherosRoot = process.env.AITHEROS_ROOT || "D:\\AitherOS-Fresh\\AitherOS";
// The monorepo checkout nests portal code one directory deeper than its own
// root — accept either the checkout root or that subdirectory as AITHEROS_ROOT.
const srcDir = [
  path.join(aitherosRoot, "apps", "packages", "portal-kit", "dist", "webml"),
  path.join(aitherosRoot, "AitherOS", "apps", "packages", "portal-kit", "dist", "webml"),
].find((p) => fs.existsSync(p)) || path.join(aitherosRoot, "apps", "packages", "portal-kit", "dist", "webml");
const outDir = path.join(extRoot, "shared", "webml-mirror");

const MIRROR_FILES = ["models.js", "protocol.js", "worker-core.js"];

const HEADER = (name) =>
  `// ${name} — synced from awkit dist/webml — DO NOT DRIFT.\n` +
  `// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).\n` +
  `// Import extensions are rewritten for native browser ESM.\n`;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Rewrite extensionless relative ESM imports for native browser resolution. */
function rewriteImports(code) {
  return code.replace(
    /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, pre, spec, post) => (/\.(js|mjs|json)$/.test(spec) ? m : `${pre}${spec}.js${post}`),
  );
}

if (!fs.existsSync(srcDir)) {
  console.error(`[sync-webml] Source dir not found: ${srcDir}`);
  console.error("[sync-webml] Set AITHEROS_ROOT or build portal-kit first.");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const hashes = {};
const mirrorHashes = {};
for (const name of MIRROR_FILES) {
  const srcPath = path.join(srcDir, name);
  const raw = fs.readFileSync(srcPath);
  hashes[name] = sha256(raw);
  const rewritten = HEADER(name) + rewriteImports(raw.toString("utf8"));
  fs.writeFileSync(path.join(outDir, name), rewritten);
  mirrorHashes[name] = sha256(Buffer.from(rewritten, "utf8"));
  console.log(`[sync-webml] mirrored ${name} (${raw.length} bytes)`);
}

// ── models.iife.js: classic-script wrapper for importScripts / <script src> ──
const modelsSrc = fs.readFileSync(path.join(srcDir, "models.js"), "utf8");
const stripped = modelsSrc.replace(/^export /gm, "");
const iife =
  `// models.iife.js — GENERATED from portal-kit dist/webml/models.js — DO NOT EDIT.\n` +
  `// Synced from awkit dist/webml — do not drift.\n` +
  `// Regenerate with: node tools/sync-webml.mjs (see SYNC-NOTE.md).\n` +
  `(function () {\n  "use strict";\n\n` +
  stripped.replace(/^/gm, "  ").replace(/^  $/gm, "") +
  `\n  self.AitherWebMLModels = {\n` +
  `    WEBML_MODELS,\n` +
  `    DEFAULT_WEBML_MODEL_ID,\n` +
  `    getWebMLModel,\n` +
  `    readyWebMLModels,\n` +
  `    isWebGPUAvailable,\n` +
  `  };\n})();\n`;
fs.writeFileSync(path.join(outDir, "models.iife.js"), iife);
mirrorHashes["models.iife.js"] = sha256(Buffer.from(iife, "utf8"));
console.log(`[sync-webml] generated models.iife.js`);

// ── SYNC.json: drift-guard manifest ──
let sourceCommitHint = "unknown";
try {
  sourceCommitHint = execSync("git rev-parse --short HEAD", {
    cwd: aitherosRoot,
    encoding: "utf8",
  }).trim();
} catch {
  /* not a git checkout — hint stays "unknown" */
}

fs.writeFileSync(
  path.join(outDir, "SYNC.json"),
  JSON.stringify(
    // files: hashes of the SOURCE dist inputs (drift vs portal-kit);
    // mirror: hashes of the WRITTEN outputs (catches hand-edits to the mirror)
    { sourceCommitHint, syncedAt: new Date().toISOString(), files: hashes, mirror: mirrorHashes },
    null, 2,
  ) + "\n",
);
console.log(`[sync-webml] wrote SYNC.json (source commit: ${sourceCommitHint})`);
console.log("[sync-webml] done.");
