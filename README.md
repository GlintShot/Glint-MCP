# Glint MCP

Thin MCP server so Cursor / Claude Code can drive **real** Glint Capture / Bridge, headless export, and **live Copilot** boards.

- **Mode 2 (Headless):** capture → validate → `glint_export` / `glint_render`  
- **Mode 3 (Copilot):** user opens Glint Web → Allow agent → you call `glint_editor_*` on their board code  

Real UI only - never invent App Store screenshots.

## Tools

| Tool | Purpose |
|------|---------|
| `glint_ecosystem_info` | Paths + mode guide |
| `glint_init` / `glint_discover` / `glint_capture` | Flutter Capture |
| `glint_bridge_*` | Android device capture |
| `glint_validate_session` | Validate session folder |
| `glint_render` | No-browser PNG compositing |
| `glint_export` | Headless ZIP via Web preview |
| `glint_editor_list_boards` | List open Copilot boards (CDP) |
| `glint_editor_state` | Read live frames / transforms |
| `glint_editor_dispatch` | One canvas op (cursor telepresence) |
| `glint_editor_board_pass` | Walk all frames, shared scale/angle |

## Copilot setup

1. Chrome with debugging:
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/glint-chrome-debug
   ```
2. User opens Glint Web, loads frames, clicks **Allow agent**, shares the board code.
3. Agent calls `glint_editor_board_pass` / `glint_editor_dispatch` with that `pairCode`.
4. **Never** open a second editor tab.

Env: `GLINT_CDP_URL` (default `http://127.0.0.1:9222`).

## Setup (Cursor / Claude Code)

```bash
cd Glint-MCP && npm install && npx playwright install chromium
```

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

## Agent rules

1. Prefer Capture / Bridge over inventing screenshots.  
2. Soft launch Capture: **pixel9** only.  
3. Do not ask users for Capture API keys.  
4. Headless: validate → `glint_export` / `glint_render`.  
5. Copilot: guide Allow agent → use `glint_editor_*` on their code.  
6. Never fabricate UI tiles (App Store 2.3.10).

## Modes

| Goal | Mode | Surface |
|------|------|---------|
| Hand polish | Manual | Glint Web |
| CI / fast ZIP | Headless | `glint_export` / `glint_render` |
| Watch AI + teach | Copilot | `glint_editor_*` + board code |

## License

MIT
