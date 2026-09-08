# Changelog

## Unreleased — 2026-09-08

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
- Tested with regression fixtures and real Qwen Code 0.23.0 against a synthetic local tool-calling server; no authenticated provider benchmarks or production sandbox validation. No new npm version is published by this change.

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
