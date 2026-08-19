# AitherConnect

AI browsing assistant with a local knowledge base, as a Chrome/Edge extension.
Bring your own API key (Anthropic, OpenAI, OpenRouter, Gemini, or a local
Ollama) — chat from a side panel while you browse, save what you read, search
it back later. Optionally bridges to a running [AitherOS](https://aitherium.com)
desktop instance for federated search and knowledge management across it.

## Install (development / load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `AitherConnect/` directory

## Production build

```powershell
# From the repo root:
npm run build:dist:connect
# or directly:
pwsh -File scripts/Build-Distributions.ps1 -Target Connect
```

## License

MIT (see `LICENSE`).

<!-- aitherium-ecosystem:start -->
## Aitherium open-source ecosystem

This repo is one piece of a connected set. All public, MIT/BSL-licensed:

| repo | what it is | pages |
|---|---|---|
| [aither-adk](https://github.com/Aitherium/aither-adk) | Build AI agent fleets — 3 lines, any backend | [docs](https://aitherium.github.io/aither-adk/) |
| [aither-skills](https://github.com/Aitherium/aither-skills) | Free agent skills, scripts & automations | [docs](https://aitherium.github.io/aither-skills/) |
| [AitherZero](https://github.com/Aitherium/AitherZero) | PowerShell 7+ automation framework | [docs](https://aitherium.github.io/AitherZero/) |
| [awgit](https://github.com/Aitherium/awgit) | Semantic version control on top of git | [docs](https://aitherium.github.io/awgit/) |
| [awgraph](https://github.com/Aitherium/awgraph) | Code knowledge graph for AI agents | [docs](https://aitherium.github.io/awgraph/) |
| [aitherkvcache](https://github.com/Aitherium/aitherkvcache) | Near-optimal KV cache quantization | [docs](https://aitherium.github.io/aitherkvcache/) |
| [awrelay](https://github.com/Aitherium/awrelay) | Agent-to-agent messaging over any chat server | — |
| [awm](https://github.com/Aitherium/awm) | A small world model (LeWM JEPA + MLP) to bootstrap your own | [docs](https://aitherium.github.io/awm/) |
| [AitherConnect](https://github.com/Aitherium/AitherConnect) | Browser extension: federated AI search & desktop bridge | — |
| [homebrew-tap](https://github.com/Aitherium/homebrew-tap) | `brew tap aitherium/tap` | — |

Built by [Aitherium](https://aitherium.com).
<!-- aitherium-ecosystem:end -->
