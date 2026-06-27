---
name: forge-retrofit
description: Use when asked to "retrofit", "forge this project", or set up the Forge harness in a project — runs forge retrofit and asks whether to enable the autonomous loop.
---

# Forge Retrofit

Set up (or update) the Forge harness in the current project.

1. Run `forge retrofit .` to generate artifacts for the agents detected in the project, or `forge retrofit . --agent=all` for Claude + Codex + Gemini. This is non-destructive — existing files are backed up under `.forge/backup/` before any overwrite. Generated per agent:
   - Claude: `.claude/skills/`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json` (+ rtk hook when WSL is available).
   - Codex: `AGENTS.md`, `.codex/config.toml` (MCP), `RTK.md`.
   - Gemini: `GEMINI.md`, `.gemini/commands/*.toml`, `.gemini/settings.json`.
2. **Ask the user whether to enable the autonomous Loop** (default off). If yes, add `--loop`. Recorded in `.forge/config.yaml`; toggle any time with `forge loop on|off`.
3. Show the printed report (created/overwritten/unchanged + detected agents) and where backups went. Note that MCP launch commands in the generated configs may need adjusting to the user's local tool installs.
