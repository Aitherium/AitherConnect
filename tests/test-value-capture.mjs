#!/usr/bin/env node
/**
 * FormBridge value-capture content-script tests.
 *
 * Runs content/value-capture.js against a purpose-built micro-DOM (just the
 * surface the script touches) and asserts the 06-SECURITY-MODEL behaviors:
 * anchor gating, password/ignore denylist, debounced batching, pause.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'content', 'value-capture.js');

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', blue: '\x1b[36m' };
let testCount = 0, passCount = 0, failCount = 0;
const failures = [];

async function test(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
  } catch (err) {
    failCount++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    failures.push({ name, error: err.message });
  }
}

// ── Micro-DOM ───────────────────────────────────────────────────────────────

function makeElement(tag, props = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    id: props.id || '',
    name: props.name || '',
    type: props.type || '',
    value: props.value ?? '',
    textContent: props.textContent || '',
    _selectors: props.selectors || [],   // selectors this element "matches"
    matches(sel) {
      if (this.id && sel === `#${this.id}`) return true;
      if (this.type === 'password' && sel === 'input[type=password]') return true;
      return this._selectors.includes(sel);
    },
    style: { cssText: '' },
    addEventListener() {},
    appendChild() {},
  };
  return el;
}

/** Build a fresh environment; returns helpers to drive the script. */
function makeEnv({ packCfg }) {
  const listeners = {};            // event -> [handlers]
  const byQuery = new Map();       // selector -> element
  const sentMessages = [];
  let storageChangedHandler = null;

  const documentStub = {
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector(sel) { return byQuery.get(sel) || null; },
    querySelectorAll() { return []; },
    createElement(tag) { return makeElement(tag); },
    documentElement: { appendChild() {} },
  };

  const env = {
    window: {},
    document: documentStub,
    location: { origin: 'http://localhost:8910' },
    chrome: {
      storage: {
        local: {
          get(key, cb) { cb({ [key]: packCfg }); },
        },
        onChanged: { addListener(fn) { storageChangedHandler = fn; } },
      },
      runtime: {
        sendMessage(msg, cb) {
          sentMessages.push(msg);
          if (cb) cb({ ok: true });
        },
        lastError: null,
      },
    },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),  // compress debounce
    clearTimeout,
    sent: sentMessages,
    setElement(sel, el) { byQuery.set(sel, el); },
    fire(ev, target) { for (const fn of listeners[ev] || []) fn({ target }); },
    storageChanged(changes, area) { storageChangedHandler && storageChangedHandler(changes, area); },
    async settle() { await new Promise((r) => setTimeout(r, 25)); },
  };
  return env;
}

const scriptCode = fs.readFileSync(scriptPath, 'utf8');

function runScript(env) {
  const fn = new Function(
    'window', 'document', 'location', 'chrome', 'setTimeout', 'clearTimeout',
    scriptCode,
  );
  fn(env.window, env.document, env.location, env.chrome, env.setTimeout, env.clearTimeout);
}

const PACK = {
  origin: 'http://localhost:8910',
  port: 8182,
  anchor: { selector: '#patient-name', key_selector: '#patient-id' },
  ignore: ['[name*=ssn]'],
};

function withAnchor(env) {
  env.setElement('#patient-name', makeElement('span', { id: 'patient-name', textContent: 'Pat Example' }));
  env.setElement('#patient-id', makeElement('span', { id: 'patient-id', textContent: 'DEMO-0001' }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log(`${colors.blue}=== FormBridge value-capture tests ===${colors.reset}\n`);

await test('captures an input edit into an anchored batch', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  withAnchor(env);
  env.fire('focusout', makeElement('textarea', { id: 'subjective', value: 'back pain' }));
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch, 'expected a form-capture message');
  assert.strictEqual(batch.batch.patient_key, 'DEMO-0001');
  assert.strictEqual(batch.batch.display_name, 'Pat Example');
  assert.deepStrictEqual(batch.batch.fields, [{ path: '#subjective', value: 'back pain' }]);
});

await test('debounce coalesces rapid edits into one batch', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  withAnchor(env);
  env.fire('focusout', makeElement('input', { id: 'a', value: '1' }));
  env.fire('focusout', makeElement('input', { id: 'b', value: '2' }));
  env.fire('focusout', makeElement('input', { id: 'a', value: '3' }));  // overwrites a=1
  await env.settle();
  const batches = env.sent.filter((m) => m.type === 'form-capture');
  assert.strictEqual(batches.length, 1, 'one debounced batch');
  const fields = Object.fromEntries(batches[0].batch.fields.map((f) => [f.path, f.value]));
  assert.deepStrictEqual(fields, { '#a': '3', '#b': '2' });
});

await test('password fields are NEVER captured', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  withAnchor(env);
  env.fire('focusout', makeElement('input', { name: 'portal-pass', type: 'password', value: 'hunter2' }));
  env.fire('focusout', makeElement('input', { id: 'ok', value: 'fine' }));
  await env.settle();
  const all = JSON.stringify(env.sent);
  assert(!all.includes('hunter2'), 'password value leaked');
  assert(all.includes('fine'), 'normal capture should still work');
});

await test('pack ignore selectors are NEVER captured', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  withAnchor(env);
  const ssn = makeElement('input', { name: 'ssn', value: '123-45-6789', selectors: ['[name*=ssn]'] });
  env.fire('focusout', ssn);
  env.fire('focusout', makeElement('input', { id: 'ok', value: 'fine' }));
  await env.settle();
  assert(!JSON.stringify(env.sent).includes('123-45-6789'), 'SSN value leaked');
});

await test('no anchor on page -> nothing is sent (buffered)', async () => {
  const env = makeEnv({ packCfg: PACK });  // anchor elements NOT installed
  runScript(env);
  env.fire('focusout', makeElement('input', { id: 'x', value: 'unanchored' }));
  await env.settle();
  assert.strictEqual(env.sent.filter((m) => m.type === 'form-capture').length, 0);
});

await test('buffered fields flush once the anchor appears', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  env.fire('focusout', makeElement('input', { id: 'early', value: 'typed before patient open' }));
  await env.settle();
  assert.strictEqual(env.sent.filter((m) => m.type === 'form-capture').length, 0);
  withAnchor(env);  // patient chart opens
  env.fire('focusout', makeElement('input', { id: 'late', value: 'after' }));
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch);
  const paths = batch.batch.fields.map((f) => f.path).sort();
  assert.deepStrictEqual(paths, ['#early', '#late']);
});

await test('no pack config -> script is inert', async () => {
  const env = makeEnv({ packCfg: undefined });
  runScript(env);
  withAnchor(env);
  env.fire('focusout', makeElement('input', { id: 'x', value: 'data' }));
  await env.settle();
  assert.strictEqual(env.sent.length, 0, 'nothing may be captured without a pack');
});

await test('select elements are captured on change', async () => {
  const env = makeEnv({ packCfg: PACK });
  runScript(env);
  withAnchor(env);
  env.fire('change', makeElement('select', { name: 'carrier', value: 'BCBS' }));
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch);
  assert.deepStrictEqual(batch.batch.fields, [{ path: 'select[name=carrier]', value: 'BCBS' }]);
});

// ── Tabbed single editor (the ChiroTouch Chart Notes shape) ─────────────────

const TABBED_PACK = {
  ...PACK,
  tabbed_editors: [{
    editor: '#note-editor',
    tabs: '.soap-tab',
    active: '.soap-tab.active',
    map: { Subjective: 'soap.subjective', Objective: 'soap.objective' },
  }],
};

function tabbedSetup(env) {
  withAnchor(env);
  const editor = makeElement('textarea', { id: 'note-editor', value: '' });
  env.setElement('#note-editor', editor);
  const activeTab = makeElement('button', { textContent: 'Subjective', selectors: ['.soap-tab', '.soap-tab.active'] });
  env.setElement('.soap-tab.active', activeTab);
  return { editor, activeTab };
}

await test('tabbed editor: tab click flushes content under the ACTIVE tab name', async () => {
  const env = makeEnv({ packCfg: TABBED_PACK });
  runScript(env);
  const { editor, activeTab } = tabbedSetup(env);
  editor.value = 'Patient reports lower back pain';
  // user clicks the Objective tab — outgoing Subjective content must flush first
  const objectiveTab = makeElement('button', { textContent: 'Objective', selectors: ['.soap-tab'] });
  env.fire('click', objectiveTab);
  // app swaps tab + editor content AFTER our capture-phase flush
  activeTab.textContent = 'Objective';
  editor.value = '';
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch, 'expected a capture batch');
  const fields = Object.fromEntries(batch.batch.fields.map((f) => [f.path, f.value]));
  assert.strictEqual(fields['soap.subjective'], 'Patient reports lower back pain');
  assert(!('soap.objective' in fields), 'must not attribute to the incoming tab');
});

await test('tabbed editor: blur attributes to active tab logical name (not selector)', async () => {
  const env = makeEnv({ packCfg: TABBED_PACK });
  runScript(env);
  const { editor } = tabbedSetup(env);
  editor.value = 'Exam findings here';
  env.fire('focusout', editor);
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch);
  const fields = Object.fromEntries(batch.batch.fields.map((f) => [f.path, f.value]));
  assert.strictEqual(fields['soap.subjective'], 'Exam findings here');
  assert(!('#note-editor' in fields), 'must use logical name, not the editor selector');
});

await test('tabbed editor: contenteditable DIV captured via textContent', async () => {
  const env = makeEnv({ packCfg: TABBED_PACK });
  runScript(env);
  const { } = tabbedSetup(env);
  const divEditor = makeElement('div', { id: 'note-editor', textContent: 'dictated text' });
  divEditor.value = undefined;
  env.setElement('#note-editor', divEditor);
  env.fire('focusout', divEditor);
  await env.settle();
  const batch = env.sent.find((m) => m.type === 'form-capture');
  assert(batch);
  assert.strictEqual(batch.batch.fields[0].value, 'dictated text');
});

await test('tabbed editor: unmapped tab label is never guessed', async () => {
  const env = makeEnv({ packCfg: TABBED_PACK });
  runScript(env);
  const { editor, activeTab } = tabbedSetup(env);
  activeTab.textContent = 'Billing Codes';   // a tab the pack does not map
  editor.value = 'CPT 98940';
  env.fire('focusout', editor);
  await env.settle();
  assert.strictEqual(env.sent.filter((m) => m.type === 'form-capture').length, 0,
    'unmapped tab content must not be captured');
});

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\n${colors.blue}=== VALUE-CAPTURE TESTS COMPLETE ===${colors.reset}`);
console.log(`${colors.green}Passed: ${passCount}${colors.reset}  ${colors.red}Failed: ${failCount}${colors.reset}  Total: ${testCount}`);
if (failures.length) {
  for (const f of failures) console.log(`  ${colors.red}${f.name}${colors.reset}\n    ${f.error}`);
}
process.exit(failCount > 0 ? 1 : 0);
