# Verified projects, goals and measured execution

These additions are implemented in the source tree. They do not require a cloud account or replace your provider CLI. Model availability, reasoning controls, structured output and telemetry depend on the selected provider; unknown usage is never a measured zero. Live authenticated provider comparison and calibrated time/cost benchmarks remain separate validation work.

## Check an existing project

```sh
yoke check .
yoke check . --json
yoke check . --requirement="Guest checkout completes"
```

Checks run without retrofit. Exit codes: `0` passed, `1` failed, `2` unverified or unavailable. A free-text requirement stays unverified until you map its behavior to an executable acceptance contract. Passing a project suite does not establish arbitrary product correctness.

Create `.yoke/acceptance.yaml` with tests that inspect application behavior:

```yaml
version: 1
protected:
  - tests/acceptance/checkout.test.mjs
  - tests/acceptance/helpers.mjs
criteria:
  - id: guest-checkout
    text: A guest can complete checkout and receives one order confirmation.
    commands:
      - node --test tests/acceptance/checkout.test.mjs
```

List every local test helper, fixture and configuration file whose modification could weaken this contract. Paths must resolve inside the project. `yoke check . --protect` pins the manifest, listed files and existing package manifests/lockfiles outside the worker checkout. Autonomous goals require explicit protected test infrastructure and establish this pin automatically. Protection is change detection within the local execution model, not an OS security boundary against a hostile process using your account. Review the contract before running a goal.

After intentionally editing protected tests, use `yoke check . --protect --refresh` to approve the new baseline. Ordinary checks and retries never refresh it. Source, acceptance and configuration identity are checked before and after verification; changed inputs invalidate evidence. Gitlinks/submodule directories currently fail closed because recursive identity is not implemented. Evidence is stored in `.yoke/checks/<id>.json`; it describes that checked snapshot and is not a permanent success certificate.

## Durable goals across providers

```sh
yoke goal set . --objective="Finish guest checkout" --attempts=3 --minutes=30
yoke goal run . --runner=codex
yoke goal resume . --runner=claude --model=<installed-model-id>
yoke goal resume . --runner=gemini --model=<installed-model-id>
yoke goal status .
yoke goal handoff .
yoke goal pause .
```

Goals keep objective, attempts, failure context and check IDs in `.yoke/goal.json`. They share the story-loop lock. Each implementation attempt is followed by independent executable acceptance. A completed goal is checked again on a later run. Failed work stays in the project; goal execution itself does not commit or publish it. Goal handoff is readable context for native agent goal facilities; Yoke does not invent or call an undocumented native goal API.

`--minutes` limits cumulative agent execution time. Verification is measured separately and commands retain their verification timeout. `--tokens=N` is a checkpoint budget: it prevents another attempt when measured consumption is exhausted or unknown, but cannot promise a hard token cap within a single provider call. An interrupted attempt is persisted before dispatch; recovery accounts for it conservatively and reconciles recorded provider processes before continuing. Unknown process ownership blocks execution. Pause takes effect at an attempt boundary; it does not instantly kill an in-flight agent.

Explicitly extend total budgets without deleting history:

```sh
yoke goal budget . --attempts=5 --minutes=60
yoke goal budget . --tokens=200000
# Only if you deliberately want to remove the checkpoint token limit:
yoke goal budget . --clear-token-budget
```

Unknown historical token usage cannot be made known by increasing its limit. Inspect interrupted work and keep that limitation visible.

## Recover an isolated story

Failed or paused isolated story worktrees are retained. Resume the same story with:

```sh
yoke loop run . --isolate --resume-worktree --parallel=1 --candidates=1
```

Yoke validates the registered worktree, repository, original target commit and PRD digest. Changed target/PRD state is refused; inspect retained edits and reconcile deliberately. This flag is for serial isolated recovery; parallel workers retain their existing coordinator lifecycle. `yoke loop cleanup` remains an explicit cleanup operation; inspect its removal flags before discarding unfinished work. Existing projects should rerun retrofit to add ignore entries for checks, events and goals.

## Spend fewer model calls

Add explicit project rules to `.yoke/config.yaml`:

```yaml
routing:
  enabled: true
  strategy: cost
  maxCandidates: 2
  workers:
    - id: fast
      agent: claude
      model: <your-fast-model-id>
      costTier: low
      capabilities: [docs, tests]
    - id: strong
      agent: codex
      model: <your-strong-model-id>
      costTier: high
      capabilities: [implementation]
  rules:
    - area: docs
      worker: fast
      escalateTo: strong
```

The first matching rule bypasses the routing controller. Its optional area and story ID selectors both have to match when supplied. Independent gate failure escalates the next attempt, including after loop restart; an unavailable or unknown worker falls back to the parent. Without an explicit escalation target the parent handles the failed rule. Other stories retain adaptive routing. Gate-driven routing observations are local and bounded when read. These are measured outcomes, not guarantees that a named inexpensive model can handle every task.

For deterministic operations, configure exact executable arguments:

```yaml
actions:
  - storyId: regenerate-types
    file: node
    args: [scripts/generate-types.mjs]
    timeoutMs: 60000
```

Actions use no model, run without a shell, have bounded output/time and still pass the ordinary story gates before commit. They currently require serial execution with one candidate. On Windows use an executable such as `node` and its script path; shell-only `.cmd` wrappers are not automatically enabled. Commands are project-authored configuration, never free-form model-generated commands. Projects consisting entirely of configured actions do not need a model CLI unless they enable a model-based review or planning workflow.

Implementation/review prompts now select task-relevant project context deterministically within a 6,000-character budget. A stable project/glossary prefix precedes ranked historical references with source paths and content hashes. Excerpts point back to complete files. This does not claim a fixed token count or guaranteed provider cache hit. Mandatory verification always reruns; no broad result cache or selective-test bypass was introduced.

## Parallelism and time estimates

Stories can declare relative file/directory scopes:

```yaml
- id: api-types
  title: Update API types
  priority: 1
  area: api
  writes: [src/api, tests/api]
  needs: []
  acceptance: ["Replace with executable structured criteria in strict projects"]
  passes: false
```

Overlapping declared scopes cannot run simultaneously, including while integration is pending. Dependencies, areas, explicit priorities and concurrency limits also apply. Equal-priority work that unlocks a longer dependency chain is scheduled first. Declarations are advisory scheduling input, not filesystem write enforcement; absent declarations preserve previous behavior. Final integrated gates remain mandatory.

Versioned local events record status, phase duration, attempts and available usage. Retention is bounded to 1,000 events. Estimates combine historical and current durations, preserve failed-attempt cost and expose sample counts and empirical ranges. Schedule estimates simulate dependency, scope and concurrency constraints. Predictions and later errors are attached to completed attempt events so accuracy can be evaluated. Ranges describe observed data; they are not calibrated probabilities or exact deadlines. No history means no justified time estimate.

## Local project dashboard

```sh
yoke projects add /path/to/project
yoke projects list
yoke dashboard .
yoke dashboard --no-register --port=4100
yoke projects remove <opaque-project-id>
```

Open the printed loopback URL. The dashboard displays project goals, backlog, worker/status data, evidence, blockers, events, usage availability and schedule ranges. It can request a goal pause through the same service as the CLI. Start, resume and budget changes remain explicit CLI operations. Removing registration only removes the registry reference.

The HTTP service binds to `127.0.0.1`, validates Host/Origin, requires a per-session token for pause, sends a restrictive CSP and renders project strings as text. It does not serve arbitrary local files or allow remote registration. Missing/corrupt/oversized project data is shown as unavailable. Shared project registration and protected acceptance live under `YOKE_STATE_DIR` or `~/.yoke/state`; existing routing history retains its `YOKE_REGISTRY_DIR` location. The dashboard is local, not a hosted multi-user service.

## Remaining validation and product work

Live Codex/Claude/Gemini comparisons, measured competitive development-time/cost studies and estimate calibration require representative real projects and authenticated runs. Equal adapter contracts do not imply equal model capability. Cloud/team access, automatic selective test reuse, web-based start/resume controls and commercial rollout are not included in this local foundation. The complete saved direction is in [PRODUCT-DIRECTION-2026-09-05.md](PRODUCT-DIRECTION-2026-09-05.md).
