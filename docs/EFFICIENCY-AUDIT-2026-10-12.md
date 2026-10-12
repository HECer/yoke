# Efficiency and reliability audit — 2026-10-12

Historical candidate audit supplied with the handoff. Its validation section records the original author's environment, not the current implementation status. See [the implementation report](EFFICIENCY-HANDOFF-2026-10-13.md) for corrections and current evidence. The original measurements remain unchanged. This work is unreleased against `56691e694874dbf1166b461e1994172567bf9a17` (1.25.0).

## Findings and changes

| Finding | Change | Boundary |
| --- | --- | --- |
| `feedbackPacket` can expand a failure instead of bounding it when reference markers exceed a small budget. Negative slice indices duplicate most of the original diagnostic. | Validate budgets; allocate nonnegative head/tail space; retain full source hash and only complete reference markers that fit. | Character budgets are not provider-token counts. Extremely long artifact paths may not fit; the source hash remains. Default callers use 2,400 characters; the amplification reproduction uses the supported custom budget of 256. |
| Historical retrieval fills its budget with unrelated sections, and prefix slicing can exclude the very passage that matched. | Keep stable project/glossary prefixes, select matching historical sections, retain a matching window in long secondary sections, and identify complete source files by hash. | Lexical retrieval is not semantic recall. Full source paths remain available. Binding objectives, invariants, criteria, and executable proofs are supplied separately and are not shortened by this change. |
| Output retention repeatedly concatenates, measures, and copies the whole retained log on every chunk. A zero limit accidentally retains all output. | A byte ring copies incoming bytes only, memoizes decoded snapshots, enforces a zero limit, and avoids starting a decoded tail on a UTF-8 continuation byte. | These are console-retention limits, not limits on total provider output, tokens, or process heap. Calling the snapshot getter after every append still entails snapshot work. |
| Telemetry retains an unbounded unfinished JSON line. Supervision drops an overflowing prefix and can misinterpret its suffix as a fresh error event. | Shared bounded NDJSON framing discards an oversized logical frame through its next newline. Telemetry gaps remain explicitly partial unless an authoritative cumulative result restores coverage. | Telemetry defaults to an 8 MiB logical-line limit; supervision uses 256 KiB. Oversized records may lose measurements, never turn unknown usage into measured zero. Step-based usage cannot recover lost steps from one subsequent step. |
| Claude assistant usage is treated as an invocation total; duplicate message snapshots and nested-agent reporting can distort accounting. | One parser for synchronous and streaming production readers; deduplicate message IDs; retain interrupted input/cache lower bounds; do not treat assistant output placeholders as complete output. Prefer final `modelUsage` for the complete agent tree and preserve missing fields. | Correct accounting can increase reported usage; it does not save already-spent tokens. Legacy public `parseClaudeStreamUsage` remains for compatibility; production readers use `parseProviderTelemetry`. Provider cost estimates are not invoices. |
| Already-cancelled calls may start a provider; observer or cleanup exceptions can leave completion unresolved; separate pipe decoding corrupts split Unicode. | Check cancellation before dispatch/input, validate retention before spawn, decode streams incrementally, guard post-spawn record setup, and settle completion with retained usage on observer/storage cleanup failures. | Existing process identity, termination confirmation, sandbox, and unknown-consumption policies remain. These guards do not promise recovery from every OS/storage failure. |
| Each model profile triggers the same CLI availability probe during routing setup. | Probe once per distinct provider during setup. | Admission still checks availability afresh before each actual call. No persistent cache, model-tier change, or automatic fallback expansion. |
| Every implementation worker is told to run the complete test suite, duplicating configured host checks. | Prompt focused TDD/acceptance feedback and assign configured independent verification and required gates to Yoke; request broader worker checks for cross-cutting changes, failures, or explicit criteria. | The host runs configured gates; the prompt cannot promise an unconfigured full suite. No independent verification, review, integration, completion, or protected gate is removed. |
| The workflow skill recommends repeatedly restarting after five iterations, contrary to the baseline's attached blocking-loop guidance. | Use one blocking invocation for the approved backlog; consume separate wait timeouts in host code rather than model turns. Explicit caps remain authoritative. | Do not reset budgets automatically, enable exploration, or dispatch nested agents. Existing project-generated skills require an intentional normal update to receive this text. |

Claude accounting follows the provider's [Agent SDK cost and usage guidance](https://platform.claude.com/docs/en/agent-sdk/cost-tracking): assistant message IDs can repeat, assistant output values can be placeholders, and final model-level accounting covers nested work. This implementation does not infer live prices or alter model selection.

## Measured local results

The reproducible benchmark is `bench/stream-efficiency.mjs`; raw measurements are in [measurements.json](benchmarks/2026-10-12-efficiency/measurements.json). It verifies the original Git blob identities before comparison. Environment: Linux x64, Node v22.16.0. Five warmed samples alternate baseline/candidate execution order. No provider is invoked.

| Fixture | Baseline | Candidate |
| --- | ---: | ---: |
| Retain the trailing 1 MiB while appending 4 MiB in 4 KiB chunks; median | 1,008.10 ms | 2.45 ms |
| Same fixture, observed range | 875.62–1,022.81 ms | 2.13–4.03 ms |
| 30,570-character feedback with a 256-character budget | 61,396 characters | 256 characters |
| 27,155-character context with no matching historical section | 6,000 characters | 168 characters |
| Explicit zero output-retention budget | 15 bytes retained | 0 bytes retained |

The buffer result is an isolated function measurement, **not a whole-Yoke speedup**. The context fixture exercises the standalone historical-retrieval API. Production worker/reviewer prompts preserve complete unclassified binding context, so this fixture does not measure production prompt savings. Characters are not measured tokens. Prompt changes require a real task comparison before claiming faster or cheaper accepted development.

Reproduce after installing project dependencies:

```sh
npm run build
node bench/stream-efficiency.mjs
```

The benchmark needs the exact base commit in local Git history. An optional argument points to a directory containing its original `src/agents/process-streams.ts` and `src/context/packet.ts`; Git blob identities are checked in both modes. No dependencies were added.

## Historical candidate validation and acceptance criteria

The supplied candidate contained 57 registered regression cases in seven test files. In its original environment, forty-two pure-module cases passed after TypeScript transpilation with Node's test runner/assertions. That environment lacked the complete project installation and network access; this was not a full TypeScript/Vitest check.

The other 15 candidate cases covered actual subprocess lifecycle, supervision/timers, worker prompts/workflow and routing initialization, and were unexecuted in the original environment. Its connector rejected a write, leaving an apply-checked patch/source overlay without a source commit, PR or candidate CI run. These statements are historical; current validation is recorded in the implementation report.

After applying and opening a PR, inspect the checks on the **exact PR head** for authoritative Linux/Windows × Node 20/24 lint, build, full tests, Canon validation, documentation consistency, dependency audit, and package dry-run results. A prior green base or local isolated test run is not approval of the final candidate.

The original candidate proposed 1,956 registered tests. Current README metadata is generated from current Vitest discovery. Package and Canon version remain 1.25.0: this is unreleased work.

Review requirements:

- Independent acceptance and protected checks remain mandatory; no test weakening or permission relaxation.
- Malformed/oversized/interrupted streams preserve uncertainty and cannot invent a zero-cost call.
- A record/observer failure must not strand an owned provider or silently discard measured usage.
- Review full-suite cross-platform results before merge; do not publish based only on this document.

## Why the visible token total can be misleading

The [historical 1.22 NEXUS analysis](benchmarks/2026-10-04-efficiency/ANALYSIS.md) records 28,094,098 cumulative input tokens, including 26,848,896 cache reads (95.57%). Its coordinator/observer accounts for 15,525,113 input tokens, but includes instrumentation, communication, setup, and independent checks. These are not measurements of this candidate, and cached tokens are not proven free.

That trace recorded 3,868.892 seconds of summed implementation intervals versus 74.024 seconds of separate verification phases. Removing all independent gates would therefore target neither the dominant observed interval nor the quality objective. Nested phases and concurrent intervals must not be added as if they were nonoverlapping wall time. Model calls, replayed context, tools, environment failures, and coordination should be attributed separately.

Yoke 1.25 already provides bounded references, `loop wait`, prepared assessments, durable attempt budgets, and opt-in exact pure-command reuse. This patch does not rebrand those existing features as new or enable them indiscriminately.

## Operational use without weakening quality

For an already configured project with an approved backlog:

```sh
yoke usage . --json
yoke tools-preflight . --json
yoke loop run . --isolate
```

Keep the run attached to its host. When a separate observer is genuinely necessary, `yoke loop wait . --timeout=60 --json` waits without making a model call. Its timeout exit code is 3: handle that in host code, not by paying a model to repeatedly inspect status. Respect explicit operator caps and blockers; do not treat a cap as permission to restart with a fresh budget.

Do not blindly choose a cheaper model, lower reasoning, increase workers, disable review, or enable `--explore`. The appropriate values depend on the real task, hardware, provider, acceptance contract, and measured first-pass success. This audit has not inspected the user's private per-project runtime configuration or authenticated provider sessions.

## Prioritized product improvements — not shipped here

1. **Measure cost per independently accepted change.** Expand existing usage reporting with explicit end-to-end phase attribution: controller, implementation, repair, independent review, tools, admission wait, and integration. Show fresh/cache/reasoning measurements with uncertainty; avoid double-counting parent/child calls and overlapping durations. Treat first-pass acceptance and regressions as co-primary metrics, not just tokens.
2. **Make the host own deterministic work.** Prefer native process/event handoff over model polling and repeated workflow activation. Expose actual tool readiness before implementation; a configured Code Intelligence facade is not proof that its backends are usable. Build on existing preflight and prepared-assessment features rather than adding another model-based supervisor.
3. **Tune policy against matched real tasks.** Compare baseline, candidate, and direct-provider runs on the same immutable acceptance oracle, model/reasoning, CLI version, permissions, tool availability, concurrency, and budgets. Separate package-cache warmth from provider caching; include every paid planning/repair/review attempt. Use multiple representative tasks and repetitions. Reject changes that reduce quality or merely move unmeasured work to the outer controller.

No authenticated live-provider comparison or release was performed as part of the local evidence above. Overall savings remain an empirical question, not a promised percentage.
