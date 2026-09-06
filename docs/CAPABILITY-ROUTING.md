# Routing by task requirements

Available in Yoke 1.9.0.

New setups use `routing.strategy: capability`. Existing explicit strategies and profiles remain unchanged. To opt an existing project into capability routing with its current profiles:

```sh
yoke setup . --yes --routing --routing-strategy=capability
```

Give each existing worker a `tier: light|standard|strong|frontier`. Profiles without a tier remain usable with legacy strategies but are not candidates for capability selection. To explicitly replace worker profiles with the supplied provider presets, add `--routing-preset`. This replaces customized worker profiles; omit it to retain them.

## Planning and selection

The configured start provider/model plans new change requests. The planner supplies an `assessment` with the task class, difficulty, uncertainty, risk, scope, testability, rationale and implementation approach. Existing tasks without an assessment receive one read-only assessment call using the start model. This call does not use a cheaper orchestration override. Its result is cached under `.yoke/routing/`, keyed by the task contract. Changing the contract invalidates the cached assessment; toggling `passes` does not.

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

Yoke chooses an eligible profile at or above the required tier, then compares declared cost tiers. Optional `roles: [implementation, reviewer, critic, repair]` limits a profile's uses. Task `agent` affinity restricts implementation to that provider. Explicit routing rules and explicit quality role models retain precedence. A missing suitable profile falls back to the start model (or the explicitly bound provider's default) and labels the fallback; it does not prove that the fallback has sufficient capability. An invalid assessment blocks implementation.

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
