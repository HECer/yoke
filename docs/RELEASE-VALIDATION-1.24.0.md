# Yoke 1.24.0 release preparation

Status: draft PR https://github.com/HECer/yoke/pull/17. The preceding 1.23.0 release is public on GitHub and npm; its publish workflow completed successfully and the actual registry package was installed and validated. Baseline merge is `a989a8c0ca323cfccfcb4107e408bbf0ecc72efe`; measured baseline `d85cd0d970d22b8e6a6b966d3e151754872c3aee` has the same Git tree.

## Scope and independent review

- Benchmark-owned local npm provisioning replaces the shared node_modules junction. Safe receipts bind package/lock bytes, Node/npm/platform/architecture and the complete invocation. Prefix/executable values are hashed. Invalid setup safely invalidates previous receipts; linked targets remain untrusted and untouched. Node/npm PATH layouts use direct Node+JS invocation.
- Dedicated failure events preserve bounded categories, causes and stable IDs through execution, verifier, completion, worker, integration and recovery. Known categories survive routed early exits, promise rejections and post-repair gates. Failed attempts before successful retry remain durable; optional telemetry sink failure preserves execution outcomes. Arbitrary exits and unsupported legacy observations remain unknown.
- F1 independent review passed after three correctness fixes; 37 dependency cases passed independently after the final canonical-path test correction. F2 independent review passed at `6250101`; 44 targeted cases passed independently. Implementers did not review or merge their changes. No remaining concrete security blocker was found in the reviewed scope.

## Local evidence

- Lint, build, Canon validation and docs metadata check: passed locally; all required checks passed in the four CI jobs on reviewed runtime snapshot `132eda01a55b3352a98d33a29d025dc4e8195d48`.
- Complete final production-source suite at `697408a`: 1,758 passed, two existing Windows platform skips, zero failures; 1,760 defined cases. Elapsed through the last test: 245.353 seconds. The later change adds one canonical project-directory alias test and corrects a Windows 8.3 expected path; production/runtime bytes are unchanged.
- npm audit: zero vulnerabilities. Package dry-run: passed. Actual tarball installation: passed; installed Canon validated; packaged dependency helper matches source and performs a real offline empty-project install. Lifecycle scripts were disabled. The local artifact is not a published 1.24 package.
- Isolated NEXUS copy: original application/assertion bytes preserved, only copied npm launcher adapted for Windows. Typecheck, 25 unit tests, six browser cases and build passed. Populated desktop with seven incidents was inspected in the shared browser; strict own port and stable served-source hashes confirmed. Original project untouched.
- Three alternating fresh/warm download-cache pairs passed on helper `5a9e208`; exact inputs, flags, lineage and durations are committed. Provider cache warmth is not inferred from npm cache conditions.

## Immutable measurement snapshots

The first candidate pair measured `697408a`; subsequent samples use the test-only correction and inventory commit. The actual runtime digest must remain identical across candidate samples. All samples require clean before/after snapshots, equal fixture/requirements/acceptance/prompt digests and equal model/effort/startup policy. Native CLI session metadata supplements the missing model field in the Yoke report without changing that original report.

Raw native transcripts stay local; public evidence contains only bounded usage, identities and hashes. Existing ChatGPT-authenticated Codex CLI was used, with API-key/endpoint overrides removed from child environments. Additional paid model APIs were not used.

## Remaining empirical limits

Small TaskQueue samples do not establish full NEXUS/product-wide speed or cost gains. Provider cache, CPU/RAM, background load, prices and unobserved approval/guardian waiting remain unknown. Core dependency setup remains unmanaged. Readiness receipts do not attest every installed byte. Unknown legacy failure categories remain unknown.

## Completed measurements and release gates

Three alternating version pairs completed; all six independent original-test replays passed. Median loop wall time is 319.236 s for 1.23 and 318.147 s for 1.24. Empirical ranges are 289.127–324.097 s and 295.487–355.403 s respectively. These observations do not establish general speed, token or cost superiority. All twelve native sessions confirm the fixed model/effort; their input/cache/output/reasoning usage matches Yoke exactly.

Fixture, acceptance, requirements, submitted workflow-input bundle, execution, startup and environment identities match. Sources are clean and stable across each run; every candidate uses the same actual runtime digest `8f6cd603c84f41815d818679043ef269b4afdb2a93240840c087497f39ed09d3`. The baseline digest is `eb4e7e71107d897d48e55ad2e1f441ff4370dfe7f6b45adab4888cba261c2045`. The test-only canonical-path correction did not alter that measured runtime. See [full analysis](benchmarks/2026-10-04-followups/ANALYSIS.md) and its committed structured datasets.

[CI run 37208754601](https://github.com/HECer/yoke/actions/runs/37208754601) passed Linux/Windows × Node 20/24 on runtime snapshot `132eda0`. Linux collected all 1,761 cases; Windows retains two existing platform skips. The earlier CI run failed only its raw Windows 8.3 path expectation; the corrected exact argv assertion and new canonical alias regression passed independently and in all four jobs.

The final documentation/data-only draft head receives a fresh complete local suite and four-job CI. Its exact commit, results, CI links and rebuilt package-install evidence are recorded in PR #17 after verification, avoiding a self-referential commit hash in this document. No production/runtime source changes follow the reviewed measurements. Version 1.24 remains a draft preparation; no tag or npm publication was made.
