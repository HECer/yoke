# Yoke 1.20.0 release preparation — 2026-09-30

AI-assisted implementation and validation in an isolated worktree based on
`05fac3db1a51412563005e07f80e6e5a9aab8e06`. The original checkout and its local
changes were preserved. This report records local release preparation, not a
published GitHub or npm release.

## Implemented and checked

- Goal-to-criterion binding, contract digests and migration for unbound goals.
- Shared model admission, separate asynchronous check admission, token overrun
  reporting, cumulative provider/wall budgets, cancellation and retained ownership.
- Optional Codex native goal threads with paused automatic continuation, independent
  completion, durable usage baselines and cumulative turn accounting.
- Story context through integration gates, retained parallel candidates, validated
  recovery, bounded metadata and shorter Windows worktree paths.
- Saved run mode, identity, implementation/planner selections, absolute exploration
  deadline and durable attempt charging before scheduling work.
- Runtime claims and nested worker checkouts excluded from cleanliness and staging.

Regression tests reproduced the original failures before correction. Review also
covered telemetry failures during retention, reporter failures after admission,
interrupted counters, unsafe resume defaults and process-tree cleanup uncertainty.

## Actual execution evidence

The corrected authenticated parallel smoke used `gpt-6.1-sol`, low effort, three
workers and routing disabled. It accepted **3/3 stories**, exited `0`, and passed
**15/15 original tests** after replaying immutable verification files. All four
protected verification files matched the seed. Duration: **112,949 ms**. Recorded
input: **456,659**, including **372,096 cached**; output: **3,217**. The initial
failed sample is preserved rather than excluded from the report.

See [parallel validation data](../bench/results/parallel-validation-2026-09-30.json).
This is a single corrected arm, not a fresh direct-Codex comparison. CPU, RAM and
USD costs were not measured, and host load was not controlled. It establishes this
fixture's acceptance, not general efficiency superiority.

The integrated native goal fixture completed its protected acceptance in one model
attempt and resumed the same goal/thread without another implementation attempt.
The final accounting trial measured **153,736 input** and **606 output** tokens,
with **134,528 cached input**. Its persisted baseline matched the cumulative
provider total; native paused-goal accounting separately reported zero. Model and
check permits and process records were empty after completion.

See [native goal validation data](../bench/results/native-goal-validation-2026-09-30.json).

Native accounting uses cumulative thread snapshots and a durable baseline. Missing,
malformed or decreasing counters remain unknown; a decreasing counter marks the
binding untrusted for subsequent accounting. No token usage is fabricated from the
absence of telemetry. Paused native goals do not provide a hard token cap for a
manual turn; Yoke's independent accounting guards further work and reports overruns.
Native cumulative progress notifications also request cancellation when the ceiling
is exceeded. Focused parent/adapter regressions cover streaming, buffered replies
and foreign-turn rejection; the authenticated sample above used a generous budget
and establishes completion/accounting, not a live small-budget cancellation trial.

## Release checks

Environment: Windows, Node.js **24.13.0**. Native protocol and model execution used
installed Codex **0.161.0-alpha.2**. TypeScript lint and build passed. Dependency
audit passed with **0 vulnerabilities**. The complete test run passed **1,418 tests**
across **155 files**, with **2 skipped** (1,420 defined), in **342.26 seconds**.
Canon, README metadata and package dry-run checks passed. The complete
`prepublishOnly` pipeline exited **0**. The package contains **362 files**;
temporary runtime state and raw model transcripts are excluded.

The local build archive `hecer-yoke-1.20.0.tgz` was created and inspected directly.
All four packaged version manifests match; the native adapter and durable run-state
modules are included. Matching changelog-derived `RELEASE-NOTES.md`, `SHA256SUMS`
and `PACKAGE-VALIDATION.json` accompany the archive in the local release output.

Versions are synchronized to **1.20.0** in package/lockfile, Claude/Codex manifests,
Gemini extension and README. The dated changelog entry is the source of release
notes. No remote tag, GitHub release, CI run or npm publication is claimed here;
the repository's GitHub matrix and npm verification remain publication gates.

## Documentation provenance

Read-only provenance inspection fully scanned README, CHANGELOG, this report, the
goal guide and sanitized validation reports. No supported provenance carrier or
observable text marker was found.
Cryptographic verification, signer trust and text metadata privacy remain unknown:
no conforming verifier/trust policy was supplied, and keyed provider watermarks
are unavailable. Absence of a marker is not evidence of human authorship. Raw model
transcripts and native thread identifiers are kept outside the published reports.

## Operational limits

- Native goals are opt-in. App-server lacks exec's bare startup control, so native
  plus bare stops before dispatch. Ordinary Codex execution remains available.
- Worker/check permits limit concurrency, not CPU/RAM consumption inside a process.
- Synchronous check/story execution retains its existing contracts.
- Process termination uncertainty blocks follow-up and retains ownership; a late
  confirmed tree stop can release the retained permit.
- Dashboard resume restores validated safe options. Reviewer/quality/routing policy
  still follows current config; self-review/unbounded-quality overrides use defaults.
- Retained parallel candidates require validated repository, contract and ownership
  state. Stale target history requires reconciliation; serial recovery does not
  automatically adopt a parallel checkout.
