# NEXUS: Development Analysis with Yoke

English translation of the original benchmark report. Source results, measurement dates, and limitations are preserved; numerical separators follow English conventions.

Measurement cutoff: 2026-10-04T09:27:32.214737+00:00 (UTC). One real benchmark run; no comparison measurement against direct Codex. Raw data contains observable metadata and measurements, without hidden reasoning content.

## Compact Assessment

7/7 stories passed; eight implementation attempts, at most two parallel workers. Total Yoke loop runtime: 56.4 minutes. Implementation workers: 11,234,592 input tokens including 10,621,952 cached tokens, 82,193 output tokens. All measured roles combined at the cutoff: 28,094,098 input, including 26,848,896 cache reads; 1,245,202 uncached input and 195,930 output. The large cumulative input count includes repeated context on every call; it does not represent the amount of content read once.

The main evidenced bottlenecks were setup/compatibility issues, repeated checks and browser work, an integration retry caused by the observer, and a layout defect discovered only by independent review. Implementation workers' shell checks took a total of 461.3 process seconds; this time is partly included in the implementation phases. The available data does not support a reliable breakdown of every second into model latency, thinking, and tool wait time.

## Measurement Method and Limitations

- Provider tokens come from Yoke history and native Codex token events. The two views are not added together. Input tokens include cache-read tokens; reasoning output tokens are a subset of output tokens.
- Output bytes are serialized tool or shell output, not provider tokens. Tool bytes can include image data and metadata; they do not establish text context size. Unique usage events are counted, not independently verified HTTP requests.
- The breakdown by story/role is directly observable. The purpose of individual model calls in model-calls.jsonl and shell categories is inferred heuristically from visible tool calls; mixed commands cannot be broken down precisely.
- Shell times are process runtimes. Background servers, parallel workers, and checks can overlap; their sum is not total development time. Nested Yoke phases must also not be counted twice.
- RTK savings and Code Intelligence token budgets are tool estimates, not additional measured provider tokens or monetary amounts. Monetary costs are unavailable and recorded as unknown.
- Coordinator includes setup, ongoing communication, instrumentation, and independent checks. This additional measurement overhead is reported separately. Values end at the measurement cutoff; later calls and the final response are excluded.

## Measurement Scope, Environment, and Instrumentation Overhead

From the start of the 10-second observer to the measurement cutoff: 91.7 minutes. This is recorded elapsed time including setup, interruptions, checks, and analysis; it is not a pure product development measure. The observer was stopped before the final assessment. Its last CPU/RSS snapshot is in observer-resources-final.txt.

Yoke 1.22.0; codex-cli 0.160.0; rtk 0.51.0; runner gpt-6.1-sol / medium. Isolated worktrees, automatic parallelism and decisions enabled. No --explore. Code Intelligence facade in ACTIVE: MCP handshake successful, actual semantic backends graft/graphify/serena missing. A semantic efficiency gain was therefore not demonstrated.

RTK database for root and all project-related worktrees: 42 commands; estimated input/output tokens 13,752/11,635; estimated savings 2,117 (15.4%). These local estimates cover registered RTK commands and do not prove a percentage reduction in total model usage. Native automatic rewriting of nested code-mode calls could not be demonstrated; explicit RTK usage is evidenced from the last workers onward.

| Instrumented Command Phase | Commands | Errors | Wall s | Child CPU s |
|---|---:|---:|---:|---:|
| environment | 4 | 1 | 0.9 | 0.6 |
| code-intelligence | 3 | 0 | 2.0 | 1.3 |
| planning | 5 | 1 | 61.4 | 11.0 |
| dependency-setup | 2 | 1 | 10.0 | 6.8 |
| yoke-smoke | 1 | 1 | 0.4 | 0.3 |
| execution | 4 | 2 | 3384.7 | 1277.9 |
| recovery | 1 | 0 | 0.5 | 0.3 |
| dev-server | 1 | 1 | 0.8 | 0.5 |
| browser-inspection | 2 | 0 | 14.3 | 5.4 |
| final-validation | 1 | 0 | 20.0 | 30.0 |
| final-yoke-smoke | 2 | 2 | 5.5 | 4.2 |

This includes only processes launched through measure.py. Child CPU can include overlapping subprocesses; measurement script execution, tool round trips, and provider latency are not fully separated. Coordinator token usage includes both necessary orchestration and additional measurement work; these cannot be separated precisely after the fact.

## Token Usage by Observed Purpose

The following breakdown is explicitly a heuristic based on the last visible tool call. A call can combine reading, editing, and checking. Values do not provide an exact separation between thinking time, writing, and tool-result processing. Full role/purpose matrix: model-purpose-hints.csv.

| Implementation Workers: Purpose Hint | Usage Events | Input | Cache | Output |
|---|---:|---:|---:|---:|
| discovery | 35 | 2,015,491 | 1,824,896 | 6,669 |
| checks | 63 | 3,377,368 | 3,130,624 | 44,163 |
| code_intelligence | 6 | 263,056 | 252,160 | 785 |
| dependency_setup | 6 | 270,273 | 244,480 | 2,947 |
| dev_server_or_mixed | 12 | 809,495 | 797,184 | 4,029 |
| waiting_or_polling | 26 | 1,668,311 | 1,642,752 | 1,869 |
| browser_validation | 41 | 2,830,598 | 2,729,856 | 21,731 |

### Directly Evidenced Rework

An additional STORY-5 implementation phase resulted from the observer commit during an integration. STORY-7 is an additional repair within the original product scope: independent review found a desktop height of 938px with a 900px viewport despite the initial gates passing. After repair, the correctly attributed root server measures 900px; event panel bottom edge: 884px. Both measurement states and server provenance are archived. Incorrect measurements against the unrelated server were explicitly invalidated.

Guardian sessions are reported separately because they were absent from Yoke's story token view. For capacity/cost planning, Yoke must also make these control costs visible. No invented monetary costs; cache-read tokens are not treated as free.

## Tokens by Role

| Role | Sessions Measured/Total | Model Calls | Input Including Cache | Cache Read | Uncached Input | Output |
|---|---:|---:|---:|---:|---:|---:|
| guardian | 7/7 | 48 | 1,281,675 | 1,073,152 | 208,523 | 5,404 |
| implementation | 8/8 | 189 | 11,234,592 | 10,621,952 | 612,640 | 82,193 |
| coordinator | 1/1 | 127 | 15,525,113 | 15,139,456 | 385,657 | 107,118 |
| planner_or_review | 2/2 | 2 | 52,718 | 14,336 | 38,382 | 1,215 |

## Stories and Time

| Story | Passed | Implementation Calls | Implementation s | Gate Checks s | Integration s | Input | Cache | Output |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| STORY-1 | True | 1 | 565.9 | 3.1 | 6.3 | 1,435,585 | 1,314,176 | 12,725 |
| STORY-2 | True | 1 | 367.4 | 2.8 | 8.7 | 698,268 | 643,968 | 8,663 |
| STORY-3 | True | 1 | 696.3 | 5.2 | 9.2 | 2,080,455 | 1,994,752 | 15,192 |
| STORY-4 | True | 1 | 505.8 | 4.1 | 11.8 | 921,789 | 857,088 | 12,190 |
| STORY-5 | True | 2 | 566.1 | 11.6 | 35.7 | 1,347,301 | 1,245,568 | 11,899 |
| STORY-6 | True | 1 | 683.2 | 28.8 | 28.3 | 2,950,211 | 2,853,888 | 13,068 |
| STORY-7 | True | 1 | 484.2 | 18.4 | 0.0 | 1,800,983 | 1,712,512 | 8,456 |

Completed loop processes: 4, of which failed: 2. Total loop runtime: 3384.7 s. Total implementation phases: 3868.9 s; union duration of these intervals: 3184.7 s. Observed overlapping worker time: 684.2 s. This is not a measured speedup against a serial control run.
Concurrency samples: 530, interval 10 s, observed peak of 2 implementation workers and 2 combined units. Brief peaks between samples may be missing.

## Implementation Workers' Shell Work

| Category (Heuristic) | Calls | Exit != 0 / Aborted | Process Runtime s | Output Bytes |
|---|---:|---:|---:|---:|
| discovery | 73 | 12 | 32.2 | 452,893 |
| dependency_setup | 10 | 5 | 114.5 | 6,349 |
| checks | 92 | 25 | 461.3 | 420,588 |
| browser_validation | 23 | 9 | 103.3 | 109,393 |
| dev_server_or_mixed | 12 | 12 | 677.8 | 4,534 |
| other | 17 | 3 | 86.7 | 4,748 |
| file_editing | 1 | 0 | 0.3 | 0 |

Failed test commands include intentionally red TDD tests. They do not automatically represent product defects or additional Yoke story attempts. dev_server_or_mixed includes long-running or mixed commands.

## Concrete Findings and Improvements

| ID | Observation | Impact / Improvement |
|---|---|---|
| CLI-HELP-MUTATION | yoke setup --help created 95 files and enabled loop; yoke retrofit --help then disabled loop | Read-only discovery mutated configuration and required explicit correction Handle help before command dispatch; reject unknown flags before mutation |
| RTK-INIT-FLAGS | rtk init --codex --auto-patch exits 1: cannot be combined | One failed setup call Document per-runner incompatible flags and expose compatibility validation |
| CI-WORKSPACE-ID | code_context rejects absolute path and configured codeIntelligence.workspaceId; MCP server computes hash workspace ID and ignores configured workspaceId | Two failed probes before reading implementation to determine identifier Expose workspace identifier in initialization/tool listing, honor config or document discovery method |
| CI-BACKENDS-MISSING | graft, graphify and serena executables absent on PATH | Facade can be enabled but semantic/structural backend functionality unavailable Add preflight that distinguishes configured active mode from operational backend coverage and provides pinned installation guidance |
| RTK-DUPLICATE-HOOKS | Yoke legacy hook and rtk init native Codex hook both present; rtk hook check is supported (exit 0) | Double hook registration observed; rewrite effectiveness with actual Codex tool schema needs separate measurement Use idempotent native Codex hook integration and provide actual rewrite/adoption telemetry |
| COMPACT-STATUS-MISSING | yoke loop status --compact prints story=none phase=undefined while loop-status.json reports active STORY-1 implementing | Compact progress unsuitable for reliable supervision; detailed status file required Summarize parallel workers in compact status and avoid undefined values |
| WRITE-SCOPE-DRIFT | STORY-2 declared src/simulation and tests/simulation.test.ts but commit writes src/simulation.ts, src/useSimulation.ts, src/types.ts, tests/simulation.test.tsx; scheduler scopes are advisory | Declared non-overlap does not prove actual non-overlap; shared type file changed during parallel topology work Compare candidate changes against writes declarations, surface deviations and recheck collision risk before integration |
| SMOKE-MISDIAGNOSIS | Yoke flow-smoke reports Playwright not found while node_modules/playwright/package.json exists; launchPlaywright catches both import and chromium.launch errors and returns null | Package absence and browser launch/sandbox failures have the same actionable error; worker reads harness source to diagnose Return structured import/browser-binary/sandbox/launch failure causes and preserve underlying error |
| EPHEMERAL-PROOF | After isolated STORY-1/2 integration, target .yoke/proof directory absent; earlier worker smoke screenshot was in removed worktree | Intermediate manual proof lost on cleanup; root must preserve required screenshots in tracked artifact path Copy and content-bind selected verification artifacts to target before deleting isolated worktrees |
| RTK-LEGACY-ALLOW | Yoke-generated rtk.mjs emits updatedInput without permissionDecision allow; official RTK Codex documentation requires allow for replacement to take effect | Legacy transparent command rewriting incompatible with documented Codex response contract; native RTK integration is also registered but worker adoption not observed Use current native rtk hook codex; verify an actual verbose Codex command records compressed output and RTK history |
| RTK-NATIVE-CORRECTION | Removed legacy Yoke hook registration; native rtk hook codex remains sole active hook and manual exact-schema probe rewrites git status correctly | Future workers receive native integration without duplicate response; effectiveness measured separately |
| SHARED-DEPS-SANDBOX | STORY-5 Vitest fails EPERM mkdir at target root node_modules/.vite-temp while executing in isolated worker; tests succeed after worker retries | Dependency reuse caused additional startup failure and approval/escalation path Share immutable package download cache, provide per-worktree writable dependency/runtime cache or explicit allowed paths |
| NETWORK-RETRY-CACHE | Target npm ci fails ECONNRESET downloading why-is-node-running; npm ci --offline --cache /private/tmp/nexus-npm-cache then installs 105 packages in 4s | At least one failed installation and repeated dependency setup; cached recovery successful Preflight and reuse exact lockfile package cache, classify network failures separately from code failures; n=1 does not establish general speedup |
| GUARDIAN-USAGE-GAP | Native Codex sessions with source.subagent.other=guardian report token usage separately; Yoke worker token event matches implementation session and excludes those sessions | Harness totals omit observable approval-model usage; independent observer reports it separately Expose approval/guardian call coverage and distinguish implementation usage from full provider-session cost; unknown charge remains unknown |
| OBSERVER-HEAD-RACE | Observer committed AGENTS.md during STORY-5 integrated gates; Yoke rejected changed target HEAD, retained candidate, and stopped loop | One failed integration and explicit recovery; prior source preserved; recovery invalidates proof and reruns implementation/gates Observer should make harness changes only between loop batches; CLI should expose integration busy state and avoid premature integration complete message |
| VISUAL-COMPOSITION | INVALIDATED: first observer screenshots came from another pre-existing NEXUS on port 4173; expected root Vite process exited with port-in-use error | Those visual conclusions are excluded from this project assessment Verify owning process cwd, successful server startup and source identity before collecting browser evidence |
| OBSERVER-WRONG-SERVER | First browser probe navigated occupied port 4173 before checking Vite process had started. Different NEXUS app names and styles exposed mismatch. Target process exit 1 confirmed port conflict. Existing listener left untouched. | One invalid browser run; screenshots and prior visual finding invalidated; its time/tokens remain observer overhead Require startup success plus bound process cwd and served source signature; use unique port and record provenance |
| RUNTIME-IGNORE-GAP | yoke prd assess creates .yoke/supervision/<uuid>.json but retrofit .gitignore lacks this directory. New loop blocked as dirty before any iteration. Initial planner supervision file was already tracked. | One zero-iteration loop failure; runtime ignore corrected and tracked runtime file untracked without deleting it Include all watchdog/supervision runtime state in generated ignore rules and distinguish harness-owned dirtiness from user code |
| COMPLETION-DIRTY-PROOFS | After loop complete 6/6, overview.png and selected-machine.png are modified because completion reexecutes screenshot-writing tests after story commit | Next loop starts dirty and requires explicit artifact commit even though previous loop reported completion Store rerun proofs outside tracked final assets, promote deterministic final proof once, or finalize generated artifact commit after completion verification |
| VERIFIED-VISUAL-GAP | Correctly bound app on port 6317 has document scrollHeight 938 for viewport 900; event panel bottom 914. All original six stories and design-scan passed. | Full-screen layout still incomplete; finite original-scope repair STORY-7 added, preserving existing functionality and tests Assert panel bottom bounds and populated incident/event states, not only horizontal overflow or panel top visibility; use independent visually bound review |
| OBSERVER-FINAL-SMOKE-DIRTY | Two final root smoke attempts had 1/1 successful browser flows but source evidence was rejected: first because observer config was uncommitted; second because observer report generation created an untracked root file during the gate. | Observer interference, not product failure. Root smoke must run only after artifact writes and commit are finished. Treat integrated source gates as a write lock for all coordinator tasks; keep measurement generation outside that interval. |

Priorities for Yoke: (1) safe CLI help and clear preflight checks of actual RTK/CI functionality, (2) correct attribution of provider, approval, control, and integration failures, (3) concrete browser failure causes and reusable package caches with isolated write directories, (4) verifiable write scopes and durable proof artifacts, (5) reliable compact live status and token information.

The HEAD race was caused by the observer. Yoke's rejection was the correct safety decision; the resulting time and repetition must not be interpreted as spontaneous model failure. The retained candidate was passed through Yoke's recovery APIs for renewed implementation verification; integration evidence was not presented as still valid.

The native RTK Codex contract was checked against the [official RTK documentation](https://github.com/rtk-ai/rtk/blob/develop/hooks/codex/README.md). All other concrete findings come from local commands, runtime files, and the installed Yoke 1.22.0 implementation.

## Data for Follow-up Analyses

measurements/summary.json, stories.csv, roles.csv, yoke-phases.csv, shell-categories.csv, model-calls.jsonl, shell-metrics.jsonl, sessions.json, yoke-history.jsonl, commands.jsonl, status-samples.jsonl, observations.jsonl, and Code Intelligence/recovery probes. Screenshots are stored separately under screenshots/. Observer and analysis scripts are under tools/.

For reliable evidence of improvement: the same task and test gates with/without the change, the same model version, multiple repetitions, cold and warm caches, controlled network/sandbox conditions, and separate measurement of observer overhead. This run provides concrete failure evidence and measurements, but no causal conclusion about general Yoke efficiency.

## Final Verification After the Measurement Cutoff

Yoke Flow-Smoke against the unchanged, committed root server passed at 2026-10-04T09:28:21.392Z: 1/1, 2.156 seconds total runtime, stable source fingerprints. Report in measurements/final-yoke-smoke.json. This confirms that the observer checks, which were correctly rejected earlier, work after all writes have ended. This additional gate and subsequent artifact packaging are excluded from the token/time aggregates frozen above.
