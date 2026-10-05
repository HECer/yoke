# Changelog

## 1.25.0 — 2026-10-05

### Added
- Add model-free `yoke loop wait` with terminal/change conditions, bounded JSON, semantic cursors, timeout and cancellation.
- Bind new drafts to their original objective with host-written story markers and a requirements/invariant ledger. Require executable coverage references and ordered shared-file ownership. Reject missing, rewritten or stale contracts.
- Add opt-in `verify.reusableCommands` for operator-approved pure criterion commands within one loop invocation. Identity covers local ignored inputs, source, contracts, environment, installed tools and runtime. Full verification, integration and completion remain fresh.
- Retain measured fresh/cached input and reasoning subsets with unknown/partial evidence explicit; account for provider-specific input semantics. Add a synthetic host regression benchmark.

### Fixed
- Prepare absolute child cwd and Windows PATH without changing parent environment or permissions. Validate provider/watchdog prerequisites before model start; propagate structured failure evidence through synchronous and asynchronous launches.
- Separate bounded infrastructure restarts from semantic attempts only when pre-model execution and complete zero usage/cost are proved. Unknown, interrupted and post-model calls remain charged; retain durable history.
- Bound secondary planning references and repair feedback while preserving binding criteria, objectives, invariants, ownership and artifact references. Review instructions cover preserved behavior, boundaries, state transitions and test adequacy.
- Request the smallest coherent decomposition rather than a minimum of five stories. Protect planning contracts against isolated worker changes and invalidate stale assessments.
- Keep registered test counts consistent across platforms during release metadata discovery while preserving normal Windows-only execution.
- Reject retained isolated worktrees with changed planning contracts before resuming implementation, including parallel recovery after parent HEAD advances.
- Preserve textual planning contracts across LF/CRLF checkout conversion on Windows while rejecting substantive contract changes.

### Migration and limits
- Legacy unbound PRDs remain supported. New drafts must retain `.yoke/requirements.yaml`, `.yoke/plan.md` and story `requirementsFor` markers. Forced host-authorized redrafting can establish a new objective; ordinary workers cannot. Change intake blocks active-ledger extensions until coverage can be safely updated.
- Criterion reuse is disabled by default. Allow only commands without side effects, network, time dependencies or external state. Linked, unavailable or oversized local identities disable reuse. Hashing can cost more than a short check.
- `loop wait --timeout` uses seconds; `loop run --timeout` retains minutes. Wait exit codes are changed 0, timeout 3 and error 1. The API returns `outcome: 'cancelled'`; the CLI maps that result to 130. It observes the currently stored loop, including an existing terminal state.
- Mechanical coverage does not prove semantic completeness. No real-project token, time or cost reduction is claimed. See [validation and remaining work](docs/YOKE-1.25-VALIDATION.md).

## 1.24.0 — 2026-10-04

### Added
- Give the full-repository benchmark its own npm dependency installation and input-bound readiness receipts. Record setup duration and structured installer failures; stop before model dispatch when setup fails.
- Record durable, deduplicated failure observations at production execution, verification, completion and recovery boundaries, including failures without an active story attempt. Preserve unknown causes instead of inferring them from arbitrary messages or exit codes.

### Validation and limits
- Recheck the populated NEXUS desktop on Windows using project-local dependencies and immutable original assertions. Keep the original project untouched.
- Record three fresh-download-cache/warm-download-cache setup pairs and controlled ChatGPT-authenticated Codex CLI version samples. Download-cache warmth is separate from provider caching; prices and unobserved approval waits remain unknown.
- Dependency setup belongs to the benchmark, not Yoke core. Readiness receipts bind setup inputs and invocation, not the integrity of every installed byte. Independent code and measurement reviews passed; no general speed, token or cost improvement is claimed.

## 1.23.0 — 2026-10-04

### Added
- Add read-only `yoke tools-preflight` and bounded local `yoke usage` reports. Separate configured tools from available capabilities, recorded usage from unknown coverage, and overlapping worker time from summed process durations.
- Retain immutable hashed runtime proofs before isolated candidate cleanup, with source, configuration and environment bindings. Preserve candidates when transfer or validation fails.
- Add optional `smoke.sourceIdentity: { path, sha256 }` configuration; production browser smoke now requires it and verifies served bytes before launch and after journeys.

### Fixed
- Make setup/retrofit help read-only and reject unknown or contradictory mutating flags before dispatch while preserving recovery options.
- Ignore supervision runtime files, diagnose already tracked copies, render actual parallel workers and integration states, and stop reporting success merely when an integrator becomes idle.
- Preserve redacted browser launch causes instead of reporting every failure as a missing package. Keep OAuth, authorization and configured form secrets out of diagnostics.
- Migrate Yoke-owned Codex RTK hooks to the native protocol without deleting foreign hooks; honor configured Code Intelligence workspace identifiers and await MCP shutdown before temporary directory cleanup.
- Validate actual candidate writes and sibling collisions before and after integration gates. Reject shared writable worktree runtime caches and completion commands that change source or final assets.
- Preserve partial/missing usage markers through routing and include recorded serial implementation durations without counting parent/child usage twice.

### Migration and validation limits
- Existing browser smoke projects must pin an app-specific served source path and its lowercase SHA-256. Update the pin intentionally after source changes; a static byte pin establishes response identity, not an independent deployment attestation.
- Shared package download stores remain allowed. Worktrees need their own `node_modules` root and writable `.vite-temp`, `.vite` and `.cache` directories. The guard covers these conventional roots, not arbitrary application-defined cache paths or concurrent changes after inspection.
- No dependency installer or retry policy was added: Yoke does not own one. Full-product model speed/cost and genuine npm/provider cold/warm cache comparisons remain unmeasured. The paired help experiment is a local regression check only.
- See the [analysis](docs/benchmarks/2026-10-04-efficiency/ANALYSIS.md) and [validation record](docs/RELEASE-VALIDATION-1.23.0.md). Version metadata is prepared locally; publication requires independent review and release gates, followed by verified CI/npm evidence.

## 1.22.0 — 2026-10-03

### Added
- Add durable routing attempt reservations independent of optional analytics retention, per-call goal admission and persistent consumption accounting, including planning and interrupted calls.
- Add optional evidence-based economic ranking inside capability routing. Cost, speed and balanced objectives require comparable, complete execution evidence; configured capability floors and fallback limits remain authoritative.
- Add `yoke goal assess` to prepare a bound goal contract explicitly, and record versioned provenance for setup model profiles as configuration priors rather than measured price or capability claims.
- Add compact persistent failure signatures: repeated unchanged failures request diagnosis and then stop instead of exhausting repeated identical turns. Completion failures carry typed reasons into repair planning.
- Add optional multi-step browser journeys and structured proof reports. Project checks can bind declared artifacts and journeys to an acceptance digest, source fingerprint, runtime environment and individual requirement results.
- Add versioned direct-Codex benchmark manifests containing actual source/build, fixture, acceptance, model and startup-policy provenance. Only compatible verified pairs contribute to comparisons; legacy data remains diagnostic.

### Fixed
- Retain incomplete parallel work across failure, pause and decision boundaries, including unsuccessful candidate races, and resume implementation separately from already prepared integration candidates.
- Honor ambiguity aborts consistently in serial and parallel execution. Reuse successful gates only on unchanged source, task and gate inputs; rerun them after relevant changes and integration.
- Prevent exhausted routing budgets from resetting after statistics eviction or failed registry writes. Preserve the cost of planning even when routing blocks before implementation.
- Preserve known partial provider usage without converting unknown calls to zero-cost work or discarding measured worker usage. Record PRD drafting, decomposition and change-planning/coverage calls on success and failure.
- Apply goal assessment policy and routing rules, reset provider-specific defaults when changing runners, and separate historic native Codex bindings from the currently executing provider.
- Correct Code Intelligence reference edges, report unverified index freshness and traversal coverage honestly, and enforce shared request deadlines and bounded UTF-8 responses including evidence metadata.
- Synchronize package, lockfile, Canon, provider manifests and README release metadata.

### Migration and validation limits
- Existing configurations retain their routing ranking unless `routing.optimization` is added. New setup configurations select `balanced` with a minimum of 20 comparable samples per candidate; insufficient or incomplete evidence keeps the conservative order. Profile tiers and `costTier` are configuration priors, not live provider prices.
- Goal token ceilings are checked before each additional call. A provider reporting only at call completion can still exceed a ceiling within that call; the overrun is retained and prevents further budgeted dispatch. Unknown interrupted consumption requires an explicit budget decision.
- Retained work consumes disk space until successful integration or explicit reviewed cleanup. Candidate recovery resumes the first retained alternative; additional alternatives remain available for inspection and cleanup. Custom lifecycles without `retain` keep their existing cleanup policy. Interrupted attempts remain spent budget and are excluded from model-quality comparisons; recovery does not invent missing accounting history.
- Delivery declarations map project-authored commands to artifacts and journeys. Hashes compare pre-check and post-check artifact content; they do not detect changes reverted between snapshots or independently prove that a command exercised a particular device or deployment. Artifact snapshots are limited to 512 MiB per file, 1 GiB total and 10 seconds per snapshot. Build artifacts before `yoke check`; inspect and explicitly refresh protected acceptance after intentional manifest changes.
- Code Intelligence token budgets use a documented conservative UTF-8 estimate, not provider-measured token counts. A tiny budget can only return a bounded `BUDGET_EXCEEDED` error envelope; backend freshness stays unknown without independent index evidence.
- This release uses deterministic regression and packaging checks. No new paid model benchmark or general speed/cost improvement is claimed; see the [validation record](docs/RELEASE-VALIDATION-1.22.0.md).

## 1.21.1 — 2026-10-03

### Fixed
- Fix runner model and reasoning effort inheritance in `yoke setup` when switching runners: changing from Codex to another agent no longer leaks stale model or reasoning effort.
- Fix RTK hook planning condition in Claude retrofit planner on non-Windows/WSL environments.

## 1.21.0 — 2026-10-03

### Added
- Add first-class git worktree management commands: `yoke worktrees list [dir] [--all]` and `yoke worktrees prune [dir] [--all] [--force]` to discover, unregister, and safely prune orphaned, dead, or retained worktrees across a single repository or the entire registered fleet.
- Add `--clean-worktrees` flag to `yoke retrofit` and `yoke setup` to automatically prune dead story worktrees during project updates.
- Add user-configurable, per-agent model and reasoning effort selection in `yoke retrofit` and `yoke setup` (`--runner-model=<model>`, `--runner-reasoning=<effort>`, `--model=<agent>:<model>`, `--reasoning=<agent>:<effort>`, and interactive `--configure-models`). Reasoning effort is never forced or hardcoded during a retrofit unless explicitly chosen.
- Add compact zero-token loop status mode (`yoke loop status [dir] --compact`) returning a single-line summary (`state=... story=... progress=... phase=... updated=...`) to avoid burning thousands of replay tokens when agents check loop progress.
- Add native Windows RTK hook detection (`rtk.exe` on PATH or `%USERPROFILE%\.local\bin\rtk.exe`) in Claude retrofit planner without requiring WSL.

### Fixed
- Prevent exponential worktree accumulation in `.yoke/worktrees` and git metadata from consuming system disk space and causing IDE/runner OOM crashes.
- Make interactive question parser null-safe against empty inputs or aborted prompts.

## 1.20.0 — 2026-09-30

### Added
- Add explicit goal-to-acceptance binding with `goal set --criteria=...` and `goal bind --criteria=...`; preserve the objective and manifest digest across continuation.
- Add opt-in native Codex goal threads through `goal run --native-goal` or `goals.nativeCodex`. Yoke pauses native automatic continuation, runs explicit bounded turns, and synchronizes completion only after independent acceptance.
- Add cumulative `goal set|budget --wall-minutes=N` and a separate shared asynchronous goal-check pool, controlled by `YOKE_MAX_PARALLEL_CHECKS` (1–8, default 1).
- Add reproducible direct-Codex comparison tooling, deterministic resource/goal probes and dated evidence reports.

### Fixed
- Preserve story context through integrated verification, design, performance, audit and quality gates, and restore it after exceptions.
- Retain rejected parallel candidates and exact rejection reasons; validate recovery before rerunning integration gates without another implementation model call.
- Shorten generated worktree names and reject unsupported Windows paths before setup.
- Exclude active claims and nested worker worktrees from cleanliness checks and implementation staging even in manually configured projects without generated ignore rules.
- Admit goal implementation and routing calls through the shared worker pool, disable unmanaged native delegation, inherit runner defaults, and report measured token overruns even when acceptance passes.
- Account for all model requests in a native turn using durable cumulative usage baselines; react to valid streamed usage with budget cancellation without double-counting progress frames.
- Persist safe run identity, execution mode, selection and consumed iteration budget; dashboard resume selects that run rather than an unrelated unfinished goal.
- Preserve absolute exploration deadlines on dashboard resume and retain exclusive supervisor ownership between batches and during idle waits.

### Migration and validation limits
- Existing unbound goals now stop before execution. Review the acceptance contract, then run `yoke goal bind . --criteria=<ids>`. Binding retains previous attempts and does not refresh protected infrastructure.
- Goal `--minutes` remains cumulative admitted provider time; `--wall-minutes` also includes admission and verification. Providers with end-of-call telemetry can exceed token ceilings within a call; Yoke records the overrun and blocks further budgeted work. Unknown interrupted usage remains conservative.
- Native goals remain disabled by default and depend on installed Codex app-server capabilities. Unsupported goal methods fall back to ordinary Codex; other protocol/authentication failures remain visible. Native goal accounting and Yoke token totals can use different units.
- Native Codex app-server lacks exec's bare startup control. Native plus bare stops before dispatch; use `--no-native-goal` to keep bare execution or explicitly disable bare when opting into native goals.
- The new check pool covers asynchronous goal checks. Synchronous `yoke check` and story gates keep their existing execution contracts. Concurrency permits do not enforce CPU/RAM quotas or demonstrate general savings over direct Codex.
- Resume through the dashboard retains the original exploration deadline. An explicit fresh CLI invocation can establish a new duration. Parallel recovery requires a validated unchanged contract; stale candidates need reconciliation. Serial `--resume-worktree` does not adopt parallel candidates.
- Local Windows validation on Node.js 24.13.0 passed: lint, build, Canon validation, README metadata, package dry-run, dependency audit (0 vulnerabilities), and 1,418 tests across 155 files (2 skipped). Authenticated parallel validation accepted 3/3 stories with 15/15 immutable tests; a native goal completed and resumed with cumulative usage accounting. These small fixtures do not establish general efficiency superiority; live small-budget native cancellation and the cross-platform CI matrix remain unverified. See [release preparation](docs/RELEASE-VALIDATION-1.20.0.md). No publication is implied by this entry.

## 1.19.0 — 2026-09-28

### Added
- Add optional, per-project SoL-Pi controls for Pi, including dashboard settings and temporary configuration for each opted-in invocation. SoL-Pi remains disabled by default and is pinned to a reviewed upstream commit.

### Fixed
- Write SoL-Pi options to its project-local `.pi/sol-pi.json` configuration path and restore the prior file after each invocation, so enabled mechanisms are read by the extension.
- Map Hermes reasoning selection to the CLI's `--reasoning` option.
- Normalize federated Code Intelligence stdio evidence across adapters and the coordinator.

### Changed
- Replace the long README with a concise feature overview, a workflow diagram, a quick start and links to detailed guides.
- Raise test-only child-process and Windows integration timeouts to reduce false failures under host load; production timeout defaults are unchanged.

### Migration and validation limits
- SoL-Pi's pinned upstream lists Node.js 22.19+ and `@earendil-works/pi-coding-agent@0.84.2` as its tested baseline. Yoke checks Node.js but does not enforce the Pi version; other releases are unverified. Pi project trust may be required. Yoke does not install Pi, grant trust, or configure provider credentials. SoL-Pi remains opt-in, and the upstream paper results are not a savings guarantee for a Yoke project.
- Continuous exploration and parallel workers remain independently opt-in/configurable; see the [continuous exploration](docs/CONTINUOUS-EXPLORATION.md) and [parallel execution](docs/parallel-execution.md) guides for safe-boundary and resource limits.
- Local release checks on Windows with Node.js 24.13.0 passed: lint, build, canon, README metadata, npm audit (0 vulnerabilities), package dry-run, and 1,337 tests (2 skipped). The GitHub Node 20/24 Linux/Windows CI matrix remains the cross-platform release gate.

## 1.18.0 — 2026-09-27

### Added
- Add opt-in continuous exploration with evidence-filtered task discovery, validated PRD additions, isolated implementation, bounded history compaction, automatic provider recovery, stop detection, and `yoke loop pause`.
- Add optional `--explore-limit=<Nh|Nd|Nw>` durations. Exploration remains unbounded when omitted; when the limit expires, Yoke stops launching work and pauses after active workers finish their normal gates and integration.

### Changed
- Keep exploration status and narrative focused on newly accepted work, the next planned action, provider recovery, and safe stop state.
- Process finite-duration runs in bounded task batches so the supervisor can honor the deadline while retaining configured parallel workers.

### Migration and validation limits
- Exploration is opt-in and requires isolated story worktrees. Use `--explore-limit=12h`, `3d`, or `2w` to bound one invocation; expiry exits with code `3`, and a later resume starts a new duration. Without a limit or a user pause, it continues while the process and machine remain available.
- Auto-discovered work is limited to repository-evidenced proposals that pass confidence, risk, write-scope, acceptance-criteria and criterion-test checks. This does not guarantee project maturity or model quality; provider credentials, configured gates and machine availability still determine progress.
- A time limit does not interrupt an active story or integration. Active work finishes through the normal gates before the loop stops, so wall-clock completion can exceed the requested duration by the time needed for that safe boundary.

## 1.17.0 — 2026-09-27

### Added
- Coordinate weighted worker reservations across concurrent Yoke projects under a user-local pool. The default is three units, `YOKE_MAX_PARALLEL_WORKERS` accepts 1–8, and candidate races consume one unit per simultaneous candidate.
- Add `yoke prd decompose --story=<id>` as a preview-first planner for splitting eligible stories into two independently scheduled children; `--apply` atomically replaces the parent and rewrites downstream dependencies after hash and schema checks.
- Report shared capacity and resource waits in loop status and the dashboard. Record integration queue wait and duration, and forecast dependency-aware implementation work alongside a serialized integration lane.
- Add a deterministic local dispatcher benchmark matrix for dependency chains, independent scopes and conflicting scopes.

### Changed
- Separate implementation slots from each project's integration queue. A completed candidate frees its implementation slot while retaining collision areas and write scopes through rebase, integrated-tree gates, commit and cleanup.
- Keep single-worker runs on the serial path and reserve a shared unit around each agent invocation; use the dispatcher for multiple workers and competing candidate runs.
- Cap explicit and configured per-project concurrency at eight. Automatic concurrency remains conservative and is now bounded by the shared cross-project limit.

### Fixed
- Release the shared claim-operation lease when pool-state parsing throws, so corrupt records fail closed without leaving later pool access stuck behind a leaked lock.

### Migration and validation limits
- Existing `loop.parallel` values above 8 must be lowered. The default shared cap can queue previously simultaneous project loops; set `YOKE_MAX_PARALLEL_WORKERS` to 1–8 for the desired user-level ceiling. Existing active workers are not cancelled when the cap is lowered.
- Decomposition requires at least four structured criteria, at least two non-overlapping write scopes and no shared area. Child assessments/quality declarations need task-specific refresh; write scopes remain advisory.
- Synthetic benchmark results use fixed local delays and make no model quality, token or provider-cost claims. Local release checks: 1,296 tests passed, two skipped across 143 files; lint/build, docs checks, package dry run, Canon validation and dependency audit passed.

## 1.16.0 — 2026-09-17

### Added
- Add first-class adapter support for Nous Research's Hermes Agent (`hermes` CLI) as the eighth supported harness.
- Add non-interactive execution for Hermes via `hermes chat --format stream-json --query-file -`.
- Map permission profiles to Hermes toolset flags: `safe` to `--toolsets file,terminal`, `read-only` to `--toolsets file`, and `unsafe` to `--yolo`.
- Add telemetry extraction for Hermes `stream-json` streams: assistant text deltas, token usage (`input`, `output`, `cache_read`, `cache_write`), total cost USD, and active model identities.
- Recognize successful Hermes `tool_result` events as watchdog progress activity.
- Add Hermes project marker detection (`.hermes`, `HERMES.md`, `hermes.yaml`, `hermes.json`) and host environment marker detection (`HERMES_SESSION_ID`, `HERMES_CONFIG`, `HERMES_HOME`).
- Add Hermes retrofit planner generating complete skill packages under `.hermes/skills/`, shared `AGENTS.md` instructions, and a read-only reviewer agent (`.hermes/agents/yoke-reviewer.md`).
- Add `hermes` to setup CLI options, routing worker presets (`hermes-standard`), fallback review providers, and runner affinity validation.
- Add Hermes integration documentation in `docs/HARNESSES.md`.

### Changed
- Update README, package metadata, and manifests to reflect eight supported harnesses across invocation, routing, and retrofit architecture.
- Synchronize Claude plugin, Codex plugin, Gemini extension, Canon, and npm package versions to 1.16.0.

### Migration and validation limits
- Run `yoke retrofit . --agent=hermes` or `yoke retrofit . --agent=all` to install native Hermes artifacts. External `hermes` CLI must be installed and configured separately; Yoke does not bundle runtimes or credentials.
- Hermes runner does not support bare startup mode or native multi-agent delegation; Yoke enforces managed worker and single-flight execution boundaries.
- Local verification: 1,285 tests passed, two platform-specific tests skipped, 141 test files passed; TypeScript lint/build, Canon validation, documentation metadata check, package dry run, and dependency audit passed.

## 1.15.1 — 2026-09-16

### Fixed
- Sum finalized Pi assistant-turn usage without counting streamed snapshots or replayed transcripts twice; preserve missing measurements and multiple model identities.
- Recognize successful Pi/OpenCode/Kilo tool events as watchdog progress without relaxing execution budgets.
- Reject structured verdicts followed by terminal provider errors, reject errored/aborted Pi verdicts, and exclude Claude child-agent verdicts/usage from parent results.
- Validate OpenCode/Kilo effort aliases consistently; emit a single variant flag.
- Correct Pi settings-relative skill discovery and enforce manual-only skill invocation using Pi's native frontmatter.
- Estimate schedule ranges from per-story scenarios and retain low confidence for sparse task-specific evidence.
- Ship eight missing delegation/review/debugging/testing resources and clarify host capability, worker-budget and verification rules in the shared skills; remove unsupported quality/speed claims.
- Keep coordinator unit tests offline by stubbing the separate preview backend; verify actual isolated edits and preservation of the source project.
- Synchronize previously stale Claude/Codex plugin, Gemini extension and Canon versions with the npm package.

### Migration and validation limits
- Refresh generated skills with a reviewed `yoke retrofit . --agent=all` (or the selected agent). Current Pi requires explicit project trust to load project-local resources; Yoke does not grant it automatically. See [harness setup](docs/HARNESSES.md).
- Existing custom configuration remains authoritative. No timeout or acceptance-gate defaults were weakened. Time ranges remain empirical, not guaranteed deadlines.
- See the [audit and validation limits](docs/AGENT-HARDENING-2026-09-16.md). No authenticated seven-agent benchmark or guaranteed speed/quality improvement is claimed.
- Local verification: 1,281 tests passed, two platform-specific tests skipped; TypeScript lint/build, Canon validation, documentation metadata, package dry run and dependency audit passed.

## 1.15.0 — 2026-09-09

### Added
- Add opt-in federated Code Intelligence that composes Graft, Graphify and Serena behind one Yoke-controlled MCP facade with six stable tools for context, symbols, traces, impact and edit workflows.
- Add pinned backend adapters, explicit coverage/provenance/freshness evidence, content-addressed workspace snapshots and bounded local policy checks.
- Add isolated edit previews and guarded apply transactions with approval, snapshot freshness, exclusive locking and idempotency checks; Yoke's existing review, verify and commit gates remain authoritative.

### Changed
- Add `off`, `shadow` and `active` Code Intelligence modes to setup and retrofit. `off` preserves the legacy `codeGraph` path unchanged; `shadow` is read-only; `active` enables preview and approved edits.
- Keep backend runtimes external and configurable instead of vendoring or silently installing them. Pin the validated integration targets to Graft `0.17.0`, Graphify `0.9.56` and Serena `1.7.1-dev`.
- Add the [Code Intelligence guide](docs/CODE-INTELLIGENCE.md), including setup, backend requirements, safety boundaries, limitations and the Pi integration note.

### Migration and validation limits
- No migration is required. Existing projects remain on the legacy path until `yoke setup` or `yoke retrofit` is run with `--code-intelligence=shadow` or `--code-intelligence=active`.
- Validated with the Code Intelligence contract/coordinator/snapshot/MCP tests, TypeScript lint/build, documentation metadata, package dry run and the facade MCP handshake. The full suite retains one pre-existing provider-process timing failure; it is reproduced independently and is not caused by this release.
- This release does not claim that every language or backend is available in every environment. Backend failures are surfaced as partial coverage or an explicit unavailable capability, never silently treated as complete evidence.

## 1.14.0 — 2026-09-09

### Added
- Add a local-first workspace control room that ranks registered projects by attention, activity, recorded tokens, reported cost, acceptance, or name, with composable search, status filters, UTC scopes, and restorable view links.
- Add workspace and project analytics with time buckets, token/call/duration/outcome summaries, provider/model/agent/role/phase/run rankings, usage comparisons, and visible measurement coverage.
- Add project live operations for task and phase state, worker metadata, bounded event timelines, safe-boundary pause/resume, append-only operator notes, and queued change requests.
- Add a responsive dashboard shell with dark/light themes, keyboard and reduced-motion support, explicit loading/empty/error/stale states, and readable narrow-screen navigation.

### Changed
- Base dashboard views on durable local history and versioned events while keeping unknown, partial, corrupt, unavailable, and stale telemetry explicit instead of treating it as zero.
- Keep dashboard controls on the existing loop/goal runner and lock boundaries; browser requests remain typed, same-origin, loopback-only, and unable to execute arbitrary shell commands.

### Fixed
- Scope dashboard loop verification to the intended local project and retain focused coverage for dashboard authorization, path safety, partial history, concurrency, navigation, and control behavior.
- Improve light-theme contrast for the active navigation state and keep long project names inside desktop and mobile navigation areas.

### Migration and validation limits
- No migration is required. Start the local view with `yoke dashboard --no-register`, then register projects with `yoke projects add <path>` as needed. Existing dashboard settings remain local and authoritative.
- Validated with the dashboard tests, TypeScript lint/build, canonical manifest validation, release metadata checks, package dry run, and real local browser screenshots at desktop and mobile sizes.
- Dashboard data is limited to explicitly registered local projects and retained local telemetry. It does not provide remote multi-user access, reconstruct missing history, prove requested models were used, or execute arbitrary browser-supplied commands. Pause/resume operates only at existing safe loop/goal boundaries.
- This release targets npm package 1.14.0; npm publication is triggered by the matching published GitHub release and verified separately.

## 1.13.0 — 2026-09-08

### Added
- Add first-class OpenCode, Kilo and Pi coding-agent adapters across setup, retrofit, loop execution, reviews, quality critics/repairs, goals, PRD affinity and adaptive routing.
- Generate idiomatic OpenCode/Kilo skill packages, `AGENTS.md` instructions, merged MCP config and read-only reviewer agents; generate Pi skill packages and project settings without inventing unsupported MCP or sub-agent features.
- Support provider/model/variant selection for OpenCode and Kilo, and provider/model/thinking selection for Pi. Preserve provider and variant identity in routing evidence and dashboard status.
- Parse OpenCode/Kilo JSON text and per-step usage/cost events and Pi JSONL assistant/usage events, retaining partial or unknown measurements instead of treating them as free calls.

### Changed
- Extend the shared agent contract and all CLI validation/help text from four to seven supported harnesses: Claude, Codex, Gemini, Qwen, OpenCode, Kilo and Pi.
- Add JSONC-aware merging for existing Kilo configuration files so comments, trailing commas and user-owned settings survive retrofit.
- Add OpenCode/Kilo/Pi capability-tier routing defaults and carry provider/variant choices into parallel workers and quality candidate comparison.

### Migration and validation limits
- Run `yoke retrofit . --agent=opencode,kilo,pi` to add the new native artifacts, or use `--agent=all` for all seven harnesses. Install and authenticate each external CLI separately; Yoke does not bundle runtimes or credentials.
- OpenCode and Kilo safe execution uses their headless approval mode, while Pi uses explicit tool allowlists. None provides the same OS-level sandbox boundary as Codex/Gemini; Pi has no native MCP, sub-agent or plan layer. See [OpenCode, Kilo and Pi](docs/HARNESSES.md) before using `unsafe`.
- Regression fixtures cover invocation, routing, quality configuration, retrofit, host detection, result parsing and telemetry. No authenticated provider matrix, production sandbox equivalence, or model-quality/cost benchmark is claimed for these harnesses. Provider streams that omit final usage events remain partial or unknown.
- This release targets npm package 1.13.0; publication is triggered by the matching published GitHub release and verified separately.

## 1.12.0 — 2026-09-08

### Fixed
- Parse Qwen Code's native assistant/result/structured-result output and cumulative native model statistics, ignoring nested subagent results and refusing terminal-error verdicts.
- Use Qwen's native headless approval flags, retain the sandbox in safe mode and explicitly permit shell tools there; exclude native delegation tools when Yoke owns concurrency.
- Detect native Qwen session/project markers and include Qwen in automatic loop review selection and CLI review validation.
- Install manual Qwen skills with native invocation restrictions and a supported RTK PreToolUse retry guard; back up settings and remove only Yoke's obsolete BeforeTool hook on retrofit.
- Accept up to 32 routing profiles so an all-agent setup remains valid.

### Added
- Opt-in `setup --model-provider=deepseek,kimi` with DeepSeek V4 Flash/Pro and Kimi K2.6/K2.7 Code/K3 API configurations, environment key references, preserved custom settings and routing profiles.
- Explicit Qwen `PROTOCOL::MODEL` selectors mapped to native authentication/model arguments without changing global login settings.

### Migration and validation limits
- Fresh Qwen setups now use one standard profile with the user's configured model. Existing workers remain unchanged unless reset with `--routing-preset`; configure stronger profiles for stronger assessments.
- API presets require separately configured credentials and are not model-quality or cost benchmarks. Read [Qwen model support](docs/QWEN-MODEL-SUPPORT.md) for exact behavior and migration.
- Tested with regression fixtures and real Qwen Code 0.23.0 against a synthetic local tool-calling server; no authenticated provider benchmarks or production sandbox validation. This release targets npm package 1.12.0; publication is triggered by the published GitHub release and verified separately.

## 1.11.0 — 2026-09-07

### Added
- Add Qwen Code (Alibaba) as fourth supported provider alongside Claude, Codex and Gemini.
- Detect Qwen host environment via `QWEN_CLI` and `QWEN_CLI_HOME` environment variables.
- Add Qwen routing workers with four capability tiers: `qwen-turbo-latest` (light), `qwen3-coder-plus` (standard/strong), `qwen3-235b-a22b` (frontier).
- Parse Qwen streaming telemetry for token usage and model reporting.
- Support Qwen in all CLI commands: `setup`, `loop`, `review`, `prd draft`, `prd assess`, `goal run`.

### Changed
- Update project description from "three agents" to "four agents" to reflect Qwen support.
- Extend review resolution order to include Qwen for cross-model reviews.
- Update setup prompts to offer Qwen as agent and runner option.

### Migration and validation limits
- Existing configurations remain compatible. New setups can select Qwen as agent/runner.
- Qwen CLI uses Gemini-style arguments (`--approval-mode`, `--output-format stream-json`). `bare`, `reasoningEffort` and `nativeMultiAgent` selections are not supported (like Gemini).
- Qwen routing profiles are configurable hypotheses, not authenticated benchmarks. Update installed packages and restart the dashboard/runner.

## 1.10.0 — 2026-09-06

### Added
- Adopt the Yoke wordmark in the GitHub and npm README.
- Prepare task assessments in one bounded planning call with `yoke prd assess`; draft and inbox planning bind assessments to requirements, upstream dependencies and the approved brief.
- Separate `planning.agent`/`model`/`reasoningEffort` from execution settings. New setups require prepared assessments and block missing worker profiles; existing configurations retain on-demand planning and parent fallback.
- Add selective reassessment, planning input limits and `routing.maxTier` to bound automatic model selection and escalation.
- Add attention-first project search and status filters, with separate goal/loop states and explicit stale activity warnings.
- Restore dashboard views and UTC period controls through URL links, browser history and refresh; cancel obsolete requests and bound project comparison concurrency.
- Compare recorded tokens, accepted tasks and reported costs against the preceding equal-duration period without inventing missing measurements or percentages from zero baselines.

### Fixed
- Fix Windows safe-mode Codex execution by screening Store PowerShell/aliases and probing a native shell under the same sandbox before model work; keep permissions intact.
- Launch Windows provider executables/npm entry points with literal argv; bound preflight and provider lifetime, recognize streamed infrastructure failures, retain failed-worktree/process evidence, and guard against unconfirmed termination before another worker starts.
- Separate provider liveness, supervisor heartbeat, output and successful-tool progress in status/dashboard; label backlog percentages and preserve explicit bare startup through capability routing. See [Windows runner validation](docs/WINDOWS-RUNNER-VALIDATION.md).
- Keep local loop locks and dashboard status out of implementation commits and clean-worktree checks.
- Stage implementation files safely when runtime history directories are already ignored, including literal filenames and tracked deletions, for serial commits and parallel candidate snapshots.

### Migration and validation limits
- Existing routing configurations retain on-demand assessment and parent fallback. Use `yoke prd assess` to prepare task packages; configure `planning.agent`, `planning.model`, `planning.reasoningEffort` and `routing.maxTier` to separate planning from bounded execution. New setups require prepared assessments and block missing profiles.
- Update installed packages and restart the dashboard/runner to use the new code. Existing running processes are not upgraded or instrumented retroactively. Windows preflight preserves sandbox permissions and changes only the provider environment.
- Dashboard comparisons report recorded measurements, not reconstructed history or calibrated savings. Tokens per minute are consumption rates, not generation speed. Live routed Windows validation covered Codex on the documented machine; cross-provider performance and universal Windows compatibility are not established. See the linked dashboard, batch-planning and runner validation records.

## 1.9.0 — 2026-09-06

### Added
- Add capability-based routing with persisted task assessments, explicit model/effort tiers, role eligibility and conservative use of independent task-class outcomes.
- Keep planning on the start model; reuse assessments across attempts/worktrees and invalidate them when task requirements change.
- Add bounded repair and tier escalation after mechanical gate failures, retaining the patch and forwarding failure evidence. Infrastructure failures do not trigger capability escalation.
- Apply task-based profiles to reviews, quality critics/repairs and goal execution; display implementation selection reasons and next escalation in the dashboard.
- Add setup options `--routing-strategy=capability` and `--routing-preset` for explicit migration. Preserve existing strategies and custom profiles by default.

### Validation limits
- Initial profile tiers are configurable hypotheses, not authenticated model benchmarks, price estimates or calibrated success probabilities. See [capability routing](docs/CAPABILITY-ROUTING.md) for defaults and bounds.

## 1.8.0 — 2026-09-06

### Added
- Add persistent local measurement history and dashboard views for current work, usage/time and results, including UTC day/week/month filters, model history, project comparisons and consumption charts.
- Display current tasks, worker phases, integration progress and status age, with automatic refresh of the current-work view.
- Record explicit acceptances and show measured tokens and time per acceptance. Attribute available reviewer, critic and repair usage; distinguish actual reported models, unknown calls and partial costs.

### Changed
- Enable routing in new setups and automatically select up to three parallel workers when all pending tasks declare write scopes. Dependencies and overlapping scopes still constrain dispatch. Preserve explicit opt-outs and use isolated worktrees by default.
- Share routing decisions between synchronous and asynchronous runners; support routed parallel workers, stable recovery history and explicit provider affinity.
- Reserve execution capacity through integration and disable native delegation for loop providers; preserve Gemini system policy in a temporary bounded-execution configuration.
- Require a dated changelog entry, synchronized version metadata and verified release checks for every new version in the project instructions.

### Fixed
- Avoid conflicting Codex sandbox arguments and prevent Codex-only options from leaking into Gemini workers.
- Keep compact measurement history after recent activity expires, deduplicate archived events, and report incomplete history instead of treating missing usage as zero.
- Preserve reviewer telemetry and worker/model attribution across parallel execution and recovery.

### Migration and validation limits
- Use `--parallel=N` to choose a worker limit, `--parallel=auto` for automatic selection, `--no-routing` to opt out of routing, and `--no-isolate` to opt out of default isolation. Explicit existing configuration remains authoritative. Unknown write scopes, tool actions and worktree recovery select serial execution in auto mode.
- Automatic routing needs configured profiles; otherwise it keeps the selected parent provider. Explicit `--routing` without profiles reports a configuration error.
- Missing historical usage cannot be reconstructed. Tokens per minute describe interval or summed call consumption, not measured generation speed. Live authenticated provider benchmarks, resource-adaptive concurrency and calibrated time/cost predictions are not established by this release.

## 1.7.0 — 2026-09-05

### Added
- Independent `yoke check` with executable acceptance mapping, protected test infrastructure and content-bound evidence.
- Durable project goals, provider handoff, checkpoint budgets, interruption accounting and project-scoped recovery.
- Local project registry and loopback dashboard with goals, task estimates, evidence, consumption and pause controls.
- Explicit routing rules with persisted gate-driven escalation; bounded tool actions without model calls.
- Task-aware context packets, advisory write scopes, dependency-depth scheduling and empirical time ranges with prediction error records.

### Fixed
- Failed serial isolated worktrees are retained and can be explicitly resumed against their original target and PRD.
- Reviewer fingerprints include untracked contents and acceptance inputs; unsupported nested repository identity fails closed.
- Gemini always emits streaming telemetry, preserves model identity, honors aggregate token aliases and rejects unsupported selections. Its RTK hook merges native settings without a shell dependency.
- Runtime evidence is excluded from Git gates and commits in existing projects. Partial usage and costs remain visibly incomplete.
- Protected acceptance is checked after verification and repair, and linked goal state cannot overwrite unrelated files through pause.

### Validation limits
- Live authenticated provider comparisons and calibrated development-time/cost estimates are not established by the automated tests. Browser proof and independent model review still require explicit configuration.

## 1.6.2 — 2026-09-02

### Added
- GitHub Releases can now publish `@hecer/yoke` through npm trusted publishing with short-lived OIDC credentials and automatic provenance, without a long-lived npm token.

### Fixed
- Codex safe-mode invocations now use the supported `workspace-write` sandbox with `--approve-for-me`; the removed `--full-auto` flag no longer blocks current Codex CLI releases.
- Windows provider cleanup rechecks termination after process close and accepts an already-absent process as successfully cleaned up, avoiding stale ownership records and unnecessary watchdog waits.
- Successful stale-loop cleanup removes obsolete runtime status, so `yoke loop status` no longer reports a dead run as `RUNNING`.

## 1.6.1 — 2026-08-21

### Fixed
- Release metadata counts platform-conditional tests consistently on Windows and Ubuntu.
- Provider cleanup confirms termination after child close, preventing stale ownership records when Windows reports process exit asynchronously.

## 1.6.0 — 2026-08-20

### Added
- The canon now includes `no-ai-slop`, `domain-modeling`, `codebase-design`, `resolving-merge-conflicts`, and `writing-for-agents`, with their supporting templates and evaluation material. Source adaptations are credited in `canon/skills/ATTRIBUTION.md`.
- UI projects receive an automatic design-quality gate with configurable `design.mode` (`off`, `auto`, or `on`) and score budget. Detection uses package dependencies, UI source files, and configured smoke flows.
- Durable context now includes a project glossary and can expose an optional bounded-context map.

### Changed
- Retrofit installs complete skill packages for Claude, Codex, and Gemini instead of copying only `SKILL.md`. Local resources, binary files, and executable bits are preserved where supported.
- Every canon skill declares `invocation: auto|manual`; retrofit maps that policy to Claude frontmatter, Codex `agents/openai.yaml`, and Gemini's generated automatic-skill index.
- Canon validation rejects missing local Markdown resources, unsafe package entries, symlinks, and provider metadata that conflicts with the manifest.

### Fixed
- Windows provider cleanup now treats a successful `taskkill` as a request and confirms that the recorded PID has stopped before deleting its ownership record.

## 1.5.1 — 2026-08-17

### Fixed
- Serena MCP configurations generated by Yoke no longer open the local web dashboard automatically on every startup.

## 1.5.0 — 2026-08-16

### Added
- Failed verify, executable-criterion, performance, configured custom-audit, and completion gates now produce deterministic byte-bounded previews and preserve large complete stdout/stderr in content-addressed `.yoke/artifacts/` files with SHA-256 references.
- Projects can tune `output.previewBytes` and `output.artifactThresholdBytes`; existing projects use backward-compatible 2 KiB/8 KiB defaults.
- A deterministic local benchmark verifies signal retention, preview bounds, compression measurement, and artifact digest round-trips without making provider-token claims.

### Security
- Output artifact paths sanitize story identifiers, stay below a project-local root, use user-only file modes where supported, and are excluded from Yoke's clean-tree and story-commit operations even in upgraded projects. Raw artifacts are never injected automatically and documentation warns that project commands may emit secrets or personal data.
- Gate command capture is capped at 16 MiB per stdout/stderr stream. Quota overflow fails closed and labels retained evidence as truncated instead of risking unbounded memory or claiming partial output is complete.

## 1.4.0 — 2026-08-15

### Added
- `yoke loop run --parallel=N` now executes dependency-ready, non-colliding stories through real provider subprocess workers, isolated worktrees, leased claims, and a FIFO integration queue with fresh integrated-system gates.
- Reference-driven quality declarations can collect screenshots, files, command output, or benchmark results and run a schema-validated blind critic with bounded repair rounds, elapsed-time limits, blocking or advisory policy, and retained proof.
- `--candidates=N` can fan out up to five isolated implementations, discard mechanically red candidates, select one green candidate through identity-blind pairwise comparison, and preserve selected/loser evidence before cleanup.
- Loop status now exposes dispatcher, worker, integrator, candidate lifecycle, worktree, queue, integration, reopen, quality-round, repair-budget, and trusted provider/model provenance data.

### Changed
- Provider subprocesses use explicit lifecycle contracts and incarnation-aware process records so worker cancellation and cleanup target only the process tree Yoke actually started.
- Parallel and candidate runs disable adaptive routing, honor story-level provider affinity, latch pause requests across the whole dispatcher, and rerun quality plus review after integration.
- `yoke loop cleanup` retains Yoke worktrees unless `--remove-worktrees` is explicit, while still reaping recorded orphan runners and stale locks safely.

### Fixed
- Expired claims, worker crashes, merge conflicts, pause races, and integration failures now release ownership deterministically, retain terminal proof, and reopen stories without leaking worktrees or marking false completion.
- Quality repair fails closed on malformed critic output, reference drift, provider/model provenance mismatch, candidate identity leakage, unavailable critics, exhausted limits, and mechanically red repairs.
- The watchdog resolves its TypeScript loader from both source and built npm layouts on Node 20+, and read-only Codex comparisons can run in disposable candidate worktrees without weakening normal repository checks.

### Security
- Blind comparison requests expose only opaque labels and digests while binding every verdict to the trusted judge provider, model, prompt, rubric, reference, and candidate provenance.
- Cleanup and cancellation use project-scoped leases, owner tokens, PID birth/incarnation checks, and recorded process handles rather than machine-wide process-name matching.

## 1.3.0 — 2026-08-09

### Added
- Teams can submit change requests at any time with `yoke change add` and inspect the append-only inbox with `yoke change status`; queued requests are planned at safe loop boundaries by Claude, Codex, or Gemini without interrupting active story work.
- Acceptance criteria can carry stable IDs and executable verification commands, and Yoke records per-criterion evidence before a story can be marked complete.
- Projects can configure an integrated completion command that proves the final system flow after all story-level gates pass.

### Changed
- New projects use strict criterion-proof requirements by default, while existing boolean-only criteria remain readable for compatibility.
- PRD authoring, schemas, loop guidance, generated configuration, and provider instructions now treat completion as an ephemeral readiness state: new requests create more stories instead of prematurely forcing a release boundary.

### Fixed
- Broad green test suites can no longer satisfy unrelated structured acceptance criteria: proof commands must use an approved test runner, contain the criterion ID, and avoid shell operators.
- Change-intake failures block safely; an independent coverage pass rejects omitted requested outcomes, crash recovery retains uncommitted requests, and concurrent PRD edits are detected instead of silently overwriting user work.
- Integrated completion checks prevent locally finished stories from masking broken cross-component flows such as authentication callbacks or purchase-to-entitlement activation.

### Security
- Updated the transitive development dependency `nanoid` to a non-vulnerable release so the complete CI dependency audit is clean.
- Restricted model-authored criterion proof to criterion-targeted test commands and blocked shell control operators and runner-prefix spoofing before host execution.

## 1.2.1 — 2026-08-02

### Fixed
- `yoke loop run` now executes every remaining planned story by default instead of stopping after an implicit 25-iteration batch. Use `--max=N` only when an intentional bounded batch is wanted.
- Unlimited runs remain unlimited after a critical-decision answer/resume cycle, while explicit caps remain preserved and accept positive integers only.

## 1.2.0 — 2026-08-02

### Added
- Opt-in adaptive model routing lets a strong parent orchestrate each bounded story while Yoke selects an available Claude, Codex, or Gemini worker by quality, speed, cost, or balanced strategy.
- A concurrency-safe local evidence registry learns from independent verification results without sharing mutable state between simultaneous Yoke processes.
- Routing telemetry, reproducible benchmark fixtures, and analysis tooling make worker selection, token use, timing, and gate outcomes auditable.

### Changed
- Setup keeps routing disabled unless explicitly enabled and validates provider/model worker pools before execution.
- Internal provider contract tests cover Claude Code, Codex CLI, and Gemini CLI through the shared adapter. Codex-only authenticated trials completed all 12 stories and 36 hidden checks; median routed runs used 11.0% fewer fresh input tokens, 49.5% fewer output tokens, 78.2% fewer reasoning tokens, and 33.8% less wall time than routing off.

### Fixed
- Reviewer prompts now permit their required verdict file while continuing to forbid project changes.
- Failed reviewer subprocesses retain bounded provider stderr in loop status, exposing authentication, quota, sandbox, and startup failures instead of a generic command error.

## 1.1.0 — 2026-07-30

### Added
- Shared five-question `yoke setup` wizard with provider-aware defaults for Claude, Codex, and Gemini.
- Persisted default runner selection and `auto|critical` loop decision policies.
- Provider-neutral `yoke-workflow` skill for planning questions, approved-plan PRD handoff, autonomous story execution, and critical-decision resume.
- Structured critical-decision requests with `yoke loop decision` and `yoke loop answer`; answers are validated, committed under the configured human identity, and resume the same story.
- Approved `.yoke/plan.md` context in PRD drafting and a lint gate for unresolved planning placeholders.

### Fixed
- Retrofit and loop on/off now preserve timeout, decision, runner, and permission settings.
- Empty projects prefer the active agent host instead of silently installing Claude artifacts in Codex.
- Loop and PRD runner selection now prefer an explicit flag, then the configured runner, then the active host.
- Retrofit reports no longer label every provider as Claude Code.
- Critical-decision resumes retain isolation, review, runner, permissions, timeout, JSON, policy, and iteration settings instead of falling back to an unreviewed default run.
- Decision answers use an atomic owner-token lock and recoverable request journal, are checked against the active PRD story, bounded as untrusted data, and committed path-by-path so unrelated edits cannot enter the human-owned commit.
- Decision recovery now binds the exact selected answer to its commit, rolls back only its own interrupted context append, namespaces resume state per project/worktree, and serializes cleanup with loop startup.
- Active agent session markers now outrank globally configured provider home directories, and setup rejects partially invalid agent lists.

### Changed
- New setups enable the loop by default and choose `decisionPolicy: auto`; the wizard can select `critical` or disable the loop.
- Legacy `loop.onAmbiguity` and `--on-ambiguity` remain compatibility aliases.

## 1.0.0 — 2026-07-27

### Added
- Native Codex skills, project config, hooks, reusable agents, and plugin metadata.
- Safe provider permission profiles and structured cross-provider telemetry.
- Schema-validated independent review verdicts with explicit self-review opt-in.
- Human-owned commit identity enforcement; AI co-author trailers default off.
- `yoke audit` dependency, secret, and sensitive-diff gate with versioned suppressions.
- PRD dependency graphs, collision areas, agent affinity, claims, FIFO merge queue, and bounded async dispatcher APIs.
- Reproducible cross-runner benchmark schema and matrix launcher.

### Changed
- Dangerous permission bypass is opt-in via `--unsafe`.
- Worktree cleanup is non-destructive unless `--remove-worktrees` is passed.
- Reviews no longer trust process exit code alone.

### Security
- Vitest upgraded to 4.1.10; the dependency tree reports zero known vulnerabilities.


## 0.9.0 — 2026-07-22

### Added
- **Performance budget gate** (`perf.command` in `.yoke/config.yaml`, optional `perf.retries`).
  A benchmark command with the same contract as verify (exit 0 = within budget) runs **after
  verify** on every story — new loop phase `perf`, `YOKE_STORY` exposed, worktree-aware in
  `--isolate` mode. A red benchmark blocks the story
  (`story S6 exceeded its performance budget: …`) no matter how clean the diff is. When the
  gate is configured, the implementer prompt names the budget command so agents keep hot
  paths efficient and never "simplify away" an optimization without re-running the benchmark.
- **`performance` canon skill** (28 skills now): efficiency as a measured requirement —
  clean-by-default with the decision ladder (minimal-code → measurable acceptance criterion →
  project perf gate), profile-first, optimize leaves not boundaries, benchmarks committed as
  tests, the *why* of every optimization versioned so future agents don't clean fast code
  back to slow.
- **`authoring-prd` guidance**: performance requirements belong in acceptance criteria as
  numbers ("imports 1M rows in < 2s"), and every clarifying question belongs in the planning
  round — a criterion still needing a decision is not loop-ready.

## 0.8.0 — 2026-07-20

### Added
- **Live progress + ETA.** Story completions are now first-class events: the console shows
  `✓ S6 done in 4m28s — 20/45 (44%) · ~1h40m left`, every status (file, NDJSON stream,
  `yoke loop status`) carries `percent` and an `eta` block. The estimate averages the
  durations of stories completed **in this run** (current velocity) and falls back to the
  persisted history of previous runs (`.yoke/story-durations.json`, last 50, gitignored).
  No data → no estimate, never an invented one.
- **Ambiguity policy** (`loop.onAmbiguity` / `--on-ambiguity=<resolve|abort>`). The runner
  prompt now always forbids asking questions (a loop run has nobody to answer). Default
  `resolve`: the agent settles ambiguous criteria itself, states the interpretation, and the
  loop never stops. Opt-in `abort`: the agent writes its open questions to
  `.yoke/ambiguity.md` and stops; the loop consumes the file, skips verify (an unimplemented
  story would otherwise pass on pre-existing green tests), and blocks with the question as
  the reason. Companion principle: clarifying questions belong in the planning round, before
  the loop starts.

## 0.7.0 — 2026-07-17

### Added
- **Update check + `yoke upgrade`.** Every CLI invocation ends with a non-blocking
  version hint (npm/gh-style): a detached background refresher caches the registry's
  latest at most once a day; when it is newer, a one-line stderr hint suggests
  `yoke upgrade` (which runs `npm install -g @hecer/yoke@latest`). Silent in CI,
  `--json` runs, non-TTY pipes, and under `YOKE_NO_UPDATE_CHECK=1`.
- **Opt-in auto-upgrade** (`update.auto: true` in `.yoke/config.yaml`): evaluated at
  loop START only — never mid-run; the running process finishes on its version and
  the upgrade applies from the next invocation. Deliberately NOT the default:
  a gate harness must not change itself mid-project (determinism), and unreviewed
  auto-installs are a supply-chain hazard.

## 0.6.0 — 2026-07-17

### Added
- **Project-scoped orphan reaping.** The watchdog now records its pids in the project's
  `.yoke/runner.pid` (main dir and per-story worktrees; removed on clean exit), and
  `yoke loop cleanup` kills exactly those recorded process trees — and only while no
  live loop holds the lock. Background: without a scoped mechanism, users and agents
  resorted to machine-wide pattern kills (every process matching
  `dangerously-skip-permissions`), which took down *healthy* runners of other projects
  mid-story and stalled their loops. Never kill by pattern; `yoke loop cleanup` is the
  safe path. `.yoke/runner.pid` is gitignored by retrofit.

## 0.5.0 — 2026-07-17

Root-cause fixes for the two "yoke keeps hanging" failure modes observed in the field
(orphaned `claude.exe` runners piling up, healthy long stories dying at exactly the
idle window):

### Fixed
- **Watchdog now kills the whole process tree on Windows** (`taskkill /T /F`).
  Previously it killed only the spawned shell (`shell: true`), orphaning the actual
  agent process — which kept writing to the worktree (dirty-tree blocks, failing
  worktree removal) and kept burning API tokens. Observed in the field as ~10
  zombie `claude.exe` per machine plus surviving dev servers.
- **Claude runner always runs in stream-json mode.** Plain `-p` prints nothing until
  the run finishes, so the idle watchdog mistook healthy >20-minute stories for dead
  processes and killed them at exactly the idle timeout — while the user saw dead air.
  The stream doubles as liveness; token usage is now reported on every run (not just
  `--json` mode).

### Changed
- README: operating notes for driving the loop from inside an agent session
  (background execution, small `--max` batches, `yoke loop cleanup` after interrupts) —
  outer shell-tool timeouts killing a foreground `yoke loop run` were the third
  observed "hang" pattern.

## 0.4.0 — 2026-07-17

### Added
- **Hardened runner prompts** — distilled agent-harness patterns for headless runs:
  scope discipline (nothing beyond the story), no unsolicited summary/plan/analysis
  documents, root-cause fixes instead of gate bypasses, faithful outcome reporting,
  bounded final messages (cuts output-token waste). Review prompts now ground verdicts
  in observed evidence only and keep them brief.

### Fixed
- `.yoke/loop.pause` is now gitignored by retrofit. Previously the loop's own
  `git add -A` story commit swept the pause control file into history in
  un-retrofitted targets; removing it dirtied the tree and the clean-tree gate
  blocked the resume run — the loop locked itself out.

> Note: 0.3.0 was tagged and released on GitHub but never reached npm (2FA re-login
> was pending), so for npm users 0.4.0 is the first release with the 0.3.0 changes below.

## 0.3.0 — 2026-07-10

### Added
- **Claude Code plugin packaging** — the repo is now its own plugin marketplace
  (`.claude-plugin/plugin.json` + `marketplace.json`): `/plugin marketplace add HECer/yoke`,
  then `/plugin install yoke@yoke` installs the full canon under the `yoke:` skill namespace.
- **Gemini CLI extension manifest** (`gemini-extension.json` + `GEMINI-EXTENSION.md`) —
  installable via `gemini extensions install https://github.com/HECer/yoke`, listed in the
  daily-crawled extensions gallery.
- **Benchmark harness** (`bench/`) — reproducible cross-runner benchmark (tokens · speed ·
  quality) with a fixed fixture, pre-written objective tests, and committed result data.
- **Companion tool docs** — `canon/tools/claude-mem.md` (persistent memory; interactive
  sessions only, explicitly kept out of loop runs) and `canon/tools/ui-ux-pro-max.md`
  (design generation paired with Yoke's design verification gates).
- **Multi-agent parallel loop design** — evaluation + phased design for distributing PRD
  stories across parallel workers (`needs` dependency field, claim files, merge queue,
  heterogeneous cross-agent dispatch): `docs/superpowers/specs/2026-07-10-multi-agent-parallel-loop-design.md`.

### Fixed
- Agent-availability probe timeout raised 5s → 20s: Gemini CLI cold-starts in ~6s on
  Windows, so the loop misreported an installed `gemini` as "not found on PATH"
  (found by the new benchmark harness).
- Gemini runner invocation: dropped the bare `-p` flag — current Gemini CLI (0.33+)
  requires a value after `-p` and errored with "Not enough arguments following: p".
  Piped stdin selects headless mode by itself, so the runner now passes only `--yolo`
  (also found by the benchmark harness).

### Changed
- README: npm install is now the primary quickstart path; documented plugin/extension
  installs and optional companions.
- npm package now ships `CHANGELOG.md`, `bench/` (harness + result data), and
  `docs/superpowers/` (all specs and plans, including the multi-agent parallel loop design).

## 0.2.0 — 2026-07-09

- First npm release as `@hecer/yoke`.
- Hyperflow integration surface: `yoke loop run --json` NDJSON stream, pause signal,
  token-usage + model-id reporting for the claude runner.
- `yoke new` greenfield bootstrap, `yoke prd draft`, cross-model `yoke review`,
  `yoke flow-smoke` browser gate with proof artifacts, `yoke design-scan`.
- Retrofit planners for Claude Code, Codex CLI, Gemini CLI; canon of 26 skills;
  loop with worktree isolation, watchdog, single-flight lock, commit integrity.
