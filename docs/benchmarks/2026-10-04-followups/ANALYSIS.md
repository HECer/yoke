# Yoke 1.24: Follow-up tasks and measurements

Yoke 1.23 was published on npm and GitHub. 1.24 is being prepared as another release candidate. The original [efficiency analysis](../2026-10-04-efficiency/ANALYSIS.md) remains the foundation; these measurements supplement it.

## What needs to change

1. **Dependencies must belong to the project being measured.** The large benchmark previously linked another project's `node_modules`. This could introduce incorrect versions and platform packages. The benchmark now installs from its own package and lockfiles. It does not start a model run if setup fails. This does not give Yoke Core a universal installer.
2. **Evidence of successful setup must bind its inputs and the complete npm invocation.** The lockfile, Node/npm versions, platform, and installation parameters determine whether evidence can be reused. Failed setups invalidate old evidence that can safely be accessed. Secrets in preceding CLI arguments are only hashed. Evidence does not attest to every installed byte.
3. **Known failure causes must survive propagation.** Production, verification, completion, and recovery receive structured categories and a stable failure ID. The archive also records completion without an active story. Arbitrary exit codes and error messages remain unknown; cancellation remains separate. Multiple views of the same failure are not counted more than once.
4. **Measurements require a verified platform and unchanged acceptance criteria.** An isolated Windows copy of NEXUS was created without macOS dependencies or broken Git metadata. The application and assertions remain byte-identical. Only the copied test launcher invokes npm through Node in a platform-appropriate way.

## NEXUS: Result and cause of the earlier blocker

The first invocation of the copied original verification failed at `spawnSync('npm')`: Windows provides npm shims, but this invocation without a shell could not find an executable npm. This is an infrastructure failure. After the limited adjustment to the copied launcher, type checking, 25 unit tests, six browser cases, and the build passed. The original was not changed.

The populated desktop was also checked in the shared browser: CSS viewport 1440 × 900, seven incidents, nine events with timestamps, document height 900. The inspector and event feed ended at 760 and 884 CSS pixels, respectively. The original browser test checked the included panels and accessible actions. Original browser proof files are 1440 × 900 pixels, or 390 × 844 pixels on mobile. The additional preview capture is scaled and does not serve as a pixel measurement.

A dedicated server used a strictly bound port. The served application-specific source responses were hashed and checked again for stability. This local identity is not an independent deployment attestation. Details and source/test hashes are in [nexus-evidence.json](nexus-evidence.json).

## Measurement conditions and limitations

The current setup samples use the independently verified helper from `5a9e208`. Three successful installations were measured per condition, in the order cold/warm, warm/cold, cold/warm. The second warm sample used the populated cache from the first cold sample; each project had a fresh local installation.

| Pair | Fresh download cache | Warm download cache, offline |
| --- | ---: | ---: |
| 1 | 3.581 s | 2.601 s |
| 2 | 3.366 s | 2.823 s |
| 3 | 7.263 s | 2.854 s |
| Empirical range, n = 3 | 3.366–7.263 s | 2.601–2.854 s |

The measurement covers the entire setup helper, including npm version detection, installation, and writing the evidence. The slower third cold run remains in the results. Without isolated background load or separate network/CPU measurements, its additional duration cannot be attributed conclusively. Raw values, lock hashes, and invocation binding are in [dependency-samples.json](dependency-samples.json).

- Cold download cache: a new isolated cache and a fresh local installation. Warm: a cache already populated by a documented cold installation, a fresh project, and an offline installation. Lifecycle scripts and automatic network retries are disabled.
- Model runs: the existing ChatGPT sign-in in Codex CLI, with no additional paid API calls. API key and endpoint overrides are removed from the child process environment. The requested settings are `gpt-6.1-sol`, reasoning `medium`, routing off, one worker, and the same unchanged acceptance tests.
- The controlled model fixture is a task queue with two stories. This does not support a general conclusion about complete NEXUS projects. Provider cache, background load, CPU/RAM, prices, and unrecorded Guardian/approval waiting times remain unknown.
- With this CLI version, the Yoke report provides no actual model identifier. Native session metadata bound to the respective benchmark working directory is therefore checked separately. The missing field in the original report is preserved.

## Version comparison: Three pairs, six successful runs

The task queue fixture with two stories was measured. The order was 1.23/1.24, 1.24/1.23, 1.23/1.24. Each run started from a fresh fixture; the unchanged original tests were then run again independently. All six runs passed. The following times start after fixture setup and end when the loop process exits; independent acceptance verification is listed separately.

| Pair | Yoke 1.23 | Yoke 1.24 | Difference, 1.24 minus 1.23 |
| --- | ---: | ---: | ---: |
| 1 | 289.127 s | 355.403 s | +66.276 s |
| 2 | 319.236 s | 318.147 s | −1.089 s |
| 3 | 324.097 s | 295.487 s | −28.610 s |
| Median, n = 3 per version | 319.236 s | 318.147 s | −1.089 s |
| Empirical range | 289.127–324.097 s | 295.487–355.403 s | |

**A general speed improvement has not been demonstrated.** The medians are practically equal; the direction of the difference changes between pairs. Total loop time is 1,901.497 seconds (31 minutes 41.497 seconds). This excludes project preparation, pauses between samples, and external waiting times outside the loops; these were not measured separately.

| Sample | Implementation call, story 1 | Implementation call, story 2 | Remaining loop time | Independent acceptance verification afterward |
| --- | ---: | ---: | ---: | ---: |
| 1 / 1.23 | 131.644 s | 154.666 s | 2.817 s | 0.190 s |
| 1 / 1.24 | 169.397 s | 183.570 s | 2.436 s | 0.120 s |
| 2 / 1.24 | 183.084 s | 132.621 s | 2.442 s | 0.124 s |
| 2 / 1.23 | 169.027 s | 147.738 s | 2.471 s | 0.120 s |
| 3 / 1.23 | 172.921 s | 148.578 s | 2.598 s | 0.114 s |
| 3 / 1.24 | 159.988 s | 132.917 s | 2.582 s | 0.118 s |

99.19% of recorded loop time is spent in implementation calls. This process duration also includes provider/tool waiting and is not pure neural computation time. The remaining time is a residual; individual verification, Git, and status components were not profiled separately here. This suggests that further investigation should focus on context and failed attempts, which offer more potential than the few seconds outside implementation processes. The provider/cache or background load responsible for the differences was not measured in isolation.

| Recorded tokens, total across three runs per version | 1.23 | 1.24 |
| --- | ---: | ---: |
| Input including cache | 1,356,910 | 1,385,667 |
| Of which cached input | 1,166,848 | 1,176,960 |
| Input minus cached input | 190,062 | 208,707 |
| Output | 19,337 | 19,882 |

These results also do not demonstrate a reduction in tokens or costs. All twelve native implementation sessions report `gpt-6.1-sol` and `medium`; their accumulated input/cache/output/reasoning tokens match Yoke exactly. Costs remain unknown. The original field `actualModels: null` was not rewritten afterward; the native verification is bound separately.

The baseline comes from `d85cd0d` and has the same Git tree as the published 1.23 version. The first candidate comes from `697408a`, and the later ones from `132eda0`. Only a Windows path test and the README test count changed between them. The actual runtime digest is identical in all three candidates. All source checkouts were clean and stable before and after their sample; fixture, acceptance, request, workflow input, model, effort, startup, and environment data match. This does not fully attest to provider system prompts or installed plugins/skills.

The complete structured results, invocation timings, native session hashes, model/usage checks, and limitations are in [version-pairs.json](version-pairs.json). Local absolute project paths were removed from the public copy; the original files are bound by SHA-256. Native transcripts remain local.

Reproduction: run `npm run build` in both pinned checkouts, followed by `node bench/compare-codex.mjs --fixture=routing-queue --repeats=1 --arms=yoke-serial --model=gpt-6.1-sol --effort=medium --root=<fresh-sample-directory>` for each sample in the stated order. Run only with an authorized existing CLI sign-in. The child process environment removes `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_ENDPOINT` without logging their values. The harness replays the original tests after the agent exits.

## Quality and CI: Where verification time is spent

The independently reviewed runtime revision `132eda0` passed [all four CI jobs](https://github.com/HECer/yoke/actions/runs/37208754601). There is one observed job per platform/Node version here, not a repeated platform benchmark series. Times are derived from GitHub step timestamps in whole seconds. Different runners prevent an isolated conclusion about the cause of platform differences.

| CI runner | npm ci | Lint | Build | Full tests | Canon | Documentation test count | Audit | Package | Total job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Linux / Node 20 | 2 s | 6 s | 7 s | 97 s | 1 s | 41 s | 1 s | 1 s | 167 s |
| Linux / Node 24 | 2 s | 5 s | 5 s | 90 s | 1 s | 38 s | 1 s | 1 s | 149 s |
| Windows / Node 20 | 4 s | 8 s | 8 s | 296 s | 2 s | 67 s | 2 s | 2 s | 412 s |
| Windows / Node 24 | 6 s | 6 s | 7 s | 251 s | 2 s | 53 s | 1 s | 3 s | 348 s |

The jobs run in parallel; their sum is not the workflow wall time. Total job time also includes checkout, Node setup, and other job steps. These Yoke repository installations are a different workload from the NEXUS cache samples and must not be combined with them. The data is in [ci-runtime-snapshot.json](ci-runtime-snapshot.json).

The documentation check starts `vitest list --json` again even though the full suite has already run. The measured step takes 38–67 seconds. A subsequent optimization should use existing complete test evidence when test/configuration/environment identity is demonstrably the same. If the binding is missing or differs, complete discovery must remain in place. Merely shortening checks or guessing test counts would weaken assurance.

During development, a legacy recovery test failure was fixed: new optional observation data must also be allowed in the V1 record, which remains strictly validated. The first Windows CI run then failed solely because of a test assumption about `RUNNER~1` versus the correctly resolved full temporary path. The correction preserves the exact argument comparison and adds a directory alias test that is not skipped. Both findings remain visible in the validation evidence.

## What should improve next

- Preserve the actual model identifiers reported by native sessions in Yoke's event path, with thread/call binding; requested identifiers alone are insufficient.
- Avoid duplicate test count discovery by using complete test evidence bound to the relevant identity. Do not reuse evidence when code, tests, configuration, or the relevant environment changes.
- Collect several complete product runs with the same unchanged acceptance criteria to evaluate context, retry, and model decisions. The small fixture does not replace this investigation.
- Add targeted instrumentation for unrecorded legacy/Guardian/approval causes and waiting times once a known boundary provides evidence. Until then, leave them unknown.

1.24 is prepared as a draft release with local installation, structured failure diagnosis, and actual measurements. The [validation evidence](../../RELEASE-VALIDATION-1.24.0.md) and PR #17 contain the final gate status. 1.24 has not been published.
