# Glint MCP

Thin MCP server so Cursor / Copilot / Claude Code can drive **real** Glint Capture / Bridge and headless export - not fake UI mockups.

This is **Mode 2** (Headless / MCP) in Glint’s [editor modes](../Glint-Docs/reference/editor-modes.md): fast, offstage, final assets. **Mode 1** is the Web editor; **Mode 3** (Copilot) will reuse these verbs with a live telepresence session - see [Copilot mode](../Glint-Docs/guides/copilot-mode.md).

The **agent is the intelligence**. Developers should not paste LLM API keys into Capture.

## Tools

| Tool | Purpose |
|------|---------|
| `glint_ecosystem_info` | Paths + soft-launch summary |
| `glint_init` | `glint init` in a Flutter app |
| `glint_discover` | Scan `lib/` for screens + write rules (no keys) |
| `glint_capture` | `glint capture` (+ optional `auto`) → session + PNGs |
| `glint_bridge_crawl` | Bridge Android/web crawl (optional `--ai` vision) |
| `glint_validate_session` | Validate session folder |
| `glint_render` | No-browser PNG compositing (headlines, colors, bezel) |
| `glint_export` | Headless ZIP via Glint Web `/export` |

## Setup (Claude Code / Cursor)

```json
{
  "mcpServers": {
    "glint": {
      "command": "node",
      "args": ["/ABS/PATH/GlintShot/Glint-MCP/src/index.js"],
      "env": {
        "GLINT_WEB_BASE": "http://127.0.0.1:4173"
      }
    }
  }
}
```

```bash
cd Glint-MCP && npm install
cd ../Glint-Web && npm install && npm run build && npm run preview
```

## Agent rules

1. Prefer Capture discover/rules or Bridge crawl over inventing screenshots.  
2. Soft launch Capture: **pixel9** only.  
3. Do **not** ask users for Capture API keys - use discover/auto + your own reasoning.  
4. After capture → validate → Web polish / `glint_export`.
5. Never generate fabricated UI tiles (App Store 2.3.10).
6. **Edit via `glint_render`:** headlines, colors, device `frame` (omit `scale` when swapping frames to keep display size). Live Fabric drag/resize is Mode 1 (human editor) until Copilot’s canvas agent API lands - [editor modes](../Glint-Docs/reference/editor-modes.md).

## Modes cheat sheet

| Goal | Mode | Surface |
|------|------|---------|
| Hand polish in the UI | 1 Manual | Glint Web |
| CI / fast agent ZIP | 2 Headless | This MCP |
| Watch AI + teach-by-edit | 3 Copilot | Web Copilot bar + `__GLINT_COPILOT__` *(MCP attach next)* |

---

<div align="center">

<a href="https://github.com/darkmintis">
  <img src="https://img.shields.io/badge/follow-%40Darkmintis-1DA1F2?style=social&logo=github" alt="Follow @Darkmintis"/>
</a>

</div>
