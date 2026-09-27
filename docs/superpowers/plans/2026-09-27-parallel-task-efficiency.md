# Parallel Task Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yoke's independent-task execution safer under load, easier to parallelize, less blocked by integration, and measurable by accepted result.

**Architecture:** Keep the PRD dependency graph and FIFO integration gate as the source of correctness. Add bounded cross-project worker admission, let PRD planning propose safe task splits that become ordinary stories, and separate implementation slots from the serialized integration lane while retaining scope reservations through integration. Extend event-based measurements and schedule forecasts to account for both lanes.

**Tech Stack:** TypeScript, Node.js filesystem/process APIs, Zod, YAML, current Yoke CLI and dashboard.

---

## File map

- `src/loop/resource-pool.ts`: user-local, cross-process weighted leases with FIFO fairness, owner identity, stale-owner recovery, and owner-checked release.
- `src/loop/run-command.ts`, `src/loop/parallel-command.ts`, `src/loop/dispatcher.ts`: bounded configuration, lease acquisition, lane scheduling, and lifecycle reporting.
- `src/retrofit/config.ts`, `src/cli.ts`, `src/prd/command.ts`, `src/prd/decompose.ts`, `src/loop/prd.ts`: bounded worker schema and safe PRD decomposition command.
- `src/observability/events.ts`, `src/loop/reporter.ts`, `src/estimation/schedule.ts`, `src/dashboard/server.ts`, `src/dashboard/panels.ts`: stage and wait measurements, resource status, and two-lane ETA.
- `bench/run-parallel-matrix.mjs`, `bench/fixtures/parallel-work/`: repeatable synthetic serial/parallel comparisons with fixed work and no paid model calls.
- `README.md`, `docs/VERIFIED-PROJECTS.md`, `docs/parallel-execution.md`, `CHANGELOG.md`: user-facing defaults, limits, recovery, and validation boundaries.

## Task 1: Bound shared execution capacity

- [x] Cap explicit and configured per-project concurrency at eight; reject larger values with a clear limit.
- [x] Add a user-local shared pool that coordinates concurrent Yoke loop processes across projects and hosts no model prompts or project contents.
- [x] Track total active worker weight. Default to three total worker units; allow a bounded override through `YOKE_MAX_PARALLEL_WORKERS`. Provider-specific hard limits are not reliable while adaptive routing can change the selected backend after dispatch, so provider use is recorded as evidence instead of guessed.
- [x] Implement weighted FIFO admission with bounded overtakes, cancellable waits, owner process identity, atomic records, stale-owner recovery, and token-checked release. Fail closed on corrupt ownership state or unsupported atomic filesystem operations.
- [x] Reserve candidate races by the number of simultaneous candidate workers. Release implementation permits before integration and acquire a separate permit for integration/review.
- [x] Keep `auto` conservative at the shared limit only when all pending tasks declare write scopes; the shared pool may lower simultaneous work across projects.

## Task 2: Improve task decomposition safely

- [x] Add `yoke prd decompose --story=<id>` to request a bounded child-story proposal from the configured planner.
- [x] Require structured executable acceptance criteria and nonempty, valid, pairwise-disjoint write scopes for each child; preserve the original criteria exactly as a complete union.
- [x] Keep preview as the default. `--apply` acquires the project lock, rechecks PRD/brief hashes, replaces the parent with child tasks, and rewrites downstream dependencies to require every child.
- [x] Validate IDs, story schema, dependency references, and cycles before the atomic write. Stale assessment bindings are removed. Planner output never becomes executable shell text.
- [x] Include the proposal format and refusal cases in CLI help and documentation.

## Task 3: Pipeline implementation and integration

- [x] Count only active implementations against implementation slots; keep completed candidates in the serial integration lane without blocking unrelated, dependency-ready work.
- [x] Keep their areas and declared write scopes reserved until integration finishes, so dependent or overlapping stories cannot start early.
- [x] Keep the existing rebase, integrated-tree gates, commit, post-integration cleanliness check, cancellation, and cleanup ordering.
- [x] Report implementation activity, global-pool wait, integration queue wait, and integration duration separately in status and immutable events.

## Task 4: Measure end-to-end efficiency

- [x] Extend event aggregation with accepted-result wall time, implementation work, queue wait, integration time, attempts, reported usage, and measurement coverage.
- [x] Update schedule simulation to model weighted implementation workers and one serialized integration lane; preserve empirical ranges and unknowns.
- [x] Show local/global capacity, resource waits, and lane utilization in CLI/dashboard status.
- [x] Add a synthetic benchmark matrix comparing one, two, and three workers over serial chains, independent scopes, and conflicting scopes. Record wall time, worker time, integration wait, total attempts, and accepted results. The fixture uses a deterministic local runner; no provider costs or model-quality claims are implied.

## Task 5: Document operation and limits

- [x] Document bounded overrides, global environment settings, pool location/recovery, task-split preview/application, pipeline behavior, and telemetry coverage.
- [x] Add a dated unreleased changelog entry; do not change package versions, tag, publish, or claim external benchmark results.
- [x] Run TypeScript build and release documentation checks. No tests are added or run in this execution.

**Execution record:** TypeScript build and `docs:check` passed on the first run. A later check retry could not enumerate tests because Vitest's `list --json` command ran out of WebAssembly memory; no tests were executed. The synthetic matrix is recorded in `bench/RESULTS.md`.

## Self-review

- Coverage: hard concurrency bounds, shared resource accounting, safe task decomposition, integration overlap, measurement, estimation, dashboard, benchmark harness, and documentation each have an implementation task.
- Safety: PRD writes remain lock-protected and atomic; acceptance and dependency validation remain mandatory; write scopes stay advisory scheduling inputs; pool leases are owner-bound and never reclaimed from a live process.
- Compatibility: existing serial mode and existing PRDs remain valid; new decomposition and resource overrides are opt-in or bounded defaults; no release/version change is part of this task.
