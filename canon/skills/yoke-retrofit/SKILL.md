---
name: yoke-retrofit
description: Use when asked to "retrofit", "yoke this project", or set up the Yoke harness in a project — runs yoke retrofit, picks a code-graph tool, and asks whether to enable the autonomous loop.
---

# Yoke Retrofit

Set up (or update) the Yoke harness in the current project.

1. **Choose the code-graph tool.** Ask the user which to wire, and recommend based on the project:
   - **Serena** (LSP-accurate, symbol-exact refactoring, no stale index) — recommend for large, strongly-typed codebases (TypeScript, Python, Go) doing systematic refactoring, where missing a reference is costly. Needs one language server per language.
   - **graphify** (fast, multimodal: code + PDFs + diagrams + images; ~70x token reduction on large mixed repos; honest INFERRED/AMBIGUOUS edges) — recommend for rapid exploration / migration / onboarding of large or unfamiliar repos, or repos with mixed non-code content.
   Make a direct recommendation for THIS project, then run with `--code-graph=serena` or `--code-graph=graphify` (default graphify if the user has no preference). The choice is saved in `.yoke/config.yaml`.
2. Run `yoke retrofit . --agent=all --code-graph=<choice>` (or a subset of agents). Non-destructive — existing files are backed up under `.yoke/backup/` before any overwrite; `.claude/settings.json` is merged, not replaced. Generated per agent: Claude (`.claude/skills/`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, rtk hook when WSL is available); Codex (`AGENTS.md`, `.codex/config.toml`, `RTK.md`); Gemini (`GEMINI.md`, `.gemini/commands/*.toml`, `.gemini/settings.json`).
3. **Ask whether to enable the autonomous Loop** (default off). If yes, add `--loop`. Toggle any time with `yoke loop on|off`.
4. Show the printed report (created/overwritten/unchanged/merged + detected agents) and where backups went. Note that the generated MCP launch commands may need adjusting to the user's local tool installs.

The harness includes a `minimal-code` skill (YAGNI / lazy-senior-dev) that nudges every agent to write the least code that solves the task — saving tokens and reducing maintenance.
