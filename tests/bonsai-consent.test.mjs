#!/usr/bin/env node
/**
 * Awconnect On-Device Model Consent
 * =================================
 * An extension has no page to put a dialog on and nobody watching when its alarms fire, so
 * consent for a 236 MB - 3.6 GB download is a SETTING the owner turned on once. Two halves,
 * and either alone is worthless:
 *
 *   - the GATE, in offscreen/offscreen-inference.js, and
 *   - the CONTROL, in options/options.html + options.js.
 *
 * AC001 in check_aitherconnect_wiring.py records what a flag with no control is worth: it is
 * deleted code, and it cost weeks of a silently dead command bar. So this asserts both.
 *
 * The decision function is EXECUTED, not grepped. `offscreen-inference.js` is an ES module
 * that pulls in the whole webml runtime, so the two functions under test are lifted out and
 * run against a stubbed `chrome` — which is the only way to prove the three answers that
 * matter: unset is off, false is off, and an unreadable store is off. A source scan can see
 * that a key is mentioned; it cannot see which way the comparison points.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const offscreen = read('offscreen', 'offscreen-inference.js');
const optionsJs = read('options', 'options.js');
const optionsHtml = read('options', 'options.html');

const SETTING = 'bonsaiOnDeviceEnabled';

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m' };
let passCount = 0;
let failCount = 0;

function it(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
  } catch (e) {
    failCount++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${e.message}`);
  }
}

/** Lift `onDeviceModelAllowed` out of the module and bind it to a stub store. */
function allowedWith(store) {
  const m = offscreen.match(
    /async function onDeviceModelAllowed\(\)\s*\{[\s\S]*?\n\}/,
  );
  assert.ok(m, 'onDeviceModelAllowed() is not in offscreen-inference.js at all');
  const key = offscreen.match(/const BONSAI_ON_DEVICE_KEY = "([^"]+)";/);
  assert.ok(key, 'BONSAI_ON_DEVICE_KEY is not declared');
  const chrome = {
    storage: {
      local: {
        get: async () => {
          if (store === 'throws') throw new Error('storage denied');
          return store;
        },
      },
    },
  };
  const factory = new Function(
    'chrome',
    `const BONSAI_ON_DEVICE_KEY = ${JSON.stringify(key[1])};
     ${m[0]}
     return onDeviceModelAllowed;`,
  );
  return factory(chrome)();
}

console.log('\nAwconnect on-device model consent\n');

// ── The gate, executed ───────────────────────────────────────────────────────────────
await (async () => {
  const unset = await allowedWith({});
  it('unset => refused', () => assert.strictEqual(unset, false));

  const off = await allowedWith({ [SETTING]: false });
  it('explicitly false => refused', () => assert.strictEqual(off, false));

  // The trap this guards: every OTHER toggle in this extension defaults ON via `!== false`.
  // Copying that idiom here would make an unattended multi-gigabyte download the shipped
  // default, which is the entire defect.
  const truthy = await allowedWith({ [SETTING]: 'yes' });
  it('a truthy non-true value => refused (=== true, never !== false)', () =>
    assert.strictEqual(truthy, false));

  const on = await allowedWith({ [SETTING]: true });
  it('explicitly true => allowed (the gate is not a permanent wall)', () =>
    assert.strictEqual(on, true));

  const broken = await allowedWith('throws');
  it('an unreadable store => refused, never assumed', () =>
    assert.strictEqual(broken, false));
})();

// ── The control, which must exist and be wired (AC001) ───────────────────────────────
it('options.html renders a checkbox the owner can actually toggle', () => {
  assert.ok(
    optionsHtml.includes(`id="${SETTING}"`),
    `options.html has no control with id=${SETTING} — a gate nobody can open is the feature ` +
      `deleted, not the feature protected`,
  );
});

it('options.js persists the toggle to the SAME key the gate reads', () => {
  assert.ok(optionsJs.includes(SETTING), `options.js never mentions ${SETTING}`);
  assert.ok(
    /chrome\.storage\.local[\s\S]{0,200}\.set\(\{\s*\[BONSAI_ON_DEVICE_KEY\]/.test(optionsJs),
    'options.js does not write the key into chrome.storage.local',
  );
});

it('only a user surface writes it — coordination code must not (AC002)', () => {
  // A content script once wrote a user-facing kill switch as internal coordination. That
  // write is STICKY: it outlives the page, the tab and the browser, so the X account posted
  // nothing for weeks with every surface reporting "enabled". Coordination uses a lease that
  // expires; a permission uses a setting only the owner writes.
  const writers = ['content', 'background.js', 'sidepanel'];
  for (const dir of writers) {
    const target = path.join(__dirname, '..', dir);
    if (!fs.existsSync(target)) continue;
    const files = fs.statSync(target).isDirectory()
      ? fs.readdirSync(target).map((f) => path.join(target, f))
      : [target];
    for (const f of files) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(f, 'utf8');
      const writes = new RegExp(`storage\\.local[\\s\\S]{0,120}set\\([^)]*${SETTING}`);
      assert.ok(
        !writes.test(src),
        `${path.relative(path.join(__dirname, '..'), f)} writes ${SETTING} — only the ` +
          `options page may write a user permission`,
      );
    }
  }
});

it('every load branch passes the gate, not just the Bonsai one', () => {
  // The transformers.js lane fetches weights from a CDN just as unaskedly. Gating only the
  // runtime named in the bug report is how the next lane goes unguarded.
  const branches = (offscreen.match(/msg\.type === "load"/g) || []).length;
  const checks = (offscreen.match(/onDeviceModelAllowed\(\)/g) || []).length;
  assert.ok(branches > 0, 'no load branch found — this test is reading the wrong file');
  assert.ok(
    checks >= branches,
    `${branches} load branch(es) but only ${checks} consent check(s)`,
  );
});

console.log(`\n${passCount} passed, ${failCount} failed\n`);
process.exit(failCount === 0 ? 0 : 1);
