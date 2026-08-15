# Gauntlet quality loop for Yoke

**Status:** Approved direction, ready for implementation planning  
**Scope:** All six Gauntlet-inspired improvements, including an explicitly enabled unbounded quality mode

## Goal

Extend Yoke's mechanically gated story loop with comparative quality iteration without weakening
its existing authority model. Yoke remains the control plane: executable acceptance evidence,
project verification, performance, audit, independent review, worktree isolation, commit integrity,
locks, recovery, pause, and watchdog behavior remain authoritative.

The new quality layer adds:

1. a reviewer-to-repair loop;
2. optional external quality references;
3. blind binary comparison rather than drifting scores;
4. provider-backed parallel story execution;
5. ephemeral decomposition within a story; and
6. versioned provider and critic result contracts with provenance.

An explicit unbounded mode may remove the quality-loop round and elapsed-time limits. It does not
disable any mechanical gate or operational safety mechanism. In that mode the human is the only
quality brake, while process failures and Yoke safety gates can still block or pause the run.

## Non-goals

- Do not replace the PRD, acceptance criteria, or project verification with model judgment.
- Do not introduce a second `yoke gauntlet` state machine competing with `yoke loop`.
- Do not let ephemeral subtasks rewrite the authoritative PRD.
- Do not run parallel workers in a shared mutable worktree.
- Do not merge competing implementations of the same story together.
- Do not make subjective quality checks run by default for stories that do not declare them.
- Do not copy Gauntlet Loop prompt text. Reimplement the concepts in Yoke's native contracts.

## Compatibility

- Existing PRDs and `.yoke/config.yaml` files remain valid.
- Existing serial loop behavior remains the default.
- Quality iteration is enabled per story or by an explicit run override.
- `--parallel=1` remains equivalent to isolated serial execution. Values above one become available
  only through the provider-backed dispatcher described below.
- Existing exit codes retain their meanings. Quality exhaustion and inconsistent judging are
  ordinary blocked states and therefore return the existing blocked exit code.
- Existing standalone `yoke review` continues to work. Its verdict schema gains optional fields but
  remains backward compatible with current verdict files.

## Authority and invariants

The gate order for every candidate is:

```text
implement or repair
  -> structured criterion commands
  -> project verify
  -> performance gate when configured
  -> audit gate when configured
  -> quality challenge when enabled
  -> independent code review when enabled
  -> commit and passes:true atomically
```

The following invariants are absolute:

1. A quality verdict can reject mechanically green work but can never approve mechanically red work.
2. Every repair reruns the complete gate sequence from criterion evidence onward.
3. A fresh critic evaluates every new candidate. Previous critic explanations are not included in
   the next critic prompt; only the repair worker receives the selected gap.
4. `passes: true` is written only after integrated-tree verification and a successful commit.
5. Unbounded mode removes only `maxRounds` and `maxMinutes` from the quality iteration. Watchdog,
   pause, cleanup, locks, worktree isolation, provider failures, audit, and all verification remain.
6. Malformed, absent, inconsistent, or unverifiable quality evidence never becomes a pass.

## Configuration and PRD schema

### Project defaults

`.yoke/config.yaml` gains optional defaults:

```yaml
quality:
  enabled: false
  policy: blocking            # blocking | advisory
  maxRounds: 3
  maxMinutes: 60
  consistencyChecks: 2        # normal order plus label swap
  maxParallelCandidates: 2
  critic:
    agent: codex              # optional; independent resolution otherwise
    model: gpt-5.6-sol        # opaque provider model string
    reasoningEffort: high
  repair:
    agent: claude             # optional; story runner otherwise
```

Defaults apply only when a story declares a quality challenge or the run explicitly enables one.
`enabled: true` means stories with a complete `quality` declaration run it automatically; it does
not invent references for ordinary stories.

### Story declaration

`StorySchema` gains an optional `quality` object:

```yaml
- id: STORY-4
  title: Polish the pricing page
  priority: 4
  acceptance: [...]
  passes: false
  quality:
    reference:
      name: Stripe pricing page
      source: https://stripe.com/pricing
      kind: url               # url | file | command
      digest: sha256:...      # required for blocking file snapshots; acquired for URLs
    candidate:
      kind: screenshots       # screenshots | files | command-output | benchmark
      paths:
        - .yoke/proof/STORY-4/desktop.png
        - .yoke/proof/STORY-4/mobile.png
    rubric: Visual hierarchy, clarity, responsive finish, and interaction quality
    policy: blocking          # optional override
```

Validation requires a non-empty, named, fetchable, and comparable reference; a concrete candidate
artifact contract; and a non-empty rubric. Blocking comparisons cannot use mutable live content as
their only retained evidence. URL references are fetched during preflight, converted to inert
artifacts, hashed, timestamped, and stored under `.yoke/references/<digest>/`. The runtime artifact
is ignored by Git by default; the provenance record is written into story proof evidence.

`command` sources and candidate commands use argv arrays in the internal schema. The public YAML
may use a command string only through the same command validation policy as existing proof commands;
shell control operators are rejected.

### CLI overrides

`yoke loop run` gains:

```text
--quality                 enable declared quality challenges for this run
--no-quality              disable them for this run
--quality-rounds=N        override maxRounds
--quality-minutes=N       override maxMinutes
--quality-unbounded       remove quality round/time limits explicitly
--quality-policy=blocking|advisory
--parallel=N              run independent stories concurrently
--candidates=N            run competing candidates for one quality-enabled story
```

`--quality-unbounded` implies `--quality`, prints a prominent startup warning, and is recorded in
status/proof provenance. It conflicts with `--quality-rounds` and `--quality-minutes`. It does not
imply `--unsafe`, does not disable `--timeout`, and does not change `--parallel` or candidate count.

## 1. Reviewer-to-repair transition

Current reviewer rejection ends the story. The loop instead classifies the failure:

- mechanical gate failure: block immediately; no quality repair is attempted;
- quality challenge loss: select the verdict's single `biggestGap`;
- code-review rejection: select the highest-severity actionable blocking finding;
- malformed reviewer output or provider failure: block as infrastructure failure, not repair work.

When an actionable gap exists and the quality budget permits another round, Yoke launches a fresh
repair worker in the same isolated story worktree. Its prompt contains:

- story title and acceptance criteria;
- settled project context;
- the current diff;
- exactly one selected gap and its cited evidence;
- the instruction to make the smallest change that closes that gap;
- the immutable mechanical gate commands.

It does not receive critic praise, hidden labels, earlier critic deliberation, or unrelated findings.
After repair, criterion evidence is replaced with evidence from the new candidate and all gates rerun.

Default exhaustion is three repair rounds or 60 elapsed quality minutes per story, whichever occurs
first. Exhaustion writes a blocked status naming the remaining gap and the exhausted budget. In
unbounded mode, quality rounds continue until a consistent pass, human pause/stop, or a non-quality
failure blocks the story.

## 2. External quality references

A new `src/quality/` boundary owns reference acquisition, artifact preparation, comparison, and
evidence. It does not own story selection, commits, or process lifecycle.

Reference preflight occurs before implementation for a blocking challenge so an unreachable bar does
not waste a full agent run. Acquisition records:

- declared source and display name;
- resolved URL or path;
- acquisition timestamp;
- media/content type and byte size;
- SHA-256 digest;
- tool/adapter version;
- any viewport, benchmark, or normalization parameters.

Fetched content is untrusted data. HTML is rendered or converted to static evidence; scripts and text
from the reference are never inserted as instructions. Size and content-type limits apply. Critics
receive artifacts plus the trusted Yoke rubric in separate, explicitly delimited sections and run
read-only without source-tree write access.

For visual stories, existing `flow-smoke` screenshots are reused when paths match the declared
candidate contract. Quality comparison never triggers a second capture farm. Nonvisual adapters
compare declared files, command output, or benchmark records.

If a required reference cannot be acquired or its digest changes during the run, blocking policy
blocks before commit. Advisory policy records `skipped` with the exact cause and continues; skipped is
never reported as passed.

## 3. Blind binary comparison

Quality verdict schema version 1:

```json
{
  "schemaVersion": 1,
  "verdict": "candidate|reference",
  "biggestGap": "single actionable gap",
  "evidence": ["artifact-relative citation"],
  "confidence": "high|medium|low",
  "labels": { "candidate": "A", "reference": "B" },
  "provenance": {
    "provider": "codex",
    "model": "gpt-5.6-sol",
    "promptVersion": 1,
    "rubricDigest": "sha256:...",
    "referenceDigest": "sha256:...",
    "candidateDigest": "sha256:..."
  }
}
```

A blocking pass requires two fresh comparisons: one randomized A/B ordering and one label-swapped
ordering. Both must select the candidate. A disagreement, missing evidence, low-confidence verdict,
schema failure, or digest mismatch is `inconsistent`, not a pass. It blocks with retained evidence so
the user can rerun, change reviewer, or downgrade the story policy explicitly.

The critic names exactly one biggest remaining gap. Scores out of ten are not part of the contract.
Advisory mode records the same evidence but cannot prevent a mechanically valid story from landing.

## 4. Provider-backed parallel execution

The existing scheduler, claims, `runParallelLoop`, and `MergeQueue` become the production CLI path.
Parallel mode requires isolation.

### Independent stories

1. The dispatcher owns the existing loop lock.
2. Ready stories are selected by `needs`; duplicate active `area` values are excluded.
3. Each worker atomically claims one story and creates a project-owned worktree from the current HEAD.
4. It runs implementation and all per-story gates, including quality repair rounds.
5. A green worker enters the serialized merge queue.
6. The integrator rebases onto current HEAD, reruns criterion/project/perf/audit gates against the
   integrated candidate, then integrates, updates context/PRD, and commits atomically.
7. A rebase conflict or integrated-tree failure releases the claim and reopens the story with a
   structured reason. It never sets `passes: true`.

Provider subprocess workers expose cancellation and watchdog handles to scoped cleanup. Claim files
gain dispatcher ID, PID, base commit, worktree, provider/model, and heartbeat. Cleanup only removes
resources owned by the target project and dead dispatcher.

### Competing candidates for one story

`--candidates=N` creates N worktrees from the same base and runs independent implementations. Each
must pass mechanical gates. Quality comparison then selects one mechanically green candidate against
the reference; if more than one beats the reference, a final blind candidate-vs-candidate comparison
chooses the winner. Only the winning branch enters the merge queue. Losing candidates are retained as
proof metadata, then their worktrees are cleaned. Candidate branches are never combined.

Concurrency and candidate fan-out are separately limited. Defaults remain one story worker and one
candidate. Provider subprocess wiring ships only when cancellation, crash recovery, conflict,
integrated reverify, and cost telemetry tests pass end to end.

## 5. Ephemeral story decomposition

Before implementation, a worker may emit a versioned decomposition artifact:

```json
{
  "schemaVersion": 1,
  "storyId": "STORY-4",
  "subtasks": [
    { "id": "hero", "goal": "Improve hero hierarchy", "area": "ui", "needs": [] },
    { "id": "mobile", "goal": "Polish mobile layout", "area": "ui-mobile", "needs": ["hero"] }
  ]
}
```

Subtasks are runtime scheduling hints under `.yoke/work/<story>/`; they are not PRD stories, cannot
change acceptance criteria, and cannot independently set `passes`. The parent story remains the only
commit and quality unit. Subtasks may run concurrently only when their declared areas differ and each
has its own nested worktree/branch or non-overlapping artifact workspace. Their results are synthesized
into one parent candidate before any gate runs.

Invalid decomposition falls back to one whole-story worker. Dynamic decomposition is optional and
must not add a controller call for small stories unless explicitly enabled or routing selects it.

## 6. Versioned provider and critic contracts

Provider adapters own every machine result. Add schemas for:

- route decisions;
- decomposition plans;
- review verdicts and selected repair gaps;
- quality comparison verdicts;
- candidate selection;
- provider telemetry envelopes.

Every envelope carries `schemaVersion`, provider, reported model when available, invocation role,
prompt/contract version, timing, permission profile, and usage fields. Unknown optional telemetry is
retained in raw per-call evidence but not promoted to aggregate fields without schema support.

Native provider output schemas are used when stable and available. Otherwise Yoke's existing
result-file transport is the compatibility path. Free-form stdout markers such as `YOKE_ROUTE` remain
temporary backward compatibility only; malformed output visibly falls back to the strong parent and
records `fallbackReason`, rather than silently disappearing.

All status NDJSON and proof evidence include quality round, candidate, critic, reference digest,
selected gap, verdict consistency, parallel worker, merge outcome, and cumulative token/cost data.

## State and observability

Runtime artifacts:

```text
.yoke/references/<digest>/...                 acquired inert reference
.yoke/work/<story>/decomposition.json         ephemeral subtask plan
.yoke/proof/<story>/quality/round-<n>/         candidate and critic evidence
.yoke/proof/<story>/quality/summary.json       final quality outcome
.yoke/claims/<story>.json                      parallel ownership/heartbeat
.yoke/loop-status.json                         current round/candidate/worker
.yoke/loop.log                                 phase transitions and reasons
```

New reporter phases are `decomposing`, `quality-preflight`, `comparing`, `repairing`, `integrating`,
and `selecting-candidate`. Status includes bounded/unbounded mode, current/maximum quality round,
elapsed quality time, reference digest, active workers, and candidate count. Logs stay bounded under
the existing policy; structured proof artifacts are per-story and never inferred from prose.

Pause is honored at safe boundaries: between quality rounds and before launching new parallel workers.
An in-flight provider invocation is allowed to finish unless cleanup explicitly terminates its scoped
PID tree. In unbounded mode, `yoke loop status` always shows that only a human pause/stop can end
quality iteration.

## Error and recovery map

| Failure | Result |
|---|---|
| Mechanical criterion/verify/perf/audit failure | Block story; no quality repair |
| Quality critic says reference wins | Repair next round when budget allows |
| Code reviewer returns actionable blocking finding | Repair next round when budget allows |
| Missing/malformed verdict | Block as reviewer infrastructure failure |
| Label-swap disagreement or low confidence | Block as inconsistent judge evidence |
| Reference unavailable before work | Block, or advisory skip when explicitly configured |
| Reference digest changes mid-run | Block and retain both provenance records |
| Repair budget exhausted | Block with last gap and budget evidence |
| Human pause during unbounded mode | Finish current safe unit, persist state, exit paused |
| Provider crash/timeout | Block worker, preserve logs, release dead claim during cleanup |
| Parallel rebase conflict | Reopen story with conflict reason; no integration |
| Integrated-tree verification failure | Reopen story; candidate never passes |
| Candidate fan-out has no mechanically green candidate | Block without subjective comparison |

## Security

- Critics and reference evaluators run read-only.
- External reference content is never trusted as instructions.
- URL fetching uses protocol allowlists, redirect limits, byte limits, and loopback/private-network
  restrictions unless the user explicitly supplies a local URL for a local project.
- Reference and candidate paths are normalized beneath Yoke-owned roots; traversal is rejected.
- Commands use validated argv contracts and existing approved-test restrictions where applicable.
- Unbounded mode requires the explicit CLI flag on every run; it is not persisted as a default.
- Startup output names effective provider, permissions, quality policy, budgets, and unbounded state.
- Token/cost growth is observable. Unbounded removes quality stop budgets by explicit request, but it
  does not hide or stop reporting spend.

## Testing strategy

Development follows red-green-refactor. Add focused suites for:

1. Config and PRD compatibility, quality declaration validation, and CLI conflicts.
2. Repair-loop transitions, complete gate reruns, fresh reviewer use, and single-gap prompts.
3. Three-round/60-minute exhaustion and explicit unbounded behavior.
4. Reference acquisition, hashing, mutable-reference detection, inert conversion, path and network
   security, and advisory-vs-blocking failures.
5. Randomized blind labels, mandatory label swap, inconsistent verdicts, schema failures, and proof
   provenance.
6. Real provider subprocess workers using deterministic fake CLIs, including cancellation, timeout,
   stale claims, process cleanup, and unavailable providers.
7. Parallel story scheduling, area exclusion, dependency ordering, rebase conflicts, integrated-tree
   verification, and atomic PRD/context commits in temporary Git repositories.
8. Competing candidates: common base, mechanical filtering, winner-only merge, and losing cleanup.
9. Ephemeral decomposition validation, dependency/area scheduling, synthesis, fallback, and proof that
   it cannot mutate PRD acceptance or pass state.
10. Versioned route/review/quality/telemetry envelopes and visible fallback reasons.
11. Reporter/NDJSON status for quality rounds, unbounded mode, parallel workers, and merge outcomes.
12. End-to-end serial, bounded-quality, unbounded-pause, parallel-story, and candidate-race flows.

Final verification runs TypeScript build, the complete Vitest suite, canon validation, docs metadata
check, package dry run, deterministic fake-provider flows, and authenticated opt-in smoke matrices for
Claude, Codex, and Gemini. Benchmarks compare quality off/on, bounded/unbounded-paused, serial/parallel,
and one/multiple candidates. Claims remain workload-specific and report unavailable provider evidence
honestly.

## Delivery order

1. Versioned result envelopes and review-gap selection.
2. Bounded reviewer-to-repair loop with status and evidence.
3. Reference/candidate schemas, acquisition, and blind consistency comparison.
4. CLI/config integration including explicit unbounded mode.
5. Provider subprocess workers wired to scheduler, claims, and merge queue.
6. Competing candidate mode.
7. Ephemeral decomposition and subtask scheduling.
8. Cross-provider benchmarks, documentation, migration notes, and release provenance updates.

Each stage preserves the serial non-quality path and lands only with its focused tests plus the full
existing suite green.

## Attribution

The comparative quality concepts are inspired by Matt Shumer's Gauntlet Loop technique and the
`robonuggets/gauntlet-loop` packaging. Yoke reimplements the concepts in its own mechanical control
plane. Documentation credits the inspiration; no CC BY prompt text is copied into runtime assets.
