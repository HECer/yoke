# Routing by task requirements

Capability routing is available in Yoke 1.9.0. Batch preparation, separate planning settings and routing limits described below are local, unreleased additions.

New setups use `routing.strategy: capability`. Existing explicit strategies and profiles remain unchanged. To opt an existing project into capability routing with its current profiles:

```sh
yoke setup . --yes --routing --routing-strategy=capability
```

Give each existing worker a `tier: light|standard|strong|frontier`. Profiles without a tier remain usable with legacy strategies but are not candidates for capability selection. To explicitly replace worker profiles with the supplied provider presets, add `--routing-preset`. This replaces customized worker profiles; omit it to retain them.

## Planning and selection

The start provider/model remains the planning default. Optional `planning.agent`, `planning.model` and `planning.reasoningEffort` select a separate planner without changing the execution model. Draft and change-inbox planning request complete assessments in the same pass that creates the tasks. The inbox still performs its separate coverage review.

New setups use `routing.assessmentPolicy: prepared` and `routing.fallback: block`. Before dispatch, each unfinished task must have 2–5 executable criteria and a current assessment. No per-task planning call runs in this mode. Existing configurations retain `on-demand` and `parent` unless explicitly changed; on-demand routing makes a read-only planning call for an unassessed task and caches its result.

Run `yoke prd assess .` to assess all missing or stale unfinished tasks together. One invocation makes at most one read-only planner call, with exact task IDs and validated output, then atomically replaces the PRD. Invalid, incomplete or duplicate output leaves the PRD unchanged; concurrent input edits are preserved and the result is rejected. A current package uses zero model calls. `--story=ID` selects one unfinished task; `--reassess` also includes already-current assessments. The default package limit is 20 tasks (`planning.maxTasks`, range 1–50) and the prompt limit is 60,000 characters; oversized input is rejected before calling the provider.

Yoke writes `assessmentFor` bindings over requirements, declared write scope/provider, transitive dependency contracts and `.yoke/plan.md`. Changes invalidate affected unfinished tasks; progress or priority changes do not. A changed brief invalidates all unfinished tasks. These hashes detect stale input, not authorship or semantic correctness. Source-code changes outside these contracts require explicit reassessment when relevant.

Example settings alongside the project's existing worker profiles:

```yaml
runner:
  agent: codex
  model: gpt-5.6-terra
planning:
  agent: codex
  model: gpt-6-astra
  reasoningEffort: high
  maxTasks: 20
routing:
  enabled: true
  strategy: capability
  assessmentPolicy: prepared
  fallback: block
  maxTier: strong
  # Keep the existing workers list here.
```

`maxTier` limits automatic execution and escalation, including routing-rule selections. If a task needs frontier while the ceiling is strong, it blocks; Yoke does not lower the required capability. Planning itself may still use Astra. Explicit quality-role model overrides retain precedence. Goal execution retains its own protected manifest and budgets, uses the configured planner on demand, and honors routing fallback/tier limits; PRD preparation policy does not apply to synthetic goal tasks.

An assessment is a planning judgment, not a measured success probability. High testability means executable checks can detect an incorrect implementation. High uncertainty, architecture work or high risk require the frontier tier; difficult or broadly coupled work requires strong; routine implementation requires standard. Light is reserved for clear, low-risk mechanical work with strong checks. Weak testability raises the minimum tier. Reviews and critics have a standard minimum even for light tasks.

```yaml
assessment:
  taskClass: implementation
  difficulty: medium
  uncertainty: low
  risk: low
  scope: low
  testability: high
  reason: Existing handler pattern and executable contract tests
  approach: Extend the handler, cover the boundary cases, run contract tests
```

Yoke chooses an eligible profile at or above the required tier, then compares declared cost tiers. Optional `roles: [implementation, reviewer, critic, repair]` limits a profile's uses. Task `agent` affinity restricts implementation to that provider. Explicit routing rules and explicit quality role models retain precedence. With legacy `fallback: parent` and no tier ceiling, a missing suitable profile falls back to the start model (or the explicitly bound provider's default) and labels the fallback; it does not prove sufficient capability. `fallback: block` or a configured tier ceiling prevents that fallback. An invalid assessment blocks implementation.

## Initial profiles

| Tier | Codex | Claude | Gemini |
| --- | --- | --- | --- |
| light | gpt-5.6-luna, low | haiku | gemini-2.5-flash |
| standard | gpt-5.6-terra, medium | sonnet | gemini-2.5-pro |
| strong | gpt-5.6-sol, high | sonnet, high effort | gemini-2.5-pro |
| frontier | gpt-6-astra, high | opus | gemini-2.5-pro |

These are editable starting hypotheses, not measured equivalences or price claims. The Codex names follow the requested profile family. Account access is not established by finding an installed CLI. Gemini uses documented explicit model IDs and receives no unsupported reasoning-effort parameter. Several Gemini tiers deliberately share Pro; moving between those tiers alone is not a stronger-model transition. Adjust the presets to the models available to your account. Claude aliases can resolve to different concrete models over time. Provider-reported model identity remains separate from requested identity.

Provider references: [Claude model configuration](https://code.claude.com/docs/en/model-config), [Gemini model selection](https://geminicli.com/docs/cli/model/).

## Repair, escalation and evidence

After an independent mechanical failure, capability routing permits one targeted repair at the initial tier, then raises the required tier on further failures. Attempts retain the current worktree and receive the previous gate findings. Every returned candidate still passes the normal acceptance, protection, quality, review and integration gates. Critical decisions, pause/cancellation and protected-acceptance violations stop retries. Provider process failures are classified conservatively as infrastructure; they do not count as evidence that a stronger model is needed.

`routing.maxAttempts` limits implementation calls per unchanged task contract (default 5, configurable 1–8). The initial tier imposes an additional bound: light at most 5, standard 4, strong 3, frontier 2. An exhausted task blocks and requires a revised plan. These are inner implementation attempts; the outer loop's iteration count still counts task dispatches. Existing quality repair rounds and time limits remain separate bounds, and quality repairs can raise their profile tier by round. Goal execution keeps its existing global attempt, time and token budgets.

Routing observations record task class, required tier, requested and reported models, effort, independent result, duration and available consumption. Selection considers matching project/task-class/tier history from the last 30 days within the bounded registry read. At least ten matching observations are required before an observed success rate below 80% excludes a profile. History is scoped to the concrete reported model to avoid mixing changed aliases. This is a conservative exclusion rule; it does not lower the planner's safety floor or claim calibrated probabilities. Missing usage remains unknown. Financial optimization and cross-provider performance require authenticated benchmarks.

The dashboard's Now view shows the last recorded implementation profile, requested model/effort, rationale and next escalation tier. Usage & time retains reported model and role consumption, including assessment calls. Cached planning has no new model-call charge. Routing state is local runtime data and excluded from Yoke story commits.
