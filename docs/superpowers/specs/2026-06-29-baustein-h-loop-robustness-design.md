# Baustein H — Loop Robustness (verify-as-truth + flaky-tolerant verify)

**Status:** Design approved 2026-06-29
**Component:** Yoke (🐂)
**Relates to:** [[harness-build-progress]], [[harness-loop-technique]]

## Problem & Goal

Evidence from a real autonomous run (NewMarket, 52/57 stories): the loop blocked and needed
human intervention on a handful of stories. Two of those block causes are **harness defects**,
not project defects, and both are cheap to fix:

1. **Runner exit-code is treated as ground truth (SE5).** The story was implemented and the full
   suite was green (769/769), but the `claude` `.cmd` wrapper on Windows exited **127**. The loop
   checks `result.success` *before* running verify, so it **blocked a successful story** on a
   spurious exit code and didn't auto-commit. This contradicts the loop's own stated philosophy
   (Baustein C2): *"independent verification is the source of truth, not the agent's exit code."*

2. **No flaky-test tolerance (T4).** Under autonomous load, a heavy background task caused an
   async test to time out — a **false** red, not a real defect. The single-shot verify gate
   blocked the story. The user had to manually add `retry: 2` to the project's `vitest.config`.
   That resilience belongs in the harness.

**Goal:** make the loop trust **verify**, not the agent's exit code, and tolerate transient
flakes — closing two real block causes without weakening the gate.

**Out of scope (deferred):** cross-story regression repair (S5/S6 — a later story breaking an
earlier story's tests). That needs its own design; this spec does not address it.

## Key Decisions (locked)

| Decision | Choice |
|---|---|
| Verify authority | The **implementer** runner's `success` flag is advisory; **verify decides**. Run verify regardless of runner exit, block only on verify failure. |
| Runner-fail + verify-pass | Proceed (commit) — the exit code was a ghost. Note it via the reporter / summary. |
| Runner-fail + verify-fail | Block, with a reason naming both signals. |
| Reviewer runner | **Unchanged** — its non-zero exit *is* the reject verdict (there is no separate verify for the review). |
| Flaky tolerance | `retryingVerifier(inner, retries)` re-runs a failing verify up to `retries` times; first pass wins. |
| Retry default | `config.verify.retries` default **1** (one retry). `0` = strict/no-retry. A real failure still fails (twice). |
| Out of scope | Cross-story regression repair; changing the reviewer's exit-code semantics. |

## Architecture

### 1. `src/loop/verify.ts` — `retryingVerifier`
```ts
export function retryingVerifier(inner: Verifier, retries: number): Verifier {
  return (targetDir) => {
    let last = inner(targetDir)
    let attempt = 0
    while (!last.passed && attempt < retries) {
      attempt++
      last = inner(targetDir)
    }
    if (last.passed && attempt > 0) {
      return { passed: true, summary: `${last.summary} (passed on retry ${attempt})` }
    }
    return attempt > 0 && !last.passed
      ? { passed: false, summary: `${last.summary} (still failing after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` }
      : last
  }
}
```
Pure, injectable `inner` for tests (no real command needed).

### 2. `src/loop/loop.ts` — verify is the gate
In **both** the isolate and non-isolate paths, restructure the implementer step so verify always
runs:

- Run the implementer runner (keep `result` for its summary).
- `reporter.phase('verifying')`; run `opts.verify(dir)`.
- If verify **fails**: block. Reason = verify summary, and if the runner *also* reported failure,
  prepend that (`runner reported failure (<summary>); verify also red: <verify summary>`).
- If verify **passes**: proceed to review/commit even if `result.success` was false. When the
  runner had reported failure, the committed decision/summary notes
  `(runner exited non-zero but verify is green)` so the ghost is auditable.

The reviewer step is untouched: `if (!reviewResult.success) → block` stays (exit = verdict).

The Baustein-E invariant (no `passes:true` without a commit; decision rollback on commit failure)
and the leftover-hint are preserved exactly — only the implementer-failure gate moves from
"before verify" to "verify decides".

### 3. `src/retrofit/config.ts` — `verify.retries`
Extend the `verify` config object: `verify: { command: string; retries?: number }`.
Backwards-compatible (optional).

### 4. `src/loop/run-command.ts` — wire the retry
When building the verifier from config, wrap it:
`verify = retryingVerifier(commandVerifier(command), config.verify?.retries ?? 1)`.
The injected-verifier test path (`opts.verify`) is unchanged.

### 5. README + loop-spec
Document: verify is the source of truth (a spurious agent exit code can't block a green story),
and `verify.retries` (default 1) for flaky suites. Update `canon/loop/loop-spec.md` step 5.

## Testing (subagent-driven TDD)
- **verify.ts:** `retryingVerifier` passes immediately when inner passes (no retry); passes on
  retry N when inner fails then passes; fails after exhausting retries; `retries: 0` = single
  shot; summary notes the retry/exhaustion. Inner is a stub Verifier.
- **loop.ts:** runner-fail + verify-pass → story is committed + `passes:true` (the SE5 case);
  runner-fail + verify-fail → blocked with a combined reason; runner-pass + verify-fail →
  blocked (unchanged); the reviewer still blocks on its own failure; existing invariant tests
  (commit-failure revert, leftover hint) stay green; applies to both isolate and non-isolate.
- **config.ts:** `verify.retries` accepted + optional.
- **run-command.ts:** the built verifier is wrapped with the resolved retry count (assert via a
  small seam or by config round-trip).
- Full suite green; `tsc` clean.

## What this would have done for the run
- **SE5:** runner exits 127 but suite is 769/769 green → verify passes → story auto-commits. No
  manual finalize.
- **T4:** the load-flake fails once, the retry passes → story proceeds. No manual `vitest.config`
  patch, no false block.
