# Native managed workspaces (M1 slice, unreleased)

This branch adds an **executable bounded text-edit path** to the existing serial,
isolated Yoke loop. It does not replace the scheduler or introduce an Orca dependency.
Ordinary CLI workers keep their existing behavior. This is not a production 2.0 release.

## What runs now

`actions[].kind: workspace-edit` selects the native data adapter. Instead of executing
an arbitrary command or asking a model to write files, it consumes an operator-authored
set of replacement texts with explicit file preconditions. The existing loop selects
the story, owns the project lock, creates its worktree, runs the configured gates and
reviews, and performs the normal commit/integration. The adapter never marks a story
passed by itself. A failed managed action is an infrastructure failure, so a green
pre-existing test cannot turn a rejected edit into success.

The implementation connects these boundaries:

| Boundary | Implementation | Limitation |
| --- | --- | --- |
| Shared reading | Immutable UTF-8 snapshots; all readers may reuse the same revision | Explicit files, not an automatic full-repository index or model context |
| Exclusive mutation | One revocable writer handle; snapshot and file SHA-256 preconditions | Enforced on broker API operations, not arbitrary host processes |
| Candidate ownership | Actual registered Git worktree and existing external recovery record | Git worktrees are not an OS sandbox |
| Admission | Existing lock-owner token, revisioned budget and durable reservation before file publication | Only this native action is connected to the new ledger in this slice |
| Publication | Stage replacements, recheck source, retain before/after backups and an intent journal | Individual file replacements; no cross-file filesystem transaction guarantee |
| Verification | Pin candidate fingerprint/HEAD and target state before gates; recheck after gates/review | Detects lasting changes at boundaries, not a hostile write-and-restore attack |
| Acceptance | Existing criteria, verify, optional gates/review, protection and integration | No new acceptance authority, no self-certified completion |

An internal topology-plan call describes the **in-process data broker** whose methods
are implemented and tested here. Its capability values are not inferred from installed
CLI names or accepted from the M0 JSON example. Runtime inventory checks reject leftover
runner/provider records and unresolved supervision at the root and candidate. They do
not discover every manually started program on the host. The M0 `workspace-plan`
command remains non-authorizing advice.

## Opt in through the existing loop

Work on a disposable test repository first. Use a checkout of this PR and build it:

```sh
npm ci
npm run build
```

Prepare a project with committed `.yoke/config.yaml`, `.yoke/prd.yaml`, a real test
command and `.yoke/acceptance.yaml`. Keep normal Yoke runtime paths ignored; at least
`.yoke/worktrees/`, `.yoke/loop.log` and `.yoke/control-plane/` must not be committed.
`yoke retrofit` now includes the control-plane directory in its generated ignore list.
Yoke's own staging also excludes control-plane state, including accidentally staged
journals and backups.

Inspect exact current file hashes without printing source contents:

```sh
node /path/to/yoke/dist/control-plane/cli.js workspace-snapshot /path/to/project src/value.txt
```

This command reports a bounded observation, **not a live filesystem freeze**. Its output
contains `coverage: "explicit-files"`, a snapshot ID, and file hashes, sizes and executable
intent. A missing requested file has a null hash; an empty file has the SHA-256 of empty
text. File contents and unrelated paths are not exposed. Invalid input exits 2.

For a file containing exactly `before` plus a newline, append the following action to
the project's configuration (the hash below is for those exact UTF-8 bytes):

```yaml
canonVersion: 0.1.0
agents: [codex]                  # ordinary fallback provider; not invoked by this action
loop:
  enabled: true
  isolate: true
verify:
  command: node tests/gate.cjs    # must actually assert the requested outcome
  retries: 1
routing:
  enabled: false
actions:
  - kind: workspace-edit
    storyId: S1
    writeScopes: [src]
    reserveComputeMs: 1000
    edits:
      - path: src/value.txt
        expectedSha256: 9160d4be34c8695bd172a76c7c7966587ea5a4d991ad22c87b2b91af54aa9ebb
        content: "after\n"
```

The matching PRD story must declare `writes: [src]` and meaningful acceptance criteria.
Action write scopes must be contained in those story scopes. In `.yoke/acceptance.yaml`,
list the test infrastructure in `protected`, for example `tests/gate.cjs`; keep executable
criteria in `criteria`. `yoke check /path/to/project --protect` can pin the existing
acceptance baseline outside the worktree. The native broker also denies `.git`, `.yoke`,
protected test paths and common package/lock manifests. Do not weaken protection to
make an edit pass.

Initialize the new ledger explicitly using a limits JSON file:

```json
{"tokens":0,"costMicrousd":0,"computeMs":60000,"maxActive":1}
```

```sh
node /path/to/yoke/dist/control-plane/cli.js budget-init /path/to/project limits.json
node /path/to/yoke/dist/cli.js loop run /path/to/project --isolate --parallel=1 --max=1
node /path/to/yoke/dist/control-plane/cli.js budget-show /path/to/project
```

The budget is initialized only once, never silently reset. Commit configuration and
source before running the loop. A successful action remains subject to real tests and
any configured review or additional gates. The integration test in
`tests/control-plane/native-workspace.integration.test.ts` constructs a complete temporary
Git repository and executes a real Node test process without any model credentials.

Creation uses `expectedSha256: null` and a string replacement. Deletion uses the current
SHA-256 and `content: null`. Empty text is valid; it is different from deletion. This
adapter deliberately does not edit binaries, links, permissions or arbitrary filesystem
objects. It preserves existing ordinary permission bits when replacing text on POSIX.
Limits are 200 explicit files, 1 MiB per file and 8 MiB per snapshot. Paths must be portable
literal repository-relative names without traversal, globs, reserved Windows aliases,
case-colliding entries or linked ancestors.

Managed actions currently require `parallel=1`, one candidate and a fresh real isolated
worktree. Non-isolated runs, injected Git adapters and automatic worktree resume are
rejected. Legacy command actions and ordinary model runners retain their prior options.
Multiple immutable readers are supported by the broker library; this slice does **not**
start a group of model-based live observers or expose a new model-facing MCP edit tool.

## Failures, accounting and recovery

The native adapter persists an in-flight reservation under the existing root lock
before publication. `transactLedgerOwned` verifies the actual current process and owner
token and never reacquires or releases the loop's lock. It rechecks ownership/revision
after the transaction callback and refuses nested transactions, limit changes and
history rewrites.

The root journal lives under `.yoke/control-plane/native/<id>.json` and includes task,
reservation, worktree, before/after IDs, explicit coverage and the post-publication
candidate fingerprint/HEAD. An `applied` journal means **candidate files were written**,
not that acceptance or integration passed. Its acceptance field intentionally stays
`pending-existing-loop-gates`; consult the existing loop/PRD evidence for the outcome.

Before/after text backups are kept inside the candidate's `.yoke/control-plane/`.
On success the existing worktree cleanup removes them. On I/O failure there may be a
partial candidate, but no success is returned; the failed candidate and available
backups remain for inspection. No rollback overwrites a concurrent user edit.
A crash or an unwriteable intent journal can leave an in-flight reservation. Never
retry it blindly under a new identity or delete its budget record; this slice provides
no automatic crash reconciliation. Ordinary cleanup is a separate explicit operator
action, not permission to erase budget uncertainty.

This action invokes no model and no worker shell, so its model tokens and provider charge
are measured zero. It records native publication/guard preparation elapsed milliseconds
as `computeMs`; configured tests, reviews, controller preparation before reservation and
other runner paths are **not included in that new ledger measurement**. Existing Yoke
telemetry for those paths is unchanged. The reservation is admission accounting, not a
hard CPU deadline or a hard cap on external provider bills. Observed overruns are retained;
unknown or in-flight usage blocks subsequent admission according to the existing ledger.

## Validation and remaining integration

```sh
npm test -- tests/control-plane/workspace-broker.test.ts tests/control-plane/owned-store.test.ts tests/control-plane/native-workspace.integration.test.ts tests/loop/git.test.ts
npm run lint
npm run build
npm run docs:update
npm run docs:check
```

The tests include actual Git worktrees, a real verification subprocess, source-mutating
tests and reviewers, target-HEAD changes, stale edits, missing/exhausted budgets, preserved
unknown/in-flight attempts, failed publication/intent writes, capability revocation,
immutable readers, protected paths, links and runtime-state staging.

Still outside this slice: enforcing permissions on arbitrary CLI process trees, OS-level
snapshot freezing, detached-process containment, external/remote runtime lifecycle,
automatic analysis/context sharing across model sessions, effect/resource discovery,
full ledger coverage of every model/review/gate, distributed recovery and a 2.0 release.
Trusted test commands can produce ignored artifacts or use scratch storage; changing
fingerprinted source/configuration during verification blocks this managed candidate.
The source guard is not a sandbox, a dependency/environment attestation, or proof that
an adversarial test never temporarily changed a file. No performance or cost speedup is claimed.
