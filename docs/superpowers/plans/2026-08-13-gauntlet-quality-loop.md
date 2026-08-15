# Gauntlet Quality Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded and explicitly unbounded comparative-quality iteration, structured repair, external reference judging, production parallel workers, candidate races, ephemeral decomposition, and versioned provider contracts to Yoke without weakening its mechanical gates.

**Architecture:** Extend the existing `yoke loop` state machine rather than adding a second loop. New focused `src/quality/`, `src/agents/contracts.ts`, and loop-worker modules provide pure contracts and adapters; `runLoop` retains story/commit authority. Deliver the work in independently green phases so the unchanged serial, no-quality path remains releasable throughout.

**Tech Stack:** TypeScript ESM, Node.js ≥20 standard library, Zod 3, YAML, Vitest 4, Git worktrees, existing Claude/Codex/Gemini CLI adapters, project-local Playwright when visual artifacts are used.

**Source design:** `docs/superpowers/specs/2026-08-13-gauntlet-quality-loop-design.md`

---

## File structure

### New production modules

- `src/agents/contracts.ts` — versioned machine envelopes shared by routing, review, quality, decomposition, and telemetry.
- `src/quality/types.ts` — quality policy, reference, candidate, verdict, budget, and outcome types.
- `src/quality/reference.ts` — safe reference validation, acquisition, hashing, and provenance.
- `src/quality/artifacts.ts` — candidate artifact collection and deterministic digesting.
- `src/quality/verdict.ts` — quality verdict file contract and label-swap consistency reduction.
- `src/quality/runner.ts` — read-only critic invocation and evidence persistence.
- `src/quality/repair.ts` — selected-gap extraction and repair prompt/runner construction.
- `src/quality/loop.ts` — bounded/unbounded quality-round controller; no story or commit ownership.
- `src/loop/worker.ts` — execute one isolated story candidate through implementation and gates.
- `src/loop/dispatcher.ts` — provider subprocess workers, claims, cancellation, and merge-queue integration.
- `src/loop/candidates.ts` — same-story candidate fan-out and winner-only selection.
- `src/loop/decomposition.ts` — ephemeral subtask schema, planning, scheduling, and synthesis.

### Existing modules to modify

- `src/review/verdict.ts` — schema version, provenance, and optional actionable finding metadata.
- `src/retrofit/config.ts` — quality defaults and decomposition configuration.
- `src/loop/prd.ts` — optional story quality declaration.
- `src/loop/runner.ts` — repair/decomposition/quality invocations through provider adapters.
- `src/loop/loop.ts` — invoke quality/repair controller while preserving gate and commit order.
- `src/loop/run-command.ts` — resolve quality policy, parallel dispatcher, candidates, and CLI options.
- `src/loop/reporter.ts` — quality/parallel phases and structured status fields.
- `src/loop/claims.ts` — dispatcher/base/worktree/provider/heartbeat metadata.
- `src/loop/parallel.ts`, `src/loop/scheduler.ts`, `src/loop/merge-queue.ts` — production worker and integration semantics.
- `src/routing/router.ts` — consume versioned route contracts and disclose fallback reasons.
- `src/agents/telemetry.ts` — versioned telemetry envelope plus raw evidence retention.
- `src/cli.ts` — additive CLI flags and conflict validation.
- `src/retrofit/planners/shared.ts` and generated templates — runtime ignore paths and config comments.
- `canon/loop/prd.schema.md`, `canon/loop/loop-spec.md`, `canon/skills/authoring-prd/SKILL.md` — user-facing contracts.
- `README.md`, `CHANGELOG.md`, `TODOS.md`, migration docs — truthful shipped behavior.

### New test suites

- `tests/agents/contracts.test.ts`
- `tests/quality/{reference,artifacts,verdict,repair,loop}.test.ts`
- `tests/loop/{worker,dispatcher,candidates,decomposition}.test.ts`
- `tests/loop/gauntlet-cli.integration.test.ts`
- `tests/fixtures/fake-agent.mjs` additions for deterministic provider outputs and process behavior.

---

## Phase 1: Versioned contracts and backward-compatible schemas

### Task 1: Shared machine-result envelopes

**Files:**
- Create: `src/agents/contracts.ts`
- Create: `tests/agents/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests** covering a valid envelope, rejection of unknown schema versions, required role/provider/timing fields, optional reported model, usage, and retained raw metadata.
- [ ] **Step 2: Run** `npx vitest run tests/agents/contracts.test.ts` and confirm failure because the module does not exist.
- [ ] **Step 3: Implement** `MachineEnvelopeSchema`, `MachineRoleSchema`, `MachineUsageSchema`, and inferred types. Version 1 accepts roles `route`, `review`, `quality`, `decomposition`, `candidate-selection`, `telemetry`; timing is nonnegative integer milliseconds; `raw` is `z.record(z.unknown()).optional()`.
- [ ] **Step 4: Run** `npx vitest run tests/agents/contracts.test.ts` and confirm pass.
- [ ] **Step 5: Commit** `feat(contracts): add versioned provider result envelopes`.

### Task 2: Review verdict provenance and actionable gaps

**Files:**
- Modify: `src/review/verdict.ts`
- Modify: `src/loop/runner.ts`
- Modify: `tests/review/verdict.test.ts`
- Modify: `tests/loop/runner.test.ts`

- [ ] **Step 1: Add failing tests** proving legacy `{approved,summary,findings}` remains valid and versioned verdicts accept `schemaVersion:1`, envelope provenance, finding `id`, `actionable`, and `evidence` fields.
- [ ] **Step 2: Add a failing test** for `selectRepairFinding(verdict)` choosing the first actionable blocking finding deterministically by original order and returning `null` for malformed/infrastructure-only rejection.
- [ ] **Step 3: Run** `npx vitest run tests/review/verdict.test.ts tests/loop/runner.test.ts` and confirm the new expectations fail.
- [ ] **Step 4: Extend schemas minimally** with optional fields and export `selectRepairFinding`. Update `formatReviewContract` to request the versioned shape while `readReviewVerdict` still parses legacy files.
- [ ] **Step 5: Run** the two focused suites and confirm pass.
- [ ] **Step 6: Commit** `feat(review): add actionable versioned verdicts`.

### Task 3: Quality configuration and PRD declarations

**Files:**
- Create: `src/quality/types.ts`
- Modify: `src/retrofit/config.ts`
- Modify: `src/loop/prd.ts`
- Modify: `tests/retrofit/config.test.ts`
- Modify: `tests/loop/prd.test.ts`

- [ ] **Step 1: Write failing config tests** for safe defaults (`enabled:false`, blocking, three rounds, 60 minutes, two consistency checks, two max candidates), invalid nonpositive limits, and backward-compatible configs without `quality`.
- [ ] **Step 2: Write failing PRD tests** for URL/file/command references, candidate kinds, required rubric, path traversal rejection, and old stories without `quality`.
- [ ] **Step 3: Run** `npx vitest run tests/retrofit/config.test.ts tests/loop/prd.test.ts` and confirm failures.
- [ ] **Step 4: Implement focused Zod schemas** in `quality/types.ts`; import them into config and PRD schemas rather than duplicating declarations.
- [ ] **Step 5: Run focused tests**, then `npm run lint`.
- [ ] **Step 6: Commit** `feat(quality): add config and story contracts`.

**Phase 1 gate:** `npm run lint && npx vitest run tests/agents tests/review tests/retrofit/config.test.ts tests/loop/prd.test.ts`.

---

## Phase 2: Bounded reviewer-to-repair loop

### Task 4: Repair-gap prompt and runner

**Files:**
- Create: `src/quality/repair.ts`
- Create: `tests/quality/repair.test.ts`
- Modify: `src/loop/runner.ts`

- [ ] **Step 1: Write failing tests** for a prompt containing story, acceptance, current diff instruction, exactly one gap, evidence, project context, and gate names while excluding praise, prior deliberation, and unrelated findings.
- [ ] **Step 2: Write a failing invocation test** proving repair uses a fresh provider call with workspace-write permissions and the existing watchdog.
- [ ] **Step 3: Run** `npx vitest run tests/quality/repair.test.ts` and confirm failure.
- [ ] **Step 4: Implement** `RepairGap`, `buildRepairPrompt`, and `makeRepairRunner` by reusing provider invocation/watchdog seams from `runner.ts`.
- [ ] **Step 5: Run focused tests** and confirm pass.
- [ ] **Step 6: Commit** `feat(quality): add fresh single-gap repair runner`.

### Task 5: Quality budget controller

**Files:**
- Create: `src/quality/loop.ts`
- Create: `tests/quality/loop.test.ts`

- [ ] **Step 1: Write failing pure-controller tests** for immediate pass, repair then pass, three-round exhaustion, 60-minute exhaustion using injected clock, unbounded continuation beyond both limits, pause between rounds, and infrastructure failure blocking without repair.
- [ ] **Step 2: Run** `npx vitest run tests/quality/loop.test.ts` and confirm failure.
- [ ] **Step 3: Implement** an injected `runQualityRounds(options)` controller returning `passed`, `blocked`, or `paused`, last gap, rounds, elapsed time, and evidence. It calls injected `gateCandidate`, `judgeCandidate`, and `repairCandidate`; it owns no Git or PRD operations.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): add bounded and unbounded repair controller`.

### Task 6: Integrate repair rounds into serial story execution

**Files:**
- Modify: `src/loop/loop.ts`
- Modify: `src/loop/reporter.ts`
- Modify: `tests/loop/loop.test.ts`
- Modify: `tests/loop/reporter.test.ts`

- [ ] **Step 1: Add failing loop tests** proving a review rejection with an actionable finding repairs in the same isolated worktree, reruns criterion/verify/perf/audit, invokes a fresh reviewer, and commits only after pass.
- [ ] **Step 2: Add failing tests** proving mechanical failure never invokes repair, malformed review blocks, exhaustion blocks with last gap, pause exits at the next round boundary, and existing no-quality behavior invokes each legacy gate exactly once.
- [ ] **Step 3: Add reporter tests** for phases `repairing` and quality round/budget fields in JSON status.
- [ ] **Step 4: Run** `npx vitest run tests/loop/loop.test.ts tests/loop/reporter.test.ts` and confirm failures.
- [ ] **Step 5: Add optional quality/repair dependencies to `LoopOptions`** and thread the pure controller into both isolated and non-isolated candidate paths without moving commit authority.
- [ ] **Step 6: Run focused tests**, then `npm test` to detect serial regressions.
- [ ] **Step 7: Commit** `feat(loop): repair actionable review failures behind gates`.

**Phase 2 gate:** full build and tests; a deterministic fake-review integration must demonstrate reject → repair → reverify → approve → one commit.

---

## Phase 3: External references and blind comparison

### Task 7: Safe reference acquisition

**Files:**
- Create: `src/quality/reference.ts`
- Create: `tests/quality/reference.test.ts`

- [ ] **Step 1: Write failing tests** for file acquisition, SHA-256 provenance, URL redirect/size/content-type limits through an injected fetcher, private-network rejection, explicit local-project URL allowance, command validation, digest mismatch, and safe storage below `.yoke/references/<digest>`.
- [ ] **Step 2: Run** `npx vitest run tests/quality/reference.test.ts` and confirm failure.
- [ ] **Step 3: Implement** pure validation and injected acquisition adapters using Node `crypto`, `fs`, `path`, `URL`, and `fetch`; no new dependency. Store inert bytes plus `provenance.json`. Never return fetched text as prompt instructions.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): acquire pinned untrusted references safely`.

### Task 8: Candidate artifact collection

**Files:**
- Create: `src/quality/artifacts.ts`
- Create: `tests/quality/artifacts.test.ts`
- Modify: `src/smoke/command.ts`
- Modify: `tests/smoke/command.test.ts`

- [ ] **Step 1: Write failing tests** for declared screenshots/files, stable ordered digesting, missing artifacts, traversal rejection, command-output/benchmark capture, and reuse of existing flow-smoke proof files without recapture.
- [ ] **Step 2: Run** the quality artifact and smoke tests and confirm failure.
- [ ] **Step 3: Implement** collection under the story proof root and expose smoke proof metadata sufficient for reuse.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): collect comparable candidate artifacts`.

### Task 9: Blind label-swap verdict contract

**Files:**
- Create: `src/quality/verdict.ts`
- Create: `tests/quality/verdict.test.ts`

- [ ] **Step 1: Write failing tests** for schema validation, random A/B assignment through injected RNG, mandatory swapped second comparison, candidate/candidate consistency, low-confidence rejection, missing evidence, digest mismatch, and reduction to `pass`, `lose`, or `inconsistent`.
- [ ] **Step 2: Run** `npx vitest run tests/quality/verdict.test.ts` and confirm failure.
- [ ] **Step 3: Implement** `QualityVerdictSchema`, `assignBlindLabels`, and `reduceComparisons`. Do not add numeric quality scores.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): enforce blind binary judge consistency`.

### Task 10: Read-only critic and evidence persistence

**Files:**
- Create: `src/quality/runner.ts`
- Create: `tests/quality/runner.test.ts`
- Modify: `src/loop/runner.ts`

- [ ] **Step 1: Write failing tests** proving the critic receives trusted rubric separately from untrusted artifacts, uses read-only permissions, writes a result file, emits two fresh calls for blocking policy, and persists every raw verdict under round-specific proof paths.
- [ ] **Step 2: Run focused tests** and confirm failure.
- [ ] **Step 3: Implement** prompt/result-file transport and provenance envelopes, reusing the provider watchdog. Advisory policy still writes evidence but returns nonblocking outcome.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): add read-only comparative critic`.

### Task 11: Quality preflight and serial integration

**Files:**
- Modify: `src/loop/loop.ts`
- Modify: `src/loop/run-command.ts`
- Modify: `src/loop/reporter.ts`
- Modify: `tests/loop/loop.test.ts`
- Create: `tests/loop/quality.integration.test.ts`

- [ ] **Step 1: Write failing tests** for blocking preflight before implementation, advisory skip, immutable digest recheck, flow-smoke artifact reuse, consistent win, quality loss → repair, and inconsistent verdict blocking.
- [ ] **Step 2: Run focused suites** and confirm failures.
- [ ] **Step 3: Wire reference/artifact/critic adapters** into the existing quality controller and add reporter phases `quality-preflight` and `comparing`.
- [ ] **Step 4: Run focused tests**, then full suite.
- [ ] **Step 5: Commit** `feat(loop): gate declared stories against pinned quality bars`.

**Phase 3 gate:** fake provider + static fixture demonstrates both label orders, proof provenance, repair on loss, and no commit on inconsistent judging.

---

## Phase 4: CLI and explicit unbounded mode

### Task 12: Parse and validate quality CLI flags

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/loop/run-command.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/loop/loop-cli.integration.test.ts`

- [ ] **Step 1: Write failing CLI tests** for `--quality`, `--no-quality`, positive rounds/minutes, policy values, `--quality-unbounded`, conflicts with bounded flags, `--candidates`, and existing flag compatibility.
- [ ] **Step 2: Add failing run-command tests** proving unbounded implies quality, is never persisted, preserves timeout/safe permissions, and prints/streams an explicit warning and effective policy.
- [ ] **Step 3: Run focused tests** and confirm failures.
- [ ] **Step 4: Implement additive parsing and `ResolvedQualityPolicy` precedence.** Resolve CLI override → story → project defaults; undeclared stories remain unchanged.
- [ ] **Step 5: Run focused tests** and confirm pass.
- [ ] **Step 6: Commit** `feat(cli): expose bounded and human-brake quality modes`.

### Task 13: Status, pause, cleanup, and resume semantics

**Files:**
- Modify: `src/loop/reporter.ts`
- Modify: `src/loop/cleanup.ts`
- Modify: `src/loop/run-command.ts`
- Modify: `tests/loop/reporter.test.ts`
- Modify: `tests/loop/cleanup.test.ts`
- Modify: `tests/loop/loop-cli.integration.test.ts`

- [ ] **Step 1: Add failing tests** for unbounded status text/JSON, current round, elapsed time, reference digest, safe-boundary pause, scoped critic/repair PID cleanup, and resume retaining bounded settings but requiring `--quality-unbounded` again.
- [ ] **Step 2: Run focused suites** and confirm failures.
- [ ] **Step 3: Implement fields and scoped cleanup.** Never persist unbounded as project default or hidden resume escalation.
- [ ] **Step 4: Run focused suites** and full loop tests.
- [ ] **Step 5: Commit** `feat(loop): make quality runtime observable and recoverable`.

**Phase 4 gate:** manually run the CLI against a fake provider in bounded mode, then unbounded mode; create `.yoke/loop.pause` and observe exit code 3 with retained evidence and active safety settings.

---

## Phase 5: Production parallel story workers

### Task 14: Rich claims and worker lifecycle

**Files:**
- Modify: `src/loop/claims.ts`
- Create: `src/loop/worker.ts`
- Modify: `tests/loop/claims.test.ts`
- Create: `tests/loop/worker.test.ts`

- [ ] **Step 1: Write failing tests** for dispatcher ID, PID, base commit, worktree, provider/model, heartbeat, stale takeover, owner-only release, cancellation handle, and one candidate's full gate result without PRD mutation.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Extend claims backward compatibly** and implement an async `runStoryWorker` adapter around existing runner/verifier/reviewer/quality seams.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(loop): add owned provider worker lifecycle`.

### Task 15: Async provider subprocess execution

**Files:**
- Modify: `src/agents/providers.ts`
- Modify: `src/loop/runner.ts`
- Modify: `src/loop/watchdog.ts`
- Modify: `tests/agents/providers.test.ts`
- Modify: `tests/loop/runner.test.ts`
- Modify: `tests/loop/watchdog.test.ts`

- [ ] **Step 1: Write failing fake-CLI tests** for concurrent streaming processes, telemetry, nonzero exit with partial output, idle timeout, cancellation, Windows command shim path, and project-scoped PID recording.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Add async provider invocation** using `spawn` with argv arrays where supported and the existing Windows wrapper policy. Return a typed handle with completion and cancellation.
- [ ] **Step 4: Run focused tests** and confirm pass on the current platform; keep platform-conditional contract tests for Windows/non-Windows invocation shapes.
- [ ] **Step 5: Commit** `feat(runner): support cancellable async provider workers`.

### Task 16: Dispatcher and verified merge queue

**Files:**
- Create: `src/loop/dispatcher.ts`
- Modify: `src/loop/parallel.ts`
- Modify: `src/loop/merge-queue.ts`
- Modify: `src/loop/scheduler.ts`
- Create: `tests/loop/dispatcher.test.ts`
- Modify: `tests/loop/parallel.test.ts`
- Modify: `tests/loop/merge-queue.test.ts`

- [ ] **Step 1: Write failing tests** for dependency readiness, area exclusion, max concurrency, heterogeneous agent affinity, FIFO integration, rebase conflict reopen, integrated criterion/verify/perf/audit rerun, pause before launch, and worker crash cleanup.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Implement dispatcher composition** over existing scheduler/claims/parallel/merge primitives. Move `passes:true` mutation from worker completion to successful serialized integration.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(loop): dispatch parallel stories through verified merge queue`.

### Task 17: Enable `--parallel=N` end to end

**Files:**
- Modify: `src/loop/run-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/loop/reporter.ts`
- Create: `tests/loop/parallel-cli.integration.test.ts`

- [ ] **Step 1: Replace the existing rejection test** with failing integration tests for `N=1`, `N=2`, automatic isolation, claims, progress, conflict reopen, and final completion.
- [ ] **Step 2: Add failure tests** for nonpositive values, unavailable workers, dirty tree, and unsafe cleanup attempts.
- [ ] **Step 3: Run focused integration tests** and confirm the current `--parallel>1` rejection.
- [ ] **Step 4: Wire dispatcher resolution** while leaving serial default untouched.
- [ ] **Step 5: Run focused tests**, full suite, and build.
- [ ] **Step 6: Commit** `feat(cli): enable dependency-aware parallel loops`.

**Phase 5 gate:** temporary Git repository with two independent stories and one dependent story runs two fake providers concurrently, serializes integration, reruns integrated gates, and finishes with exactly three story commits and clean PRD state.

---

## Phase 6: Competing candidates

### Task 18: Candidate fan-out and winner selection

**Files:**
- Create: `src/loop/candidates.ts`
- Create: `tests/loop/candidates.test.ts`
- Modify: `src/quality/verdict.ts`

- [ ] **Step 1: Write failing tests** for common base, max candidate limit, independent worktrees, mechanical filtering, zero-green block, one-green automatic selection, multiple winners requiring blind candidate-vs-candidate comparison, inconsistent selection block, and winner-only result.
- [ ] **Step 2: Run focused tests** and confirm failure.
- [ ] **Step 3: Implement candidate coordinator** using `runStoryWorker`; never merge branches together.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(quality): race isolated candidates and select one winner`.

### Task 19: Candidate CLI and cleanup integration

**Files:**
- Modify: `src/loop/run-command.ts`
- Modify: `src/loop/cleanup.ts`
- Modify: `src/loop/reporter.ts`
- Modify: `tests/loop/loop-cli.integration.test.ts`
- Modify: `tests/loop/cleanup.test.ts`

- [ ] **Step 1: Add failing tests** for `--candidates=N` requiring a quality declaration, candidate/worktree status, winning merge, losing proof metadata, and cleanup after crash/pause.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Wire candidate coordinator before merge queue** and reporter phase `selecting-candidate`.
- [ ] **Step 4: Run focused tests** and full suite.
- [ ] **Step 5: Commit** `feat(loop): expose winner-take-all candidate races`.

**Phase 6 gate:** fake providers produce one mechanically red candidate and two green candidates; blind selection integrates only one green branch and cleans all candidate worktrees.

---

## Phase 7: Ephemeral decomposition

### Task 20: Decomposition contract and planner

**Files:**
- Create: `src/loop/decomposition.ts`
- Create: `tests/loop/decomposition.test.ts`
- Modify: `src/agents/contracts.ts`
- Modify: `src/loop/runner.ts`

- [ ] **Step 1: Write failing tests** for valid subtask DAGs, duplicate IDs, cycles, unknown dependencies, area conflicts, parent story binding, result-file transport, and invalid-output fallback to whole-story execution.
- [ ] **Step 2: Run focused tests** and confirm failure.
- [ ] **Step 3: Implement schema and read-only planner call** with a versioned envelope. Persist only under `.yoke/work/<story>/`.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(loop): plan ephemeral story subtasks`.

### Task 21: Subtask scheduling and synthesis

**Files:**
- Modify: `src/loop/decomposition.ts`
- Modify: `src/loop/worker.ts`
- Modify: `src/loop/reporter.ts`
- Modify: `tests/loop/decomposition.test.ts`
- Modify: `tests/loop/worker.test.ts`

- [ ] **Step 1: Add failing tests** for dependency/area scheduling, separate nested worktrees, synthesis into one parent candidate, no subtask commits to main, no PRD mutation, parent-only gates, pause, and cleanup.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Implement bounded subtask execution** reusing parallel scheduling but preserving the parent as the only story/commit unit.
- [ ] **Step 4: Run focused tests** and full suite.
- [ ] **Step 5: Commit** `feat(loop): execute decomposed work beneath one story gate`.

### Task 22: Decomposition opt-in and routing policy

**Files:**
- Modify: `src/retrofit/config.ts`
- Modify: `src/loop/run-command.ts`
- Modify: `src/routing/router.ts`
- Modify: `tests/retrofit/config.test.ts`
- Modify: `tests/routing/router.test.ts`

- [ ] **Step 1: Add failing tests** for decomposition disabled by default, explicit enable, no controller call for small stories, and routing-selected decomposition for qualified complex stories.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Implement minimal policy fields and a deterministic small-story fast path.** Add `decomposition.enabled`, `decomposition.maxSubtasks`, and `decomposition.minAcceptanceCriteria` to config; skip the planner when disabled or below the threshold.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(routing): opt into cost-aware story decomposition`.

**Phase 7 gate:** one parent story decomposes into two independent and one dependent fake subtasks, synthesizes one candidate, runs parent gates once, and lands one commit without PRD additions.

---

## Phase 8: Routing, telemetry, docs, and release evidence

### Task 23: Versioned routing and visible fallback

**Files:**
- Modify: `src/routing/router.ts`
- Modify: `src/agents/contracts.ts`
- Modify: `tests/routing/router.test.ts`

- [ ] **Step 1: Write failing tests** for native/result-file route envelope, legacy `YOKE_ROUTE` compatibility, malformed output fallback to SELF with `fallbackReason`, and reporter evidence.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Prefer versioned result transport** while retaining the old marker as an explicitly reported compatibility fallback.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(routing): adopt versioned decisions with visible fallback`.

### Task 24: Telemetry envelopes and raw evidence

**Files:**
- Modify: `src/agents/telemetry.ts`
- Modify: `src/loop/reporter.ts`
- Modify: `tests/agents/telemetry.test.ts`
- Modify: `tests/loop/reporter.test.ts`

- [ ] **Step 1: Write failing tests** for all three providers, unknown-field retention in per-call raw evidence, aggregate known fields, role/worker/candidate/round attribution, missing usage honesty, and cost accumulation.
- [ ] **Step 2: Run focused tests** and confirm failures.
- [ ] **Step 3: Wrap parsed events in machine envelopes** and persist raw evidence without promoting unknown values.
- [ ] **Step 4: Run focused tests** and confirm pass.
- [ ] **Step 5: Commit** `feat(telemetry): attribute quality and parallel provider calls`.

### Task 25: Canon, retrofit, and migration contracts

**Files:**
- Modify: `canon/loop/prd.schema.md`
- Modify: `canon/loop/loop-spec.md`
- Modify: `canon/skills/authoring-prd/SKILL.md`
- Modify: `canon/skills/yoke-workflow/SKILL.md`
- Modify: `src/retrofit/planners/shared.ts`
- Modify: `tests/canon/real-canon.test.ts`
- Modify: `tests/retrofit/retrofit.integration.test.ts`
- Create: `docs/MIGRATING-TO-1.4.md`

- [ ] **Step 1: Add failing canon/retrofit assertions** for quality schema guidance, runtime ignores, safe defaults, explicit unbounded warning, parallel/candidate/decomposition contracts, and attribution.
- [ ] **Step 2: Run** `npx vitest run tests/canon/real-canon.test.ts tests/retrofit/retrofit.integration.test.ts` and confirm failures.
- [ ] **Step 3: Update canonical docs and generated guidance** with exact YAML/CLI examples and migration behavior.
- [ ] **Step 4: Run focused tests** and `npm run yoke -- validate canon`.
- [ ] **Step 5: Commit** `docs(canon): define comparative quality and parallel execution`.

### Task 26: Benchmarks and end-to-end matrix

**Files:**
- Modify: `bench/result-schema.mjs`
- Modify: `bench/run.mjs`
- Modify: `bench/run-matrix.mjs`
- Add fixture files under: `bench/fixtures/quality-loop/`
- Modify: `bench/README.md`
- Add deterministic integration tests under: `tests/loop/gauntlet-cli.integration.test.ts`

- [ ] **Step 1: Add failing result-schema tests/checks** for quality rounds, consistency, reference digest, repair count, parallel workers, candidates, decomposition, conflicts, and per-role calls.
- [ ] **Step 2: Build a deterministic fake quality fixture** with hidden acceptance checks and scripted critic losses/wins.
- [ ] **Step 3: Run the fixture before wiring** and confirm expected schema/test failure.
- [ ] **Step 4: Extend benchmark capture and matrix arms:** quality off/on, bounded, unbounded with pause, serial/parallel, candidates one/two.
- [ ] **Step 5: Run deterministic matrix** and confirm all final hidden tests pass; do not claim authenticated provider performance from fake rows.
- [ ] **Step 6: Commit** `bench: measure quality repair and parallel execution`.

### Task 27: Product documentation and final release gates

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `TODOS.md`
- Modify: `docs/MIGRATING-TO-1.4.md`
- Modify: release metadata only when a release is explicitly requested.

- [ ] **Step 1: Update README** with the authoritative gate order, bounded defaults, explicit human-brake command, safety invariants, quality YAML, parallel/candidate/decomposition behavior, and measured caveats.
- [ ] **Step 2: Remove completed TODOs** for provider subprocess wiring and native schemas only after their end-to-end tests are green; retain broader authenticated samples and signed provenance until separately completed.
- [ ] **Step 3: Run final static gates:** `npm run lint`, `npm run build`, `npm test`, `npm run yoke -- validate canon`, `npm run docs:check`, `npm run audit:ci`, `npm run package:check`.
- [ ] **Step 4: Run manual CLI QA** in a temporary Git fixture: help text; invalid flag; bounded reject/repair/pass; quality-unbounded then pause; parallel independent stories; two-candidate winner; decomposition fallback; status/cleanup after killed fake provider.
- [ ] **Step 5: Review `git diff --check`, `git status --short`, and the complete diff.** Verify `.omo/` and unrelated concurrent changes remain untouched.
- [ ] **Step 6: Commit** only if explicitly requested: `feat: add gated comparative quality loops`.

---

## Dependency graph and parallel work

```text
Phase 1 contracts
  -> Phase 2 repair loop
  -> Phase 3 reference judging
  -> Phase 4 CLI/unbounded

Phase 1 contracts
  -> Phase 5 provider parallelism
  -> Phase 6 candidate races

Phase 5 worker lifecycle
  -> Phase 7 decomposition

Phases 2-7
  -> Phase 8 telemetry/docs/benchmarks
```

Within Phase 1, Tasks 1 and the initial tests for Task 3 can proceed independently. In Phase 3,
reference acquisition and artifact collection are independent until critic integration. In Phase 5,
async provider work can proceed alongside rich claim tests after their shared handle contract is
agreed. All modifications to `loop.ts`, `run-command.ts`, `runner.ts`, and `reporter.ts` should remain
serialized to avoid conflicting edits.

## Plan self-review

- **Spec coverage:** Tasks 4-6 cover repair; 7-11 references/blind judging; 14-17 parallel stories;
  18-19 candidate races; 20-22 decomposition; 1-3 and 23-24 versioned contracts; 12-13 explicit
  bounded/unbounded CLI and operational behavior. Security, observability, attribution, benchmarks,
  canon, migration, and manual QA are covered in Tasks 7, 10, 13, and 23-27.
- **Compatibility:** Every new schema field is optional; serial and no-quality paths receive explicit
  regression tests; unbounded is a per-run explicit escalation.
- **Type consistency:** `MachineEnvelope`, `QualityVerdict`, `RepairGap`, `ResolvedQualityPolicy`, and
  worker/candidate/decomposition outcomes are introduced before their consumers.
- **No hidden weakening:** All repairs rerun gates; workers cannot set PRD pass state; merge queue owns
  integrated success; subjective verdicts can reject but never override mechanical failure.
- **No placeholders:** Every task has exact files, expected behavior, commands, and a commit boundary.
