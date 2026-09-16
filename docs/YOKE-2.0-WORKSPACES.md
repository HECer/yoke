# Yoke 2.0: shared knowledge, controlled mutation

Status: **M0 workspace-planning preview**, not a shared-checkout executor. This extends [the 2.0 plan](YOKE-2.0-PLAN.md) and [control-plane preview](CONTROL-PLANE-PREVIEW.md). Inspected production base: `4c8654e1e8639ddd3c308db8aded0701d8cebcbf` (1.15.1). Package versions and native execution defaults are unchanged.

## What the comparison actually shows

BridgeMind's Code Workbench launches independent seats. Its documented default is a shared checkout, with an optional separate Git worktree per seat. Workbench is not the same thing as a coordinated Swarm: several terminals sharing files do not automatically share a plan, acceptance contract or reliable ownership protocol. The supplied screenshot also shows both isolation choices; the disabled worktree option says the selected folder is not a Git repository. This is not evidence that BridgeMind lacks worktree support.

Orca also documents multi-agent conversations inside a single worktree. Therefore "BridgeMind shares, Orca isolates" is not a sound architectural distinction. The useful questions are who owns mutation, what snapshot a reader sees, how effects are bounded, and who accepts the integrated result.

Primary references:

- https://docs.bridgemind.ai/docs/code-mode (Workbench, shared checkout and optional per-seat worktrees)
- https://www.onorca.dev/docs/multi-agent-setup (multiple agents in one worktree)
- https://git-scm.com/docs/git-worktree (linked worktrees share repository data)

## Yoke today, not a proposed greenfield system

| Path | Existing behavior | Boundary |
| --- | --- | --- |
| Serial story loop | Executes one selected story at a time in the target checkout. | A serial coordinator does not control unrelated manually started tools. |
| Serial `--isolate` | Creates a story worktree under `.yoke/worktrees/<story>`. | Isolation is a Git working-tree boundary, not an OS sandbox. |
| Parallel story loop | Creates owned per-story worktrees; candidates can have additional worktrees. | No native shared-multiwriter mode is introduced here. |
| Scheduler | Uses dependencies, priority, areas, critical-path ranking and declared `writes`. | `writes` are advisory; omitted scopes preserve legacy behavior. |
| Integration | Serial queue, candidate rebase/tree reconciliation, configured gates and target-HEAD revalidation. | A worker's finished message is not sufficient acceptance. |

Read `src/loop/loop.ts`, `scheduler.ts`, `dispatcher.ts` and `parallel-adapters.ts`. Story claims/ownership protect coordination; they are not filesystem ACLs. The existing scope-conflict filter is not removed merely because an isolated branch could theoretically accept overlapping edits.

## Three useful strategies, not one universal winner

**Shared read.** Reuse one frozen, identified base snapshot for exploration, symbol lookup and review. Enforce read-only tools; the reader role name alone is not enforcement. This can avoid duplicate checkout/environment preparation, but does not automatically share model context, provider prompt caches or tokens. Shared knowledge must be packaged and invalidated explicitly.

**Shared single writer.** Share a session-owned candidate checkout among a team, not the user's protected integration target. This may be one pre-provisioned worktree for the whole feature team rather than a worktree for every agent. Exactly one participant may modify the checkout for the entire attempt. Snapshot-sensitive readers finish before that writer starts. Enforced-read-only live observers can inspect partial progress, but their observations are advisory. Verification follows writer termination and a fresh snapshot barrier. This is appropriate for tightly coupled work on one feature when live observation is useful and ownership can actually be enforced.

**Isolated writers.** Independent changes and alternative candidates get separate worktrees. Shared base analysis may be reused, but edits are not mixed. Integration remains serialized and rechecks the current target. This costs setup and integration work, but preserves attribution, rollback and reproducible candidates. Git object sharing already avoids making a complete independent repository clone per worktree.

Multiwriter shared checkout is deliberately **not supported** by this preview. Nonoverlapping filenames are insufficient: formatters, imports, package locks, generated outputs, Git index operations, test databases, ports and compiler caches can still interact. A future broker could serialize validated patch transactions against expected file versions, but arbitrary shell access can bypass a cooperative broker. Such a system must prove its enforcement boundary before claiming safety.

## The implemented planner

```sh
npm run build
node dist/control-plane/cli.js workspace-plan docs/examples/control-plane/workspace.json
```

The example has **synthetic** snapshot and capability declarations. It does not establish that any installed Yoke, Orca or BridgeMind runtime provides these guarantees.

The command reads a bounded JSON manifest and returns a deterministic topology and ordered phase description. It neither calls a model nor launches agents, creates worktrees, grants write access, reserves budget or accepts work. Every output contains `preview: true`, `effects: "none"` and `dispatchAuthorized: false`. Exit 0 means a plan could be formed from the supplied declarations, 1 means blocked, and 2 means malformed input or an I/O error. None means a production runtime was validated.

The input separates **purpose** (`inspect`, `implement`, `verify`) from effective **effects** (`read-only`, `workspace-write`, `unknown`). An inspector with write-capable tools counts as a writer. An actual build/test command that emits artifacts is not misclassified as read-only just because it is a verifier. External or unclassified effects must be represented as `unknown` until a runtime has a stronger, explicit policy.

`auto` proposes shared-read for no implementation writers, shared-single-writer for exactly one when exclusive ownership is declared supported, otherwise isolated writers. An explicit requested mode is never silently changed. Missing/unknown required guarantees block. The conservative M0 planner also blocks an incomplete inventory or active unowned writer; it does not prove safe snapshot materialization from a concurrently changing source.

The selected mode describes **implementation topology**, not a promise that every seat uses that same storage. Read-only base exploration may share a frozen snapshot even with isolated writers. Write-producing verification always needs isolated scratch copies and occurs after integration (or against the base for a verification-only request).

Example phases:

1. Explorer reads the pinned base snapshot.
2. One implementer writes; a read-only observer can watch the mutable candidate.
3. The candidate writer process tree must be confirmed stopped; the existing integration gates remain authoritative.
4. Tests run against fresh identified source with disposable output storage. Source/acceptance code in test copies must be protected, and evidence must bind to the checked source and environment.

The phase list describes required ordering, not a command to stop unrelated isolated workers before integrating a completed candidate. Existing per-candidate integration can remain pipelined. The planner lists these as **required guards**. It does not implement the barriers or turn caller-supplied guarantees into trusted attestations. Live observers never appear as acceptance verifiers in the mutable implementation stage. A verification participant asking for live consistency is moved behind the verification barrier instead of being allowed to certify a changing tree.

## M1 integration contract

Keep the existing scheduler, runner, cancellation handling and integration queue. Integrate one execution boundary at a time; do not bolt on another authoritative scheduler.

Before dispatch, a trusted adapter must re-read inventory, resolve workspace identity, confirm required capabilities, check profile scopes and protected paths, reserve the existing global budget, and persist a launch intent. Capabilities must remain enforced for the duration of the operation, not just pass an initial probe. The workspace preview cannot override an admission denial or the existing scope policy.

A shared writer lease must cover the entire process tree, native subagents and tool actions. Expiry or missing heartbeat is not proof that the writer stopped. Unexpected writers, uncertain termination or a changed source invalidate the planned boundary and block acceptance. Same-user hostile processes require a real OS/container/account boundary; neither a JSON lease nor a Git worktree supplies one.

The final verification identity must include source snapshot, acceptance contract, policy, environment/dependencies and relevant configuration. A check result on a live tree is not reusable merely because the same filename exists. Worktree-to-shared or shared-to-worktree transitions require a stopped writer, recorded patch/snapshot and new validation; never move a running process to a new checkout and assume its context is current.

A later effect-aware scheduler should distinguish filesystem paths from other resource claims: Git administration, ports, databases, package-manager state, generated artifacts and external APIs. Resource namespacing and capability enforcement are separate from worktree creation. Independent branches can eventually permit intentional overlapping candidates, but only with explicit candidate identities, budget limits, deterministic integration and renewed acceptance.

## Cost and context strategy

Optimize measured cost and time per independently accepted change, including setup, review, failed attempts, repair and integration. No speedup percentage is established by this implementation.

Reuse immutable base indexing, dependency downloads and trusted read-only context summaries where compatible. Keep mutable build outputs, databases and worker changes separate. A shared checkout alone does not remove repeated model exploration; task-specific context packets with snapshot/provenance/freshness are the mechanism that can address that duplication. Share an immutable base index, but keep each worktree's dirty-file overlay separate and invalidate affected symbols/contracts after edits. Partial Code Intelligence coverage must stay explicit.

Do not launch six strong agents simply because there are six seats. Use deterministic tools first, then bounded specialists where they shorten the critical path or improve required verification. CPU/RAM/VRAM, provider limits and integration throughput constrain useful concurrency. Shared-read analysis can still consume multiple model calls and must count against the same budget.

## Validation and remaining work

The 66 workspace cases cover strict schemas, unknown effects/capabilities, source inventory, writer counts, mode fallback, explicit-mode refusal, live versus snapshot readers, write-producing tests, ordered verification and deterministic/no-mutation behavior. The same case source is registered with Vitest and with a dependency-free Node assertion runner:

```sh
npm test -- tests/control-plane/workspace.test.ts
npx tsx tests/control-plane/run-workspace-cases.ts
```

Focused local validation: TypeScript compilation of the workspace module and its unchanged validation dependency; 66 cases passed on Node 22.16.0. The dependency copy was checked against repository blob `a609ce60280e24acba7c3020b854c822bb3a5daf`. This is not a full-repository regression run, CLI end-to-end test, filesystem isolation test or authenticated model benchmark. Check the exact commit's CI separately.

Not implemented here: live shared-write dispatch, real capability probes for these guarantees, writer fencing, snapshot freeze enforcement, process migration, a patch broker, automatic effect discovery, new billing guarantees or a production 2.0 release. Existing production paths remain unchanged.
