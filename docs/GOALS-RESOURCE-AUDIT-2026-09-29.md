# Goals and resource audit — 2026-09-29

AI-assisted inspection and authenticated tests of Yoke **1.19.0**, commit `05fac3db1a51412563005e07f80e6e5a9aab8e06`. Test tooling and this report were added in a separate worktree and branch. The original checkout and its local changes were preserved. Recommendations below are proposals, not shipped changes.

## What is already reliable

This report preserves the **1.19.0** findings. The implementation following this
audit is documented in [verified goals](GOALS.md) and the **1.20.0** changelog;
its release validation is recorded separately. Historical benchmark timings are
not measurements of the corrected version.

Yoke persists a provider-neutral objective, attempt history, independent check IDs, and interrupted-attempt evidence in `.yoke/goal.json`. Goals and story loops share an exclusive project lock. Goals require executable acceptance and protected test infrastructure. Each attempt is independently checked, and an earlier completion is checked again when resumed. Failed work is retained; a goal run does not automatically commit or publish it. These protections are useful even when a provider confidently claims completion.

The latest release's complete prepublication validation previously passed: TypeScript lint/build, **148 test files; 1,337 passed and 2 skipped**, docs checks and package dry run. In this audit, the final focused goal, shared worker-pool, dashboard and comparison-summary suites passed: **40 tests**, including 11 goal tests and five new summary tests. A passing suite does not establish coverage for the gaps below.

## Reproduced gaps

| Gap | Evidence | Consequence | Proposed fix |
| --- | --- | --- | --- |
| Objective is not bound to relevant acceptance | A disposable project had passing protected checks for an old feature. A new objective requested `new-feature.txt`, but its criteria still only checked the old feature. Yoke marked the new goal `complete` with **zero attempts**, without calling the fake executor or creating the requested artifact. | Checks prove the supplied contract, which can be unrelated to the newly requested work. Existing green tests alone do not prove a new objective. | Persist an explicit goal-to-criterion mapping and contract revision. Require criteria that cover the new objective, generated or selected before autonomous execution and then protected. Keep regression-suite success separate from objective-specific acceptance; do not infer relevance from a free-text objective. |
| Goals bypass the shared resource pool | With an isolated pool limited to one worker and its permit occupied, a goal's fake executor still started and completed. Default execution and capability-planner calls also directly start providers without requesting a permit. | Concurrent projects can exceed the intended Yoke worker limit; goal routing can introduce additional unaccounted calls. | Route all goal implementation and planner calls through the shared admission service. Disable unmanaged native delegation or account for its children explicitly. Release permits in `finally`, including abort, provider failure and routing escalation. |
| No native Codex goal binding | The persisted goal schema contains no native thread reference. `goalHandoff` supplies text, and execution launches a fresh CLI invocation. There are no native goal protocol calls. | Native and Yoke goal statuses, pause controls, budgets and continuation can disagree. Context is restarted between attempts. | Add a capability-negotiated Codex adapter with persisted thread binding, native goal set/get/update notifications, pause synchronization and session recovery. Keep provider-neutral fallback for CLIs without this capability. |
| Token budget is checked between attempts | A disposable goal with a budget of **1 token**, a fake executor reporting **100 tokens**, and passing acceptance finished as `complete`. This is a mechanical control-flow test, not an actual 100-token model call. | A single attempt can exceed the budget. The option is an admission guard for subsequent attempts, not a strict live token cap. | Pass supported live limits into the native runtime, consume streamed usage, reserve a bounded allowance for controller and verification calls, and report overshoot explicitly. Do not equate native budget accounting with provider aggregate tokens until their units are verified. |
| Time budget excludes verification | With a **60 ms agent-time budget**, intentionally delayed protected checks and a fake fast executor, the final recorded probe completed after **652 ms** while recording **3 ms** agent work. | Users cannot use `--minutes` as a total elapsed-time or CPU-resource limit. The current handoff explicitly says total agent work; this is a limitation rather than proof the documented budget is incorrect. | Preserve the existing meaning for compatibility and add an explicit elapsed-time deadline. Record admission wait, model work, verification and integration separately. Allow safe-boundary overrun only when documented. |
| Goal CLI does not inherit the configured runner selection | `src/cli.ts` defaults the goal provider to Codex and passes only `--model`; `runProjectGoal` loads config for routing but does not merge `runner.reasoningEffort`, `bare`, or native delegation policy into the direct selection. | Goal execution can use different startup context, effort and resource policy than the same project's story loop. | Resolve one common execution policy: explicit CLI overrides, then project runner config, then provider defaults. Test parity across goal, loop and dashboard resume. |

Source references: `src/goals/command.ts:21,69,83,115,128,134,136,147,152`; `src/cli.ts:202`; `src/loop/resource-pool.ts`; `src/agents/providers.ts`.

## Native capability verified on this machine

Installed Codex: **0.161.0-alpha.2**, authenticated with ChatGPT; its `goals` feature is enabled. The local CLI emitted experimental app-server schemas for `thread/goal/set`, `thread/goal/get`, and `thread/goal/clear`. In a disposable thread the actual app-server successfully performed:

1. Set an active objective with a 1,000-token budget.
2. Read the same objective and budget.
3. Set status `paused` and read it back.
4. Clear the goal and verify `goal: null`.

The thread was archived. This protocol probe did **not** request a model development turn; it verifies the local lifecycle API, not autonomous completion quality. Protocol availability must be negotiated for other installed versions. Do not enable global features or silently create a native goal in the user's current conversation.

OpenAI describes native goals as persistent, thread-scoped objectives with continuation subject to completion, interruption, budgets and blockers. This is not a guarantee of endless productive development. See the [official Goals cookbook](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex).

## Unify continuation without competing controllers

Keep Yoke authoritative for executable project acceptance, evidence and safe integration. Let the native goal manage work inside a provider thread. When the provider reports completion, run Yoke's independent check against the current tree. Only synchronize successful completion when that check passes. When it fails, supply bounded findings and continue the same objective within the remaining budget. Persist the native completion claim and the failed evidence separately rather than discarding either.

Store a run identity, native thread reference, objective revision, acceptance digest, provider/model selection, budget units and stop reason. Recovery must reconcile native and Yoke state before resuming. An explicit user pause must remain paused across crashes and restarts. Temporary rate limits, exhausted budgets, unresolved decisions and infrastructure errors need distinguishable reasons and retry rules; they should not all become an indistinguishable `blocked` status.

Checks currently use synchronous command execution with a default timeout of up to ten minutes **per command** (`src/loop/verify.ts:42`). The goal's agent-time timer has already been cleared before those checks. A total elapsed-time limit therefore needs an asynchronous, abortable verification path or an external supervisor; adding only another JavaScript timer around synchronous checks would not enforce it. Synchronous checks also block the dashboard process's event loop when a goal is resumed inside that process.

Continuous exploration is already an optional story-loop supervisor; it does not consume or synchronize `.yoke/goal.json`. Keep discovery separate from a finite goal contract. Each accepted exploration batch should have a bounded objective and verified acceptance, then return to discovery if the user still wants exploration. A waiting or blocked provider must never cause two independent supervisors to issue overlapping work.

Dashboard resume currently chooses a goal when an unfinished `.yoke/goal.json` exists; otherwise it starts `runLoopCommand(root, {})`. It does not persist and restore the original exploration flag, exploration deadline or full run selection. This is an observed source-level integration gap, not a crash-recovery test. Persist the actual execution mode and options, select the interrupted run by identity, and explicitly choose whether a resumed exploration limit preserves the original deadline. Test pause/resume both before and during model calls and integration.

## Resource efficiency priorities

**An actual parallel integration failure was reproduced.** The corrected independent-task fixture ran three authenticated Codex workers, but integrated **0/3** stories and ended at the explicit three-attempt cap. The worker gate sets `YOKE_STORY`; the dispatcher's integration gate directly invokes the verifier without setting it (`src/loop/worker.ts:60`, `src/loop/parallel-command.ts:113`, `src/loop/dispatcher.ts:133`). The fixture's scoped verifier therefore ran all three tests against each partial candidate at integration, rejecting it because the other independent modules were still unimplemented.

A deterministic diagnostic exercised the real loop/dispatcher with fake agents and Git adapters: worker observations were `A,B,C`, integration observations were `null,null,null`. The always-green control accepted **3/3**; the story-context-dependent verifier accepted **0/3**. Preserve identical verification context across worker and integration phases, preferably with explicit subprocess environment rather than ambient global mutation. Record rejection reasons and retain recoverable candidate evidence: this run's final status only reported `cap-reached`, while worker directories were removed. Lost context and repeated implementation after rejected integration consume resources without accepted work. The failed authenticated parallel run remains in the result set and is not reported as a speedup.

The first independent-task comparison exposed a Windows path limit before any parallel provider call: `git worktree add` failed with `fatal: '$GIT_DIR' too big`. Yoke's generated candidate path included a 64-character story digest and a UUID below the project path. The fixture was rerun under a shorter root. A production improvement is to preflight the complete Git worktree path, use shorter collision-safe candidate names or an explicit short worktree root, and report recoverable setup failures without a raw stack trace. Separately, the new fixture initially lacked runtime-file ignore rules and its serial run stopped on a dirty worktree after one story; this was corrected in the fixture. Those initial failed attempts are retained as setup diagnostics, not counted as successful performance samples.

The existing pool limits worker units, not measured CPU, memory or test subprocesses. Model request concurrency and local compilation/testing are different constraints. A useful next step is separate admission for model calls and expensive local checks, with per-project fairness and a shared cross-project ceiling. Include goal planners, repair attempts, exploration and native children in the accounting. Do not hold an implementation permit while merely waiting for integration if the integration lane can acquire its own permit safely.

For small coherent tasks, repeated context loading, separate sessions, worktree creation and repeated gates can cost more than they save. Introduce an explicit lightweight path or batching of tightly related criteria where the final independent acceptance remains protected. Parallelism is useful when write scopes are independent and model work dominates; it does not remove serial integration and can increase total tokens. Preserve mandatory final acceptance, but reuse test results only when the relevant code, toolchain, environment and test contract digests match. Missing telemetry is unknown, not zero cost.

## Concrete implementation order and acceptance

1. **Correct verification context, objective acceptance and shared execution policy.** Assert worker and integration gates receive the same story context and that rejection reasons survive in status/events. Test a new objective against an old green contract; it must not be accepted without an explicit relevant criterion binding. Preserve legitimate already-satisfied objective handling. Saturate a one-worker pool; assert goals and their planner wait. Exercise abort while queued, failure after acquisition and escalation. Assert no leaked permit and consistent selection in CLI/dashboard paths.
2. **Optional Codex native-goal adapter.** Test supported and unsupported schemas, persistent thread binding, independent-completion reconciliation, provider switches, objective revision mismatch and stale native state. Never require native Codex goals for Hermes or other providers.
3. **Budgets, pauses and recovery.** Test live token accounting, unknown usage, single-attempt overshoot reporting, elapsed-time limits during checks, user pause while active, restart after interruption and resumption without resetting measured consumption.
4. **Exploration and dashboard identity.** Persist mode/options and connect each bounded batch to its own verified goal. Test that a requested pause survives restart and dashboard resume preserves the chosen mode and documented deadline policy.
5. **Measured efficiency.** Run repeated real comparisons at equal accepted quality, model and effort. Include dependent tasks, independent tasks and a larger build/test workload. Report elapsed time, fresh/cached tokens, acceptance, retries and actual process-tree CPU/memory when measured. Decide lightweight/default policies from that evidence.

## Reproduce

Run from the validation branch after building Yoke:

```powershell
rtk npx vitest run tests/goals/command.test.ts tests/loop/resource-pool.test.ts
rtk proxy node bench/probe-goal-integration.mjs G:/NN-Developed/Yoke-Testground/goal-probe-NEW
rtk proxy node bench/probe-parallel-gate-context.mjs G:/NN-Developed/Yoke-Testground/parallel-probe-NEW
rtk proxy node bench/compare-codex.mjs --fixture=routing-queue --repeats=2 --root=G:/NN-Developed/Yoke-Testground/comparison-NEW
rtk proxy node bench/compare-codex.mjs --fixture=independent-utils --repeats=1 --root=G:/NN-Developed/Yoke-Testground/independent-NEW
```

Use a fresh output directory. The comparisons make authenticated model calls and permit changes inside disposable fixture projects. Routing is disabled and native multi-agent delegation is disabled in both arms. The Yoke parallel arm uses three Yoke workers. The original fixture tests are replayed after execution, so agent-modified tests do not define success. They remain visible to the agents; this is not hidden-test evaluation. User config is disabled, but the harness does not certify removal of every installed plugin or host-discovered skill. CPU and memory are not measured. Full logs remain in the local testground; summarized results accompany this report.

These runs share one Windows machine with other activity; background resource load was not controlled or measured. Small-sample elapsed times should not be generalized to all projects or treated as isolated CPU benchmarks.

The [authenticated comparison report](CODEX-COMPARISON-2026-09-29.md) contains timings, tokens, the failed parallel outcome and explicit sample limits. [Machine-readable probes](../bench/results/goal-integration-probes-2026-09-29.json) retain the mechanical findings and protocol results without private thread identifiers.

Provenance: AI assistance is disclosed above. Read-only scans found no supported provenance carrier or observable text-watermark signal and inspected the full text. Cryptographic verification, signer trust, and metadata privacy remain unknown for this text without supported verifier/trust inputs. Proprietary keyed watermark detectors were unavailable; absence of a signal is not evidence of human authorship. No authorship classification is made.
