# Chrome Web Store Review Submission Guide

This document is an internal playbook for submitting Awconnect to the Chrome Web Store (CWS) and passing their review process.

## Single-Purpose Narrative

**For reviewers:** Awconnect is an **AI-powered browsing assistant** that adds intelligent chat and knowledge management to your browser. It lets you:

1. **Chat with AI** — Ask questions about pages you're viewing, with full context
2. **Save to a local knowledge base** — Build your own searchable library as you browse
3. **Analyze text** — Summarize, explain, or ask follow-up questions about selected text
4. **Optionally connect to your own AI provider** — Use your own OpenAI, Anthropic, or local Ollama account

**Key selling point for CWS:** No tracking, no ads, no cloud storage, no account required. Your data stays on your machine.

---

## Step-by-Step Reviewer Test Script

This is what a CWS reviewer will do. Our extension must pass every step.

### 1. Install

- Download the `.zip` from the CWS listing or load it unpacked in dev mode
- Click "Add to Chrome" (or "Load unpacked")
- Expect: Extension icon appears in toolbar, no permission prompts yet

**Reviewer check:** No remote code execution, no suspicious permissions on install

### 2. Onboarding

- Click the extension icon → Popup opens
- See "Welcome to Awconnect" screen (or similar onboarding)
- Expect: Clear buttons for "Settings," "Quick Start," or "Learn More"

**Reviewer check:** No tracking pixels, no external CDN code loaded, onboarding is in-extension only

### 3. Configure Provider

- Click "Settings"
- See provider dropdown: Anthropic | OpenAI | OpenRouter | Gemini | Ollama | Local Fleet
- Select "OpenRouter" (test provider with easier test keys)
- Paste a test API key:
  ```
  sk-or-v1-invalid1234567890abcdefghijklmnopqrstuvwxyz
  ```
  (Shaped like a real OpenRouter key; CWS knows we won't process it, just testing CORS)

**Reviewer check:** Settings are stored locally only (not sent to any server on input)

### 4. Basic Chat

- Open the sidepanel (right-click extension → "Open sidepanel" or Alt+Shift+A)
- Type: "What is 2+2?"
- Click "Send"
- Expect: Either a response from the AI provider OR a clear error message (e.g., "401 Unauthorized — check your API key")

**Key for reviewer:** If it's a test key, we expect it to fail with a 401 HTTP response. This proves:
- Network request was sent to the correct provider endpoint
- CORS is not blocked
- We're not hiding requests or using a proxy

### 5. Save to Knowledge Base

- Go to any website (e.g., https://example.com)
- Select some text with your mouse
- Right-click → "Save to Awconnect Knowledge Base"
- Expect: Confirmation message, "Saved to your KB"

**Reviewer check:** No data exfiltration, no background analytics calls

### 6. Search Knowledge Base

- Click extension icon → "Search your knowledge base"
- Type a word from the text you saved
- Expect: Result appears with the saved snippet and source URL

**Reviewer check:** All search is local (IndexedDB), no external API calls

### 7. Privacy Policy

- Check the extension listing page
- Expect: A link to the privacy policy (https://github.com/Aitherium/AitherOS/blob/develop/awconnect/docs/PRIVACY_POLICY.md or similar)
- Click and read it
- Expect: Clear statement that data is stored locally, not sold, no tracking

**Reviewer check:** Privacy policy exists, is complete, mentions no tracking/analytics/sale

### 8. Permissions Audit

- Check manifest.json
- Verify each permission is justified:
  - `storage` — For settings & KB
  - `activeTab` — For page context in chat
  - `contextMenus` — For right-click "Save to KB"
  - `scripting` — For text highlighting
  - No `host_permissions: ["*://*/*"]` in required (only optional)

**Reviewer check:** No over-broad permissions, each one is necessary for the stated features

---

## Reviewer Test Credentials (for staging before CWS submission)

Place these in a **PRIVATE** document (never committed to repo):

```
Provider: OpenRouter
Test Key: sk-or-v1-[REAL TEST KEY FROM OPENROUTER ACCOUNT]

Provider: Anthropic (alternative)
Test Key: sk-ant-[REAL TEST KEY]

Provider: Ollama (local)
URL: http://localhost:11434
(Reviewer must have Ollama running locally; optional)
```

**CRITICAL:** Real API keys are NOT checked in. These are fetched by the reviewer from their own test accounts (created for free on each provider). Include instructions:

> "To test: Create a free/trial account on your chosen provider, generate a test API key, and paste it into Awconnect settings."

---

## CWS Listing Metadata

### Title (max 45 characters)

```
Awconnect — AI Chat & Knowledge Base
```

### Short Description (max ~50 chars for the store card)

```
Local AI chat assistant with a personal knowledge base. No tracking, no account needed.
```

### Full Description (for the listing page)

```
Awconnect is an AI-powered browsing assistant that brings intelligent chat and knowledge 
management to your browser.

FEATURES:
• Chat with AI about any webpage — full page context, always available
• Build your own knowledge base — save articles, snippets, ideas for instant recall
• Analyze text — summarize, explain, or ask questions about selected content
• Use your own AI account — OpenAI, Anthropic, OpenRouter, Google Gemini, or local Ollama
• 100% private — no tracking, no analytics, no account required
• All data stays local — syncing to your fleet is optional and under your control

WHAT'S INCLUDED:
✓ Local knowledge base (IndexedDB, on your machine)
✓ Built-in chat with your choice of AI provider
✓ Right-click "Save to knowledge base" for any text
✓ Full-page context awareness
✓ Optional connection to AitherOS fleet (self-hosted)

PRIVACY:
Your data is yours. We don't track you, we don't sell your data, and we don't require an account.
All settings and your knowledge base stay on your device. When you chat, messages go only to 
your chosen AI provider—never to Aitherium servers.

Read our full privacy policy for technical details.

REQUIREMENTS:
• A Chrome-based browser (Chrome, Edge, Brave, etc.)
• An API key from your chosen AI provider (free trials available)
• Optional: AitherOS instance for advanced features

Get started in 2 minutes:
1. Click the extension icon
2. Enter your API key in Settings
3. Select text on any page and chat about it
```

---

## Screenshots & Assets

### Suggested Screenshots (list)

1. **Install confirmation**  
   → Extension icon in toolbar with a tooltip

2. **Onboarding screen**  
   → "Welcome to Awconnect" with provider selection dropdown

3. **Settings page**  
   → API key input, model selection, provider dropdown

4. **Sidepanel chat**  
   → Active chat with a website about selected text

5. **Knowledge base search**  
   → Search results from saved articles

6. **Context menu**  
   → Right-click "Save to knowledge base" option

**Reviewer tip:** Use simple, clear UI screenshots. CWS rejects blurry screenshots or ones with sensitive data. Mock screenshots with placeholder text are fine.

---

## Staged Rollout Plan

After CWS approves the listing:

1. **1% rollout (48 hours)**
   - Monitor crash reports, 1-star reviews, support tickets
   - Check error logs in Chrome DevTools (background.js console)
   - Verify no unexpected permissions requests

2. **25% rollout (1 week)**
   - Expand if 1% is stable (< 0.1% crash rate)
   - Monitor performance, user feedback on listing page
   - Confirm knowledge base performance with larger user base

3. **100% rollout**
   - Full release when 25% shows no critical issues
   - Announce in release notes, blog, or newsletter

---

## Common Rejection Causes Checklist

Use this checklist **BEFORE submitting:**

- [ ] **Obfuscation detected** — All code is readable and not minified beyond recognition
  - **Fix:** Ensure `shared/`, `background.js`, `popup.js` are human-readable (not uglified)

- [ ] **Remote code execution (RCE)** — No eval(), no dynamic script imports from URLs
  - **Fix:** Verify no `fetch().then(r => r.text()).then(eval)`; no dynamic `<script src>`

- [ ] **Missing or vague privacy policy** — Policy must be specific about data handling
  - **Fix:** Link to PRIVACY_POLICY.md from the CWS listing; mention "no tracking," "local storage only"

- [ ] **Over-broad host permissions** — Requesting `*://*/*` for generic features
  - **Fix:** Use `optional_host_permissions` for broad patterns; required should be specific

- [ ] **Deceptive practices** — Claiming "no ads" while injecting ads, or misleading features
  - **Fix:** Be honest: test the KB, test chat, make sure everything advertised works

- [ ] **Malware/malicious behavior** — Crypto miners, redirect schemes, credential theft
  - **Fix:** Static analysis: `ruff check .` (Python linter), no suspicious patterns

- [ ] **Copyright/trademark issues** — Using third-party logos without license
  - **Fix:** Verify all assets are original or have explicit licenses in docs/

---

## CWS Submission Workflow

1. **Build the production zip**
   ```powershell
   pwsh -File scripts/Build-Distributions.ps1 -Target Connect
   ```
   → Output: `dist/aither-connect-v*.zip`

2. **Go to Chrome Developer Dashboard**
   → https://chrome.google.com/webstore/devconsole

3. **Upload the zip**
   → Click "Upload new package"
   → Select the zip file

4. **Fill in listing details**
   - Title, short/long description (use above)
   - Category: "Productivity" or "Developer Tools"
   - Screenshot URLs or uploads
   - Privacy policy URL

5. **Submit for review**
   - CWS review typically takes 1–3 days
   - Check your email for approval or rejection

6. **If rejected**
   - Read the rejection reason carefully (not vague, but specific)
   - Fix the issue locally
   - Resubmit (you can upload a new version)

---

## Edge Cases & Common Issues

### Issue: "Failed to fetch" when testing with a mock key

**Expected behavior:** This is fine! It means CORS is working and the provider endpoint is reachable. The 401 response we get (or the network request completing) proves the request went out.

**What it proves:** No middleware is interfering, no proxy is hiding the request.

### Issue: Reviewer says "We found obfuscation"

**Root cause:** Build output is minified (webpack/terser). Awconnect is a no-build extension; if it happens, one of our libraries was transpiled.

**Fix:** Ensure all JS in the extension is readable source. If you use a bundler, expose source maps to CWS.

### Issue: "Too similar to [other extension]"

**Fix:** CWS rarely rejects for similarity alone. Focus on being distinct: emphasize the knowledge base feature and local-first design.

### Issue: "Privacy policy is too vague"

**Fix:** Be specific! Don't say "we take privacy seriously"; say exactly what data goes where:
- "Chat messages go to [provider], never to our servers"
- "Knowledge base is stored in IndexedDB on your machine"
- "No analytics, no cookies, no account required"

---

## Post-Approval: Maintenance

Once live on CWS:

- Monitor the listing page for 1-star reviews and respond quickly
- Watch for crash reports in Chrome DevTools error tracking
- Plan quarterly security audits (check for XSS, CSP violations)
- Update version in manifest.json for each release
- Keep PRIVACY_POLICY.md in sync with actual features

---

## Quick Reference

| Phase | Owner | Duration | Output |
|-------|-------|----------|--------|
| **Build** | CI/CD | 5 min | dist/aither-connect-v*.zip |
| **Package** | Manual | 10 min | CWS metadata + screenshots |
| **Submit** | Manual | 2 min | CWS submission created |
| **Review** | Google | 1–3 days | Approval or rejection |
| **1% rollout** | Manual | 48h | Monitor, fix if needed |
| **25% rollout** | Manual | 1 week | Expand if stable |
| **100% rollout** | Manual | Immediate | Live to all users |

