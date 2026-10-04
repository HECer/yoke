# Yoke efficiency: analysis and required changes

Editorial note: this is a historical pre-release snapshot, now translated into English. Implementation and release claims below describe that snapshot. For current publication status, see the [release validation report](../../RELEASE-VALIDATION-1.23.0.md).

As of 2026-10-04. Created by the AI assistant from local measurements and a targeted source-code inspection. Draft target version: **1.23.0**. No improvement has been implemented or released yet.

## What the measurement shows

Yoke 1.22.0 brought the NEXUS project to seven passing stories. The four loop processes ran for a combined **56:24.7 minutes**. The entire recorded period was **91:44.8 minutes**, including setup, interruptions, additional observation, and analysis. There is **one product run**, no direct Codex control run, and no measured general speedup.

The most important required changes concern safe CLI exploration, accurate infrastructure diagnoses, correct parallel status, clean runtime files, durable verification evidence, and traceable usage accounting. This run does not justify blanket test reductions or enabling more workers.

## Basis and reproducibility

Originals: `G:/NN-Developed/ToolTesting/Yoke/YokeEfficiencyTest1/benchmark-artifacts/`. The original run took place on macOS; the current analysis is being performed on Windows. The copied test project's `.git` reference points to a nonexistent macOS worktree and has not been changed.

Selected raw measurement content is stored unchanged under [raw/](raw/); [manifest.json](manifest.json) contains provenance and SHA-256 hashes. The complete sessions, model calls, shell metrics, status samples, and images remain in the original directory. The published copy of the previous report, `raw/DEVELOPMENT_ANALYSIS.md`, is now an English translation; its original local source remains untouched. The manifest distinguishes original source checksums and byte counts (`source_sha256`/`source_bytes`) from published Git blob checksums and byte counts (`sha256`/`bytes`), including the translated report. The other 17 raw evidence files retain their measurement content; Git may normalize line endings.

Targeted inspection of the current Yoke code: commit `e2e3c18`, package version 1.22.0. The main working tree contains user changes. Preparation is therefore taking place on `codex/yoke-1.23-efficiency` in a separate worktree.

Measurement environment: Codex CLI 0.160.0, model `gpt-6.1-sol`, effort `medium`, RTK 0.51.0, isolated worktrees, automatic parallelism/decisions, no continuous exploration. The code-intelligence facade was active and the MCP handshake succeeded, but graft/graphify/serena were unavailable. No demonstrated semantic efficiency gain.

## How long each task took

| Story | Task | Implementation | Yoke gates | Integration | Attempts |
|---|---|---:|---:|---:|---:|
| 1 | React/TypeScript/Vite foundation, types, and test infrastructure | 9:25.9 min | 3.058 s | 6.301 s | 1 |
| 2 | Deterministic telemetry, incidents, and machine actions | 6:07.4 min | 2.816 s | 8.723 s | 1 |
| 3 | Interactive SVG topology, gestures, and visual states | 11:36.3 min | 5.190 s | 9.183 s | 1 |
| 4 | Machine inspector, fleet, events, and KPIs | 8:25.8 min | 4.124 s | 11.815 s | 1 |
| 5 | UI integration and keyboard command palette | 9:26.1 min | 11.580 s | 35.665 s | 2 |
| 6 | Integrated browser verification, bug fixes, and image evidence | 11:23.2 min | 28.821 s | 28.292 s | 1 |
| 7 | Subsequent repair of desktop height and mobile priority | 8:04.2 min | 18.435 s | 0.000 s in the separate integration field | 1 |

All seven stories passed. STORY-7 ran serially; its zero value in the separate integration field does not mean that no commit or completion occurred. The loop reported a total of 8m23s there. The table shows different phases, not seven independent total project durations.

Observed implementation duration per story: **6:07–11:36 minutes**, seven different stories, STORY-5 with two attempts. This is not a forecast range for new tasks. Individual implementation attempts: eight, including the STORY-5 recovery attempt at 90.363 s.

Why the longer stories took longer: STORY-3 combines visual design and SVG interaction; STORY-6 checks the integrated application in the browser and writes evidence. This explanation is inferred from the tasks and visible actions. Exact time shares for model latency, reasoning, tool waits, and programming are unavailable.

### Loop phases

| Phase | Events | Summed time | Meaning |
|---|---:|---:|---|
| Implementation | 8 | 3,868.892 s / 64:28.9 min | Sum of worker intervals, including internal tools/tests |
| Verification | 9 | 74.024 s | Separate Yoke gate phases |
| Integration | 7 | 99.979 s | Includes nested phases; do not add again |
| `waiting-resource` | 14 | 97.927 s | Partly within integration; not pure scheduler wait time |
| Design | 4 | 14.082 s | Design gates, not complete UX evidence |
| Commit | 8 | 2.701 s | Within parent phases |
| Resource wait before implementation | 8 | 0.038 s | No demonstrated major bottleneck here |
| Integration queue | 7 | 0.019 s | No demonstrated major bottleneck here |
| Resource wait before integration | 7 | 0.017 s | No demonstrated major bottleneck here |

The union duration of the implementation intervals is **3,184.729 s / 53:04.7 min**. The observed overlap is **684.163 s / 11:24.2 min**. This difference is not a saving relative to a measured serial control run. 530 samples taken every ten seconds show at most two implementation workers; brief peaks between samples may be missing. Story dependencies limit parallelism.

Four completed loop invocations, two of which failed: one rejected integration after an observer commit and one startup abort due to a dirty worktree. These are not two failed product implementations.

### Setup, observation, and completion outside the worker view

The following times cover only processes started through `measure.py`. They are not a complete breakdown of the 91.7 minutes and overlap with other tables.

| Instrumented command phase | Commands | Failures | Process wall time | Child CPU |
|---|---:|---:|---:|---:|
| Environment | 4 | 1 | 0.914 s | 0.646 s |
| Code-intelligence probe | 3 | 0 | 1.987 s | 1.251 s |
| Planning | 5 | 1 | 61.429 s | 11.040 s |
| Dependency setup | 2 | 1 | 10.049 s | 6.796 s |
| First Yoke smoke | 1 | 1 | 0.423 s | 0.271 s |
| Loop execution | 4 | 2 | 3,384.740 s | 1,277.859 s |
| Recovery command | 1 | 0 | 0.531 s | 0.345 s |
| Server startup | 1 | 1 | 0.826 s | 0.506 s |
| Observer browser check | 2 | 0 | 14.340 s | 5.432 s |
| Final project verification | 1 | 0 | 19.997 s | 30.002 s |
| Two rejected final smokes before cutoff | 2 | 2 | 5.513 s | 4.183 s |

Child CPU time can exceed wall time due to parallel subprocesses. Uninstrumented tool round trips, conversations, report generation, and provider wait time are not fully separated. The difference of approximately 35.3 minutes between the recorded total period and the summed loop processes must therefore not be presented as precisely measured Yoke orchestration overhead.

## Where effort arose within workers

| Shell category | Calls | Unsuccessful/aborted | Summed process duration |
|---|---:|---:|---:|
| Repository exploration | 73 | 12 | 32.161 s |
| Dependency setup | 10 | 5 | 114.453 s |
| Tests and checks | 92 | 25 | 461.324 s / 7:41.3 min |
| Browser verification | 23 | 9 | 103.280 s |
| Dev server/mixed commands | 12 | 12 | 677.782 s / 11:17.8 min |
| Other | 17 | 3 | 86.671 s |
| Separate file edits | 1 | 0 | 0.269 s |

The categories are heuristic. A mixed command can include several tasks. Long-running servers are aborted at the end; their process duration is not automatically blocking wait time. Failing TDD tests are part of correct development. A single separate file edit says nothing about the total writing effort.

The 92 worker checks are a candidate for targeted reuse, but they are not 92 unnecessary checks. Before optimization, Yoke must distinguish test purpose, the source/configuration/environment state checked, and protected gates. The additional 74 seconds of Yoke gates are a different metric. Verification times are partly already included in implementation times.

## Tokens and measurement gaps

| Role | Sessions | Usage events | Input including cache | Cache reads | Fresh input | Output |
|---|---:|---:|---:|---:|---:|---:|
| Implementation | 8 | 189 | 11,234,592 | 10,621,952 | 612,640 | 82,193 |
| Coordinator/observer | 1 | 127 | 15,525,113 | 15,139,456 | 385,657 | 107,118 |
| Guardian/approval | 7 | 48 | 1,281,675 | 1,073,152 | 208,523 | 5,404 |
| Planner/review | 2 | 2 | 52,718 | 14,336 | 38,382 | 1,215 |
| Total through cutoff | 18 | 366 | 28,094,098 | 26,848,896 | 1,245,202 | 195,930 |

**95.57% of cumulative input consists of cache reads.** The 28 million count context repeatedly sent with model events; they are not 28 million tokens read only once. Cache tokens have not been shown to be free. Monetary costs are unknown. Reasoning output is part of output and must not be added separately. Native usage and Yoke usage are alternative views and are not added together.

The coordinator accounts for 55.26% of cumulative input tokens and 107,118 output tokens. It includes measurement instrumentation, communication, setup, and independent checks. This does **not** imply that Yoke always requires more controller effort than worker effort in normal use. Routine observation should take place without new model calls; a follow-up run must measure the actual saving.

The `measured_provider_calls` field in the story CSV counts aggregated worker usage reports (usually one per attempt). It does not contradict the 189 native implementation usage events and must not be interpreted as a single model request per story. Unique usage events are also not an independently confirmed HTTP request count.

Heuristic purpose of the 189 implementation events:

| Purpose hint | Events | Input | Cache | Output |
|---|---:|---:|---:|---:|
| Exploration | 35 | 2,015,491 | 1,824,896 | 6,669 |
| Tests/checks | 63 | 3,377,368 | 3,130,624 | 44,163 |
| Code intelligence | 6 | 263,056 | 252,160 | 785 |
| Dependency setup | 6 | 270,273 | 244,480 | 2,947 |
| Server/mixed actions | 12 | 809,495 | 797,184 | 4,029 |
| Waiting/polling | 26 | 1,668,311 | 1,642,752 | 1,869 |
| Browser verification | 41 | 2,830,598 | 2,729,856 | 21,731 |

Coordinator polling: 35 events, 4,593,089 input and 31,499 output. Attribution is based on the most recently visible tool actions and does not prove that these tokens were used exclusively for waiting. Event-driven status updates are therefore an optimization to evaluate.

RTK: 42 registered commands, tool estimate of 13,752 input/11,635 output tokens, 2,117 saved (**15.4% for these commands**). No evidence of 15.4% less provider usage across the entire project. Automatic rewriting of nested code-mode calls was not demonstrated. Explicit RTK use is documented.

## Specific rework and error attribution

1. **STORY-5:** The observer changed target HEAD during integration. Yoke correctly rejected it and retained the candidate. First attempt: 475.741 s of implementation; repeat implementation phase: 90.363 s, followed by a 5.504 s gate and 17.627 s integration. These recovery phases were observed, but are not a fully isolated duration of the impact. The four minutes between attempts are not clearly separated into active repair and other wait time.
2. **STORY-7:** An independent check correctly attributed to the server detected a document height of 938 px with a 900 px viewport; the event panel's bottom edge was at 914 px. Repair took 484.220 s of implementation and an 18.435 s gate. Afterwards, document height was 900 px and the bottom edge was at 884 px. This quality rework is avoidable if the original acceptance checks visible panel boundaries in populated states.
3. **Dependency setup:** One `npm ci` failed with ECONNRESET. Offline installation from an existing cache installed 105 packages in four seconds. A single case, not a general cache speedup.
4. **Sandbox:** Reused dependencies caused EPERM when writing to root `node_modules/.vite-temp`. This cause belongs to the environment, not the simulation or model.
5. **Wrong browser server:** The first observer checked an already occupied port 4173. Startup of the intended server failed; images from the other server were invalidated. Time and tokens remain measurement overhead; visual claims are not product findings.
6. **Final smoke:** Two browser flows passed, but source evidence was correctly rejected due to observer writes. After the root reached a stable committed state, another smoke passed at 09:28:21 UTC in 2.156 s, **after the token cutoff**. Its configuration contains a foundation flow without interaction steps; it does not replace complete UX acceptance.

## All documented findings and required action

P0 = first, before further production development; P1 = part of the planned efficiency release; P2 = subsequent optimization requiring measurement. The priorities are recommendations, not CVSS severity levels.

| Finding | Cause and change | Priority / attribution |
|---|---|---|
| CLI-HELP-MUTATION | Handle help before dispatch; reject unknown flags before any write. Setup help created 95 files; retrofit help disabled the loop. Still plausibly confirmed in the current `src/cli.ts`. | P0, Yoke |
| RTK-INIT-FLAGS | Specifically validate and document incompatible RTK init flags. | P1, integration/setup |
| CI-WORKSPACE-ID | Respect the configured workspace identifier and provide the valid identifier in machine-readable form. The current coordinator hashes the root; the server does not pass the configured identifier. | P1, Yoke |
| CI-BACKENDS-MISSING | Separate the configured mode from actually available capabilities; report fallback and missing backends. | P1, Yoke/environment |
| RTK-DUPLICATE-HOOKS | Make native hook setup idempotent; migrate only Yoke's own legacy registration and preserve third-party hooks. | P0, Yoke |
| COMPACT-STATUS-MISSING | Output workers and the integrator from parallel status; never emit `phase=undefined`. Current code still interpolates only the top-level story/phase. | P0, Yoke |
| WRITE-SCOPE-DRIFT | Check the actual diff against declared `writes`; handle deviations and collisions before integration. Do not infer a security guarantee from declarations. | P1, Yoke; recheck current enforcement |
| SMOKE-MISDIAGNOSIS | Distinguish missing packages, browser binaries, sandbox errors, and other launch failures; retain the cause and redact sensitive content. Currently a shared `catch → null`. | P0, Yoke |
| EPHEMERAL-PROOF | Collect required evidence before worktree cleanup and record it in a manifest bound to hashes/source; copy failures must not count as completion. | P1, Yoke; recheck current lifecycle |
| RTK-LEGACY-ALLOW | The current Canon adapter still contains `updatedInput` without `permissionDecision`; evaluate native RTK integration with the actual host contract instead of a custom obsolete response. | P0, Yoke/host contract |
| RTK-NATIVE-CORRECTION | Preserve the local hook correction already made during the benchmark; it is not a shipped Yoke fix. | Correction evidence |
| SHARED-DEPS-SANDBOX | Share the package download cache and isolate writable runtime/dependency directories per worktree. No blanket permission expansion. | P1, environment/isolation |
| NETWORK-RETRY-CACHE | Prepare a package cache bound to the lockfile; report network errors separately and retry within limits. | P1, setup |
| GUARDIAN-USAGE-GAP | Track implementation and additional approval sessions separately; mark unavailable control costs as unknown. | P1, Yoke/provider telemetry |
| OBSERVER-HEAD-RACE | Publish busy/integration state and coordinate observer writes; resume the retained candidate with new evidence. Preserve HEAD protection. | P1, caused by observer; improve Yoke diagnosis |
| VISUAL-COMPOSITION | The earlier visual conclusion was invalidated due to the wrong server and remains excluded. | No valid product finding |
| OBSERVER-WRONG-SERVER | Verify successful server startup, owning cwd, and source identity before browser evidence; reserve a dedicated port. | P1, measurement harness/browser evidence |
| RUNTIME-IGNORE-GAP | Add `.yoke/supervision/` to the generated ignore list. `src/loop/git.ts` already excludes it: the gap concerns retrofit and external Git views, not a new blanket Git exception. | P0, Yoke |
| COMPLETION-DIRTY-PROOFS | Put rerun evidence in the runtime directory; explicitly collect only selected final artifacts. No automatic inclusion of third-party changes. | P1, Yoke/project verification commands |
| VERIFIED-VISUAL-GAP | Expand layout acceptance to cover bottom edges, populated incident/event states, and the mobile priority area. Do not present a design scan as UX evidence. | P1, acceptance/project quality |
| OBSERVER-FINAL-SMOKE-DIRTY | Respect source-verification intervals as write locks for coordinated tools; generate analysis outside the interval. | P1, caused by observer |

## Recommended new version

**1.23.0 “reliable efficiency foundation”**: P0 regression fixes first, then preflight, integration/evidence, and telemetry. No promise of a specific saving percentage. The acceptance draft and story order are in the [version draft](../../superpowers/specs/2026-10-04-yoke-1.23-efficiency-design.md).

The alternatives are a small 1.22.1 hotfix limited to P0 or a comprehensive scheduler/routing redesign. The hotfix leaves substantial measurement and evidence gaps open. A scheduler redesign is not justified by practically negligible queue times. 1.23.0 combines specific repairs with the data foundation for later optimization.

Then investigate selectively: less LLM polling, reusable exploration/context packages, safe test reuse, and demonstrably working RTK. Before every code change, check which of these capabilities already exist. Do not completely reimplement existing context or routing modules.

## Evidence of an actual improvement

Use the same task, unchanged protected acceptance checks, model/effort/CLI versions, and a comparable environment for 1.22.0 and 1.23.0. At least three paired repetitions per cold/warm cache state as the first investigation stage; explicitly identify the small sample. More runs are needed if variation or claimed effects require them.

Record: runtime to independent acceptance, union/sum of phases, rework, infrastructure failures, observer effort, usage from all available roles, coverage gaps, workers actually started, and unchanged test quality. Report the empirical range and sample count; report monetary costs only when price/usage evidence is available. No direct Codex efficiency claim without a suitable control arm.

Do not infer a fixed implementation duration from this run. The seven UI stories are not comparison data for harness changes. User wait time, model/network latency, and new errors remain unknown.

## Provenance and current work status

Read-only `audit-provenance` for the existing report: no supported C2PA structure found; supported scan complete. Cryptographic verification and trust are unknown because a verifier and trust policy are missing. Text metadata privacy is unknown. Proprietary/keyed watermarks cannot be verified; absence of an observed signal does not prove human authorship. No provenance features were removed. This new report explicitly identifies its AI creation.

Prepared at the time of this analysis: isolated version branch, unchanged evidence copies with a hash manifest, analysis, and a testable version draft. Production code, version number, and release artifacts were still unchanged. Design approval was required before implementation under `brainstorming`. An independent code/security review had not yet taken place; publication and merge were to be assessed only through the release gates.

Editorial note for the English edition: measurement content remains unchanged, with possible Git line-ending normalization. The published source report has been translated into English, with original source and published Git blob hashes recorded separately in the manifest; the original local report remains untouched. The work status above describes the historical analysis state, not the state of later releases.
