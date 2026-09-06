# Batch planning validation — 2026-09-06

AI-assisted implementation record for the local development build after 1.9.0.
No new version has been published by this task.

## Implemented

- One bounded assessment call for a selected package, with exact output IDs,
  executable-criteria checks, project locking and atomic PRD replacement.
- Separate planning provider/model/effort, complete draft/inbox assessments,
  stale-contract detection including upstream requirements and the approved brief.
- Prepared routing and blocked fallback in new setups; existing settings remain
  compatible. Automatic tier ceilings block insufficient configurations.
- Capability routing recognizes reported Windows process-creation/authentication
  failures and failed gate evidence as infrastructure, stopping repair without
  adding model-quality failures.

## Actual Yoke run

The current compiled development CLI ran in a separate `Yoke-batch` checkout with
capability routing, prepared assessment, blocked fallback, a strong tier ceiling
and one serial worker. The assigned task was limited to batch-command tests.
Yoke chose `codex-standard`, requested `gpt-5.6-terra` at medium effort, verified
the criterion tests and committed the result. The main checkout received only
the reviewed test file; one assertion was strengthened during review.

Recorded start: 2026-09-06T17:45:54.729Z. Terminal state: complete at
17:50:41.108Z, one backlog task accepted. One measured worker call and no
orchestrator/assessment call were recorded. Input: 546,591 tokens, including
496,384 cached input tokens; output: 6,294 tokens. Reported monetary cost and
actual model identity are unknown. This is no cost benchmark or measured saving.

This run explicitly used unsafe permissions. It does not validate the Windows
safe-mode execution reported in issue #5.

## Issue #5 boundary

**Follow-up:** the user subsequently requested completion of the runner correction.
The reproduction, safe-mode end-to-end result and supervision changes are recorded
in [WINDOWS-RUNNER-VALIDATION.md](WINDOWS-RUNNER-VALIDATION.md). The following paragraph
describes the earlier batch-planning checkpoint.

The user-provided runner handoff and [issue #5](https://github.com/HECer/yoke/issues/5)
were read. The infrastructure-classification correction is partial. The original
safe-mode shell failure has not been reproduced or diagnosed here. In particular,
a preflight under the actual sandbox identity, streamed tool-error handling when
a provider exits zero, separate heartbeat/useful-progress reporting, total process
budgets and argument-safe Windows launch regressions remain open. Optional MCP
startup warnings alone are not treated as proof of a task failure. No affected
DeviceLane worktree was restarted or cleaned, and the issue was not closed.

## Evidence scope

Automated tests cover batch call suppression, invalid/partial/duplicate output,
concurrent PRD edits, contract invalidation, planner/worker separation, prepared
dispatch, tier limits and infrastructure repair suppression. Injected planner
responses establish command behavior; they are not authenticated provider parity
benchmarks. The full suite executed 1,166 tests in 127 files: 1,163 passed, two
were skipped and one new test fixture lacked a required configuration field.
After correcting that fixture, all 11 tests in its file passed. Subsequent
focused routing checks cover the final input-freshness guard. Planning hashes
establish input freshness, not provenance or correctness.

Read-only provenance scan: no C2PA located, supported scan complete, verification,
signer trust and Markdown metadata privacy unknown. The audit's limits are:
"No conforming verifier was supplied." and "Keyed model-level watermarks cannot
be checked without the provider's key." No authorship inference or mark removal.
