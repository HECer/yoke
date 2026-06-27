# Forge

A cross-agent coding **harness** — one source-of-truth set of skills, policy, and tooling that you can install into any project for **Claude Code, OpenAI Codex CLI, and Gemini CLI**, with an optional autonomous **loop** that implements a spec story-by-story behind mechanical safety gates.

Forge has three parts:

1. **Canon** — a harness-agnostic source-of-truth (`canon/`): skills, policy gates, loop spec, and tool wiring.
2. **Retrofit** — `forge retrofit` reads the Canon and generates idiomatic, native artifacts for each agent in a target project — non-destructively.
3. **Loop** — `forge loop` runs an optional, opt-in Ralph-style autonomous loop that completes a PRD, marking a story done only when the agent **and** the project's tests both pass.

## Requirements

- Node.js ≥ 20 (developed on 24)
- Git
- Optional, wired but installed separately: [rtk](https://github.com/rtk-ai/rtk) (token compression), [graphify](https://github.com/safishamsi/graphify) (code graph), [Playwright MCP](https://github.com/microsoft/playwright-mcp) (browser). Forge writes their config; it does not install them.

## Install

```bash
git clone <this-repo>
cd MyHarnessSkill
npm install
```

Run the CLI with `npm run forge -- <command>` (or `npm run build` then `node dist/cli.js <command>`).

## Commands

### `forge validate [canonDir]`

Lints the Canon: manifest parses, every referenced skill/policy/loop/tool exists, each `SKILL.md` has valid frontmatter.

```bash
npm run forge -- validate canon
# ✓ canon valid (canon)
```

### `forge retrofit [targetDir] [--agent=...] [--loop]`

Generates harness artifacts into `targetDir` (default `.`) from the Canon. **Non-destructive**: any file it would overwrite is first copied to `.forge/backup/<timestamp>/`; re-running is idempotent (`unchanged`); `.claude/settings.json` is **deep-merged**, never replaced.

- `--agent=all` — generate for Claude + Codex + Gemini.
- `--agent=claude,gemini` — comma-separated subset.
- *(omitted)* — auto-detect from the project, falling back to Claude.
- `--loop` — record the autonomous loop as enabled in `.forge/config.yaml` (default: disabled).

```bash
npm run forge -- retrofit . --agent=all
```

What gets generated per agent:

| Agent | Artifacts |
|---|---|
| **Claude** | `.claude/skills/`, `AGENTS.md`, `CLAUDE.md` (imports `AGENTS.md`), `.mcp.json` (graphify + Playwright), and — when WSL is available — a `.claude/settings.json` rtk `PreToolUse` hook |
| **Codex** | `AGENTS.md`, `.codex/config.toml` (MCP servers), `RTK.md` |
| **Gemini** | `GEMINI.md`, `.gemini/commands/*.toml` (one slash-command per skill), `.gemini/settings.json` (MCP + `AGENTS.md` context) |

> **rtk asymmetry:** Claude can rewrite commands transparently via a hook (needs WSL on Windows). Codex and Gemini have no such hook, so they receive an instruction to prefix commands with `rtk` instead. The generated MCP launch commands are best-effort templates — adjust them to your local installs.

### `forge loop <on|off|status|run> [targetDir] [--max=N]`

The optional autonomous loop. Off by default; toggling is config-only and reversible.

```bash
npm run forge -- loop on .         # enable in .forge/config.yaml
npm run forge -- loop status .     # show enabled state + PRD progress
npm run forge -- loop run . --max=10
npm run forge -- loop off .
```

**How a run works** — each iteration starts a fresh agent and:

1. **Pre-dispatch gate** — the git worktree must be clean, else `blocked` (0 iterations).
2. Pick the highest-priority unfinished story from `.forge/prd.yaml`.
3. **Stop-the-Line gate** — the story must have acceptance criteria, else `blocked`.
4. Run the agent (`claude -p`) to implement **one** story.
5. **Verify** — run the project's test command (`verify.command` in config, or a detected `npm test`). The story is marked `passes: true` and committed **only if the agent succeeded AND the tests pass**. If tests are red: `blocked` (no commit, story stays open).
6. Stop when all stories pass (`complete`) or the iteration cap is reached (`cap-reached`).

State lives outside the model context — the PRD file plus git. The loop **refuses to start** if no verify command is configured or detectable, so it never marks work done without a green test run.

#### PRD format (`.forge/prd.yaml`)

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  acceptance:            # Definition of Done (required, else blocked)
    - The endpoint returns 200 for a valid request.
  passes: false          # the loop sets this true only on green tests
```

#### Verify command (`.forge/config.yaml`)

```yaml
verify:
  command: npm test      # optional; npm test is auto-detected if a real test script exists
```

## The Canon (`canon/`)

```
canon/
  AGENTS.md              # portable baseline instructions
  skills/<id>/SKILL.md   # harness-agnostic skills (methodology + roles)
  policy/                # gates.md (Stop-the-Line), roles.md (role separation)
  loop/                  # loop-spec.md, prd.schema.md
  tools/                 # rtk.md, graphify.md, playwright-mcp.md
  manifest.yaml          # declares everything above; validated by `forge validate`
```

The Canon is the single source of truth. To extend the harness, add to the Canon and `forge validate` it; `forge retrofit` then propagates it to every agent.

## Safety model

- **Mechanical gates, not agent goodwill** — the loop blocks on a dirty worktree, missing acceptance criteria, or red tests; none rely on the agent choosing to behave.
- **Commit integrity** — a story is never recorded `passes: true` without a corresponding commit (a failed commit reverts the PRD).
- **Non-destructive retrofit** — existing files are backed up before any change; `.claude/settings.json` is merged, not replaced.

## Development

```bash
npm test          # vitest (112 tests)
npm run build     # tsc, no emit errors
```

Design specs and per-component implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Each component (`A` Canon, `B1` Claude retrofit, `B2` Codex/Gemini + tools, `C1` loop, `C2` verify, `B3` settings merge) was built test-first and reviewed.

## Status

| Component | State |
|---|---|
| Canon + `forge validate` | ✅ |
| Retrofit — Claude | ✅ |
| Retrofit — Codex + Gemini + tool wiring | ✅ |
| Autonomous loop (gates, PRD, toggle) | ✅ |
| Loop verification (independent test run) | ✅ |
| Non-destructive settings merge | ✅ |
| **Deferred (C3):** Codex/Gemini loop runners, per-iteration worktree isolation, review-iteration with role separation | ⏳ |

### Known limitations

- The loop's agent runner is `claude -p` only; running it needs the `claude` CLI authenticated for headless use (`ANTHROPIC_API_KEY` or a logged-in CLI). Codex/Gemini runners are C3.
- WSL detection for the rtk Claude hook is best-effort; without WSL, Claude falls back to instruction-mode rtk.
- Generated MCP launch commands (graphify, Playwright, Codex config) are templates that may need adjusting to your local tool installation.
