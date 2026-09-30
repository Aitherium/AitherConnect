#!/usr/bin/env node
/**
 * Run EVERY test file in this directory, one at a time.
 *
 * The npm "test" script used to be a hand-maintained `node a && node b && ...`
 * chain. A new test file that nobody appended to it never ran, and nothing
 * said so: of 19 files, 7 (bonsai-consent, mcp-url-behavior, mcp-url-wiring,
 * os-origin-guard, overlay-summon, settings-sync, social-plan) were orphans.
 * This runner globs instead, so a file named *.test.mjs / *.test.js runs by
 * existing.
 *
 * Known pre-existing failures are listed EXPLICITLY below with the debt id
 * that owns them -- never skipped silently. An expected failure that starts
 * passing FAILS the run too, so the list cannot outlive the defect.
 *
 * Sequential on purpose: several suites stub globalThis.fetch, and machines
 * that run this are often memory-tight.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** file -> why it is expected to fail today (one line; this tree is published, so no internal ledger ids). */
export const EXPECTED_FAIL = Object.freeze({
  "webml-sync.test.js":
    "shared/webml-mirror hashes and model readiness drifted from the upstream kit; re-run tools/sync-webml.mjs",
});

/** The suite entry, plus every *.test.{mjs,js}, plus the legacy test-*.mjs name. */
export function discover(dir = here) {
  const names = fs.readdirSync(dir).filter((f) =>
    f === "run-tests.mjs" || /\.test\.(mjs|js)$/.test(f) || /^test-.*\.mjs$/.test(f));
  names.sort((a, b) => (a === "run-tests.mjs" ? -1 : b === "run-tests.mjs" ? 1 : a.localeCompare(b)));
  return names;
}

function main() {
  const files = discover();
  const results = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(here, f)], {
      cwd: here, encoding: "utf8", timeout: 300000,
    });
    const passed = r.status === 0;
    results.push({ f, passed, out: (r.stdout || "") + (r.stderr || "") });
    console.log(`${passed ? "PASS" : "FAIL"}  ${f}`);
  }

  console.log("\nExpected failures (each owned by a debt id):");
  for (const [f, why] of Object.entries(EXPECTED_FAIL)) console.log(`  ${f} -- ${why}`);

  const bad = [];
  for (const { f, passed, out } of results) {
    const expected = Object.prototype.hasOwnProperty.call(EXPECTED_FAIL, f);
    if (!passed && !expected) {
      bad.push(`${f} failed`);
      console.log(`\n----- ${f} -----\n${out.slice(-4000)}`);
    }
    if (passed && expected) bad.push(`${f} passes now: remove it from EXPECTED_FAIL`);
  }
  for (const f of Object.keys(EXPECTED_FAIL)) {
    if (!files.includes(f)) bad.push(`EXPECTED_FAIL names ${f}, which does not exist`);
  }

  console.log(`\n${files.length} files, ${results.filter((r) => r.passed).length} passed, ` +
    `${Object.keys(EXPECTED_FAIL).length} expected to fail`);
  if (bad.length) {
    console.log("\nRUN FAILED:\n  " + bad.join("\n  "));
    process.exit(1);
  }
  console.log("RUN OK");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
