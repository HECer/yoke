# Multi-agent parallel loop — evaluation & design (2026-07-10)

**Question:** when a project is implemented via the Yoke loop, can we distribute the open
stories across *many* agents in parallel — and does that actually speed up completion?

**Answer:** yes, with a bounded design — the worktree machinery we already have does most of
the work — but parallelism pays off only under specific conditions, and it multiplies token
cost. This doc evaluates where it helps, where it hurts, and specifies a three-phase design.

## Where we start (current state)

- The loop is strictly **serial**: one story at a time, selected by lowest `priority`
  (`src/loop/prd.ts` — `selectNextStory`), guarded by a single-flight lock (`.yoke/loop.lock`).
- `--isolate` already gives every story its **own detached git worktree** under
  `.yoke/worktrees/<story-id>`, merged back with `git merge --ff-only` and discarded on failure.
  This is exactly the isolation primitive a parallel dispatcher needs.
- The PRD schema has **no dependency field** — stories are implicitly assumed independent,
  ordering is a soft hint via `priority`.
- Two multi-agent mechanisms already exist, both *role-parallel*, not *task-parallel*:
  the reviewer can be a different agent (`--reviewer=codex`), and the
  `dispatching-parallel-agents` / `subagent-driven-development` skills cover in-session
  fan-out *within* one Claude Code session.

## When parallelism actually speeds things up (the honest part)

Parallel story execution helps iff:

1. **Stories are genuinely independent** — no shared files, no semantic coupling. Two stories
   editing the same module produce merge conflicts or, worse, silently incompatible designs
   that both pass their own acceptance tests.
2. **Verify is the short pole, not the long pole.** Each merged story must be verified against
   the *integrated* tree (merge-queue semantics). If `npm test` takes 10 minutes, merges
   serialize on verification and N workers approach 1× speedup (Amdahl).
3. **Wall-clock matters more than spend.** N parallel agents ≈ N× token cost for (at best)
   ~N× wall-clock speedup on the parallel portion. Parallelism buys *time*, never *efficiency*.

Typical PRDs from `yoke prd draft` (5–12 stories on one small codebase) violate (1) more often
than not — early stories scaffold what later stories touch. The realistic win is **2–4 workers
on the independent middle of a backlog**, not 12 workers on 12 stories.

## Design

### Phase 1 — dependency-aware parallel dispatch (`--parallel=N`)

- **PRD schema:** add optional `needs: [story-ids]` per story (default `[]`). `prd.schema.md`
  documents: "list the stories whose *code* this story builds on." `yoke prd draft` prompts the
  drafting agent to emit `needs` — it already reasons about ordering when assigning priorities.
- **Scheduler:** ready-set = open stories (`passes: false`) whose `needs` are all
  `passes: true`. Dispatcher keeps ≤ N workers busy; each worker claims a story via a per-story
  claim file (`.yoke/claims/<story-id>.json`, PID + timestamp — same liveness logic as the
  existing loop lock), runs the full existing pipeline (implement → verify → review) inside its
  own worktree.
- **Merge queue (the critical piece):** workers never integrate directly. Completed worktrees
  enter a FIFO queue; a single integrator (a) rebases the worktree branch onto current HEAD,
  (b) re-runs verify if HEAD moved since the story's base, (c) ff-merges, (d) marks
  `passes: true`. Rebase conflict → story goes back to the ready-set with a `merge-conflict`
  note for the next agent run; the loop's "nothing lands unverified" invariant survives
  parallelism intact.
- **Single-flight lock** stays, reinterpreted: it now guards the *dispatcher*, not the story.

### Phase 2 — conflict avoidance (make parallelism worth turning on)

- Optional `area:` label per story (e.g. `area: api`, `area: ui`); the scheduler never runs two
  stories with the same area concurrently. Cheap, no file-prediction magic, removes the most
  common conflict class.
- Record per-story wall-clock + rebase-conflict counts (the benchmark harness in `bench/`
  measures this from outside today; the reporter should own it) so `--parallel` can be
  recommended or discouraged per project from *data*.

### Phase 3 — heterogeneous workers (cross-agent dispatch)

Workers need not be the same CLI. Assignment policies, in order of usefulness:

1. **Availability/cost:** cheap-fast model for low-priority stories, strongest model for
   stories with many dependents (they block the most downstream work).
2. **Affinity:** per-story `agent:` hint (e.g. Gemini for large-context refactors).
3. **Review stays cross-model** — implementer ≠ reviewer per story, as today.

Prerequisite: token reporting for gemini/codex runners (today only claude reports usage via
stream-json), otherwise cost-based policies fly blind.

## What we deliberately do NOT build

- **No shared mutable context between concurrent agents.** Each worker reads the committed
  context layer at its worktree's base commit. Context/DECISIONS updates land only through the
  merge queue, serialized. Cross-talk between concurrent agents is how "overnight loop" horror
  stories happen.
- **No optimistic file-overlap prediction.** Predicting which files a story will touch before
  running it is guesswork; `needs` + `area` + rebase-verify catch the same failures mechanically.
- **No parallelism by default.** Serial stays the default; `--parallel` is opt-in per run,
  consistent with every other Yoke escalation (`--isolate`, `--review`, loop itself).

## Verdict

Worth building, in this order, behind an opt-in flag: **Phase 1 is ~3 focused Bausteine**
(PRD `needs` + scheduler/claims + merge queue) on top of primitives that already exist and
are tested (worktrees, locks, gates). Phase 2 is small and makes Phase 1 honest. Phase 3 is
where "one harness, three agents" becomes a genuinely unique capability — no other harness
dispatches one backlog across Claude, Codex, and Gemini concurrently with mechanical gates.
