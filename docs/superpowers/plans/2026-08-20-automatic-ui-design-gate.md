# Automatic UI Design Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Automatically run Yoke's existing design scanner inside configured UI-project loops while preserving current behavior for non-UI and already-configured projects.

**Architecture:** Add one deterministic local detector, one default-preserving config section, and a small verifier adapter over the existing scanner. Thread that verifier through the serial and parallel loop gate contracts in the same position and evidence model as existing mechanical gates.

**Tech Stack:** TypeScript, Zod, Vitest, existing design scanner and loop abstractions.

---

## Task 1: Detect UI projects with explained evidence

**Files:** `src/retrofit/ui-detect.ts`, `src/retrofit/detect.ts`, `tests/retrofit/ui-detect.test.ts`, `tests/retrofit/detect.test.ts`

1. Add failing tests for supported dependencies, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, an existing smoke-flow config, non-UI TypeScript, and ignored dependency/generated/fixture/Yoke directories.
2. Implement bounded traversal of normal source roots and package manifests. Return `{ detected, signals }` with stable, human-readable signals.
3. Attach UI evidence to Retrofit detection without changing existing agent detection semantics.
4. Run the detector tests.

## Task 2: Add default-preserving design configuration

**Files:** `src/retrofit/config.ts`, `src/retrofit/command.ts`, `tests/retrofit/config.test.ts`, `tests/retrofit/integration.test.ts`

1. Add failing schema tests for `mode: off|auto|on`, positive integer `max`, invalid values, and omitted design config.
2. Add optional `design` to the config type and schema. Do not place it in the universal legacy default.
3. During new/retrofit setup, write `{ mode: 'auto', max: 4 }` only when UI detection succeeds and no user design choice exists.
4. Include the detector's evidence in setup output and test that an existing `off`, `on`, or custom budget is preserved.
5. Run config and Retrofit integration tests.

## Task 3: Adapt design scan results to a mechanical gate

**Files:** `src/scan/gate.ts`, `src/scan/design.ts`, `src/cli.ts`, `tests/scan/gate.test.ts`, `tests/scan/design.test.ts`

1. Add failing tests for pass/fail at a configured budget, stable finding names, bounded preview text, and a full artifact path for overflow details.
2. Extract only shared result formatting from the standalone command; do not change its public output or scanner weights.
3. Implement a verifier adapter that runs `scanDir`, returns the existing verify-result contract, and writes full findings through the existing artifact helper.
4. Run scan tests and a CLI design-scan regression test.

## Task 4: Thread the gate through serial and parallel loops

**Files:** `src/loop/run-command.ts`, `src/loop/loop.ts`, `src/loop/worker-contracts.ts`, `src/loop/worker.ts`, `src/loop/parallel-command.ts`, `src/loop/parallel.ts`, `src/loop/dispatcher.ts`, `src/loop/parallel-adapters.ts`, `src/output/types.ts`, matching `tests/loop/*.test.ts`

1. Add failing serial tests showing order `criteria -> verify -> design -> perf -> audit` and proving omitted or `off` design leaves the old call sequence unchanged.
2. Add failing worker and dispatcher tests for design evidence, stage-specific failure, retry/quality-rerun behavior, and cancellation.
3. Extend gate stage unions, callbacks, evidence, and output phases with `design`; make the verifier optional throughout.
4. Construct the verifier in `run-command` for `on`, for detected `auto`, and never for `off` or missing config.
5. Run all loop tests, then `rtk npm run lint`.

## Task 5: Verify setup-to-loop behavior

**Files:** `tests/retrofit/integration.test.ts`, `tests/loop/run-command.test.ts`

1. Add an integration fixture for a detected UI project and one for a non-UI project.
2. Prove Retrofit writes auto config only to the UI fixture and the next loop run selects the design verifier only there.
3. Prove `mode: on` overrides failed detection and `mode: off` overrides successful detection.
4. Run `rtk npm exec -- vitest run tests/retrofit tests/scan tests/loop`.

