# AitherConnect — Browser Extension Packaging

This directory contains the AitherConnect Chrome/Edge extension.

## Development (Load Unpacked)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this `AitherConnect/` directory

## Production Build

```powershell
# From repo root:
npm run build:dist:connect

# Or directly:
pwsh -File scripts/Build-Distributions.ps1 -Target Connect
```

Output: `dist/aither-connect-v{version}.zip`

Tagged GitHub releases (`connect-v*`) now publish:
- Chrome / Edge zip package
- Firefox submission zip package
- SHA256 checksum files
- Optional Chrome Web Store upload when release secrets are configured

## Publish to Chrome Web Store

1. Build the zip (above)
2. Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Upload `aither-connect-v*.zip`
4. Fill in listing details, screenshots, etc.
5. Submit for review

### Required GitHub Secrets

- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`
- `CHROME_EXTENSION_ID`

## Publish to Edge Add-ons

1. Same zip works for Edge
2. Go to [Edge Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
3. Upload the same zip
4. Submit for review

Edge publication is still manual because this repo does not yet have a trusted Partner Center automation flow.

## Publish to Firefox (AMO)

1. Use the generated `aither-connect-firefox-*.zip`
2. Upload it to [addons.mozilla.org](https://addons.mozilla.org/developers/)
3. Complete listing metadata and submit for review

## Self-Hosted Distribution

For enterprise/air-gapped deployments, serve the `.crx` file with an update manifest:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck codebase='https://your-server.com/aither-connect.crx' version='1.0.0' />
  </app>
</gupdate>
```

## Configuration

The extension connects to AitherOS via configurable URLs. Open settings via:
- Popup → ⚙️ Settings button
- Right-click extension icon → Options
- `chrome://extensions` → AitherConnect → Details → Extension options

### Connection Modes

| Mode | Use case |
|------|----------|
| **Local** | AitherOS running on same machine (default) |
| **Remote** | AitherOS on LAN or VPN (e.g. `http://192.168.1.50`) |
| **Cloud** | AitherOS hosted (e.g. `https://aither.example.com`) |

### Default Service Ports (Local mode)

| Endpoint | Default Port | Purpose |
|----------|-------------|---------|
| Genesis | `8001` | Primary API & orchestration |
| Veil | `3000` | Dashboard |
| Pulse | `8081` | Heartbeat & SSE events |
| Mind | `8086` | Cognition & chat |
| Strata | `8136` | Filesystem & telemetry |
| Search | `8114` | Federated search |
| Nexus | `8122` | Knowledge base |
| Canvas | `8108` | Image generation |

All settings are stored in `chrome.storage.sync` and synced across devices.

## Provider Mode (BYOK — Bring Your Own Key)

AitherConnect can operate in **BYOK (Bring Your Own Key) mode**, connecting directly to any AI provider using your own API key—no AitherOS fleet required.

### Supported Providers

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| **Anthropic** | `https://api.anthropic.com/v1/messages` | `x-api-key` | Requires `anthropic-dangerous-direct-browser-access: true` header for browser access |
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | Bearer token | Standard OpenAI API |
| **OpenRouter** | `https://openrouter.ai/api/v1/chat/completions` | Bearer token | Multi-model aggregator; routes to best model by cost |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai/` | Bearer token | Free tier available; API key from aistudio.google.com |
| **Ollama (Local)** | `http://localhost:11434/v1/chat/completions` | None | Requires `OLLAMA_ORIGINS=chrome-extension://<extension-id>` env var |
| **On-Device (WebGPU)** | none — runs in the extension's offscreen document | None | Chrome 124+ with a supported GPU; weights fetched once from huggingface.co |

### Configuration

To enable BYOK mode:

1. Open AitherConnect settings (popup → ⚙️ Settings or right-click extension → Options)
2. Switch from "AitherOS Fleet" to "BYOK Provider"
3. Select a provider from the dropdown
4. Paste your API key (stored locally in `chrome.storage.local`, never synced)
5. Optionally override the model and/or base URL
6. Chat normally—messages go directly to your provider

### Data Flow (BYOK Mode)

- **Chat messages** → Your chosen AI provider (not through Aitherium)
- **API keys** → Stored in `chrome.storage.local` only (never sent to cloud)
- **Knowledge base** → Stored in IndexedDB on your device (never synced unless you enable fleet optional connectivity)
- **License verification** → Offline, cached locally (no server required)

### Testing CORS Compatibility

Before submitting to CWS or deploying widely, test provider connectivity:

1. Load the extension unpacked in dev mode
2. Navigate to `chrome-extension://<extension-id>/spike/spike.html`
3. Enable providers, paste test API keys (shaped like real ones), click "Run Tests"
4. Record results in [`docs/CORS_COMPATIBILITY.md`](docs/CORS_COMPATIBILITY.md)

See **Phase 0 Spike Protocol** in that document for full testing procedure and what each verdict means.

### Privacy and Compliance

- **Zero tracking:** AitherConnect does not collect telemetry, analytics, or usage data in BYOK mode
- **Chrome Web Store compliant:** Privacy policy is in `docs/PRIVACY_POLICY.md` and describes exactly what data flows where
- **Offline-capable:** License verification does not require internet; CORS tests work with test (invalid) API keys

### Gateway Fallback

If a provider blocks CORS (e.g., OpenAI from browser contexts), AitherConnect can route requests through a local gateway:

```
Browser → chrome-extension://... → http://localhost:8182/v1/proxy/... → Provider
```

This requires a locally running MCP gateway service. Configuration via settings:

- **Gateway URL** (optional override)
- **Use gateway for:** [checkbox per provider]

### Known Limitations

- **Ollama** requires the `OLLAMA_ORIGINS` environment variable set before starting the Ollama service
- **OpenAI** does not enable CORS from browsers; use gateway fallback or OpenRouter (compatible OpenAI endpoint)
- **Embedding models** are optional; some providers don't support embeddings (e.g., Anthropic)
- **Model listing** is provider-specific; some require manual model selection after configuration
- **On-Device (WebGPU)** is Chrome-only (needs `chrome.offscreen`); hidden from the provider list on Firefox

## On-Device WebGPU Payload (`shared/vendor/webml/`)

The on-device provider ("On-Device (WebGPU)") vendors its runtime **inside the
extension package** — no CDN, no remote code:

| Asset | Size | Source |
|-------|------|--------|
| `transformers.min.js` | ~0.9 MB | `@huggingface/transformers` v3.8.1 dist (self-contained ESM) |
| `ort-wasm-simd-threaded.jsep.mjs` | ~44 KB | same dist (onnxruntime-web JSEP loader) |
| `ort-wasm-simd-threaded.jsep.wasm` | ~21 MB | same dist (WebGPU/wasm kernel binary) |

That adds **~22 MB** to the packaged zip — well under the Chrome Web Store 2 GB
limit. Model **weights** (e.g. Gemma 4 E2B, ~900 MB) are *runtime data*
downloaded from huggingface.co into the Cache API (`transformers-cache`) after
the user opts in — data, not code, and therefore compliant with the MV3
remote-code policy. `unlimitedStorage` is declared so the cached weights are
not evicted.

The protocol/registry layer in `shared/webml-mirror/` is generated from
`@aitheros/portal-kit` `dist/webml/` by `node tools/sync-webml.mjs` — see
`shared/webml-mirror/SYNC-NOTE.md`. Never edit those files by hand;
`tests/webml-sync.test.js` fails on drift.

**Both manifests must stay in lockstep:** `manifest.public.json` carries the
same WebML diff as `manifest.json` (`minimum_chrome_version: 124`,
`wasm-unsafe-eval` CSP, `unlimitedStorage`, and the optional
`huggingface.co` / `*.huggingface.co` / `*.hf.co` host permissions).
