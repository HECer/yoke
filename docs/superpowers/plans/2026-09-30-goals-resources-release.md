# Goals, verification and recovery implementation plan

> **For agentic workers:** Implement independent parallel and resume components with dispatching-parallel-agents; integrate goal policy centrally. Write each regression before changing production behavior.

**Goal:** Correct the reproduced completion/resource/integration failures, provide optional persistent native Codex Goals, and prepare a validated 1.20.0 release.

**Architecture:** Yoke owns objective-specific executable acceptance and project integration. A negotiated optional native adapter owns a Codex thread, paused at verification boundaries. All actual provider calls use the same admission pool; local goal checks have abortable execution and a separate shared check budget. Durable run identity restores the correct mode and limits.

**Tech stack:** TypeScript, Node 20+, Zod, Vitest, native CLI/app-server stdio; no new dependency.

**Spec:** docs/GOALS-RESOURCE-AUDIT-2026-09-29.md and docs/CODEX-COMPARISON-2026-09-29.md. Recommendations in those dated reports become implementation scope here; historic results remain historic.

## Constraints and decisions

- Preserve the original dirty checkout; use the existing codex/benchmark-goals-2026-09-29 worktree.
- Native goals remain optional, capability negotiated, and never required for other providers. No global CLI configuration changes.
- Bind each goal to explicitly selected criterion IDs and a stable objective/contract digest. Old unbound goals require explicit binding before accepting completion; provide CLI migration command.
- Preserve --minutes as cumulative agent-time budget; add explicit cumulative wall-time budget. Report token overshoot and unknown consumption, never silently reset them.
- Disable unmanaged native multi-agent delegation for managed provider calls; reserve one pool unit per actual call, not an outer unit plus nested units.
- Keep protected acceptance, scope controls, commits and safe-boundary exploration semantics. No weaker test gates or fabricated CPU/USD savings.
- Prepare the release locally; tagging, npm publication and GitHub release are not performed by a preparation request.

## Review focus

Goal contract unrelated to new objective; stale/edited contracts; abort while admission is queued; planner/worker token accounting; dashboard resuming a stale goal instead of active explore run; expired exploration deadline; unavailable native protocol versus genuine authentication errors; native complete while Yoke check fails; retained worktree ownership; Windows full generated path length.

## Task 1 — Parallel integration and recoverable candidates

Files: src/loop/dispatcher.ts, parallel-command.ts, parallel-adapters.ts, merge-queue.ts; tests/loop parallel/dispatcher suites; reporter integration centrally.

- [x] Add failing story-environment regression using independent scopes and an environment-dependent verifier.
- [x] Preserve verification environment across worker and integration phases and restore previous environment on errors.
- [x] Persist concrete rejection reasons and recoverable candidate ownership; retain implemented work safely and enable existing recovery paths.
- [x] Shorten generated worktree names without weakening ownership validation; test Windows path failure handling.
- [x] Run covering tests and deterministic control probe.

## Task 2 — Durable run identity and resume

Files: src/loop/run-state.ts, run-command.ts, src/dashboard/server.ts, run-state/dashboard tests.

- [x] Add failing mode/provider/selection/deadline and unrelated-goal resume tests.
- [x] Persist validated safe run options under owned project lock; restore the interrupted run's mode.
- [x] Preserve absolute exploration deadline and user pauses; explicitly fresh CLI run gets a new deadline.
- [x] Verify expired deadline starts no provider and unsafe permissions do not silently carry over.

## Task 3 — Objective acceptance, policy and budgets

Files: src/goals/command.ts, contracts.ts/admission.ts as needed, src/check/command.ts async counterpart, src/cli.ts, src/retrofit/config.ts, goals/check tests.

- [x] Add failing unrelated-green-contract test, explicit binding/digest mutation tests, saturated pool and configured-selection tests.
- [x] Bind goal objective to selected criteria and contract revision; add goal bind CLI and documented legacy migration.
- [x] Resolve explicit provider/model/effort/bare overrides then project runner configuration; centrally disable unmanaged delegation.
- [x] Admit actual implementation and planner calls through the pool and release in finally.
- [x] Add abortable checks with shared local check admission; preserve fingerprints and protected contract evidence.
- [x] Add cumulative wall-time option and post-attempt overshoot/unknown-usage accounting, streamed cancellation where supported; preserve safe pause and interrupted work.

## Task 4 — Optional native Codex adapter

Files: src/goals/codex-native.ts, tests/goals/codex-native.test.ts; central goal integration/config.

- [x] Test initialized RPC transport, unsupported capability, malformed replies, thread start/resume, abort and bounded cleanup.
- [x] Persist objective-bound thread identity; execute bounded turns with native goals paused between turns so independent checks arbitrate continuation.
- [x] Synchronize completion/pause/budget/blocker states after Yoke checks; unavailable method can fall back, real execution/auth errors cannot silently downgrade.
- [x] Test provider switches and existing-thread/model mismatch; prevent competing auto-continuation.

## Task 5 — Review, measurements and release preparation

- [x] Review merged components, fix covering regressions and rerun deterministic audit probes with updated expected outcomes.
- [x] Run authenticated corrected parallel benchmark and report accepted quality/time/tokens with original sample limits.
- [x] Run TypeScript/build, full tests, metadata checks and package dry run in isolated state.
- [x] Add dated 1.20.0 CHANGELOG entry with implemented behavior, binding migration, default/native limits and actual validation limits.
- [x] Synchronize package/lock/provider manifest/README versions; link compact guides for goals/resources/recovery.
- [x] Read-only provenance audit for changed reports; prepare matching release notes and build archive.

## Progress ledger

- 2026-09-30: Plan created; three independent implementers assigned parallel correctness, durable resume, native adapter. Controller owns goal policy, check execution, integration, release preparation. Historic benchmark failures remain in reports.
- 2026-09-30: Implementation and review complete. Final prepublish pipeline passed (1,418 tests, 2 skipped, 155 files), lint/build/Canon/metadata/package checks and zero-vulnerability audit passed. Authenticated parallel and native accounting fixtures succeeded with their stated limits. Local 1.20.0 archive and changelog-derived notes prepared; publication remains out of scope.
