# Verified projects implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and independent spec and quality reviews. User authorized implementation on 2026-09-05; no additional planning approval is required.

**Goal:** Deliver reliable cross-provider acceptance and continuation, measured execution with useful time estimates, efficient routing, and a local dashboard over a shared project state.

**Architecture:** Preserve existing CLI behavior unless a safety defect requires correction. Add small services for checks, goals, events, estimates, project registration and dashboard presentation. Provider capabilities stay in adapters; dashboard calls the same services as the CLI. Unknown measurements remain unknown.

**Tech Stack:** Existing TypeScript, Node built-ins, Zod, YAML and Vitest. Local HTTP dashboard with no runtime UI dependency. Existing CLI processes remain the coding executors.

## Scope and acceptance

The user approved the saved product direction. Implementation includes the concrete developer-tool capabilities; market validation with ten external users, commercial pricing, cloud hosting, promises of model equivalence and guaranteed time/cost savings are not software deliverables. Provider-native features must use verified supported interfaces; no invented goal protocol or provider prices.

## Task 1: Provider contracts and hooks

Files: src/agents/providers.ts, contracts/types/telemetry as necessary, src/retrofit/planners/gemini.ts, canon/tools/gemini-rtk-hook.mjs, focused provider/retrofit tests.

- [x] Write failing tests for Gemini streaming and model telemetry, unsupported selection handling, and BeforeTool command rewriting.
- [x] Run the focused tests and inspect the expected failures.
- [x] Add capability-aware invocation, reliable Gemini stream output and hook wiring. Retain safe/read-only profiles, validate native structured-output options where supported.
- [x] Run provider, process and retrofit tests plus TypeScript checks.
- [x] Independent spec review, then quality review; address findings.

## Task 2: Durable recovery and acceptance

Files: src/loop/loop.ts, src/loop/runner.ts, new src/check/ and src/goals/ modules, src/cli.ts, focused tests.

- [x] Reproduce lost failed worktrees and untracked reviewer mutations before changing production code.
- [x] Retain failed isolated work; allow intentional resume with branch/PRD identity validation. Fingerprint file content and fail closed on read failures.
- [x] Add yoke check that runs configured or detected verification without retrofit, reports passed/failed/unverified criteria and binds evidence to checked content.
- [x] Add protected-file verification and bounded repair/continuation with explicit provider selection; never silently accept changed acceptance infrastructure.
- [x] Add durable goals and handoff state, exposing native-agent-readable instructions instead of assuming unsupported APIs.
- [x] Test dirty trees, failed commands, stale evidence, missing configuration, changed protected files and recovery.

## Task 3: Measurement and estimates

Files: new src/observability/events.ts, src/estimation/, src/loop/reporter.ts, focused tests.

- [x] Test event validation, partial history, failed attempts, phase accounting and low-sample estimates.
- [x] Persist bounded versioned local events and preserve explicit measurement availability.
- [x] Combine historical and current durations robustly; expose empirical bounds and sample count.
- [x] Estimate dependency-constrained schedules and active work without naive division by concurrency.
- [x] Connect serial/parallel status to a common read model and expose estimate accuracy records.

## Task 4: Efficient execution

Files: src/routing/, src/context/, src/loop/scheduler.ts, configuration/schema and focused tests.

- [x] Test explicit deterministic routes, safe fallback and gate-driven escalation.
- [x] Add explicit rule-based routing to bypass unnecessary controller calls; support bounded configured tool actions and worker escalation.
- [x] Select relevant context within a stable prefix and content budget with source references.
- [x] Respect task write scopes, dependency priority and configured concurrency constraints.
- [x] Keep mandatory final checks; reuse only evidence with matching inputs and surface cache/usage gaps.

## Task 5: Project dashboard and shared commands

Files: new src/projects/, src/dashboard/, src/cli.ts, tests/projects/, tests/dashboard/.

- [x] Test project registration, corrupt/missing projects, task views and HTTP boundaries.
- [x] Add local project register/list/remove and shared state snapshots for goals, criteria, workers, events, estimates and consumption.
- [x] Serve a responsive dashboard on loopback only with escaped text, restrictive CSP, validated Host/Origin and opaque project IDs. Never expose arbitrary file paths as HTTP reads.
- [x] Provide overview, project and task details, blockers, evidence and time/cost uncertainty. Mutating controls reuse existing command boundaries and require local-session protection.
- [x] Verify actual HTTP responses and browser rendering, empty/error states and navigation.

## Task 6: Integration and documentation

- [x] Reconcile README claims with activation and evidence requirements; document migration and all new commands.
- [x] Update release metadata through the repository script.
- [x] Run lint, build, full tests, canon validation, docs checks and package dry run.
- [x] Perform independent spec and code-quality review and fix material findings.
- [x] Preserve original working-tree changes; provide concrete commands and remaining external verification limits.

## Verification commands

All shell calls use RTK per user instruction. Focused checks use `rtk proxy npx vitest run <test files>`. Final checks use npm scripts from package.json and `rtk proxy npx tsx src/cli.ts validate canon`. Behavioral tests must fail for the intended missing behavior before implementation. Do not call live models across user repositories for a synthetic dashboard demo.

## Execution record

- Baseline was audited earlier in this session: 1018 passed, 2 skipped, one 5-second integration-test timeout; isolated rerun passed. TypeScript and docs check passed. Work continues under the user's explicit instruction to implement and fix the recorded issues.
- Worktree: .worktrees/yoke-next, branch feature/verified-projects. Existing dependencies reused via junction; original user changes remain outside this worktree.
- Final verification: 122 files passed, 1098 tests passed and 2 platform skips. Build, typecheck, canon, docs metadata and package contents passed. Independent reviews and desktop/mobile browser inspection completed within the limits recorded in docs/VERIFIED-PROJECTS-VALIDATION.md.
- Scope clarification: mandatory final checks always rerun; no selective-result cache was added. Dashboard mutations are limited to shared-service pause; run/resume/budget stay CLI actions. Native provider goal integration is a supported handoff, not an invented API. Empirical prediction errors are recorded; live model/competition benchmarks and calibrated deadlines remain external validation.
