# Baustein J — Cross-Model Review + gstack Compose

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan

## Motivation

A comparison of Yoke against gstack (garrytan/gstack) and superpowers (obra/superpowers)
surfaced two capabilities worth adopting, each in a way that preserves Yoke's identity
(cross-agent portability + reproducible retrofit + safe autonomy):

1. **On-demand cross-model review.** gstack's `/codex` lets a *second* model review the
   current diff interactively with a pass/fail gate. Yoke already does cross-model review
   *inside the loop* (`yoke loop run --review --reviewer=codex`, see `src/loop/runner.ts`
   `makeReviewRunner` + `src/loop/loop.ts`), but there is **no standalone command** for a
   human working interactively to get a second-model review before committing/pushing.

2. **Composing with gstack instead of bundling it.** gstack is Claude-Code- and Bun-bound,
   auto-updates hourly, and owns its own skill namespace. Bundling it would break Yoke's
   cross-agent uniformity (Codex/Gemini users would get nothing) and create two masters over
   `~/.claude/skills`. The sound integration is **detect-and-compose**: if gstack is present,
   route Claude to it for capabilities Yoke deliberately does not ship — without depending on
   it, and without ever touching Codex/Gemini artifacts.

Explicitly rejected: bundling gstack at install time; copying its browser/iOS/design-shotgun
breadth (that is gstack's Claude-Code + Bun identity, and copying it would dilute Yoke's
cross-agent promise).

## Part 1 — `yoke review` (standalone cross-model gate)

### Command

```
yoke review [targetDir] [--reviewer=<claude|codex|gemini>] [--base=<ref>] [--focus="..."]
```

### Behavior

- **Diff scope:**
  - Default: the **uncommitted working-tree changes** (working tree + staged). Matches the
    loop's per-story review semantics and the common "review before I commit/push" case.
  - `--base=<ref>`: review the committed range `<ref>..HEAD` (pre-PR review of a whole branch).
- **Reviewer resolution:**
  - `--reviewer=<agent>` overrides (validated against `claude|codex|gemini`).
  - Without the flag, resolve to the first **available** (CLI on PATH) agent in the order
    **`[codex, gemini, claude]`** — preferring a *second* model so the review is genuinely
    cross-model.
  - If resolution lands on `claude` (only Claude on PATH), proceed but print a note that this
    is a **self-review, not cross-model**.
  - If no agent CLI is on PATH, exit non-zero with an install hint (same diagnostics style as
    `runLoopCommand`).
- **Prompt:** a new story-less builder `buildStandaloneReviewPrompt(scope, focus?)` added to
  `src/loop/runner.ts` next to the existing `buildReviewPrompt`. It instructs the reviewer to inspect
  the diff (it runs `git diff` itself — it has repo access) for correctness, unmet intent,
  missing tests, and obvious bug/security risks. `--focus` injects an emphasis line.
  Approve by exiting 0; reject (any blocking issue) by exiting non-zero. Do not modify files.
- **Gate semantics:** the reviewer's stdout inherits to the console (like the loop). Approve →
  `yoke review` exits **0**; findings → exits **1**. This makes it chainable as a gate:
  `... && yoke review`, inside `verify.command`, or as a pre-push hook. Consistent with the
  Baustein-H gate model.
- **Watchdog:** wrap the invocation with the existing `buildWatchdogInvocation` using the
  default idle timeout (reuse `resolveIdleMs` / `DEFAULT_IDLE_MINUTES`), overridable via a
  `--timeout=<minutes>` flag, so a silent hang is killed. Minor but keeps parity with the loop.

### Module shape

- Export a thin `runAgent(inv: Invocation): AgentResult` from `src/loop/runner.ts` (wraps the
  existing private `runCli`) so a standalone caller can reuse invocation + watchdog plumbing
  without duplicating the win32/exec logic.
- Add `src/review/command.ts` with `runReview(targetDir, opts): number` (mirrors
  `src/context/command.ts`). It resolves the reviewer, builds the scope description + prompt,
  invokes via `agentInvocation` + `buildWatchdogInvocation` + `runAgent`, and maps the result
  to an exit code.
- Wire a `case 'review':` into `src/cli.ts` `main()` with flag parsing mirroring the existing
  `loop run` parsing (validate `--reviewer`, `--timeout`; accept `--base`, `--focus`).

### Out of scope (YAGNI)

- No loop wiring (the loop already has `--review`/`--reviewer`).
- No multi-reviewer quorum.
- No diff parsing in Node — the agent reads the diff itself.

## Part 2 — gstack compose (interop bridge)

### Detection

`retrofit` checks, best-effort and non-fatal, for a gstack install:

- repo-local: `<targetDir>/.claude/skills/gstack`
- global: `<os.homedir()>/.claude/skills/gstack`

Detection returns a boolean; a filesystem error is treated as "not detected".

### Effect (Claude artifact only)

When gstack is detected **and** `claude` is a target agent, `planClaude` appends a short
**"Composed tools"** section to the generated `CLAUDE.md` (`src/retrofit/planners/claude.ts`,
`claudeMd(...)`). The section routes Claude to gstack for the capabilities Yoke deliberately
does not ship:

- Live-browser QA → gstack `/qa`
- Security audit → gstack `/cso`
- Ship / deploy → gstack `/ship`, `/land-and-deploy`

The note is **never** added to Codex or Gemini artifacts (gstack is Claude-only). If gstack is
absent, nothing is written — the feature degrades cleanly to nothing, preserving cross-agent
uniformity.

### Non-goals

- No bundling, no install of gstack, no dependency, no interaction with gstack's auto-update.
- Yoke does not own gstack; it composes with it only when the user has installed it.

## Part 3 — Tests, docs, attribution

- **Tests:**
  - `yoke review`: diff-scope resolution (default vs `--base`), reviewer resolution order
    (codex→gemini→claude) including the self-review fallback note and the no-agent error,
    exit-code gate (approve=0 / reject=1), using an injected fake runner (no real CLI call,
    mirroring the loop tests' seam).
  - gstack detection: repo-local present, global present, absent; and that `planClaude` adds
    the "Composed tools" section to CLAUDE.md only when detected + claude targeted, and never
    to Codex/Gemini artifacts.
- **Docs:** README gets a `yoke review` section + a "composes with gstack" note; the canon
  `review` skill mentions `yoke review` as the interactive counterpart to the loop's
  `--review`. Bump the test-count badge.
- **Attribution:** credit the `/codex` idea to gstack (MIT © Garry Tan) in
  `canon/skills/ATTRIBUTION.md` — natively re-implemented, cross-agent, no code copied.

## Testability & isolation

- `runReview` takes an injectable runner (default = real `runAgent`) and an injectable
  `isAvailable` probe, exactly like `runLoopCommand`, so tests never spawn a real agent CLI.
- gstack detection takes the two candidate paths (or a `homedir` injection) so tests can point
  at a temp dir.
- Each unit has one purpose: prompt building, reviewer resolution, detection, and CLI wiring
  are separable and independently testable.
