# Forge — Cross-Agent Coding Harness + Retrofit-Skill + Loop

**Status:** Design approved 2026-06-27
**Working name:** Forge (changeable)

## Problem & Goal

Build two deliverables on one shared foundation:

1. **Harness** — a cross-agent coding harness runnable across **Claude Code + OpenAI Codex CLI + Gemini CLI**.
2. **Retrofit-Skill** — a user-invocable skill that, run inside any existing project, rebuilds that project's harness for more **efficiency**, better **quality**, and more **autonomous** agent action.

Both need an autonomous **Loop** variant (Ralph-loop pattern, per video `xBygL_fIK78` "Claude Code and Codex Don't Need You Anymore", Hunter Sneed).

**Build principle:** one source-of-truth → idiomatic native artifacts per harness (wshobson/agents-style), NOT lowest-common-denominator translation. No drift.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Target environment | Cross-agent: Claude Code + Codex CLI + Gemini CLI |
| Artifact model | One source-of-truth (Canon); the skill is the installer |
| Packaging | Ansatz 1: Monorepo Canon + runtime-generating skill |
| Build sequence | A (Canon) complete → B (Retrofit-Skill) → C (Loop) |
| Generation | At runtime inside the skill (no Make; Windows-native) |
| Loop autonomy | Aggressive-autonomous with hard mechanical gates |
| Loop driver | Spec/PRD file with `passes:true` stories (Ralph standard) |

## Stack Decisions (researched, adversarially verified 2026-06-27)

| Category | Tool | Verdict |
|---|---|---|
| Methodology spine | **superpowers** | KEEP — only one with native install paths for all 3 agents (Gemini-parity anchor) |
| Role-team overlay | **gstack** | KEEP — Claude/Codex first-class, Gemini benchmark-only (issue #619) |
| Token efficiency | **rtk** | KEEP — Windows caveat: auto-rewrite needs WSL else instruction-mode |
| Code-graph | **graphify** | KEEP (user's informed choice) — MIT, multimodal; heuristic + static index tradeoff accepted |
| — | jcodemunch | OUT — proprietary/paid license = showstopper for bundling/retrofitting |
| Loop core | **gsd-pi** | KEEP as loop reference — milestones→slices→tasks, mechanical HITL blockers |
| Safety/policy | **safe-agentic-workflow** | KEEP as policy layer — Stop-the-Line gates + role separation |
| Browser/dogfood | **Playwright MCP** | ADD — only one native-MCP across all 3 agents; cleanest Windows story |
| — | dogfood/agent-browser skill | OUT — Claude-only (MCP layer optional for token-tight cases) |
| Instruction baseline | **AGENTS.md** | ADD — portable canon across 28+ agents |
| Generator architecture | **wshobson/agents** pattern | ADOPT — source-of-truth → idiomatic per-harness |

**Deferred (later swap notes):** Serena (LSP-accurate code-graph) if graphify's heuristic/staleness becomes limiting; sub-agents-skills (cross-model delegation); native plugin packaging (Ansatz 3).

## Architecture — 3 layers

```
A: CANON (this repo, harness-agnostic source-of-truth)
   → read by →
B: RETROFIT-SKILL (runtime generator): detect → plan → generate → wire → report
   → emits idiomatic artifacts into →
   Claude Code | Codex CLI | Gemini CLI
C: LOOP-ENGINE (autonomous Ralph mode, PRD-driven, hard gates) — usable by A and B
```

### Baustein A — The Canon

```
canon/
  AGENTS.md              # portable baseline instructions (the spine)
  skills/                # harness-agnostic SKILL.md (superpowers spine + gstack roles)
    brainstorming/  test-driven-development/  investigate/  ...
    ceo-review/  eng-review/  qa/  security/  ship/  ...
  policy/
    gates.md             # Stop-the-Line: DoD/Acceptance-Criteria required before implementation
    roles.md             # role separation: implementer != merger != reviewer != security
  loop/
    loop-spec.md         # Ralph+GSD algorithm + stop condition
    prd.schema.md        # PRD format (stories with passes:true)
  tools/
    rtk.md  graphify.md  playwright-mcp.md   # per-agent wiring manifests
  manifest.yaml          # contents + versions + which artifacts emit per agent
```

The Canon contains NO agent-specific paths — those are produced only in B.

### Baustein B — Retrofit-Skill (5 phases)

1. **detect** — scan target project: which agents (`.claude/`, `.codex/`, `.gemini/`, `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`), existing skills, hooks, MCP configs. Also detect rtk WSL availability on Windows.
2. **plan** — propose an **additive, non-destructive** retrofit (never overwrite without backup + consent); show diff preview.
3. **generate** — emit idiomatic per detected agent from the Canon:
   - **Claude**: `.claude/skills/`, `settings.json` hooks (rtk PreToolUse), MCP servers, `CLAUDE.md`→`AGENTS.md` symlink
   - **Codex**: `AGENTS.md`, `config.toml` (MCP), `RTK.md`, skills dir
   - **Gemini**: `.gemini/commands/*.toml`, `GEMINI.md` (+ `AGENTS.md` via `context.fileName`), `settings.json` `mcpServers`, optional `gemini-extension.json`
4. **wire** — connect cross-agent tools with caveats handled (see Cross-Agent section).
5. **report** — summary + diff; everything reversible (backup directory).

### Baustein C — Loop-Engine (aggressive-autonomous, hard gates)

Thin driver starting **fresh context per iteration**:

```
while not (all PRD stories passes:true):
    pre-dispatch gates  → missing tools / dirty worktree / git conflict → "blocked"
    pick highest-priority unfinished story
    Stop-the-Line gate  → DoD/AC present? else blocked
    spawn fresh agent (claude -p | codex exec | gemini) in a git worktree
    implement ONE story → tests green? → review iteration (different role)
    update PRD (passes:true) + atomic commit
    iteration-cap reached? → stop
```

- **State outside context**: PRD file + git. **Stop**: all stories `passes:true`.
- **Gates mechanically enforced** (not voluntary), **worktree-isolated** → always rollback-able.
- **Cross-agent**: same loop invokes the chosen agent CLI non-interactively.

## Cross-Agent Specifics & the Gemini Asymmetry

| Tool | Claude | Codex | Gemini |
|---|---|---|---|
| **rtk** | PreToolUse hook (Windows: needs WSL, else instruction-mode) | `AGENTS.md`/`RTK.md` | **no hook** → MCP tool OR `GEMINI.md` instruction |
| **graphify** | MCP server | MCP server | MCP server (`mcpServers`) |
| **Playwright** | MCP server | MCP server | MCP server |
| **Instructions** | `CLAUDE.md`→`AGENTS.md` | `AGENTS.md` native | `GEMINI.md` + `AGENTS.md` via `context.fileName` |
| **Slash-commands** | `.claude/` | TOML | `.gemini/commands/*.toml` |

**Central asymmetry:** Gemini has **no hook system** → rtk's transparent rewriting is not 1:1 reproducible; generator falls back to MCP tool or GEMINI.md instruction. Codex-only flags (`model_reasoning_effort`, `resume`) are abstracted/emulated by the generator.

## Testing

- **TDD** (superpowers spine).
- **B** tested against **fixture target projects** (various agent setups) → asserts correct artifacts emitted, **idempotent**, **non-destructive**.
- **C** tested with a tiny PRD fixture completing in 1–2 iterations against a mock agent.
- **Windows-native**: no Make; generator logic in the skill (or Node/Python). rtk WSL-fallback detected in `detect`, applied in `wire`.

## Out of Scope (YAGNI, first cut)

Native plugin packages (Ansatz 3); sub-agents-skills cross-model delegation; Serena swap; benchmark-models. All retrofittable later.

## Open Risks

- **Gemini parity** is the largest technical risk (no hooks; no session-continuity equivalent to Codex `resume`).
- rtk's 60–90% savings is self-reported; real savings vary per command and per agent.
- graphify is young (v0.8.x), heuristic edges, static index can go stale.
