#!/usr/bin/env node
/**
 * awsync tri-state contract.
 *
 * The port exists because awsync's whole value is a distinction every other
 * sync daemon throws away: "I could not tell" is NOT "we are in step". A test
 * suite that only asserted the happy path would pass just as happily over a
 * client that returned IN_STEP on every network error — which is the exact
 * defect the package was written to prevent, and the exact reason these
 * assertions are about the FAILURE branches.
 *
 * Every branch is driven through an injected fetch, so each one is proven
 * rather than hoped for. Mutation guards below reproduce the collapsed-state
 * shape and assert it would be caught.
 */

import assert from 'assert';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SyncClient, SYNC_STATUS } = require(path.join(__dirname, '..', 'shared', 'awsync.js'));

const BASE = { platformUrl: 'https://portal.example.com', apiKey: 'k', tenantId: 't' };

/** A fetch that answers with a fixed status/body. */
function respond(status, body, opts = {}) {
  return async () => ({
    status,
    json: async () => {
      if (opts.malformed) throw new SyntaxError('Unexpected token <');
      return body;
    },
  });
}
/** A fetch that fails at the transport layer — no response ever exists. */
function transportError(name = 'AbortError') {
  return async () => { const e = new Error('boom'); e.name = name; throw e; };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ── heartbeat ─────────────────────────────────────────────────────────── */

test('heartbeat: 200/201/202 are IN_STEP', async () => {
  for (const status of [200, 201, 202]) {
    const c = new SyncClient({ ...BASE, fetchImpl: respond(status, {}) });
    const r = await c.heartbeat();
    assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP, `status ${status}`);
  }
});

test('heartbeat: a rejection is DRIFTED, not COULD_NOT_JUDGE', async () => {
  const c = new SyncClient({ ...BASE, fetchImpl: respond(403, {}) });
  const r = await c.heartbeat();
  // The platform answered. That is a verdict, and it must not be softened into
  // "could not tell" — a refused node is a known-bad node.
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
});

test('heartbeat: a transport failure is COULD_NOT_JUDGE — NEVER IN_STEP', async () => {
  for (const name of ['AbortError', 'TypeError', 'NetworkError']) {
    const c = new SyncClient({ ...BASE, fetchImpl: transportError(name) });
    const r = await c.heartbeat();
    assert.strictEqual(r.exitCode, SYNC_STATUS.COULD_NOT_JUDGE, name);
    assert.strictEqual(r.ok, false, 'could-not-judge must never report ok');
  }
});

/* ── check_updates ─────────────────────────────────────────────────────── */

test('updates: empty pack list is IN_STEP', async () => {
  const c = new SyncClient({ ...BASE, fetchImpl: respond(200, { packs: [] }) });
  assert.strictEqual((await c.checkUpdates()).exitCode, SYNC_STATUS.IN_STEP);
});

test('updates: available packs are DRIFTED and are counted', async () => {
  const c = new SyncClient({
    ...BASE,
    fetchImpl: respond(200, { packs: [{ id: 'a', version: '2' }, { pack_id: 'b' }] }),
  });
  const r = await c.checkUpdates();
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
  assert.strictEqual(r.details.updates, 2, 'both id and pack_id spellings must be read');
});

test('updates: a non-200 is COULD_NOT_JUDGE, not "no updates"', async () => {
  // THE CENTRAL TRAP. A 500 yields no packs; treating "no packs" as the answer
  // reports a drifted deployment as perfectly in step.
  const c = new SyncClient({ ...BASE, fetchImpl: respond(500, {}) });
  assert.strictEqual((await c.checkUpdates()).exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
});

test('updates: an HTML body is COULD_NOT_JUDGE, not "no updates"', async () => {
  const c = new SyncClient({ ...BASE, fetchImpl: respond(200, null, { malformed: true }) });
  assert.strictEqual((await c.checkUpdates()).exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
});

test('updates: a throwing onUpdates callback does not corrupt the verdict', async () => {
  const c = new SyncClient({
    ...BASE,
    onUpdates: () => { throw new Error('consumer exploded'); },
    fetchImpl: respond(200, { packs: [{ id: 'a' }] }),
  });
  assert.strictEqual((await c.checkUpdates()).exitCode, SYNC_STATUS.DRIFTED);
});

/* ── validate_license ──────────────────────────────────────────────────── */

test('license: valid is IN_STEP, invalid is DRIFTED, unreachable is COULD_NOT_JUDGE', async () => {
  const ok = new SyncClient({ ...BASE, fetchImpl: respond(200, { valid: true, tier: 'pro' }) });
  assert.strictEqual((await ok.validateLicense()).exitCode, SYNC_STATUS.IN_STEP);

  const bad = new SyncClient({ ...BASE, fetchImpl: respond(200, { valid: false, reason: 'expired' }) });
  const r = await bad.validateLicense();
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
  assert.ok(r.message.includes('expired'), 'the reason must survive to the caller');

  const down = new SyncClient({ ...BASE, fetchImpl: transportError() });
  assert.strictEqual((await down.validateLicense()).exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
});

test('license: a MISSING valid field must not read as valid', async () => {
  const c = new SyncClient({ ...BASE, fetchImpl: respond(200, {}) });
  assert.strictEqual((await c.validateLicense()).exitCode, SYNC_STATUS.DRIFTED);
});

/* ── sync() combination ────────────────────────────────────────────────── */

test('sync: all clean is IN_STEP', async () => {
  const c = new SyncClient({
    ...BASE,
    fetchImpl: async (url) =>
      url.includes('license')
        ? { status: 200, json: async () => ({ valid: true, tier: 'pro' }) }
        : { status: 200, json: async () => ({ packs: [] }) },
  });
  const r = await c.sync();
  assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP);
  assert.deepStrictEqual(r.details.results, { heartbeat: 0, updates: 0, license: 0 });
});

test('sync: DRIFTED outranks COULD_NOT_JUDGE', async () => {
  // Real drift must not be masked by an unrelated outage on another endpoint.
  const c = new SyncClient({
    ...BASE,
    fetchImpl: async (url) => {
      if (url.includes('heartbeat')) throw Object.assign(new Error('x'), { name: 'AbortError' });
      if (url.includes('license')) return { status: 200, json: async () => ({ valid: false, reason: 'expired' }) };
      return { status: 200, json: async () => ({ packs: [] }) };
    },
  });
  const r = await c.sync();
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
  assert.strictEqual(r.details.results.heartbeat, SYNC_STATUS.COULD_NOT_JUDGE);
});

test('sync: COULD_NOT_JUDGE outranks IN_STEP — a total outage is never "in step"', async () => {
  const c = new SyncClient({ ...BASE, fetchImpl: transportError() });
  const r = await c.sync();
  assert.strictEqual(r.exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
  assert.strictEqual(r.ok, false);
});

/* ── mutation guards: prove these assertions can still fail ────────────── */

test('MUTATION: a client that collapses transport errors to IN_STEP is caught', async () => {
  class Collapsed extends SyncClient {
    async heartbeat() { return { exitCode: SYNC_STATUS.IN_STEP, ok: true, message: '', details: {} }; }
  }
  const c = new Collapsed({ ...BASE, fetchImpl: transportError() });
  const r = await c.heartbeat();
  // If the real client ever behaves like this, the transport-failure test above
  // fails. Assert the guard reproduces the bad shape, so this test is not vacuous.
  assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP, 'guard must reproduce the defect');
  const honest = new SyncClient({ ...BASE, fetchImpl: transportError() });
  assert.notStrictEqual((await honest.heartbeat()).exitCode, r.exitCode,
    'the real client must NOT agree with the collapsed one');
});

test('MUTATION: the three status codes are distinct values', async () => {
  const seen = new Set([SYNC_STATUS.IN_STEP, SYNC_STATUS.DRIFTED, SYNC_STATUS.COULD_NOT_JUDGE]);
  assert.strictEqual(seen.size, 3, 'collapsing any two makes every assertion above weaker');
  assert.strictEqual(SYNC_STATUS.IN_STEP, 0, 'exit codes are the Unix contract awsync documents');
  assert.strictEqual(SYNC_STATUS.DRIFTED, 1);
  assert.strictEqual(SYNC_STATUS.COULD_NOT_JUDGE, 2);
});

/* ── headers ───────────────────────────────────────────────────────────── */

test('every request carries bearer + tenant, and the URL has no double slash', async () => {
  let seenUrl = '';
  let seenHeaders = null;
  const c = new SyncClient({
    platformUrl: 'https://portal.example.com/',   // trailing slash on purpose
    apiKey: 'sekret', tenantId: 'acme',
    fetchImpl: async (url, init) => {
      seenUrl = url; seenHeaders = init.headers;
      return { status: 200, json: async () => ({}) };
    },
  });
  await c.heartbeat();
  assert.strictEqual(seenUrl, 'https://portal.example.com/api/v1/telemetry/heartbeat');
  assert.strictEqual(seenHeaders.Authorization, 'Bearer sekret');
  assert.strictEqual(seenHeaders['X-Tenant-ID'], 'acme');
});

/* ── integration ports (awnode / awrelay / awrecover / awshare) ────────── */

const okFetch = respond(200, { packs: [], valid: true, tier: 'pro' });

test('awnode: collectServices fills the heartbeat services map', async () => {
  let sent = null;
  const c = new SyncClient({
    ...BASE,
    integrations: { collectServices: async () => ({ awnode: 'up', models: 'bonsai-4b' }) },
    fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return { status: 200, json: async () => ({}) }; },
  });
  await c.heartbeat();
  assert.deepStrictEqual(sent.services, { awnode: 'up', models: 'bonsai-4b' });
});

test('awnode: a THROWING collectServices must not take the heartbeat down', async () => {
  // An unreachable local gateway is precisely the condition worth reporting.
  let sent = null;
  const c = new SyncClient({
    ...BASE,
    integrations: { collectServices: async () => { throw new Error('gateway down'); } },
    fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return { status: 200, json: async () => ({}) }; },
  });
  const r = await c.heartbeat();
  assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP);
  assert.deepStrictEqual(sent.services, {});
});

test('awrelay: a non-IN_STEP verdict is reported; IN_STEP is NOT', async () => {
  const seen = [];
  const mk = (fetchImpl) => new SyncClient({
    ...BASE, fetchImpl, integrations: { report: async (v) => { seen.push(v.exitCode); } },
  });
  await mk(okFetch).sync();
  assert.deepStrictEqual(seen, [], 'a clean sync must stay off the channel — noise gets a channel muted');
  await mk(transportError()).sync();
  assert.deepStrictEqual(seen, [SYNC_STATUS.COULD_NOT_JUDGE], 'an outage must reach a human');
});

test('awrelay: a THROWING report must not change the verdict', async () => {
  const c = new SyncClient({
    ...BASE, fetchImpl: transportError(),
    integrations: { report: async () => { throw new Error('relay down'); } },
  });
  assert.strictEqual((await c.sync()).exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
});

test('awrecover: a FAILED snapshot refuses to apply, and is COULD_NOT_JUDGE', async () => {
  // Fail closed: never mutate state you cannot roll back. And "I could not
  // snapshot" is not "we drifted" — it is not knowing.
  let applied = false;
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: { snapshot: async () => { throw new Error('disk full'); } },
  });
  const r = await c.applyUpdates([{ id: 'a' }], async () => { applied = true; });
  assert.strictEqual(r.exitCode, SYNC_STATUS.COULD_NOT_JUDGE);
  assert.strictEqual(applied, false, 'must not apply without a rollback path');
});

test('awrecover: a failed apply is ROLLED BACK, all-or-nothing', async () => {
  const calls = [];
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: {
      snapshot: async () => { calls.push('snapshot'); return 'snap-1'; },
      restore: async (h) => { calls.push('restore:' + h); },
    },
  });
  const r = await c.applyUpdates([{ id: 'a' }], async () => { throw new Error('bad pack'); });
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
  assert.deepStrictEqual(calls, ['snapshot', 'restore:snap-1']);
  assert.ok(r.message.includes('rolled back'));
});

test('awrecover: a rollback that ITSELF fails is reported loudly', async () => {
  // The worst state this function can leave behind is a half-applied pack whose
  // rollback failed. It must never be silent.
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: {
      snapshot: async () => 'snap-1',
      restore: async () => { throw new Error('snapshot corrupt'); },
    },
  });
  const r = await c.applyUpdates([{ id: 'a' }], async () => { throw new Error('bad pack'); });
  assert.strictEqual(r.exitCode, SYNC_STATUS.DRIFTED);
  assert.ok(r.message.includes('rollback failed'), r.message);
  assert.ok(r.message.includes('snapshot corrupt'), 'the restore error must survive');
});

test('awshare: packs are fetched through the verified port when present', async () => {
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: { fetchArtifact: async (p) => 'verified-bytes-for-' + p.id },
  });
  let got = null;
  const r = await c.applyUpdates([{ id: 'a' }], async (packs) => { got = packs; });
  assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP);
  assert.strictEqual(got[0].artifact, 'verified-bytes-for-a');
});

test('awshare: with NO port, packs pass through UNFETCHED rather than fetched unverified', async () => {
  // The honest degradation is to do less, not to do it insecurely.
  const c = new SyncClient({ ...BASE, fetchImpl: okFetch });
  let got = null;
  await c.applyUpdates([{ id: 'a' }], async (packs) => { got = packs; });
  assert.strictEqual('artifact' in got[0], false);
});

test('EC003: with NO integrations at all, the client still works alone', async () => {
  // A brick whose smallest useful job needs a sibling is not a brick. Every port
  // absent must be the pre-integration behaviour, exactly.
  const c = new SyncClient({ ...BASE, fetchImpl: okFetch });
  assert.strictEqual((await c.sync()).exitCode, SYNC_STATUS.IN_STEP);
  let applied = false;
  const r = await c.applyUpdates([{ id: 'a' }], async () => { applied = true; });
  assert.strictEqual(r.exitCode, SYNC_STATUS.IN_STEP);
  assert.strictEqual(applied, true, 'no snapshot port must not block a plain apply');
});

test('Strata/Nexus: onEvent receives tenant + node on every event', async () => {
  // NX004's lesson: an event written with no tenant scope is unreachable by
  // every scoped read, which is all of them.
  const events = [];
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: { onEvent: async (e) => { events.push(e); } },
  });
  await c.sync();
  assert.ok(events.length > 0, 'a sync must emit at least one event');
  for (const e of events) {
    assert.strictEqual(e.tenant_id, 't', 'every event must carry tenant scope');
    assert.strictEqual(e.node_id, 'aitherconnect');
    assert.ok(e.at, 'every event must be timestamped');
  }
});

test('Strata/Nexus: a THROWING onEvent never breaks the operation it describes', async () => {
  const c = new SyncClient({
    ...BASE, fetchImpl: okFetch,
    integrations: { onEvent: async () => { throw new Error('nexus down'); } },
  });
  assert.strictEqual((await c.sync()).exitCode, SYNC_STATUS.IN_STEP);
});

/* ── runner ────────────────────────────────────────────────────────────── */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${e && e.message}`);
  }
}
console.log(`\nawsync: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
