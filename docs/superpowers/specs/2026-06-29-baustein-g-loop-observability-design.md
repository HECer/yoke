# Baustein G — Loop Observability (heartbeat, timeout, live feedback)

**Status:** Design approved 2026-06-29
**Component:** Yoke (🐂)
**Relates to:** [[harness-loop-technique]], [[harness-build-progress]]

## Problem & Goal

A real incident: the autonomous loop ran on a downstream project (NewMarket) and sat
**blocked for ~5 hours, completely invisibly**. A story failed its verify gate, the loop
correctly returned `blocked` and stopped — but that outcome was printed to the stdout of a
detached background command and never surfaced. The user saw "running forever," couldn't tell
progress from a hang, and `yoke loop status` only reported the PRD count (`18/45`), not *why*
nothing was advancing.

Two gaps caused this:
1. **No durable, queryable run state.** `blocked` (and its reason) lived only in transient
   stdout. There was no artifact to glance at.
2. **No agent-run timeout.** A genuinely hung nested agent (`claude -p`) would wedge the loop
   indefinitely — only `verify` had a timeout, not the implementation run.

**Timeout must not punish slow-but-working agents.** A fixed *total-runtime* timeout cannot tell
"hung" from "working, just slow" and would kill a legitimately long story. So G uses an
**inactivity (idle) timeout**, not a wall-clock one: it measures time since the agent's *last
sign of life* (its last output byte), not total duration. An agent that keeps emitting output
runs for an unbounded time; only true silence is treated as a hang. The same output stream that
gives the user live feedback IS the liveness signal — feedback and hang-detection are one.

**Goal:** make the loop observable and self-limiting. The loop continuously reports where it
is (which story, which phase, why blocked) through **token-free, harness-side channels**, and
a per-iteration timeout breaks true hangs.

**Design principle — maximize free feedback.** All feedback added here is produced by the loop
driver (Node: console + local files), never by an agent. It costs **zero agent tokens**. The
only token cost in the loop remains the nested agent runs themselves, which G does not change.
So we deliberately make local feedback dense and frequent.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Heartbeat status file + `yoke loop status` upgrade + agent-run timeout + blocked-leftover reporting + live console narration + append log |
| Timeout kind | **Idle (no-output) timeout**, NOT total runtime. Resets on every output byte; only true silence counts. Total runtime is unbounded while the agent keeps producing output. |
| Timeout on expiry | Kill the child → treated as a normal failure → `blocked` → loop stops (consistent with runner-fail / verify-fail / review-reject). No silent skip. |
| Timeout default | 20 minutes of **silence**; `--timeout=<minutes>` flag > `config.loop.timeoutMinutes` > default. `0` disables. |
| Timeout mechanism | A small watchdog wrapper (`src/loop/watchdog.ts`) runs the agent as a child, forwards stdio (prompt in, output live out), and kills on idle expiry. Keeps `runLoop`/runner synchronous — no async ripple. |
| Feedback channels | Console narration + `.yoke/loop-status.json` (current state) + `.yoke/loop.log` (append-only timeline). All Node-side, 0 tokens. |
| Backwards-compat | No status file → `yoke loop status` behaves exactly as today. Reporter is injectable and defaults to a real impl; existing `runLoop` tests pass a no-op. |
| Out of scope (YAGNI) | No token metering of nested agents (technically not exposable), no log streaming server, no web dashboard. |

## Architecture

All new surface lives in the `loop/` subsystem.

### 1. `src/loop/reporter.ts` (new) — status types + reporter + reader
```ts
type LoopState = 'running' | 'blocked' | 'complete' | 'cap-reached'
type LoopPhase = 'implementing' | 'verifying' | 'reviewing' | 'committing'

interface LoopStatus {
  state: LoopState
  phase?: LoopPhase          // only meaningful while state === 'running'
  story?: string
  storyTitle?: string
  reason?: string            // populated on 'blocked'
  iteration: number
  progress: { passed: number; total: number }
  startedAt: string          // ISO — when the current story/iteration began
  updatedAt: string          // ISO — last heartbeat write
}

interface LoopReporter {
  storyStart(story, iteration, progress): void   // → state:running, phase:implementing
  phase(phase: LoopPhase): void                  // → updates phase + updatedAt
  blocked(reason: string): void                  // → state:blocked
  complete(progress): void                       // → state:complete
  capReached(progress): void                     // → state:cap-reached
}

makeReporter(dir, opts?: { quiet?: boolean }, now?: () => Date): LoopReporter
readStatus(dir): LoopStatus | null
```
The default `makeReporter` writes three places on every event:
- **`.yoke/loop-status.json`** — the single current `LoopStatus` (overwritten atomically: temp file + rename).
- **`.yoke/loop.log`** — appends one line: `<ISO>  <state/phase>  <story>  <detail>`.
- **console** — a human line (suppressed when `quiet`): e.g.
  - `▶ S6-seed-rich (19/45) — implementing…`
  - `  ✓ verified`  /  `  ✓ reviewed`  /  `  ✓ committed → 20/45`
  - `■ blocked on S6-seed-rich: verify failed (working tree left dirty — clean before restart)`

`now` is injectable for deterministic tests. Timestamps use the Node runtime (`Date`),
which is available (the loop is not a Workflow script).

### 2. `src/loop/loop.ts` — drive the reporter
`runLoop` takes an optional `reporter: LoopReporter` in `LoopOptions` (default: a no-op so the
existing tests are untouched; `run-command` injects the real one). At each boundary it calls:
`storyStart` before dispatch → `phase('verifying')` before verify → `phase('reviewing')` before
review → `phase('committing')` before commit → `complete`/`capReached`/`blocked` at terminal
returns. The **blocked** call's reason is enriched: if the working tree is dirty
(`opts.git.isClean(targetDir) === false`) after a block, append
`" (working tree has uncommitted changes from the blocked story — review/clean before re-running)"`.
This is the S5 leftover case made explicit.

### 3. `src/loop/watchdog.ts` (new) — idle-timeout wrapper
A tiny standalone CLI: `node watchdog.js --idle-ms=<N> -- <command> [args...]`.
- Spawns `<command>` with piped stdio. Forwards its own stdin to the child (so the prompt still
  reaches `claude -p`) and the child's stdout/stderr to its own (so live output still reaches
  the user — the feedback channel).
- Maintains an idle timer reset on **every** stdout/stderr chunk. On expiry it kills the child
  (SIGTERM, then SIGKILL after a short grace; on win32 `taskkill /pid /t /f` for the tree) and
  exits **124** (timeout convention). Otherwise it exits with the child's own exit code.
- `--idle-ms=0` means no watchdog (spawn-through with no timer).
All the async/stream complexity lives here, isolated and unit-testable. Nothing else in the
loop becomes async.

### 4. `src/loop/runner.ts` — run the agent through the watchdog
`Invocation` gains an optional `idleTimeoutMs?: number`. When set (>0), `runCli` runs the agent
**through the watchdog**: `node <dist>/loop/watchdog.js --idle-ms=<N> -- <command> <args...>`,
with the prompt still piped via stdin. `execSync` blocks on the watchdog (runner stays
synchronous). A watchdog exit of 124 (or any non-zero) is caught as today →
`{ success: false, summary: 'no output for Nm — treated as hung' }` → the loop blocks. When
`idleTimeoutMs` is unset/0, the agent runs directly as before. `makeRunner`/`makeReviewRunner`
accept and thread `idleTimeoutMs`; the reviewer run uses the same budget.

### 5. `src/loop/run-command.ts` — wire + upgrade `loop status`
- `runLoopCommand` resolves the idle timeout (`--timeout` flag > `config.loop.timeoutMinutes` >
  default 20 minutes; `0` disables), builds the real `makeReporter(targetDir)`, builds runners
  with the resolved `idleTimeoutMs`, and passes the reporter into `runLoop`.
- `loopStatus(targetDir)` reads `readStatus(targetDir)`. If present, it renders state + phase +
  story + title + reason + iteration + a relative `updatedAt`, and — when `state==='running'`
  and `updatedAt` is older than the timeout — a `possibly stuck (no update in Nm)` hint. If
  absent, it falls back to today's `enabled + PRD progress` output verbatim.

### 6. `src/retrofit/config.ts` — optional config field
`loop.timeoutMinutes?: number` (idle minutes) added to the schema (optional, backwards-compatible).

### 7. `src/cli.ts` — flag + gitignore note
Parse `--timeout=<minutes>` on `yoke loop run`. `.yoke/loop-status.json` and `.yoke/loop.log`
are runtime artifacts — ensure the retrofit gitignore covers them (or document that they are
local-only). They must NOT block the clean-tree gate: the loop writes them under `.yoke/`,
which retrofit already gitignores for `worktrees`/`backup`; extend that to these two files.

## Data flow (one iteration)
```
storyStart(S6) ─► [console ▶ / status running:implementing / log]
   runner(idle-watchdog) ─► phase(verifying) ─► verify ─► phase(reviewing) ─► [review]
   ─► phase(committing) ─► appendDecision ─► savePrd(passes) ─► commitAll
   ─► [console ✓ committed → 20/45]
on any failure ─► blocked(reason + leftover-hint) ─► [console ■ / status blocked / log] ─► return
```

## Error handling
- Status writes are best-effort and atomic (temp + rename); a write failure never aborts the
  loop (wrapped, logged to console, swallowed) — observability must not break execution.
- Timeout kills the child and surfaces as `blocked`; the clean-tree gate + leftover hint guard
  the restart.
- `readStatus` on a missing/corrupt file returns `null` → `loop status` falls back gracefully.

## Testing (subagent-driven TDD, like A–F)
- **reporter.ts:** status round-trip (write→read); missing file → null; each event sets the
  right state/phase; `loop.log` appends one line per event; `quiet` suppresses console;
  injected `now` makes timestamps deterministic; atomic write leaves no temp file behind.
- **loop.ts:** reporter receives `storyStart`/`phase`/`complete` in order on success;
  `blocked` with reason on a failed verify; leftover hint appended when `git.isClean` is false
  on block; existing loop tests still pass with the default no-op reporter.
- **watchdog.ts:** wrapping a child that keeps emitting output past the idle window is **not**
  killed (proves slow-but-working survives); wrapping a silent child that outputs nothing is
  killed after the idle window and exits 124; a fast child passes its exit code through; stdin
  is forwarded to the child; `--idle-ms=0` never kills. (Use tiny `node -e` children with short
  idle windows for deterministic, fast tests.)
- **runner.ts:** when `idleTimeoutMs>0` the invocation runs through the watchdog wrapper (assert
  the built command); when unset/0 it runs the agent directly; resolution order flag>config>20.
- **run-command.ts:** `loopStatus` renders state+phase+reason when a status file exists; falls
  back to PRD-only when absent; `--timeout` parsed and forwarded.
- **config.ts:** `timeoutMinutes` accepted and optional.

## What this would have done for the incident
`yoke loop status .` →
```
Loop: BLOCKED on S5-segment-schemas "All 9 segment attribute schemas…"
  phase: verifying · iteration 19 · 18/45 · last update 5h ago
  reason: story did not verify (working tree has uncommitted changes — clean before restart)
```
…instead of `18/45`. And a true hang (no agent output at all) would self-terminate after 20
minutes of silence as `blocked` — while a genuinely slow story that keeps streaming progress
runs as long as it needs.
