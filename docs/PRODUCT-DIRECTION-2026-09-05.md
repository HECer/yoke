# Yoke: Product status and discussion record

As of 2026-09-05. Based on repository analysis and the subsequent product discussion with the user.

This document preserves the session's main findings, proposals, and user preferences. Automatic claude-mem memory reported a failure; its storage was not assumed to have worked. This is neither implementation evidence nor an instruction to implement every proposal without asking. Check the current code and priorities before implementation.

## User intent and accepted direction

- Yoke should become more attractive compared with competitors and a developer tool used regularly.
- Codex, Claude, and Gemini should have functionally equivalent integrations. This neither promises equal model intelligence nor demonstrates it through measurement.
- The user welcomed the direction: verifiable acceptance, goals, resumption, and switching providers.
- Token consumption and development time should fall through deterministic tools, small/fast models, targeted escalation, and useful parallelism.
- New user idea: better time estimates for all tasks; improve the existing ETA.
- New user idea: a Yoke dashboard with an overview and detailed views for each project. Interest is recorded; scope and design have not yet been decided.
- The user explicitly requested that the entire discussion so far be preserved permanently.

## Initial review findings

Reviewed: Yoke 1.6.2, commit d066058. No product code changes or new authenticated model benchmarks during the analysis.

- Full suite: 1018 passed, 2 skipped, 1 test timeout out of 1021 tests.
- Affected: tests/loop/parallel-cli.integration.test.ts, test "does not integrate when the target rewinds during integrated gates". The full run exceeded the 5-second limit; a separate run with a 20-second limit passed in approximately 1.42 seconds of test time. This does not demonstrate an integration failure; investigate test instability.
- TypeScript checking and docs:check passed.
- Existing user changes were left untouched: .gitignore, .omo/, .playwright-mcp/, docs/community-outreach-2026-08-20.md, docs/launch-copy-2026-08-21.md.

### Strengths

- Mechanical verification commands and structured acceptance criteria; new default configurations require evidence for criteria.
- Shared canon with native skill packages and tool configuration for three providers.
- Dependencies, parallel workers, worktrees, locks, process monitoring, and an integration queue.
- Schema-validated reviews and an optional quality comparison with reversed candidate order and a consistency check.
- Explicit, versionable project context and local evidence; compact output with artifact references.
- Benchmark documentation identifies missing telemetry and failed runs.

### Specific gaps and limitations

1. Serial --isolate removes the worktree in finally even on failure; GitOps uses worktree remove --force. Unfinished changes can be lost. See src/loop/loop.ts and src/loop/git.ts.
2. Executed tests are not automatically independent acceptance tests: the implementer can change test files and test scripts in the examined path. Protected acceptance checks and controls against weakening tests are missing.
3. Reviews, audits, integrated final verification, and browser evidence are partly optional. README guarantees must distinguish between supported, enabled, and demonstrated capabilities.
4. flow-smoke checks page loading, errors, and optional selectors; it is not general evidence of multistep user flows.
5. repositoryFingerprint does not capture the contents of existing untracked files; it returns an empty string on Git errors. Additional controls on reviewer writes are therefore incomplete.
6. Routing uses broad cost tiers and success rates. Missing telemetry is partly aggregated as 0. Complete costs for controllers, workers, reviews, repairs, and candidates lack a reliable overall contract.
7. The design scan checks style traits such as purple/gradients; it is not general evidence of UX, accessibility, or AI authorship.
8. Existing benchmarks do not demonstrate general superiority over native agents or competitors.

### Provider parity

- Codex: skills, invocation policy, roles, JSON output, model/reasoning, RTK hook. A direct connection to native goal state is missing in the examined code. Adaptive routing deliberately disables native multi-agent functionality.
- Claude: skills, manual invocation control, streaming JSON, model/effort, RTK hook with platform conditions. Native structured output and team features are not used consistently.
- Gemini: native skills and slash commands are available. The adapter does not request stream-json even though parsing expects JSON events and reviews require reported model identity. Shared reasoning/bare options are not implemented accordingly. The installer's assumption that rewrite hooks are missing is outdated; BeforeTool supports argument changes.
- Use individual native provider features and map them to a shared result format; do not wait for identical APIs across all providers.
- Real contract cases per CLI/version/platform: implementation, review, output, model identity, telemetry, permissions, cancellation, resumption, and skill invocation.
- Checked locally: codex-cli 0.153.4, Claude Code 2.1.200, Gemini CLI 0.33.1. An available CLI does not demonstrate authentication or successful model task execution.

### Benchmark limitations

bench/RESULTS.md documents a Codex routing study with three comparison pairs. All hidden acceptance checks passed; the median was approximately 33.8% less runtime and 11% fewer fresh input tokens. The comparison is routing on/off within Yoke, not Yoke versus native Codex. Other architecture tasks remained SELF and incurred controller overhead. Do not promise general savings percentages.

## Product bet: Daily usefulness

Yoke answers: "Can I accept this change, and how do we finish it when findings remain open?"

Proposed positioning: a shared acceptance and continuation layer for coding agents. Native agents pursue goals; Yoke maintains verifiable project state, criteria, and acceptance. Avoid an unnecessary second orchestrator over native goals.

### Entry point: yoke check (proposal, not yet an implemented command)

- An existing repository, existing diff, and specific requirement are enough to start; a complete retrofit should not be a prerequisite.
- Output distinguishes passed, failed, and not verified.
- Prefer executable findings: test reproductions, browser flows, and contract violations rather than speculative review comments.
- Example demonstration: existing tests are green, Yoke reproduces a duplicate order caused by a double-click, and repair followed by repeated acceptance checks demonstrates the fix.
- Evidence is bound to the code state actually checked.
- Where appropriate, verify critical acceptance tests through targeted mutation: does the test detect the corresponding deliberately introduced defect?

### Resumption and switching providers

The handoff package contains the goal, criteria, patch/work in progress, environment, passed checks, open failures, rejected approaches, permissions, and remaining budget. Changes and evidence survive failures. Switching providers preserves verified state and does not require the user to explain it again.

Distinguish blockers: implementation failure, infrastructure/rate limit, missing credentials, or an actual product decision. Switching providers does not solve every blocker.

### Goal model

A shared goal state connects the PRD, criteria evidence, change inbox, budget, blockers, resumption, and integrated final verification. Integrate native Codex goals; do not infer guaranteed completion from model text alone. The model may choose the solution approach; binding acceptance conditions remain traceable.

### Target audience and differentiation

Proposed initial focus: developers and small teams with existing TypeScript web projects who already use coding agents. First make setup and acceptance reliable there.

Skills, autonomy, fresh context, and second opinions are not exclusive advantages. Current competitors: native Codex goals/subagents, Superpowers also with Codex/Gemini, gstack with Codex/QA/reviews, and GSD Core with multiple hosts and a phased workflow.

An advantage to build: robust project integration, reusable acceptance cases, reliable resumption, actual success data by task type, and useful PR reports. Team willingness to pay is an unconfirmed hypothesis.

Validation: ten suitable developers with real changes; measure time to a useful finding, reproducibility, false alarms, saved follow-up checking, and voluntary reuse.

## Token, cost, and speed strategy

Optimization target: cost and time per independently accepted change, including failed attempts and human rework. Treat token count, monetary costs, and waiting time separately.

1. Deterministic actions without a model: formatters/linters, AST/LSP renames, schema generators, log parsers, version synchronization, verified codemods, and symbol search. Check preconditions and postconditions.
2. Rules before a routing model: assign clear tasks without a controller call; let a model decide unclear cases.
3. Execution tiers: Tool / Fast / Standard / Strong. Risk, testability, scope, and observed results determine the choice; file count or model confidence is insufficient.
4. A cheap first attempt only for suitable tasks; acceptance checks, bounded repair, then escalation with the patch and failure evidence. Detect repeated failures. Optimize expected total cost including escalation.
5. Task-specific context packages: goal, criteria, symbols, contracts, tests, and relevant decisions. Retrieve further information as needed; do not copy parent history by default.
6. Reuse shared exploration/indexing and invalidate it by code state/file hash. Avoid four identical repository explorations by four workers.
7. Stable prompt prefixes, suitable model continuity, and measured cache hits. Caching does not automatically reduce logical context; do not assume cache transfer between providers. Distinguish CLI and API capabilities.
8. Parallelism based on dependencies, write areas, critical path, and resources. Interfaces first; independent implementation afterward. One shared limit for Yoke workers and native subagents.
9. Staged checks: fast deterministic checks, affected tests, integration, semantic review, and required full verification. Reuse results only when code/environment/configuration states match.
10. Batch small related tasks; use safe build/package caches and prepared environments. Keep mutable worker workspaces separate.
11. Later, consider direct model calls for narrowly bounded classification/transformation when CLI startup is disproportionate. Account for separate API billing.
12. Complete telemetry for all roles; never present unknown usage as a measured zero.

Proposed order: measurement, deterministic actions/router, context packages, escalation, improved scheduler, incremental checks, and cache optimization.

## Time estimates: A new focus

### Current code findings

src/loop/reporter.ts stores up to 50 story runtimes in .yoke/story-durations.json. ETA is the arithmetic mean of completed stories multiplied by the number of remaining stories. Current run durations replace older history after the first completion. Stored StoryDuration contains only storyId and ms. This formula does not account for individual task size, model, resources, or the parallel critical path. This statement concerns this ETA implementation; not every parallel view was measured separately.

### Proposed improvement

- Measure exact past durations; display future durations as estimates with uncertainty. Do not promise predictions accurate to the second.
- Record phases separately: queue, context/setup, implementation, tests, review, repair, and integration. Distinguish active execution time, waiting time, and human blockers.
- Record all attempts, including failures and cancellations; using only successful story durations would underestimate retry effort.
- Group comparable tasks by type, scope, test coverage, provider, actual model, effort, environment, and degree of parallelism. With limited data, use a robust shared baseline rather than excessively narrow groups.
- Weight history and new observations; one fast completion must not dominate the entire forecast.
- Initially use medians and empirical time ranges with sample counts; later use calibrated quantiles, such as P50/P80, when enough data is available. Measure target coverage and prediction errors.
- Calculate project ETA from remaining tasks, dependencies, free slots, integration bottlenecks, and resources; neither simply sum durations nor blindly divide by worker count.
- Update running tasks based on their current phase and elapsed time. Account for retry/repair probability and model changes.
- When the duration of a user decision is unknown: show "waiting for a decision" and conditional remaining runtime after resumption; do not invent a completion time.
- For a new task/model, clearly mark an unknown or weakly supported estimate; forecasting itself does not necessarily require an LLM call.
- Offer scenarios: time/cost with different parallelism or a different model. Label these as forecasts, not promised savings.

## Dashboard per project and across projects

Status: user interest; the following design is a proposal, not yet an approved implementation.

- Start locally, using the same data as the CLI. Initially provide registered project paths and a read-only overview; do not require a cloud account.
- Project overview: active goal, state, accepted/open criteria, running workers, blockers, time range to completion, measured usage, and telemetry gaps.
- Project detail: task list and dependency view, phases/timeline, critical path, current models, reviews, failure reproductions, artifacts, and integration status.
- Attention first: what needs a decision? Which test is blocking? Which project has been inactive, and since when? Why did the ETA change?
- Task detail: original/current estimate, actual phase durations, attempt history, patch, acceptance checks, costs, and handoffs.
- Later controls: pause/resume, answer a critical decision, switch providers at a safe transition, and change budget/parallelism. Reuse existing locks and safety boundaries; the UI must not have a second execution engine.
- Metrics: time/cost per accepted change, first-attempt success, escalation rate, rework, cache share, human interventions, prediction error, and time-range coverage.
- First create versioned events and complete measurement, then the dashboard. Existing loop-status.json, loop.log, story durations, and routing events are building blocks, but not yet a complete event history across projects.
- Telemetry is local by default; explicitly design external team/cloud functionality and its data scope later.

## Recommended product sequence

1. Stabilize failure handling and provider parity; complete events/usage/durations.
2. Develop a useful yoke-check entry point from review, verify, and smoke.
3. Protected acceptance checks, controlled repair, resumption, and switching providers.
4. Time forecasts and a read-only project dashboard on the same event foundation; targeted controls afterward.
5. Extend the shared goal model and team/CI reports; validate optimizations through comparison runs.

Not yet decided: UI technology, cloud hosting, API provider prices, specific model rankings, exact release scope, a binding schedule, a paid product, or complete implementation of all proposals.

## Sources and resumption

### Implementation status after authorization

The user subsequently gave the explicit instruction, "OK, implement everything meticulously and safely." Local implementation now includes independent checks, protected executable acceptance checks, persistent goals with provider switching and usage limits, safe serial worktree resumption, Gemini adapter corrections, events and empirical time ranges, fixed routing rules with escalation, model-free tool tasks, bounded context-specific prompts, declared write areas, and a local project dashboard. Operation and limitations: [VERIFIED-PROJECTS.md](VERIFIED-PROJECTS.md).

External user/competitor trials, authenticated model comparisons, reliable calibration of time forecasts, and commercial/cloud decisions remain open. Selective test reuse and web-based start/resume are deliberately not claimed capabilities of this local expansion. Quality checks run in full. The original product hypotheses remain documented as hypotheses.

Local anchors: src/agents/providers.ts, src/agents/telemetry.ts, src/retrofit/planners/, src/loop/loop.ts, src/loop/git.ts, src/loop/runner.ts, src/loop/reporter.ts, src/loop/scheduler.ts, src/routing/router.ts, src/routing/registry.ts, src/context/context.ts, src/smoke/command.ts, src/scan/design.ts, bench/RESULTS.md.

Primary sources read on 2026-09-05; check again before specific version/price decisions:

- https://learn.chatgpt.com/use-cases/follow-goals
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://developers.openai.com/api/docs/guides/latency-optimization
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/agent-teams
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/hooks/reference/
- https://ai.google.dev/gemini-api/docs/caching
- https://github.com/obra/superpowers
- https://github.com/garrytan/gstack
- https://github.com/open-gsd/gsd-core

Provenance of the original README review: no C2PA found, supported scan complete, verification/trust/metadata privacy unknown. Unicode finding: emoji variation selectors, not evidence of an AI watermark. Proprietary watermarks could not be verified. The AI assistant summarized this discussion document from the session; it contains no independent confirmation of the product hypotheses.

## Continuation on 2026-09-06: Defaults and dashboard

The user commissioned the combined implementation of automatic routing/parallelism and the three dashboard views Now, Usage & Time, and Results. The changes exist locally as an unpublished expansion; the package version and last published release remain 1.7.0.

Implemented: routing in the asynchronous worker path; new setups with routing on, parallelism auto, and isolation on; a conservative maximum of two Yoke workers with declared write areas; respect for explicit settings; persistent measurement history separate from the short activity list; daily/weekly/monthly analysis in UTC; model and project comparison; usage chart; current tasks and phases; acceptance checks and effort per acceptance check. Available reviewer, critic, and repair usage is also recorded. Details and limitations are in VERIFIED-PROJECTS.md.

Still not claimed capabilities: dynamically sharing slots with native subagents (native delegation is disabled for loop invocations across all three providers), exact generation speed, complete reconstruction of old usage data, automatic monthly archive compaction, or calibrated time forecasts. Existing quality repair limits remain; competing candidates remain optional.

The implementation was verified through tests and a local browser check; authenticated model benchmarks and publication were not part of this continuation. The AI assistant recorded this update from the ongoing implementation.

### Release instruction on 2026-09-06

The user subsequently requested a maximum of three workers in automatic mode and publication of the development. The release target is 1.8.0; this supersedes the earlier local intermediate state with two workers. Every new version must have a dated changelog entry before publication; the binding rule is in AGENTS.md. Actual publication status is verified through GitHub Release and npm.

## Task-specific model selection after release 1.8.0

The user explicitly commissioned implementation of the proposed capability selection: planning with the starting model, stored task assessment, model/effort profiles for Codex, Claude, and Gemini, bounded repair/escalation, and a traceable dashboard display. The implementation is being developed locally after 1.8.0. Behavior, migration, and limitations are in CAPABILITY-ROUTING.md; this must not be confused with the published 1.8.0 defaults.

### Release instruction for 1.9.0

The user explicitly requested publication of the capability routing expansion. The release target is 1.9.0. The dated changelog and CAPABILITY-ROUTING.md describe behavior, migration, and limitations; earlier references to the local intermediate state remain historical session notes.

## Dashboard use on 2026-09-06 after release 1.9.0

The user commissioned complete further development of the dashboard through actual use of the latest Yoke version with routing. The globally installed version 1.9.0 was verified and used with capability routing in the separate checkout `G:/NN-Developed/Yoke-dashboard`; the related UI task was routed based on its stored assessment to `codex-strong` / `gpt-5.6-sol` with high reasoning effort. A single serial assignment avoids competing changes to the same frontend navigation; the general automatic maximum remains three workers.

The local expansion adds priority for blocked/running loop status even when the goal is complete, labeling of stale reports, project search and status filters, current task and blockers on project cards, restorable URL views and UTC periods, cancellable project comparisons with at most three concurrent requests, and previous-period comparisons with visible measurement gaps. Using Yoke also uncovered failures in handling Git runtime files; status/locks are excluded, and implementation files are safely staged even in ignored history folders. Operation and limitations: [DASHBOARD-EVOLUTION.md](DASHBOARD-EVOLUTION.md).

Independent browser checks used synthetic projects against the real local HTTP server, including mobile rendering, history navigation, and delayed responses. This assignment covers local development; a new package version or publication was not commissioned. No model benchmark, calculated cost savings, or reconstruction of unknown usage data is claimed. The AI assistant created this session note.

## Batch planning after 1.9.0 on 2026-09-06

The user commissioned the next expansion: fully prepared task packages, separate planning/execution models, bounded fallback, and targeted reassessment of changed contracts. Locally implemented: prd assess, assessmentFor bindings including dependencies/plan, planning settings, and routing boundaries. New setups require prepared assessments and block missing profiles; existing configurations remain compatible. An actual Yoke run checked the batch commands with a worker routed to Terra. Details, measurements, and limitations: [BATCH-PLANNING-VALIDATION.md](BATCH-PLANNING-VALIDATION.md).

The additional Windows runner handoff was read, issue #5 reviewed, and a partial correction to infrastructure classification with bounded cancellation added. Sandbox preflight and further process supervision explicitly remain open; no reproduction or resolution of the original Windows cause is claimed. No new version was published. The AI assistant created this note.

## Complete runner follow-up instruction on 2026-09-06

Issue #5 was addressed further at the user's explicit request. The Store PowerShell failure was reproduced without a model using the exact error code; native PowerShell passed the same sandbox test. The local expansion checks shell startup before the model, removes unsuitable Store aliases only from the provider environment, uses argv-safe Windows launches, and monitors runtime, output, successful tool progress, and process identity separately. An actual Yoke run with Luna, routing, and safe isolation completed successfully after 3m8s, including acceptance tests and commit integration. Record, limitations, and configuration: [WINDOWS-RUNNER-VALIDATION.md](WINDOWS-RUNNER-VALIDATION.md). The old DeviceLane instance was not changed; publication or retrospective instrumentation is not claimed. The AI assistant created this note.
