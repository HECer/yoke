# Baustein E — Context Layer (durable cross-session context)

**Status:** Design approved 2026-06-28
**Component:** Yoke (🐂)
**Relates to:** [[harness-project-goal]], [[harness-stack-decisions]], [[harness-loop-technique]]

## Problem & Goal

The dev.to article ("A Claude Code Skills Stack") frames a three-layer division of labor:
**gstack decides → GSD stabilizes context → Superpowers executes.** Yoke today has the
Decision layer (ported gstack roles) and a strong Execution layer (superpowers methodology +
the Ralph loop), but it never built the **Context layer** — GSD's actual contribution:
durable, cross-session artifacts that prevent specification drift.

Concretely, the loop's [`buildClaudePrompt`](../../../src/loop/runner.ts) injects **only the
current story + its acceptance criteria**. Every fresh-context iteration starts blind to the
project's overall goal, the decisions already made, and the gotchas already learned. Over many
iterations this is exactly where drift leaks in. The user's own auto-memory does this job by
hand; the harness should give its users the same thing.

**Goal:** a durable Context layer — three markdown files under `.yoke/context/` that the loop
**reads before each iteration** and **writes decisions back to**, plus a skill so interactive
(non-loop) sessions honor the same files. This closes the spec-drift hole and completes the
third leg of the article's model.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Loop **and** interactive sessions (retrofit scaffolds for all 3 agents) |
| Write-back | **Hybrid**: loop deterministically auto-logs decisions; agents enrich `DECISIONS`/`KNOWLEDGE` via the skill |
| Files location | `.yoke/context/` (agent-agnostic shared state, like `.yoke/prd.yaml`) |
| Config | None new — injection auto-on when files present; prompt bound is a constant |
| Backwards-compat | No `.yoke/context/` → loop prompt is byte-identical to today |
| Out of scope | Routing/priority fix (separate Baustein F), structured decision schema, cross-file linking |

## The three files — `.yoke/context/`

| File | Role | Writer |
|------|------|--------|
| `PROJECT.md` | North star: goal, constraints, **non-goals**, success criteria | Human/brainstorm authored; retrofit scaffolds a template. Read-only input. |
| `DECISIONS.md` | Append-only ADR ledger | Loop auto-appends per completed+verified story; agents append in interactive work. |
| `KNOWLEDGE.md` | Gotchas, conventions, reusable learnings | Agent/human maintained via the skill. |

The files are plain markdown — no schema, no required structure beyond `DECISIONS.md`'s
append format (so the loop can append unambiguously). Missing or partial files are valid:
the layer degrades gracefully (an absent file contributes nothing to the prompt).

## Architecture

### New module — `src/context/context.ts`
Pure and unit-testable, structured like `src/loop/prd.ts`:

- `loadContext(dir): ProjectContext` — read the three files if present; missing → empty strings. Never throws on absence.
- `formatForPrompt(ctx, maxChars): string` — render a "Project context" block, **tail-bounding** each file to `maxChars` (constant, ~2 KB) so a large ledger can't blow up the prompt. Returns `''` when all three are empty.
- `appendDecision(dir, entry): { rollback: () => void }` — append a `DECISIONS.md` entry and return a rollback that restores the prior file content (captured before the write). Creates the file if absent.

`ProjectContext = { project: string; decisions: string; knowledge: string }`.

A decision entry is formatted as:
```
## <YYYY-MM-DD> — <story-id>: <title>
<one-line summary>
```
The date comes from the Node runtime at loop time (the loop is normal Node, not a Workflow
script — `Date` is available).

### Loop read — `src/loop/runner.ts`
`buildClaudePrompt(story, context?)` and `buildReviewPrompt(story, context?)` gain an optional
pre-formatted `context` string. When present, a "Project context" section is inserted **ahead
of** the story block. The reviewer gets the north star too (so it reviews against goals, not
just acceptance criteria). When `context` is undefined/empty, the prompts are unchanged.

The loop loads + formats context once per iteration (`.yoke/context/` resolved relative to
`targetDir`) and threads it through the runner/review call.

### Loop write-back — `src/loop/loop.ts`
After verify (and optional review) passes, **before the commit**:

1. `appendDecision(contextDir, { storyId, title, summary })` → keep the returned `rollback`.
2. `savePrd(passes:true)`.
3. `commitAll(...)` — now also stages `DECISIONS.md`, so the decision and the `passes:true`
   flip land in the **same atomic commit**.

If the commit throws, revert **both**: `savePrd(prior stories)` *and* `rollback()` for the
decision file. This preserves the existing invariant — *`passes:true` never persists without a
commit* — and extends it to the decision ledger (no orphan decision without a commit).

In `--isolate` mode the append happens inside the worktree before the worktree commit, so
`integrate` fast-forwards the decision back into the main tree along with the code.

### Retrofit scaffolding — `src/retrofit/`
A retrofit action writes `.yoke/context/{PROJECT,DECISIONS,KNOWLEDGE}.md` from
`canon/context/*.md` templates **only if absent** (non-destructive + idempotent, the same rule
as every other artifact). Agent-agnostic — one set under `.yoke/` serves claude/codex/gemini,
so it is emitted once regardless of `--agent`. The report lists the scaffolded files.

### Skill — `canon/skills/maintaining-context/SKILL.md`
Agent-facing, flows to all three agents via the existing planners + `manifest.yaml`:
> Before substantial work, read `.yoke/context/PROJECT.md` for the north star and
> `KNOWLEDGE.md` for known gotchas. When you make a non-obvious decision, append it to
> `DECISIONS.md`. When you learn a reusable fact or gotcha, append it to `KNOWLEDGE.md`.

This is what extends drift-protection from the loop to interactive sessions.

### CLI — `src/cli.ts`
- `yoke context init` — scaffold the three files standalone (idempotent, non-destructive).
- `yoke context status` — show presence, byte sizes, and the last decision heading.

## Data flow (loop iteration)

```
load PRD ─► pick story ─► load+format .yoke/context ─► runner(prompt + context)
   ─► verify ─► [review] ─► appendDecision() ─► savePrd(passes:true) ─► commitAll(+DECISIONS.md)
                                   └── on commit failure: rollback() + savePrd(prior) ──► blocked
```

## Error handling

- Missing/partial context files: treated as empty; no error, prompt simply omits that part.
- Oversized files: tail-bounded to a constant per file; never unbounded.
- `appendDecision` before commit + rollback on commit failure: no orphan decisions.
- Isolate mode: decision written in the worktree, carried back only on successful integrate.
- `yoke context init` over existing files: skips them (reports "exists"), never overwrites.

## Testing (subagent-driven TDD, like A–D)

**context.ts units:** load with all/none/partial files present; `formatForPrompt` bounding +
empty-returns-`''`; `appendDecision` format correctness + rollback restores prior content +
creates file when absent.

**loop:** prompt includes the context block when `.yoke/context/` present; prompt unchanged
when absent; decision appended on success; **not** appended on a blocked story; both PRD and
decision reverted on commit failure; isolate path carries the decision back via integrate.

**retrofit:** scaffolds the three files; idempotent on re-run; non-destructive over existing
files; emitted once for `--agent=all`.

**canon:** `maintaining-context` present in `manifest.yaml`; `yoke validate canon` stays green.

## Non-goals (YAGNI)

- No new config keys (injection is automatic; bound is a constant).
- No structured/parsed decision schema — markdown append only.
- No cross-file linking or decision superseding.
- Routing/priority arbitration is **Baustein F**, not this spec.
