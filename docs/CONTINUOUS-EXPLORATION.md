# Continuous autonomous exploration

The normal loop stops after every accepted PRD story passes and the optional completion gate is
green. `--explore` opts into a supervisor that keeps the loop alive after that point and looks for
the next evidence-backed improvement. Exploration is off by default.

```powershell
yoke loop run . --explore --parallel=auto
yoke loop run . --explore --explore-interval=10
yoke loop run . --explore --explore-limit=3d
yoke loop status .
yoke loop pause .
```

## Discovery and implementation

After the current backlog drains, a configured planning provider inspects the read-only repository
and returns either a short wait decision or up to three independent tasks. Yoke accepts a proposal
only when it has at least 0.8 declared confidence, low or medium risk, existing-file evidence,
non-overlapping relative write scopes, and two to five structured acceptance criteria. Every
criterion must contain an approved test command that names its criterion ID. Paths, duplicate
contracts, dependencies and the combined PRD are validated mechanically.

Accepted tasks are appended to `.yoke/prd.yaml` and committed with the configured commit identity
before implementation. Stories always run in isolated worktrees through the project's existing
acceptance, verify, completion, review, audit, quality and commit gates. `--parallel` works as usual
for independent tasks. When the optional integrated completion gate fails after every story passes,
the explorer receives that failure as context and can propose work to resolve it; the gate itself is
never skipped.

Completed auto-generated stories are compacted out of the active PRD before the next exploration
pass, so the working backlog does not grow forever. Up to 100 recent task fingerprints, IDs and
criterion IDs remain in `.yoke/exploration-recent.json` for duplicate avoidance. Older PRD states and
their full acceptance contracts remain in Git history.

## Waiting, recovery and stopping

The default no-op interval is 30 minutes. Set `--explore-interval=N` to an integer from 1 to 1440
minutes. If a provider fails, returns an invalid proposal, or a story is blocked, the supervisor
keeps running, rotates through available configured providers and retries with exponential backoff
up to 15 minutes. A task that requires a human decision remains pending; the supervisor waits for
the decision instead of declaring completion. During long waits, status heartbeats keep
`yoke loop status` accurate.

`yoke loop pause .` requests a pause at the next safe story or exploration boundary. It exits with
code `3`; start `yoke loop run . --explore` again to resume. An explicit `--max=N` remains a deliberate
story-attempt cap and exits with code `1` if work remains. Without that flag, reaching the end of a
PRD is not a stop condition.

Exploration has no time limit by default. Set `--explore-limit=12h`, `--explore-limit=3d`, or
`--explore-limit=2w` to set a positive duration in hours, days, or weeks. Full unit names also work
when quoted, for example `--explore-limit="2 days"`. When it expires, Yoke pauses automatically at a safe boundary and exits with
code `3`. It stops launching new workers, lets already active workers finish their acceptance,
verification and integration gates, and preserves resumable work. Finite runs process bounded task
batches so an unfinished large backlog does not run past the deadline by draining the whole PRD.
Omitting `--explore-limit` on a fresh run keeps the supervisor unbounded. Dashboard
resume restores the saved absolute deadline and consumed iteration budget, so pausing
does not grant another duration. An already expired saved run remains paused. Starting
an explicit new CLI invocation with a new duration creates a new run and deadline.
The supervisor retains the project lock during idle waits, preventing a second runner
from changing the same project between exploration batches.

The supervisor can retry failures while its process remains alive. Run it in a background process
for long sessions. An operating-system shutdown, forced process termination, exhausted credentials
or unavailable machine cannot be prevented by an in-process loop; after a crash, inspect
`yoke loop status .`, recover retained work if needed, then restart with `yoke loop run . --explore`.

The explorer is a proposal filter, not a guarantee of product maturity. It uses repository evidence
and strict contracts to limit speculative work; implementation still depends on the project's real
tests and any enabled independent review or quality gates. The user decides when the project is
mature enough and can stop the supervisor with `yoke loop pause .`.
