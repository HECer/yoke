# Verified project goals

A goal is a durable objective with explicit executable acceptance. Yoke owns the
completion decision; a model's claim or an unrelated green suite cannot complete it.

## Define and bind acceptance

Create `.yoke/acceptance.yaml` and protect the tests it runs:

```yaml
version: 1
protected: [tests/checkout.test.mjs]
criteria:
  - id: checkout
    text: Checkout saves an order and rejects invalid input
    commands: [node --test tests/checkout.test.mjs]
```

```sh
yoke goal set . --objective="Implement checkout" --criteria=checkout
yoke goal run . --runner=codex --model=gpt-6.1-sol --effort=low
yoke goal status .
yoke goal pause .
yoke goal resume .
```

`--criteria` asserts that the named checks actually prove this objective. Yoke validates
IDs and executable commands and binds the objective to a digest of the acceptance
manifest. It cannot determine whether your tests fully express a free-text request.
All project acceptance and configured regression checks must still pass.

Existing goals without a binding now stop before any model call. Review their tests,
then explicitly bind them with `yoke goal bind . --criteria=checkout`. Attempts and
measured consumption remain intact. Changed acceptance infrastructure still requires
an explicit protection refresh after review; binding never refreshes protected tests.

## Resource and budget controls

Goals and story loops share the project lock and the user-level worker pool. Routing
planner and implementation calls each acquire a permit; native model delegation is
disabled. Explicit runner/model/effort/bare options override project runner defaults.
Execution uses Yoke's safe permission profile.

| Setting | Meaning |
| --- | --- |
| `--attempts=N` on `set` or `budget` | Maximum cumulative attempts, default 3 |
| `--minutes=N` | Cumulative admitted provider work, default 30 minutes; excludes capacity waits and independent checks |
| `--wall-minutes=N` | Optional cumulative run time including admission, checks and state synchronization |
| `--tokens=N` | Cumulative measured input + output tokens; unknown consumption stops further budgeted work |
| `YOKE_MAX_PARALLEL_WORKERS=1..8` | Shared model/integration permit ceiling, default 3 |
| `YOKE_MAX_PARALLEL_CHECKS=1..8` | Separate shared asynchronous goal verification ceiling, default 1 |

After a measured token overrun, Yoke retains evidence and work and reports `blocked`
even if acceptance passed. Update the budget explicitly with `yoke goal budget .
--tokens=50000`; `--clear-token-budget` explicitly removes that ceiling. Providers
reporting usage only after a call cannot provide a hard mid-call token cap. Native
Codex usage units and Yoke's token accounting are recorded separately. Native
stream updates use cumulative turn deltas and request cancellation when measured
consumption exceeds the goal ceiling. Notifications arrive after model requests,
so this can still overshoot within a request; progress updates are never added
twice to persisted final usage.

The asynchronous goal checker can interrupt its own command tree at a deadline or
pause. Synchronous `yoke check` and story gates retain their existing execution
contracts; this check pool is not an operating-system CPU, RAM, or per-test scheduler.
After an interrupted process, unknown consumption is charged conservatively rather
than silently granting a fresh budget.

## Optional native Codex goals

```sh
yoke goal run . --native-goal
```

Or set `goals.nativeCodex: true` in `.yoke/config.yaml`. The default is off;
`--no-native-goal` overrides the project setting. Other providers remain supported.

Yoke negotiates the local Codex app-server goal capability, stores the thread binding,
pauses native automatic continuation, and explicitly starts one bounded development
turn. The same thread resumes on later attempts. Only Yoke's independent acceptance
can synchronize it to `complete`. Provider/model changes create a new binding.
An unsupported native goal method falls back to ordinary Codex execution; authentication,
transport and execution failures remain visible. No global Codex configuration changes
are needed. Support depends on the installed CLI, not on the model name alone.

Codex app-server does not currently support exec's bare startup option. Combining
native goals with `runner.bare: true` or `--bare` stops before dispatch rather than
silently loading user configuration. Use `--no-native-goal` to retain bare execution,
or explicitly disable bare startup when opting into native goals.

## Dashboard resume

The dashboard restores the recorded mode, goal identity and safe execution settings
from `.yoke/run-state.json`. It rejects a mismatched goal identity. A saved story or
exploration run takes precedence over an unrelated legacy unfinished goal. See
[continuous exploration](CONTINUOUS-EXPLORATION.md) for absolute deadline behavior.

Resume restores validated safe options, not every original authorization override.
It uses safe permissions and defaults for self-review overrides and unbounded quality
repair. Reviewer, quality and routing policy still follow the current project config;
implementation and exploration-planner provider/model selections are saved separately.

If process-tree termination cannot be confirmed, Yoke blocks subsequent execution and
retains its process record and concurrency permit. A late confirmed termination can
release the retained permit; otherwise inspect the recorded ownership before restarting
the holder. Uncertainty is not treated as successful cleanup.

Documentation and regression tooling were prepared with AI assistance; test evidence
and release validation are recorded separately from product guarantees.
