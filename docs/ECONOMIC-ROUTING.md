# Measured capability routing

Yoke 1.22 adds optional economic selection to capability routing. It compares
observed, independently verified execution sequences. It does not assign an
estimated success probability to a model or assume that a profile labelled
`low` has the lowest cost of completing a task.

## Configuration and compatibility

```yaml
routing:
  enabled: true
  strategy: capability
  optimization:
    version: 1
    objective: balanced
    minSamples: 20
```

This fragment supplements the project's existing routing profiles and limits.
`minSamples` defaults to 20 and has a minimum of 10. Existing configurations
without `routing.optimization` retain their previous capability ordering. New
setup-generated capability configurations enable the conservative `balanced`
policy; this does not change selection until sufficient comparable measurements
exist.

The planner's task/risk assessment still determines the minimum capability tier.
Configured provider constraints, allowed roles, `maxTier`, parent-fallback policy,
and the existing gate-failure reliability filter remain in force. Economic
selection only compares profiles that survive those checks. Explicit project
routing rules retain their precedence.

## What a sample measures

The comparison unit is a bounded **execution sequence for one task contract**,
attributed to the profile that started it. If a small model needs a targeted
repair and then escalation to a stronger model, all those measured attempts
belong to the initial profile's sequence. Charging only the final successful
model would hide the cost of the failed attempts.

Within a fully accounted execution attempt, the durable call ledger includes:

- The routing/planning call made inside that execution, when one was needed.
- The implementation call, including reported usage from interrupted calls.
- Additional reviewer, critic, repair and model-driven quality calls joined by
  the loop reporter before its final outcome.

Stable call IDs prevent a worker's usage from being counted again when its
aggregate reaches the reporter. An explicit attempt ID can join a call directly.
Without one, a role call is joined only if that story has exactly one open
attempt. Competing candidates make the attribution ambiguous; all affected
samples become incomplete instead of assigning the bill by guesswork.

The measured scope is `execution-attempt`. It is not the total cost of producing
or shipping a product. Separately prepared PRD drafts, batch assessments, change
planning, human work and later operational costs are not amortized into these
samples. Their separately emitted telemetry remains useful for project-level
analysis. The duration covers each admitted attempt through its recorded gate
outcome, summed across the sequence; it does not include idle time between
separate attempts or a developer's review time.

Only native loop paths with the complete role-accounting contract enable this
scope. Injected runners/gates and ambiguous candidate races remain `worker`
scope. Their measurements are still available diagnostically, but cannot supply
the complete evidence required for economic selection.

## Evidence and missing data

For each eligible starting profile, the router examines its most recent
`minSamples` comparable sequences. They must share the project, implementation
role, task-assessment dimensions, effective execution-policy key, requested
provider/model/effort/variant, and the current reported concrete starting model.
The policy key binds the effective gate and review configuration, including
commands and retries. A change to the concrete model starts a new evidence
window even when its requested alias remains the same.

A sequence is complete only when every reserved attempt has an outcome and the
sequence has either passed independent gates or exhausted its bounded attempt
allowance. Every attempt must have known token coverage, complete reported cost,
the full execution scope, and the same policy key. Infrastructure failures are
not treated as evidence of model reasoning quality and do not qualify for the
economic comparison.

One recent unknown or partial sequence keeps its window ineligible. The router
does not discard that row and search for an older successful subset. Open
sequence records are replaced by their later completion record, and retries do
not turn into additional independent samples. The optional observation registry
uses a 30-day evidence window and reads at most its latest 1,000 events; losing
economic history leads back to conservative selection.

Unknown usage is distinct from measured zero. Known partial token or dollar
amounts are retained with incomplete-coverage flags. For example, a fully
measured worker remains visible when its planner supplied no usage. OpenCode
and Kilo step summaries require coverage of every completed step before they
claim complete token totals; absent optional cache or cost fields are not
converted into measured zeros.

No reported dollars means no cost ranking. Yoke does not invent a bill from
declared cost tiers, token counts or a presumed provider price table. This can
leave economic routing at its conservative baseline for providers that do not
report sufficient telemetry.

## The three objectives

The baseline is the first eligible profile under the existing tier, declared
cost-tier and profile-ID ordering. Both the baseline and an alternative require
a complete evidence window. An alternative must have at least as many accepted
sequences in that equally sized window as the baseline.

The router computes two observed ratios:

```text
cost per accepted sequence = total measured sequence dollars / accepted sequences
time per accepted sequence = total measured sequence duration / accepted sequences
```

The numerators include completed failed sequences and every measured repair or
escalation in the window. A profile with zero accepted sequences is ineligible.

| Objective | Condition for choosing an alternative |
| --- | --- |
| `cost` | Lower observed dollars per accepted sequence, with no lower observed acceptance count. |
| `speed` | Lower observed duration per accepted sequence, with no lower observed acceptance count. |
| `balanced` | No higher cost or duration, and at least one strictly lower, with no lower observed acceptance count. |

`balanced` uses this conservative comparison instead of inventing a dollar
value for a second of runtime. Cost and speed can disagree; use the corresponding
explicit objective if that tradeoff is intentional. Equal scores preserve the
existing ordering.

Decision reasons identify the objective, sample count, observed acceptance
count, and measured ratios. When the baseline lacks enough data, they explain
the missing evidence and retain its existing ordering. These are observational
measurements, not calibrated forecasts or statistical confidence guarantees.
Task mix, repeated correlated failures and changing model behavior can still
affect the comparison. The minimum window is a conservative product policy,
not a claim that twenty examples prove superiority.

Reviewer and critic approval frequency is not independent evidence that their
reviews were good. Economic reordering of those roles therefore remains disabled
until an independent role-quality measure is available; their risk-based floors
and explicit model selections continue to apply.

## Persistent attempt admission

Capability routing reserves an attempt before invoking its implementation
provider. Configured bounded legacy routes use the same account. The account
is stored under the stable project root, keyed by story and bound task/plan
contract, and is independent of the optional global observation registry.
Exclusive immutable reservation files prevent two processes from replacing the
same slot. An unreadable or unwritable authoritative account blocks admission.

The capability allowance is the smaller of `maxAttempts` and the existing
tier-dependent bound: five attempts from `light`, four from `standard`, three
from `strong`, and two from `frontier`. Independent outer loop, goal and local
retry limits can stop execution sooner. Infrastructure or interrupted attempts
still occupy their reserved slots, but do not become verified reasoning failures
that automatically demand a stronger model.

Deleting or filling the optional registry, restarting a runner, or executing in
another disposable worktree does not restore those slots. Repeated preparation
or budget refusals before an implementation is admitted do not consume an
implementation attempt. A planner may itself incur cost before a later worker
is refused; that paid call is still reported. Goal callers recheck their durable
budget after planning and before implementation reservation.

A changed task/plan contract has a new account. Resume an unchanged blocked task
only after inspecting its reason and performing the required replan or explicit
configuration change. Do not delete authoritative attempt state to disguise
retries as a new run.

## Validation limits

The release tests use deterministic fake calls and synthetic observations. They
cover registry write failure and history eviction, restart-safe reservations,
known partial usage, synchronous/asynchronous provider telemetry, paid early
blocks, callback/write failures, complete escalation accounting, cold starts,
model/policy changes and objective selection. They are regression tests for the
accounting and decision rules, not provider performance benchmarks. No claimed
cost or speed improvement follows from those test fixtures.
