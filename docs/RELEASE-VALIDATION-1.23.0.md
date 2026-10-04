# Yoke 1.23.0: local implementation and validation

Date: 2026-10-04. Source baseline: `e2e3c18` (1.22.0). Isolated branch: `codex/yoke-1.23-efficiency`. This is local version preparation, not a published release or a claim that every original E1–E9 acceptance item is complete.

## Evidence and checks

The user approved the design before implementation. New behavior was developed with failing regression tests followed by focused checks. The nine-story [executable PRD](superpowers/plans/2026-10-04-yoke-1.23-efficiency-prd.json) passes `runPrdCheck`; its `passes` fields remain false because this change was implemented through scoped native workers rather than a Yoke-owned PRD loop.

Environment: Windows, Node 24.13.0. The clean detached baseline ran the entire suite: **1,607 passed, 1 failed, 2 skipped**. The failure was native Windows `EPERM` while removing a temporary MCP directory before the process had finished closing. The corrected client shares and awaits shutdown completion. The first integrated green full run had **1,669 passed, 0 failed, 2 skipped**; final counts after the last cache and notifier regressions are recorded below when verified.

Independent read-only code and security review found no remaining concrete blockers in the production snapshot. Its final focused run passed **87 tests, 0 failures**. This review covered CLI compatibility, partial telemetry, actual tool preflight, proof transfer, write scopes, per-gate cache checks, completion cleanliness, smoke identity and secret redaction. It explicitly did not certify the open acceptance items below.

After source freeze, the complete suite passed **1,694 tests, 0 failures, 2 skipped** using `vitest run --maxWorkers=2`; the worker limit changes concurrency, not scope. TypeScript lint/build, Canon validation, package dry-run and dependency audit (**0 vulnerabilities**) passed. README metadata was regenerated after the final test additions. A real tarball installed offline into a fresh prefix with lifecycle scripts disabled; its installed CLI validated its packaged Canon. All five version sources report 1.23.0; cache isolation, proof retention, preflight and local-report compiled modules are packaged. The tarball contains declared benchmark fixture configurations but no root `.yoke` runtime evidence or dependency tree. Complete raw Vitest reports are retained locally in `.yoke/artifacts/release-1.23/`; earlier failing/intermediate reports are distinct from the clean baseline and final report.

## Narrow paired regression experiment

The final full-suite observation was 237.858 seconds across 184 files (n=1); it is an observed local duration, not a future timeout or completion estimate. The two Windows skips concern executable-intent semantics in package enumeration/application; no newly added efficiency regression was skipped.

[Reproduction script](benchmarks/2026-10-04-efficiency/compare-help.py) and [raw results](benchmarks/2026-10-04-efficiency/regression-comparison.json) compare compiled CLI dispatch for `setup --help --yes --host=codex`. Both exclude the external update notifier and start a new Node process for each call. Three paired samples per target condition alternate execution order. Snapshot reads occur outside the timer; user file contents are checked after every call.

| Target condition | 1.22 observed range | 1.23 observed range | Changed files, 1.22 → 1.23 |
| --- | --- | --- | --- |
| Fresh target, n=3 pairs | 376.805–396.646 ms | 277.688–303.768 ms | 97 → 0 |
| Repeated target, n=3 pairs | 345.871–390.249 ms | 276.348–283.960 ms | 1 → 0 |

These are fresh/repeated project targets, **not measured cold/warm OS, dependency or provider caches**. Concurrent local verification and filesystem conditions can affect timings. No model calls, guardian calls or paid comparisons were made. There is no general product speed, token or cost improvement claim. Terminal help's update-notifier process mutation was separately caught with failing TTY tests and corrected.

## Open acceptance and release limits

- E9 genuine controlled cold/warm setup comparison and a new paired full NEXUS model run remain unmeasured. Approval/guardian waiting and missing prices cannot be inferred from the local help experiment.
- The original populated-layout regression is present in `YokeEfficiencyTest1/tests/browser/benchmark.spec.mjs`: seven incidents, contained desktop panels, reachable inspector actions and timestamped events. A new focused Playwright run was attempted with output outside the source checkout. It did **not** run any test: Vite could not start from the copied macOS dependency tree. Windows `.bin` launchers and `@rolldown/binding-win32-x64-msvc` are missing. Original source and dependencies were not replaced, and this infrastructure failure is not a passing layout result.
- E7 guards conventional writable cache roots and actual candidate writes. Package-level pnpm links and immutable download stores remain allowed. Yoke has no dependency installer to own offline-miss/network retry behavior or lockfile-keyed install reuse; prompt guidance does not count as executable installer enforcement. Package/lock invalidation and cold/warm install evidence therefore remain open.
- E8 reporting supports explicit observer/infrastructure/product categories and preserves `unknown` when missing. Current production emitters do not uniformly populate those categories; synthetic category tests do not establish production classification coverage. Guardian/approval and inaccessible host sessions remain unknown.
- Static served-byte identity is a conservative same-origin pin checked before and after smoke journeys, not an independent deployment attestation or protection against changes between checks. Production requires an intentional pin; injected test drivers may remain explicitly unverified.
- Independent review and local Windows checks do not replace the repository's Linux/Windows × Node 20/24 CI matrix. No tag, npm publication, merge or confirmed remote CI is claimed. The open acceptance items above prevent claiming complete E1–E9 DoD or a fully validated release.

The detailed measured workload, story times, overlapping durations, failed attempts, token coverage and required priorities remain in the [German analysis](benchmarks/2026-10-04-efficiency/ANALYSE.md).
