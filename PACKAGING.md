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
