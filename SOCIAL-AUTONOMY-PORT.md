# Porting the autonomous X loop to LinkedIn (and other socials)

> ## SUPERSEDED in 3.8.0 (2026-08-26) — the port is DONE, in a different direction.
>
> The X and LinkedIn automation lanes moved to the **fleet**: headless
> AitherBrowser + routines + the strategist agent, no browser window, no
> extension tab-driving (owner mandate: "stop driving the screen; I want to use
> X myself"). This spec is kept as the record of the OLD in-browser pattern —
> the extension no longer creates the x-*/li-* alarms, and its tick/engage/
> discover functions no-op on the `xAutomationMode` marker. The LinkedIn lane
> will follow the FLEET architecture (same shape as the X lane: `li_*` config
> block, headless driver, same caps/hold/decision-card machinery), not this
> in-browser pattern.

The X system in `background.js` (post / engage / discover / daily-summary + the
on-page control panel in `content/x-control-panel.js`) is a template. Each new
platform is a **mechanical port**: same architecture, same brain, same alarms —
only the DOM selectors and URLs change.

This spec is written so a fresh session (or a human) can apply it without
re-deriving anything. Everything below lives in `awconnect/background.js`
unless noted. After editing, `node --check awconnect/background.js`, commit
with a pathspec, and reload the extension.

---

## What is reused as-is (do NOT duplicate)

- `xComposeText()` — Aither's voice is platform-agnostic; call it for any post.
- `xEngagePlan(feed)` — takes `[{idx, text, ...}]`, returns `{likes:[idx], reply:{idx,text}|null}`.
- `xDiscoverPlan(people, maxFollows)` — takes `[{idx, handle, text}]`, returns `{follow:[idx]}`.
- `xLogActivity({type, platform, ...})` — pass `platform:"linkedin"` etc.
- `xNotify(msg, ok)` — toast.
- The `x-run-now` / `x-summary` / `x-state` / `x-toggle` message handlers — extend
  their `which`/`key` values per platform (below).
- The daily-summary + follower-history machinery — generalize `xDailySummary()` to
  group by `platform` if you want per-platform rollups (optional).

## What each platform needs (the only new code)

1. A `_liLoadTab(url)` helper — identical to `_xLoadTab` but querying that
   platform's tabs (`*://www.linkedin.com/*`).
2. Page functions (run in `world:"MAIN"`): READ_FEED, DO_ENGAGE (like+comment),
   READ_PEOPLE, DO_CONNECT (follow/connect), PAGE_POSTER.
3. Tick functions: `liPostTick`, `liEngageTick`, `liDiscoverTick` — each reads a
   `li*Enabled` storage flag (kill switch), loads the right URL, runs the page fn,
   calls the shared plan/log helpers.
4. Alarms: `li-autopost`, `li-engage`, `li-discover` — created next to the X ones,
   dispatched in `chrome.alarms.onAlarm`.
5. Panel: make it platform-aware (detect hostname) OR inject a second copy that
   sends `li-*` message values.

---

## 1. LinkedIn — exact code to add

Insert this block in `background.js` right before the `xSessionSync()` function
(the `// Read THIS browser's own x.com cookies` comment).

```js
const LI_TOPICS = ["AI infrastructure","AI agents","LLM","machine learning platform",
  "self-hosted AI","MLOps","AI automation","enterprise AI","AI engineering"];

async function _liLoadTab(url) {
  let tabs = await chrome.tabs.query({ url: ["*://www.linkedin.com/*","*://linkedin.com/*"] });
  let tab = tabs && tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url, active: false });
  else await chrome.tabs.update(tab.id, { url });
  await new Promise((resolve) => {
    const to = setTimeout(resolve, 9000);
    chrome.tabs.onUpdated.addListener(function l(id, ch) {
      if (id === tab.id && ch.status === "complete") { clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); resolve(); }
    });
  });
  await new Promise((r) => setTimeout(r, 3200));
  return tab;
}

// READ_FEED — LinkedIn feed posts.
function LI_READ_FEED(limit) {
  const posts = Array.from(document.querySelectorAll('div.feed-shared-update-v2, div[data-urn*="urn:li:activity"]')).slice(0, limit);
  return posts.map((p, idx) => {
    const textEl = p.querySelector('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text');
    const liked = !!p.querySelector('button[aria-pressed="true"]');
    return { idx, id: idx, handle: null, text: textEl ? (textEl.innerText||'').slice(0,300) : '', liked };
  }).filter((t) => t.text && !t.liked);
}

// DO_ENGAGE — like + comment. plan = {likes:[idx], reply:{idx,text}|null}.
function LI_DO_ENGAGE(plan) {
  return new Promise(async (resolve) => {
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    const posts = ()=>Array.from(document.querySelectorAll('div.feed-shared-update-v2, div[data-urn*="urn:li:activity"]'));
    const done = { liked:0, replied:false, errors:[] };
    for (const idx of (plan.likes||[])) {
      try { const p=posts()[idx]; const b=p&&p.querySelector('button[aria-label*="React Like"], button[aria-label^="Like"], button.react-button__trigger');
        if (b) { b.click(); done.liked++; await sleep(2000+Math.random()*2500); } } catch(e){ done.errors.push('like'+idx); }
    }
    if (plan.reply && plan.reply.text && Number.isInteger(plan.reply.idx)) {
      try { const p=posts()[plan.reply.idx]; const cb=p&&p.querySelector('button[aria-label*="Comment"]');
        if (cb) { cb.click(); await sleep(2200);
          const box=p.querySelector('.ql-editor[contenteditable="true"], div[role="textbox"]');
          if (box) { box.focus(); document.execCommand('insertText',false,plan.reply.text); await sleep(1200);
            let pb=p.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]');
            for (let i=0;i<25&&(!pb||pb.disabled);i++){ await sleep(200); pb=p.querySelector('button.comments-comment-box__submit-button, button[class*="submit"]'); }
            if (pb&&!pb.disabled) { pb.click(); done.replied=true; await sleep(2500); } } } } catch(e){ done.errors.push('comment'); }
    }
    resolve(done);
  });
}

// READ_PEOPLE — LinkedIn people-search cards.
function LI_READ_PEOPLE(limit) {
  const cards = Array.from(document.querySelectorAll('li.reusable-search__result-container, div.entity-result')).slice(0, limit);
  return cards.map((c, idx) => {
    const nameEl = c.querySelector('span.entity-result__title-text a, a.app-aware-link span[aria-hidden]');
    const canFollow = Array.from(c.querySelectorAll('button')).some(b=>/connect|follow/i.test(b.getAttribute('aria-label')||b.innerText||''));
    return { idx, handle: nameEl?(nameEl.innerText||'').trim().slice(0,60):null, canFollow, text:(c.innerText||'').replace(/\s+/g,' ').slice(0,200) };
  }).filter((u)=>u.handle && u.canFollow);
}

// DO_CONNECT — Connect/Follow + dismiss the "add a note" modal. plan = {follow:[idx]}.
function LI_DO_CONNECT(plan) {
  return new Promise(async (resolve) => {
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const cards=()=>Array.from(document.querySelectorAll('li.reusable-search__result-container, div.entity-result'));
    const done={ followed:0, errors:[] };
    for (const idx of (plan.follow||[])) {
      try { const c=cards()[idx]; const b=c&&Array.from(c.querySelectorAll('button')).find(x=>/connect|follow/i.test(x.getAttribute('aria-label')||x.innerText||''));
        if (b) { b.click(); await sleep(1500);
          const send=document.querySelector('button[aria-label*="Send now"], button[aria-label*="Send invitation"], button[aria-label="Send"]');
          if (send) { send.click(); await sleep(800); }
          done.followed++; await sleep(2500+Math.random()*3000); } } catch(e){ done.errors.push('connect'+idx); }
    }
    resolve(done);
  });
}

// PAGE_POSTER — open composer, type, publish.
function LI_PAGE_POSTER(text) {
  return new Promise(async (resolve) => {
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const waitFor=async(sels,ms)=>{const end=Date.now()+ms;while(Date.now()<end){for(const s of sels){const el=document.querySelector(s);if(el)return el;}await sleep(250);}return null;};
    try {
      const starter=await waitFor(['button.share-box-feed-entry__trigger','button[class*="share-box-feed-entry"]'],8000);
      if (starter) starter.click();
      const box=await waitFor(['.ql-editor[contenteditable="true"]','div[role="textbox"][contenteditable="true"]'],10000);
      if (!box) { resolve({ok:false,reason:'no_composer'}); return; }
      box.focus(); document.execCommand('insertText',false,text); await sleep(1200);
      let pb=await waitFor(['button.share-actions__primary-action','button[class*="share-actions__primary"]'],5000);
      for (let i=0;i<20&&(!pb||pb.disabled);i++){ await sleep(250); pb=document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]'); }
      if (!pb||pb.disabled) { resolve({ok:false,reason:'post_button_disabled'}); return; }
      pb.click(); await sleep(3000); resolve({ok:true});
    } catch(e){ resolve({ok:false,reason:'exception',error:String(e).slice(0,160)}); }
  });
}

async function liPostTick() {
  const s = await chrome.storage.local.get(["liAutopostEnabled"]); if (s.liAutopostEnabled===false) return;
  const text = await xComposeText();
  const tab = await _liLoadTab("https://www.linkedin.com/feed/");
  const [{result}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:LI_PAGE_POSTER,args:[text]});
  if (result&&result.ok){ xNotify(`LinkedIn posted: "${text.slice(0,70)}"`,true); await xLogActivity({type:"post",platform:"linkedin",text:text.slice(0,200)}); }
  else xNotify(`LinkedIn post failed (${result&&result.reason})`,false);
}
async function liEngageTick() {
  const s = await chrome.storage.local.get(["liEngageEnabled"]); if (s.liEngageEnabled===false) return;
  const tab = await _liLoadTab("https://www.linkedin.com/feed/");
  const [{result:feed}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:LI_READ_FEED,args:[15]});
  if (!feed||!feed.length) return;
  const plan = await xEngagePlan(feed);
  const [{result:done}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:LI_DO_ENGAGE,args:[plan]});
  if (done&&(done.liked||done.replied)){ xNotify(`LinkedIn: ${done.liked} likes${done.replied?" + comment":""}`,true); await xLogActivity({type:"engage",platform:"linkedin",liked:done.liked||0,replied:done.replied?1:0}); }
}
async function liDiscoverTick() {
  const s = await chrome.storage.local.get(["liDiscoverEnabled","liTopicIdx"]); if (s.liDiscoverEnabled===false) return;
  const topic = LI_TOPICS[(Number(s.liTopicIdx)||0)%LI_TOPICS.length];
  await chrome.storage.local.set({ liTopicIdx: ((Number(s.liTopicIdx)||0)+1)%LI_TOPICS.length });
  const tab = await _liLoadTab(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(topic)}`);
  const [{result:people}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:LI_READ_PEOPLE,args:[12]});
  if (people&&people.length){
    const plan = await xDiscoverPlan(people, 3);
    const [{result:done}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:LI_DO_CONNECT,args:[plan]});
    if (done&&done.followed){ xNotify(`LinkedIn: connected ${done.followed} in "${topic}"`,true); await xLogActivity({type:"follow",platform:"linkedin",count:done.followed,topic}); }
  }
}
```

## 2. Alarms — add next to the X alarm creation

In the `chrome.storage.local.get([...])` block that creates `x-autopost`/`x-engage`/`x-discover`, add:

```js
chrome.alarms.create("li-autopost", { periodInMinutes: Number(s.liAutopostIntervalMin)||360, delayInMinutes: 2 });
chrome.alarms.create("li-engage",   { periodInMinutes: Number(s.liEngageIntervalMin)||120, delayInMinutes: 4 });
chrome.alarms.create("li-discover", { periodInMinutes: Number(s.liDiscoverIntervalMin)||240, delayInMinutes: 6 });
```

In `chrome.alarms.onAlarm.addListener`, add:

```js
if (alarm.name === "li-autopost") await liPostTick();
if (alarm.name === "li-engage")   await liEngageTick();
if (alarm.name === "li-discover") await liDiscoverTick();
```

## 3. Message dispatch — extend `x-run-now` and the flags

In the `x-run-now` handler, add branches:

```js
else if (which === "li-post")     await liPostTick();
else if (which === "li-engage")   await liEngageTick();
else if (which === "li-discover") await liDiscoverTick();
```

In `x-state`, also read `liAutopostEnabled`, `liEngageEnabled`, `liDiscoverEnabled`.
`x-toggle` already handles any `key`, so no change.

## 4. Panel — make it platform-aware

In `content/x-control-panel.js`, at the top detect the platform and pick the loop
set + storage keys accordingly:

```js
const HOST = location.hostname;
const PLATFORM = /linkedin\.com$/.test(HOST) ? "linkedin" : "x";
const LOOPS = PLATFORM === "linkedin"
  ? [["liAutopostEnabled","Post","li-post"],["liEngageEnabled","Engage","li-engage"],["liDiscoverEnabled","Connect","li-discover"]]
  : [["xAutopostEnabled","Post","post"],["xEngageEnabled","Engage","engage"],["xDiscoverEnabled","Discover","discover"]];
```

Use `LOOPS` where the file currently hardcodes the three X loops, and title the
panel `PLATFORM === "linkedin" ? "Aither · LinkedIn" : "Aither · X"`. Rename the
file to `content/social-panel.js` if you want it neutral.

## 5. Inject the panel on LinkedIn too

In the `chrome.tabs.onUpdated` panel-injection listener, widen the host test:

```js
if (info.status === "complete" && tab && tab.url &&
    /^https:\/\/(x\.com|twitter\.com|www\.linkedin\.com)\//.test(tab.url)) {
  chrome.scripting.executeScript({ target:{tabId}, files:["content/x-control-panel.js"] }).catch(()=>{});
}
```

---

## Other platforms (Bluesky, Threads, Mastodon) — same recipe

Each is one more block with its own selectors + URLs and one more panel branch:

| Platform | Post composer | Like | Reply | People/follow | Feed URL |
|---|---|---|---|---|---|
| **Bluesky** (bsky.app) | `[data-testid="composePostButton"]` → `[data-testid="composerTextInput"]` → `[data-testid="composerPublishBtn"]` | `[data-testid="likeBtn"]` | `[data-testid="replyBtn"]` | search `/search?q=` → `[data-testid="followBtn"]` | `/` |
| **Threads** (threads.net) | new-post button → `div[contenteditable]` → Post | SVG-title `Like` button | `Reply` button | search → Follow | `/` |
| **Mastodon** | `.compose-form__textarea` → Publish | `.icon-button` title Favourite | Reply icon | search → Follow | `/home` |

Threads/Mastodon change markup often and Mastodon is per-instance — expect to
tune selectors live via the panel's Run-now.

---

## Honest caveats (carry these into whatever ships)

- **Only X's POST path is proven live.** Every LinkedIn selector here is
  best-effort and UNTESTED against the live site — LinkedIn's class-based DOM
  changes more than X's `data-testid`s. Verify each via the panel's **Run now**
  and fix what misses; every action fails safe (logs, never crashes).
- **LinkedIn invite caps are strict** — keep discover follows ≤3/tick and add a
  daily cap like X's `xFollowBudget` (LinkedIn flags aggressive connecting fast).
- **ToS:** automating LinkedIn/X/etc. violates their automation terms; human
  pacing + low caps reduce, don't remove, suspension risk.
- **Runs only while that tab's browser is open** with Awconnect connected.
- The composer/brain path depends on Genesis `/chat` being reachable through the
  Veil bridge; if it isn't, posts use the varied local fallback and engage/discover
  fall back to naive selection — add a "brain reachable" check so a fallback-only
  loop is loud, not silent.
