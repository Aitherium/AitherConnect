# AitherConnect

Browser extension for [AitherOS](https://aitherium.com) — federated AI search, chat, knowledge management, and desktop bridge.

## Install

### Chrome / Edge
1. Download the latest release zip from [Releases](https://github.com/Aitherium/AitherConnect/releases)
2. Extract it
3. Go to `chrome://extensions` (or `edge://extensions`)
4. Enable Developer Mode
5. Click "Load unpacked" and select the extracted folder

### Firefox
Download the Firefox-specific zip from [Releases](https://github.com/Aitherium/AitherConnect/releases) and load it via `about:debugging`.

## Features

- **Federated Search** — Search across AitherSearch + Nexus knowledge base from any tab
- **Chat** — Talk to AitherOS agents from the sidebar
- **Knowledge Bases** — Create, query, ingest URLs, manage RAG knowledge bases
- **Image Generation** — Generate images via Canvas/ComfyUI with queue management
- **Notes** — Browser notepad with cloud sync and KB integration
- **Page Security** — Scan pages for threats via Themis
- **IRC Relay** — Connect to AitherRelay chat channels
- **Apps** — Launch and embed AitherOS apps in the sidebar

## Configuration

Click the extension icon > Settings to configure:

| Mode | Use Case |
|------|----------|
| **Local** | AitherOS on same machine (default, port 3000) |
| **Remote** | AitherOS on LAN/VPN |
| **Cloud** | Hosted AitherOS instance |

## Requirements

- AitherOS running locally or remotely
- Chrome 120+, Edge 120+, or Firefox 115+

## License

MIT License - Copyright (c) 2025-2026 Aitherium
