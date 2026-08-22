/**
 * Live render check for demo.html, driven through AitherBrowser.
 * Verifies the demo actually runs in a real headless Chromium: the two globals
 * load, the sparkline mounts, clicking Play runs the learn loop, and the
 * surprise series renders with ZERO console errors. A check that can fail.
 *
 * Preconditions: demo served on host.docker.internal:8735 (a local http.server
 * from this dir), AitherBrowser healthy at https://localhost:8132, and an open
 * session (e.g. from a failed/goto-less open — or open one here).
 *
 * Usage: node browser-check.mjs <session_id>
 */
import https from "node:https";

const BASE = "https://localhost:8132";
const SID = process.argv[2];
if (!SID) {
  console.error("usage: node browser-check.mjs <session_id>");
  process.exit(2);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(BASE + path, {
      method,
      rejectUnauthorized: false,
      headers: data
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
        : {},
    }, (res) => {
      let s = "";
      res.on("data", (c) => { s += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(s)); } catch { resolve(s); }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const act = (action, value) =>
  req("POST", `/session/${SID}/act`, value !== undefined ? { action, value } : { action });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse(res) {
  if (res && typeof res === "object" && "value" in res) return res.value;
  if (res && typeof res === "object" && "result" in res) return res.result;
  return res;
}

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log("PASS " + name);
  else {
    failed += 1;
    console.log("FAIL " + name + " :: " + (detail ?? ""));
  }
}

const HOOK =
  "(()=>{window.__L=window.__L||[];['log','warn','error'].forEach(m=>{const o=console[m];" +
  "console[m]=(...a)=>{try{window.__L.push(m+': '+a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' '))}catch(e){}o.apply(console,a)}});" +
  "addEventListener('error',e=>window.__L.push('uncaught: '+(e.message||e)));" +
  "addEventListener('unhandledrejection',e=>window.__L.push('rejection: '+(e.reason&&e.reason.message||e.reason)));return 'hooked'})()";

const hookRes = await act("eval", HOOK);
console.log("hook:", JSON.stringify(hookRes));

const initialRaw = parse(await act("eval",
  "JSON.stringify({title:document.title,wm:!!window.ArcWorldModel,surprise:!!window.ArcSurprise," +
  "svg:document.getElementById('sparkline').innerHTML.slice(0,40),log:(window.__L||[]).slice()})"));
const initial = typeof initialRaw === "string" ? JSON.parse(initialRaw) : initialRaw;
check("page loaded (title references surprise)", /surprise/i.test(initial.title || ""), initial.title);
check("ArcWorldModel global loaded", initial.wm === true);
check("ArcSurprise global loaded", initial.surprise === true);
check("sparkline svg mounted on load", String(initial.svg).startsWith("<svg"));
console.log("initial console:", JSON.stringify(initial.log || []));

await act("eval", "document.getElementById('play').click()");
await sleep(8500); // 20 moves * 350ms + buffer

const afterRaw = parse(await act("eval",
  "JSON.stringify({poly:document.getElementById('sparkline').innerHTML.split('<polyline').length-1," +
  "stats:document.getElementById('stats').innerText,svgLen:document.getElementById('sparkline').innerHTML.length," +
  "log:(window.__L||[]).slice()})"));
const after = typeof afterRaw === "string" ? JSON.parse(afterRaw) : afterRaw;
check("raw + moving-average polylines render after play", (after.poly || 0) >= 2, "poly=" + after.poly);
check("stats report learning", /learning/.test(after.stats || ""), after.stats);
check("sparkline grew (20 moves drawn)", (after.svgLen || 0) > 200, "len=" + after.svgLen);
const consoleText = (after.log || []).join(" | ");
check("no console errors/warnings", !/error|uncaught|rejection/i.test(consoleText), consoleText.slice(0, 400));
console.log("post-play console:", JSON.stringify(after.log || []));
console.log("stats:", after.stats);

// ── Bonsai assistant: the WebGPU gate must degrade cleanly, never crash ─────
// AitherBrowser has no GPU adapter, so the panel should show a "disabled"
// message (or still "probing…") with ZERO uncaught errors — the TDR posture.
const bonsaiRaw = parse(await act("eval",
  "JSON.stringify({status:document.getElementById('bonsai-status').textContent," +
  "log:(window.__L||[]).slice()})"));
const bonsai = typeof bonsaiRaw === "string" ? JSON.parse(bonsaiRaw) : bonsaiRaw;
check("bonsai panel has a status (probe ran, no crash)", (bonsai.status || "").length > 0, bonsai.status);
const bonsaiConsole = (bonsai.log || []).join(" | ");
check("bonsai path emits no uncaught errors", !/uncaught|rejection/i.test(bonsaiConsole), bonsaiConsole.slice(0, 400));
console.log("bonsai status:", bonsai.status);

// ── Contribute bridge: opt-in -> capture during play -> fail-soft submit ─────
// No relay is configured (the token lives server-side), so flush must fail
// soft: queue retained, message shown, ZERO uncaught errors.
await act("eval", "document.getElementById('arc-contrib-toggle').click()"); // opt in
await act("eval", "document.getElementById('play').click()"); // play 20 more -> captures
await sleep(8500);
await act("eval", "document.getElementById('arc-contrib-submit').click()");
await sleep(500);
const contribRaw = parse(await act("eval",
  "JSON.stringify({status:document.getElementById('arc-contrib-status').textContent," +
  "log:(window.__L||[]).slice()})"));
const contrib = typeof contribRaw === "string" ? JSON.parse(contribRaw) : contribRaw;
check("contribute fail-soft without a relay (queue retained, no crash)",
  /not submitted/.test(contrib.status || ""), contrib.status);
const contribConsole = (contrib.log || []).join(" | ");
check("contribute path emits no uncaught errors", !/uncaught|rejection/i.test(contribConsole), contribConsole.slice(0, 300));
console.log("contrib status:", contrib.status);

await req("POST", `/session/${SID}/close`, {});
console.log(failed === 0 ? "BROWSER CHECK OK" : "BROWSER CHECK FAILED");
process.exit(failed === 0 ? 0 : 1);
