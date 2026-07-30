#!/usr/bin/env node
/**
 * WebML mirror drift guard + registry shape assertions.
 *
 * 1. If the portal-kit dist path exists on this machine, re-hash the source
 *    files and compare against shared/webml-mirror/SYNC.json — fail with
 *    "run node tools/sync-webml.mjs" on mismatch. Skip (warn) when the
 *    AitherOS repo is absent (CI without the monorepo checkout).
 * 2. Assert models.iife.js parses and defines the three model ids with
 *    `ready` booleans and `approxDownloadMB` numbers.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(__dirname, '..');
const mirrorDir = path.join(extRoot, 'shared', 'webml-mirror');

const colors = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', blue: '\x1b[36m',
};

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
  } catch (err) {
    failCount++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    failures.push({ name, error: err.message });
  }
}

console.log(`${colors.blue}=== WebML SYNC DRIFT GUARD ===${colors.reset}\n`);

// ── 1. Drift guard against portal-kit dist ──────────────────────────

const aitherosRoot = process.env.AITHEROS_ROOT || 'D:\\AitherOS-Fresh\\AitherOS';
const srcDir = [
  path.join(aitherosRoot, 'apps', 'packages', 'portal-kit', 'dist', 'webml'),
  path.join(aitherosRoot, 'AitherOS', 'apps', 'packages', 'portal-kit', 'dist', 'webml'),
].find((p) => fs.existsSync(p));

const syncJsonPath = path.join(mirrorDir, 'SYNC.json');

test('webml-sync: SYNC.json exists and parses', () => {
  const sync = JSON.parse(fs.readFileSync(syncJsonPath, 'utf8'));
  assert(sync.files && typeof sync.files === 'object');
  assert(sync.syncedAt);
});

if (srcDir) {
  const sync = JSON.parse(fs.readFileSync(syncJsonPath, 'utf8'));
  for (const [name, expectedHash] of Object.entries(sync.files)) {
    test(`webml-sync: ${name} matches portal-kit dist (no drift)`, () => {
      const srcPath = path.join(srcDir, name);
      assert(fs.existsSync(srcPath), `source file missing: ${srcPath}`);
      const actual = crypto.createHash('sha256').update(fs.readFileSync(srcPath)).digest('hex');
      assert.strictEqual(
        actual, expectedHash,
        `${name} drifted from portal-kit dist — run node tools/sync-webml.mjs`,
      );
    });
  }
} else {
  console.log(`${colors.yellow}⚠ AitherOS repo not found (AITHEROS_ROOT=${aitherosRoot}) — skipping source-hash drift check${colors.reset}`);
}

// ── 2. Mirror files present and un-edited (machine-independent) ─────

for (const name of ['models.js', 'protocol.js', 'worker-core.js', 'models.iife.js']) {
  test(`webml-sync: mirror file ${name} exists`, () => {
    assert(fs.existsSync(path.join(mirrorDir, name)));
  });
}

{
  const sync = JSON.parse(fs.readFileSync(syncJsonPath, 'utf8'));
  for (const [name, expectedHash] of Object.entries(sync.mirror || {})) {
    test(`webml-sync: mirror file ${name} not hand-edited`, () => {
      const actual = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(mirrorDir, name)))
        .digest('hex');
      assert.strictEqual(
        actual, expectedHash,
        `${name} was edited by hand — run node tools/sync-webml.mjs`,
      );
    });
  }
}

// ── 3. models.iife.js parses and defines the expected registry ──────

globalThis.self = globalThis;
const iifeCode = fs.readFileSync(path.join(mirrorDir, 'models.iife.js'), 'utf8');

test('webml-sync: models.iife.js evaluates without error', () => {
  new Function(iifeCode)();
  assert(self.AitherWebMLModels, 'self.AitherWebMLModels not defined');
});

test('webml-sync: registry exports WEBML_MODELS + getWebMLModel + isWebGPUAvailable', () => {
  const m = self.AitherWebMLModels;
  assert(Array.isArray(m.WEBML_MODELS));
  assert.strictEqual(typeof m.getWebMLModel, 'function');
  assert.strictEqual(typeof m.isWebGPUAvailable, 'function');
});

for (const id of ['gemma-4-e2b', 'bonsai-27b-text', 'bonsai-image']) {
  test(`webml-sync: model ${id} present with ready boolean + approxDownloadMB`, () => {
    const row = self.AitherWebMLModels.getWebMLModel(id);
    assert(row, `model ${id} missing from registry`);
    assert.strictEqual(typeof row.ready, 'boolean', `${id}.ready must be boolean`);
    assert.strictEqual(typeof row.approxDownloadMB, 'number', `${id}.approxDownloadMB must be number`);
    assert(row.label, `${id}.label missing`);
  });
}

test('webml-sync: gemma-4-e2b is ready, bonsai slots are not', () => {
  const m = self.AitherWebMLModels;
  assert.strictEqual(m.getWebMLModel('gemma-4-e2b').ready, true);
  assert.strictEqual(m.getWebMLModel('bonsai-27b-text').ready, false);
  assert.strictEqual(m.getWebMLModel('bonsai-image').ready, false);
});

test('webml-sync: vendored transformers.js + ORT assets present', () => {
  const vendorDir = path.join(extRoot, 'shared', 'vendor', 'webml');
  for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    assert(fs.existsSync(path.join(vendorDir, f)), `missing vendored asset: ${f}`);
  }
});

// ── Report ──────────────────────────────────────────────────────────

console.log(`\n${colors.green}Passed: ${passCount}${colors.reset}`);
console.log(`${colors.red}Failed: ${failCount}${colors.reset}`);
console.log(`Total:  ${testCount}`);

if (failures.length > 0) {
  console.log(`\n${colors.red}Failures:${colors.reset}`);
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    ${f.error}`);
  }
}

process.exit(failCount > 0 ? 1 : 0);
