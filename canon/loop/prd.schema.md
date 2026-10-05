# PRD Schema

The loop is driven by a continuous PRD backlog. Each story:

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  needs: []              # optional dependency IDs; no unknown IDs, self-links, or cycles
  area: api              # optional collision domain for parallel scheduling
  agent: codex           # optional supported harness affinity
  acceptance:
    - id: valid-request-returns-200
      text: The endpoint returns 200 for a valid request.
      verify: [npm run test:valid-request-returns-200]
    - id: invalid-request-returns-400
      text: The endpoint returns 400 for an invalid request.
      verify: [npm run test:invalid-request-returns-400]
  passes: false          # Yoke-owned; true only after all gates pass and the commit lands
```

Each new story has 2–5 acceptance criteria. Every criterion has a stable `id`, observable
behavioral `text`, and one or more executable `verify` commands. Each entry is one approved test
command, contains the normalized criterion ID, and contains no shell control operator. Yoke runs and records each criterion separately in
`.yoke/proof/<story>/evidence.json`; a broad green suite cannot stand in for an untested
criterion. Legacy string criteria remain readable, but `verify.requireCriteria: true` blocks
them.

The binding is deliberately mechanical, not an oracle for product meaning: Yoke can require a
criterion-targeted test command and a separate coverage review, but it cannot prove that arbitrary
test code faithfully models the real world. Critical cross-component behavior therefore also
belongs in a trusted `completion.command` journey suite.

`sourceChange` is an optional Yoke-owned request ID. The change inbox uses it to append new
stories idempotently; authors normally omit it.

`assessment` holds the planner's task class, difficulty, uncertainty, risk, scope, testability,
reason and approach. `assessmentFor` is a Yoke-generated SHA-256 binding to the task requirements,
upstream contracts and approved brief. Do not copy a binding onto changed requirements.
With `routing.assessmentPolicy: prepared`, use `yoke prd assess` after editing contracts;
dispatch blocks missing or stale assessments. See [capability routing](../../docs/CAPABILITY-ROUTING.md).

Stories without `needs`, `area`, or `agent` retain serial behavior. A story is ready only when
every ID in `needs` passes. The scheduler orders ready work by priority, avoids simultaneously
active areas, and uses `agent` as a supported harness affinity hint.

The backlog is continuous, not a release object. A momentary stop condition is every story
having `passes: true`; if configured, `completion.command` must then prove the integrated
system before the loop reports `complete`.

## Original objective and coverage ledger

New `yoke prd draft` output includes `.yoke/requirements.yaml` alongside the unchanged
story array. Both files are produced in one planning call and restored together if the
provider or validation fails. Drafting requests the smallest coherent decomposition of
1–12 stories. Shared contracts have an explicit file owner and stabilize before dependent
components run in parallel.

The ledger uses this shape (digest placeholders below must be replaced with real hashes):

```yaml
version: 1
objective:
  idea: The exact original --idea input, including whitespace.
  approvedPlanSha256: <SHA-256 of the exact approved .yoke/plan.md content, or empty string content>
  sha256: <SHA-256 of JSON.stringify({idea, approvedPlanSha256}), in that property order>
requirements:
  - id: REQUIREMENT-1
    text: The endpoint handles valid requests.
    criteria:
      - story: STORY-1
        criterion: valid-request-returns-200
invariants:
  - id: INVARIANT-1
    text: Invalid requests continue to return 400.
    criteria:
      - story: STORY-1
        criterion: invalid-request-returns-400
```

`objective` is supplied by Yoke in the draft prompt; the planner copies it exactly.
Yoke compares the returned idea with the original input, rather than rebuilding the objective
from story titles or summaries. After validation, Yoke writes a host-owned `requirementsFor`
SHA-256 field on every drafted story. This field binds the original objective and survives
progress saves. A bound PRD requires its ledger: removing the sidecar is an error, and a
self-consistent replacement objective cannot match the original PRD binding. The planner
must preserve bindings on retained story IDs during forced redrafting. Every later PRD load
checks these bindings, the objective digest and the current approved plan digest.
An authorized `--force --idea` replacement can retain the same story IDs: the host checks
the planner preserved their previous markers, validates the replacement against the exact
new input, and then activates the new binding. Ordinary PRD loading never performs rebinding.
Hashes bind content; they are not signatures or proof of who
approved it. Editing an approved plan requires intentionally refreshing the ledger and
prepared assessments.

The file is limited to 200,000 bytes, with 1–100 requirements and 0–50 invariants. IDs are
globally unique across both lists and at most 120 characters. Entry text is 1–2,000 characters;
each entry has 1–50 unique story/criterion references. Every reference must resolve to exactly
one structured executable criterion. Every story in a project with an active ledger must
declare nonempty `writes` and structured executable acceptance. Overlapping write scopes
must have a direct or transitive dependency establishing the write order. A shared `area`
alone does not establish contract ownership.

Active ledgers are enforced by `loadPrd`, so checking, serial scheduling, parallel scheduling
and completion use the same coverage validation. Progress saves preserve the ledger.
Prepared assessment contracts include the raw ledger digest; even an invariant edit makes
old preparation stale. Worker and reviewer packets retain the original objective, relevant
requirements, and all preserved invariants without silently truncating binding content.

Candidate acceptance protection compares the exact ledger and approved-plan bytes with
the baseline workspace, including additions and deletions, even without a pinned
acceptance manifest. Explicit acceptance protection also pins these files when present.
Append-only change intake currently rejects projects with an active ledger before calling
providers: adding a new approved objective requires updating source binding and coverage
together. The pending request is retained; legacy intake remains supported.

Legacy unbound arrays without this sidecar remain readable. `yoke prd check` explicitly reports that
original-objective, requirement and invariant coverage were not checked. String acceptance
and missing write ownership retain their legacy limits; a green legacy check does not establish
the stronger ledger contract. Adding a ledger enables its validation for the entire backlog.

Mechanical coverage establishes that named outcomes have executable references. It cannot
prove that the planner extracted every requirement, that a criterion faithfully represents
the requirement, or that a passing test covers real behavior. Independent review must compare
the original objective and approved brief, check preserved capabilities and boundary states,
and assess test adequacy. Integrated completion evidence remains required when configured.
