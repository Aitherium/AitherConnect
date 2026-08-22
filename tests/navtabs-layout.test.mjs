/**
 * Layout regression test for Awconnect's nav tab strip.
 *
 * Twelve tabs never fit a Chrome side panel. Before 2026-07-25 the strip was a
 * plain `display:flex` with NO scroll axis, so the overflow was simply
 * unreachable: measured at 400px the last tab ("Events") sat 342px outside the
 * box and setting scrollLeft did nothing (overflow-x computed `visible`). The
 * only way to reach Setup/Events was to drag the whole panel wider — the exact
 * bug the owner reported. This pins the fix.
 *
 * Renders the REAL sidepanel.html in headless Chrome and measures geometry.
 * Skips (exit 0) when Chrome is not installed, so CI without a browser is not
 * blocked — but when Chrome IS present these assertions must hold.
 *
 * The assertions were validated against the pre-fix file rendered from git as a
 * control: `overflow-x: visible`, scroll landed at 0/342, last tab unreachable.
 * Note that "clipped text" is NOT the discriminator (flex items refuse to
 * shrink below min-content either way) — REACHABILITY is.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.log('⚠ nav-tabs layout: no Chrome/Chromium found — skipping layout checks');
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDEPANEL = path.join(__dirname, '..', 'sidepanel', 'sidepanel.html');
const PAGES = { after: 'file:///' + SIDEPANEL.replace(/\\/g, '/') };
const PORT = 9334;
const PANEL_W = 400;   // realistic Chrome side panel width

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--user-data-dir=' + process.env.TEMP + '/navtabs-profile2',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

let id = 0;
function rpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== mid) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(ws, expr) {
  const r = await rpc(ws, 'Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
}

// Runs inside the page. Scroll is forced to `auto` for the duration so the
// programmatic scroll lands synchronously — with `scroll-behavior: smooth` the
// measurement would read the pre-animation position and lie about reachability.
const MEASURE = `(() => {
  const nav = document.getElementById('nav-tabs');
  if (!nav) return { error: 'nav-tabs not found' };
  const prevBehavior = nav.style.scrollBehavior;
  nav.style.scrollBehavior = 'auto';
  const tabs = [...nav.querySelectorAll('.nav-tab')];
  // A tab is CLIPPED when its content is wider than the box drawn for it.
  const clipped = tabs.filter(t => t.scrollWidth > t.offsetWidth + 1)
                      .map(t => t.dataset.panel);
  // Reachability: scroll fully right, then the last tab must sit inside the box.
  nav.scrollLeft = nav.scrollWidth;
  const landedAt = nav.scrollLeft;
  const navBox = nav.getBoundingClientRect();
  const last = tabs[tabs.length - 1].getBoundingClientRect();
  const overhangRight = Math.round(last.right - navBox.right);
  const lastReachable = overhangRight <= 1;
  nav.scrollLeft = 0;
  nav.style.scrollBehavior = prevBehavior;
  return {
    tabCount: tabs.length,
    clientWidth: nav.clientWidth,
    scrollWidth: nav.scrollWidth,
    maxScroll: nav.scrollWidth - nav.clientWidth,
    landedAt: Math.round(landedAt),
    scrollable: nav.scrollWidth > nav.clientWidth,
    overflowX: getComputedStyle(nav).overflowX,
    clipped,
    lastPanel: tabs[tabs.length - 1].dataset.panel,
    overhangRight,
    lastReachable,
  };
})()`;

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failures++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`); }
};

const ws = new WebSocket(await targetWs());
try {
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
    width: PANEL_W, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const measure = async (url) => {
    await rpc(ws, 'Page.navigate', { url });
    await sleep(1200);   // load + layout settle
    return evaluate(ws, MEASURE);
  };

  const after = await measure(PAGES.after);
  console.log(`\n=== nav-tabs @ ${PANEL_W}px (side-panel width) ===`);
  console.log(after);

  console.log('\n--- assertions ---');
  /* Derived, not hardcoded. This was `assert.strictEqual(after.tabCount, 12)`
   * and had been red for a while: the sidepanel now declares 14 nav tabs, and
   * every assertion this test actually exists for — scrolling, clipping,
   * reachability of the LAST tab — was passing the whole time. A literal count
   * goes stale the moment anyone adds a tab, and a test that fails for a
   * legitimate change is one people stop running, which is how the other four
   * assertions here ended up unread.
   *
   * The property worth holding is that every tab DECLARED in the markup
   * actually renders — a tab dropped by a layout or gating bug is invisible
   * otherwise. So count the markup and compare. */
  // `nav-tab(?:\s…)?` and NOT `nav-tabs` — the container is `class="nav-tabs"`,
  // and a prefix match counts it as a 15th tab, which reads as "one declared tab
  // failed to render" when nothing is wrong. Exactly the false positive that
  // makes people delete an assertion instead of reading it.
  const declaredTabs = (readFileSync(SIDEPANEL, 'utf8')
    .match(/class="nav-tab(?:\s[^"]*)?"/g) || []).length;
  check(`nav-tabs: all ${declaredTabs} declared tabs render`, () =>
    assert.strictEqual(after.tabCount, declaredTabs,
      `markup declares ${declaredTabs}, page rendered ${after.tabCount}`));
  check('nav-tabs: strip scrolls horizontally (overflow-x auto)', () =>
    assert.strictEqual(after.overflowX, 'auto', `was ${after.overflowX}`));
  check('nav-tabs: content genuinely overflows at panel width', () =>
    assert(after.scrollable, `scrollWidth ${after.scrollWidth} !> clientWidth ${after.clientWidth}`));
  check('nav-tabs: no tab has clipped text', () =>
    assert.deepStrictEqual(after.clipped, [], `clipped: ${after.clipped.join(',')}`));
  check('nav-tabs: programmatic scroll actually moves the strip', () =>
    assert(after.landedAt > 0 && after.landedAt >= after.maxScroll - 1,
      `landed at ${after.landedAt} of max ${after.maxScroll} — strip did not scroll`));
  check('nav-tabs: the LAST tab (events) is reachable by scrolling', () =>
    assert(after.lastReachable,
      `"${after.lastPanel}" overhangs by ${after.overhangRight}px (landed ${after.landedAt}/${after.maxScroll})`));
} finally {
  try { ws.close(); } catch { /* already closed */ }
  chrome.kill();
}

console.log(failures ? `\n\x1b[31mFAILED: ${failures}\x1b[0m` : '\n\x1b[32mALL LAYOUT CHECKS PASSED\x1b[0m');
process.exit(failures ? 1 : 0);
