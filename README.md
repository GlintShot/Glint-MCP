# Glint MCP

**MCP server for the Glint screenshot stack** - so Cursor, Claude Code, and other agents can capture real app UI, build store frames, and drive a live Glint Studio board.

Part of [GlintShot](https://github.com/GlintShot). Real screens only - never invent App Store tiles (Guideline 2.3.10).

```
Capture / Bridge  →  session + PNGs  →  render / export ZIP
                                         ↘
                                   Copilot (live Studio board)
```

## What it does

| Mode | When to use | How |
|------|-------------|-----|
| **Headless** | CI, fast ZIP, agent-only | Capture → validate → `glint_render` / `glint_export` |
| **Copilot** | User watches the agent polish | User opens Studio → **Allow agent** → `glint_editor_*` on their board code |
| **Manual** | Human polish | Glint Studio in the browser (no MCP required) |

## Install

```bash
git clone https://github.com/GlintShot/Glint-MCP.git
cd Glint-MCP
npm install
npx playwright install chromium
```

Point MCP at sibling checkouts of [Glint-Capture](https://github.com/GlintShot/Glint-Capture), [Glint-Bridge](https://github.com/GlintShot/Glint-Bridge), and [Glint-Web](https://github.com/GlintShot/Glint-Web) (or set the env paths below).

### Cursor / Claude Code

```json
{
  "mcpServers": {
    "glint": {
      "command": "node",
      "args": ["/ABS/PATH/Glint-MCP/src/index.js"],
      "env": {
        "GLINT_WEB_BASE": "http://127.0.0.1:4173",
        "GLINT_CDP_URL": "http://127.0.0.1:9222"
      }
    }
  }
}
```

| Env | Default | Purpose |
|-----|---------|---------|
| `GLINT_CAPTURE_ROOT` | `../Glint-Capture` | Flutter capture package |
| `GLINT_BRIDGE_ROOT` | `../Glint-Bridge` | Android / web bridge |
| `GLINT_WEB_ROOT` | `../Glint-Web` | Headless export |
| `GLINT_WEB_BASE` | `http://127.0.0.1:4173` | Running Studio preview URL |
| `GLINT_CDP_URL` | `http://127.0.0.1:9222` | Chrome DevTools for Copilot |

## Tools

### Capture & session

| Tool | Purpose |
|------|---------|
| `glint_ecosystem_info` | Paths, modes, quick agent guide |
| `glint_init` / `glint_discover` / `glint_capture` | Flutter Capture |
| `glint_bridge_*` | Android device capture |
| `glint_validate_session` | Validate a session folder |

### Headless export

| Tool | Purpose |
|------|---------|
| `glint_render` | Composite PNGs without a browser |
| `glint_export` | Store ZIP via Studio preview |

### Copilot (live Studio)

| Tool | Purpose |
|------|---------|
| `glint_editor_list_boards` | List open boards (CDP) |
| `glint_editor_state` | Read frames / transforms |
| `glint_editor_dispatch` | One canvas op (cursor telepresence) |
| `glint_editor_board_pass` | Walk all frames (shared scale / angle / style) |

## Copilot (Mode 3)

1. Start Chrome with remote debugging:
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/glint-chrome-debug
   ```
2. Open **Glint Studio** (Glint-Web), load frames, click **Allow agent**, share the 4-character board code.
3. Call `glint_editor_dispatch` / `glint_editor_board_pass` with that `pairCode`.
4. **Never** open a second editor tab - attach to the user’s board only.

Docs: [Copilot mode](https://glintshot.github.io/Glint-Docs/#/guides/copilot-mode) · [Editor modes](https://glintshot.github.io/Glint-Docs/#/reference/editor-modes)

## Agent rules

1. Prefer Capture / Bridge over inventing screenshots.
2. Soft-launch Capture targets: follow Capture docs (device presets).
3. Do not ask users for Capture API keys.
4. Headless: validate → `glint_export` / `glint_render`.
5. Copilot: guide **Allow agent** → use `glint_editor_*` on their code.
6. Never fabricate UI tiles for store listings.

## Ecosystem

| Repo | Role |
|------|------|
| [Glint-Docs](https://github.com/GlintShot/Glint-Docs) | Guides & golden path |
| [Glint-Web](https://github.com/GlintShot/Glint-Web) | Glint Studio editor & ZIP export |
| [Glint-Capture](https://github.com/GlintShot/Glint-Capture) | Flutter capture |
| [Glint-Bridge](https://github.com/GlintShot/Glint-Bridge) | Android / web capture |
| [Glint-View](https://github.com/GlintShot/Glint-View) | On-device preview |

## License

MIT
