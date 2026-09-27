# Parallel execution

Yoke parallelizes independent PRD stories. The scheduler respects declared dependencies, collision
areas and overlapping `writes` scopes. Each worker edits an isolated worktree; its result still has
to pass the integrated-tree gates before Yoke commits it.

## Worker limits

The shared pool admits at most **three worker units by default** across Yoke loop processes running
under the same user account. Set `YOKE_MAX_PARALLEL_WORKERS` to an integer from 1 to 8 to change the
ceiling. For example:

```powershell
$env:YOKE_MAX_PARALLEL_WORKERS = '6'
yoke loop run . --parallel=auto
```

The environment setting is read when each Yoke process starts. Active and waiting pool records
advertise their configured ceiling; while those processes are alive, the smallest advertised limit
is used for new admissions. Lowering a limit does not cancel running work: Yoke waits for active
units to drain before admitting more. Set the same value for all long-lived Yoke processes when a
consistent ceiling is desired.

`--parallel=N` and `loop.parallel` accept values from 1 to 8. This is the per-project maximum for
simultaneous implementations; the shared pool can lower actual activity across projects. `auto`
uses up to the shared limit when every pending story has a nonempty `writes` declaration. Dependency
readiness, areas and overlapping scopes still decide which stories can start. If scopes are missing,
automatic execution uses one local implementation slot. Competing candidate runs spend one unit per
candidate, so `--candidates=3` requires a shared limit of at least three.

The pool keeps small user-local lease records under:

- Windows: `%LOCALAPPDATA%\Yoke\parallel-pool`
- Linux/macOS: `$XDG_STATE_HOME/Yoke/parallel-pool`, or `~/.yoke/Yoke/parallel-pool` when
  `XDG_STATE_HOME` is unset

Records contain process identity, provider and role, worker weight, timestamps, and truncated hashes
of project and story identifiers. They do not contain prompts, file contents or absolute project
paths. They are coordinated through atomic file operations. The owner process must be known dead
before its lease is reclaimed; process identity and a 30-second stale window protect against PID
reuse and short interruptions. Admission fails closed if a record is malformed or ownership cannot
be checked. On a corruption error, stop all Yoke processes first, make a backup of the pool directory,
then inspect or move the stale pool aside before restarting. Never remove a record while its owner is
alive.

Adaptive routing can select a different provider after dispatch, so Yoke records provider use but
does not claim a hard per-provider cap. Native subagent delegation remains disabled inside loop
workers so nested agents cannot multiply the shared budget.

## Implementation and integration lanes

`--parallel` counts implementation slots. A finished candidate releases its implementation unit
while it waits in the project's FIFO integration queue. The integration lane reserves one shared
unit while it rebases, reruns integrated-tree gates, commits, checks cleanliness and cleans up. Its
area and `writes` scopes remain reserved until that sequence ends, so overlapping or dependent work
cannot start early. Independent stories can use the freed implementation slot during integration.

The worker pool is shared across projects; each project's integration queue is serialized. A global
limit of three therefore caps combined implementation and integration work, even if several project
loops are active. Cancellation removes a waiting reservation and leaves existing recovery behavior
unchanged.

`yoke loop status` and the dashboard's **Now** view report local slots, workers waiting for capacity,
the shared active-unit count, integration activity and queued integrations. Event history records
implementation/integration resource waits, integration queue wait, integration duration and the
existing worker phases. The schedule forecast simulates dependency-aware implementation slots plus
one serial integration lane when integration measurements exist. Older runs without those events
remain visible as missing integration history; forecasts are empirical ranges, not deadlines, and do
not predict future contention from other projects.

## Safe task decomposition

Make a preview with:

```sh
yoke prd decompose . --story=API-1 --runner=codex
```

The planner proposes two ordinary child stories and changes no PRD data. Applying requires the
explicit flag:

```sh
yoke prd decompose . --story=API-1 --runner=codex --apply
```

Yoke only accepts a split when the unfinished parent has at least four structured acceptance
criteria, at least two valid non-overlapping declared write scopes, and no shared `area`. The
proposal must allocate every original criterion and every declared scope exactly once, with 2–3
criteria per child and no overlap. Children preserve their exact criterion text and verification
commands, inherit upstream dependencies and agent affinity, and cannot depend on each other. A
parent with an area or too few scopes/criteria is refused; refine the task contract first or keep it
serial.

`--apply` acquires the project loop lock, rechecks hashes of the PRD and approved planning brief,
validates the resulting dependency graph, then atomically replaces the parent. Stories that depended
on the parent are updated to depend on both children. Task-specific assessments and quality
declarations are not copied to different work contracts: reassess with `yoke prd assess`, and add a
child-specific quality declaration before using competing candidates. A stale input or invalid
proposal is rejected without applying the split.

Write scopes remain advisory scheduling information, not filesystem permissions. A good split must
also keep each child independently verifiable and avoid hidden shared interfaces. Yoke does not
claim that splitting a task improves model quality or lowers token spend.

## Synthetic efficiency benchmark

After building Yoke, run:

```sh
npm run build
node bench/run-parallel-matrix.mjs
```

The matrix uses the real dispatcher with a local deterministic runner and fixed implementation and
integration delays. It compares one, two and three implementation slots over a dependency chain,
independent scopes and conflicting scopes. It reports wall time, summed worker time, integration
queue wait, integration time, attempts and accepted stories. It makes no provider, token, quality or
large-repository claims.
