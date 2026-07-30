# Privacy Policy — AitherConnect

**Effective Date:** [INSERT DATE]  
**Last Updated:** [INSERT DATE]  
**Contact:** [INSERT CONTACT EMAIL]

## Overview

AitherConnect is an AI-powered browsing assistant that adds intelligent chat, text analysis, and knowledge management to your browser. This privacy policy explains how we handle your data.

**Core principle:** Your data is yours. We do not collect, store, or sell your personal information. All processing happens locally in your browser or with your explicitly chosen AI provider.

## What Data We Collect (and Don't)

### Data Processed Locally in Your Browser

The following are processed **only in your browser** and never sent to Aitherium servers:

- **Chat messages** — Sent only to your chosen AI provider (Anthropic, OpenAI, OpenRouter, Google Gemini, or local Ollama) when you click "Send" or use a chat command.
- **Selected text** — Used only when you explicitly choose "Save to Knowledge Base," "Analyze," or "Chat about this." Not sent anywhere until you take action.
- **Knowledge base (local library)** — Stored in your browser's IndexedDB. Never synced to the cloud unless you choose to enable optional fleet connectivity (see below).
- **Browsing context** — Page titles, URLs, and selected text are kept in memory only during active chat sessions. Cleared when you close the popup or clear your browsing data.

### API Keys and Credentials

- **Your LLM provider API key** (Anthropic, OpenAI, etc.) is stored **only in chrome.storage.local** — never in cloud storage, never transmitted to Aitherium servers.
- **License key** (email + tier information only) is verified offline using Ed25519 cryptography. The verification happens in your browser; only tier and expiration are cached locally.

### Optional: AitherOS Fleet Connectivity

If you configure AitherConnect to connect to a local or self-hosted AitherOS instance, communication is between your browser and that instance only. Aitherium does not see this traffic. The data sent depends on which features you enable:

- **Chat with fleet services** — Your messages are sent to your configured Genesis endpoint.
- **Knowledge base sync** — Your KB may be synced to your fleet's Nexus service if you enable it.
- **Search** — Queries go to your fleet's search endpoint.

You control all URLs and can verify they are yours (localhost, private IP, or your domain).

## What We Don't Do

- **No tracking or analytics** — We do not collect telemetry about your usage.
- **No cookies** — AitherConnect does not set cookies (though you may have cookies from websites you visit).
- **No sale of data** — We do not sell, rent, or share your data with third parties.
- **No advertisements** — We do not show ads or inject advertisements into pages.
- **No background monitoring** — We do not listen to your keyboard, microphone, or camera.
- **No persistent logs** — Chat history is kept only in your local knowledge base; deleting it removes it permanently.

## Your Rights and Control

### Access Your Data
All your data is stored locally in your browser. You can:
- Export your knowledge base via the Knowledge Base manager
- View all stored settings via `chrome://extensions` → AitherConnect → Details → Extension options

### Delete Your Data
- **Knowledge base:** Use the Knowledge Base manager (right-click → "Manage Knowledge Base" → Delete)
- **All data:** Uninstall the extension (Chrome will also clear all chrome.storage data)
- **Cache:** Clear your browser cache normally (Ctrl+Shift+Delete)

## Third-Party AI Providers

When you send a message to Anthropic, OpenAI, Google, or another AI provider, you are sending data to that provider's servers. Review their privacy policies:

- **Anthropic:** https://www.anthropic.com/legal/privacy
- **OpenAI:** https://openai.com/privacy
- **OpenRouter:** https://openrouter.ai/privacy
- **Google Gemini:** https://policies.google.com/privacy
- **Ollama:** Local processing only (no data leaves your machine)

## Self-Hosted / On-Premise Deployments

If you run your own AitherOS instance (self-hosted or on-premise), Aitherium has no access to your data or fleet communication. You control your own infrastructure.

## License Verification

- License keys are verified offline using cryptographic signatures.
- Only your email address and license tier are stored in the browser cache.
- Verification does not require contacting Aitherium servers (fully offline-capable).

## Children and COPPA

AitherConnect is not designed for children under 13. We do not knowingly collect data from children. If we become aware of a child using the extension, we will work with parents/guardians to delete the account.

## Changes to This Policy

We will notify you of material changes by:
- Updating the "Last Updated" date at the top of this policy
- Displaying a notice in the extension if required by law

## Questions or Concerns?

If you have questions about this privacy policy or how your data is handled, please contact:

**[INSERT CONTACT EMAIL]**

---

## Appendix: Technical Details

### Storage Breakdown

| Storage Key | Location | Scope | Cleared On |
|---|---|---|---|
| `aither-settings` | chrome.storage.sync | Synced across devices | Uninstall or manual clear |
| `aither-provider` | chrome.storage.local | This device only | Uninstall or manual clear |
| `aither-license` | chrome.storage.sync | Synced (email + tier only) | Uninstall or manual clear |
| `aither-license-cache` | chrome.storage.local | This device only | Uninstall or manual clear |
| Knowledge Base (IndexedDB) | IndexedDB | This device only | Manual delete or uninstall |

### Permissions Justification

| Permission | Why We Need It | Limitation |
|---|---|---|
| `storage` | Store settings, license, KB | Data never leaves your browser |
| `activeTab` | Get page title/URL for context | Only when you use a chat command |
| `tabs` | Monitor tab state | Only to detect when you close tabs |
| `contextMenus` | Add "Save to KB" right-click option | Optional feature you control |
| `scripting` | Highlight text in web pages | UI enhancement only, no data collection |
| `cookies` | Access website auth tokens (optional) | Only if you explicitly enable integration |
| `sidePanel` | Show the chat panel | UI only |

### Encryption & Security

- **API keys** are never logged, never synced to cloud storage, never transmitted outside your browser.
- **License verification** uses Ed25519 signatures; public key is hardcoded in the extension.
- **Knowledge base** is stored unencrypted in IndexedDB. If you enable local encryption, that is a future enhancement.

---

**This privacy policy is consumer-grade and Chrome Web Store compliant. Reviewers require transparency about data flow; vague policies are typically rejected.**
