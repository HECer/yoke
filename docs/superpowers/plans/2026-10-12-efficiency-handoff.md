# Efficiency handoff implementation plan

**Goal:** Apply the verified candidate to base `56691e694874dbf1166b461e1994172567bf9a17`, correct its remaining defects, and deliver an independently reviewed branch without merging or publishing.

**Architecture:** Preserve provider contracts and independent gates. Use bounded byte retention and shared line framing, invocation-scoped Claude accounting, deterministic context selection, and provider-scoped initialization probes. The supplied handoff is the approved specification; its future ideas remain separate.

**Tech stack:** TypeScript, Node 24.13.0, npm 11.9.0, Vitest, Windows. CI additionally covers the configured Linux/Windows and Node matrix.

## Acceptance criteria

- Preserve user changes, original patch and measurements; use independent worktree dependencies.
- Run all 57 candidate cases and additional crash regressions in batch and fragmented streaming paths. Preserve known input/cache/output/cost lower bounds on crash with `usageAvailable: false`.
- Preserve genuine measured zero usage before dispatch and positive error results. Never invent assistant output totals or merge unrelated session scopes.
- Bound retention/framing and recover after discarded oversized lines; preserve coverage gaps unless a cumulative snapshot covers them.
- Verify cancellation, Unicode, publisher/observer/timer/cleanup failures, retained usage and process ownership without leaving test children alive.
- Retain binding requirements and independent host gates; respect explicit loop/budget caps, avoid model calls for waiting, validate normal canon updates in a disposable project.
- Deduplicate initialization availability probes while preserving per-dispatch admission.
- Run lint, build, focused/full tests, canon validation, docs, audit and packaging checks; record baseline failures separately and repair relevant blockers.
- Record synthetic measurements separately from unperformed authenticated provider comparisons. Independent review is required before integration; no merge, tag or npm publication is authorized.

## Execution

- [x] Inspect local changes and fetch remote; current target equals the specified base, so a second port is unnecessary.
- [x] Create `fix/yoke-efficiency-handoff-20261012` with independent `npm ci`; verify patch SHA-256.
- [x] Record clean baseline checks and validate all manifest file hashes. Baseline audit failure is recorded separately; all other baseline gates passed.
- [x] Copy candidate tests first and run them against the baseline; apply original patch only after recording failures.
- [x] Register the three observed crash sequences as Vitest cases for batch/stream; observe failures on unchanged candidate, then repair accounting and extend scope/status tests.
- [x] Inspect framing and downstream budgets; add failing tests for uncovered defects before fixes.
- [x] Inspect process completion/termination and add required failure-stage regressions before fixes, including complete admission/race and Windows-casing coverage.
- [x] Check context requirements, worker host verification, loop wait/caps, canon update, routing admission.
- [x] Run all project gates and benchmark; update current metadata deliberately while preserving historical evidence. Final local gates all exit 0; 1,989 passed, two skipped.
- [x] Request independent review, address findings test-first, rerun affected gates, and prepare the reviewable branch and delivery evidence.

Exact final commit and Linux/Windows × Node 20/24 CI are a final delivery checkpoint. Record their immutable SHA and job URLs in the external delivery report; do not mutate the tested head just to insert its own hash. Delivery remains pending until that checkpoint passes.
