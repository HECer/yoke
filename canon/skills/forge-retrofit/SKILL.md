---
name: forge-retrofit
description: Use when asked to "retrofit", "forge this project", or set up the Forge harness in a project — runs forge retrofit and asks whether to enable the autonomous loop.
---

# Forge Retrofit

Set up (or update) the Forge harness in the current project.

1. Run `forge retrofit .` to generate the Claude Code artifacts (`.claude/skills/`, `AGENTS.md`, `CLAUDE.md`). This is non-destructive — existing files are backed up under `.forge/backup/` before any overwrite.
2. **Ask the user whether to enable the autonomous Loop** (default: off). If yes, re-run with `forge retrofit . --loop`. The choice is recorded in `.forge/config.yaml` and can be changed any time with `forge loop on|off` (Baustein C).
3. Show the user the printed report (what was created/overwritten/unchanged) and where backups went.

Never overwrite the user's existing instructions without surfacing the backup location in your summary.
