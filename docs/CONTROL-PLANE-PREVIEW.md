# Control-plane preview (Yoke 2.0 M0)

Status: **experimental, separately invoked foundation**. This is not a released 2.0 runtime and does not replace `yoke goal`, `yoke loop`, the scheduler or existing acceptance gates. Read the [architecture and staged implementation plan](YOKE-2.0-PLAN.md).

## Build and inspect a plan

```sh
npm ci
npm run build
node dist/control-plane/cli.js --help
node dist/control-plane/cli.js plan docs/examples/control-plane/admission.json
```

The example uses **synthetic fixture budgets, not model prices or measured consumption**. Its first two tasks are independent; the final integration task waits for accepted dependencies. The example therefore returns exit code 1 for a deliberately blocked task. `plan` only returns decisions and a proposed ledger; it does not save reservations, launch agents, create worktrees or call a model. Capabilities and accepted IDs supplied in a preview manifest are caller assertions, not live proofs.

Protocol outcomes are `admitted`, `blocked`, `already-accepted` and `already-reserved`. Admission is a prerequisite for a future trusted dispatcher, not permission for arbitrary code to execute. An idempotent reservation replay must never cause another process launch. There can be only one in-flight worker reservation per task; speculative candidates need distinct task identities under an explicit shared budget.

## Budget storage

```sh
node dist/control-plane/cli.js budget-show /path/to/project
node dist/control-plane/cli.js budget-init /path/to/project docs/examples/control-plane/limits.json
```

`budget-show` does not initialize state. `budget-init` is the **only mutating CLI command** in this preview. It explicitly creates `.yoke/control-plane/budget.json` and uses the existing Yoke project lock. It never resets existing history or edits existing configuration.

The internal `transactLedger` API uses an expected revision under the same project lock. Old reservations cannot be erased, reordered or have finalized usage rewritten. New entries must first be persisted as in-flight intents, fit the budget and respect concurrency. This low-level API is for trusted adapters, not a remote authorization endpoint. Calls already holding the project lock must not reacquire it: M1 must integrate at the owning transaction boundary rather than nesting this API in an existing locked runner.

Units:

- `tokens`: admitted/reserved token count, not an assertion that an external engine enforces a cap.
- `costMicrousd`: integer micro-US-dollars; 1,000,000 equals USD 1. Actual CLI subscription accounting may be unavailable.
- `computeMs`: summed execution time, not parallel wall-clock elapsed time.
- `maxActive`: shared limit for cooperating reservations, including controller, worker, review, repair and integration roles.

`usage: null` means still in flight. A settled usage object with a null field means the process is confirmed stopped but that measurement is unknown. Unknown usage is never a measured zero and blocks new budgeted admissions. Actual overruns are recorded and block further work. Settlement requires confirmed termination; a timeout, missing heartbeat or lost SSH connection is not confirmation.

There is deliberately no reset/reconcile CLI or automatic migration. Never delete the ledger to hide unknown usage. A future audited reconciliation mechanism must preserve the original observation and its provenance. These are admission controls, **not a hard external billing guarantee**.

## Orca: read-only discovery and argument preview

```sh
node dist/control-plane/cli.js orca-doctor
node dist/control-plane/cli.js orca-preview docs/examples/control-plane/orca-launch.json
```

The executable is resolved once: explicit `ORCA_CLI_COMMAND`, development binary when `ORCA_DEV_REPO_ROOT` is set, otherwise `orca-ide` on Linux and the native platform executable. Linux does not guess the bare `orca` name because it can launch GNOME's screenreader. No fallback to another build, shell wrapper, installation or `open` operation is performed. A Windows `.cmd`-only installation is not silently executed through a shell; an operator must provide a compatible native executable.

`orca-doctor` reads `skills get orca-cli` followed by `status --json`, each bounded to 5 seconds and 1 MiB. It hashes the guide but does not execute its instructions or print raw output that could contain pairing secrets. A valid JSON response still leaves execution capabilities **unknown**. Exit code 2 reflects that incomplete validation rather than falsely reporting a production-ready adapter.

`orca-preview` produces a literal argument array, never a shell command to execute automatically. The placeholder Task ID in the example must not be mistaken for a real Orca Task. The preview includes only the documented per-launch model pathway for Claude/Codex/Cursor; unsupported overrides are rejected rather than silently ignored. An effort choice requires a model and is not proof that the chosen model supports it. Requested model settings must later be compared against runtime-reported effective settings.

`--setup skip` is not an OS sandbox and does not prove that every startup side effect is disabled. Before real execution, M2 must validate the installed command contract, allowed workspace startup actions, engine/model support, process lifecycle, remote authority and cleanup behavior. There is **no live worker-launch command** in this preview.

## Evidence and path boundaries

`assessEvidence` checks integrated-stage evidence against Task/Attempt/Dispatch IDs and snapshot, acceptance, policy and environment digests. Candidate output, missing checks, stale fingerprints and unverified checks cannot pass. It does not execute tests, authenticate the producer or update legacy `Story.passes`. Only a trusted verification adapter may use these receipts as input to the existing acceptance system.

Write scopes use literal repository-relative prefixes, case-folded conservatively for Windows/POSIX planning. Absolute paths, traversal and globs are rejected. `.git`, `.yoke` and explicitly protected scopes are blocked. These are lexical scheduling constraints, not filesystem permissions or protection against a hostile same-user process. The store rejects existing state-directory symlinks and uses bounded reads, file fsync and atomic replacement; directory/power-loss/network-filesystem guarantees remain platform-dependent.

## Tests

```sh
npm test -- tests/control-plane/control-plane.test.ts
npx tsx tests/control-plane/run-contracts.ts
```

Both commands run the same assertion cases. The second harness uses Node assertions and the existing TypeScript execution tool, not a model or separate test fixture implementation. Coverage includes resource conservation, missing usage, overrun, idempotency, duplicate starts, dependencies, write conflicts, stale evidence, shared locks, corrupt state, symlinks and Orca discovery failure modes. The deterministic stress case performs up to 4,000 admission/settlement iterations across 100 seeded trials.

Validation does not include authenticated coding engines, a running Orca deployment, live remote cancellation, performance benchmarks or the entire native execution path. Check the PR's exact CI status separately before merging. Package and plugin versions remain unchanged; no release or npm publication is performed.
