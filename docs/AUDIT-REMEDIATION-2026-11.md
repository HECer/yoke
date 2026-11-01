# November 2026 audit remediation

This branch implements the audit against `a97c5e09aee68c00acede09c92753f56ac754ecb` (1.25.1). It retains the TypeScript host and its acceptance model, fixes reproduced correctness and process defects, and makes optional model/tool work more selective. It is an unreleased change set: package/manifests are not bumped and no publication is implied.

## Finding disposition

| Finding | Implemented response | Evidence or remaining boundary |
|---|---|---|
| F01: contradictory review approval | Reject approved verdicts containing blocking findings; preserve defensive repair selection | Negative approval fixtures include non-actionable blockers |
| F02: false-clean dependency audit | Strict npm/pnpm/RustSec report validation and explicit clean/findings/unavailable/unsupported/partial states | Malformed/error/empty reports fail; unsupported coverage is visible |
| F03: POSIX cancellation ownership | Own the live detached process group, guard incarnation, retain unconfirmed cleanup | Real descendant and record-retention tests; native Windows parity remains to be observed |
| F04: decomposition corrupts ledger | Journaled publication/recovery of PRD and ledger, remapped requirement/invariant coverage | Actual interrupted-publication and end-to-end planning fixtures |
| F05: facade policy gaps | Canonical scope/exclusion validation and symlink-ancestor checks before dispatch and on recognized evidence | Backend executable isolation remains external |
| F06: unvalidated active edits | Hide and refuse preview/apply, including legacy direct helpers | Disabled in both shadow and active; native worker acceptance remains the edit path |
| F07: critic producer/consumer mismatch | Strict minimal decision schema, host-generated provenance, opaque A/B bundles, correct Codex temporary-directory invocation | Local schema/argument/identity fixtures; live providers unavailable here |
| F08: dependency advisories | Migrate to Zod 4 and refresh affected tooling/lockfile | Compatibility suite passes; refreshed lockfile audit reports zero advisories |
| F09: missing Serena references | Decode grouped/singleton/labelled pinned formats and retain semantic locations | Known fixtures preserve references; unknown formats remain unresolved |
| F10: MCP race/restart state | Shared initialization per process generation, bounded framing/pending requests, clean lifecycle | Real synthetic subprocess/concurrency/restart fixtures |
| F11: ledger-backed change intake blocked | Transactional additive proposals, preserved original objective, coverage review, binding updates and exact-state retry receipts | Full draft → split → assess → change → load flow and commit rollback |
| F12: quadratic dashboard work | Linear aggregation, compact run summaries, bounded details and cursor event pages | Deep-equal aggregate totals in 2k–32k-event comparison |
| F13: stale history success | Timestamp-aware latest-check selection; overflow/ties/corruption remain unavailable; completed supervision archived | Adversarial UUID ordering and history bounds tests |
| F14: misleading token caps/lost evidence | Explicit output byte budgets and retained content-addressed evidence pagination | Unicode, complete graph and policy/hash binding fixtures |
| F15: wasted backend calls | Semantic-first symbol/impact routing; no discarded initial Graft query | One-backend semantic requests work; document retrieval is opt-in |
| F16: fragmented call limits | Durable project execution admission across planning, implementation, review, critics, repairs, candidate selection and native-goal seams | Cross-process cap, frozen host policy, crash/unknown usage and nested-wrapper tests |
| F17: oversized repair context | Binding write scopes, story-filtered requirements, bounded relevant diff preview and complete retained change evidence | Tracked, staged, new-file and UTF-8 bounds fixtures |
| F18: multiplied judgments | Adaptive consistency checks, shared admission, one meaningful review boundary in canon | Explicit paired checks and competing candidates remain available; no claim that all semantic rechecks can safely be cached |
| F19: nominal capability escalation | Remove label-only debugging floor, remove duplicate Gemini default tiers, stop identical-invocation escalation | Risk/testability floors preserved; missing setup profile coverage reported |
| F20: repeated broad hashing | Stream snapshots/cache identity, inventory bounds first, remove duplicate content pass, expose cache diagnostics and optional declared input sets | Broad safe default retained; input completeness remains operator-owned |
| F21: oversized universal canon | Shorter entrypoints, conditional methods, specialist workflows explicitly selected | Same 34 capabilities, package validation, source-byte inventory and scenario review |
| F22: availability mistaken for compatibility | Versioned executable provider smoke with separate installed/not-run/pass/unknown evidence | All eight CLIs unavailable in this environment; enforcement dimensions remain untested by a benign smoke |
| F23: style heuristics as acceptance | New UI setups leave design gate off; explicit design policy remains available | Functional/browser acceptance stays independent of preferred colors/layouts |
| F24: repeated CI work | Shared lint/canon/docs/audit/package job; retain Linux/Windows Node 20/24 build/test matrix; remove recurring README test-count discovery; cancellation and timeouts | Exact test counts stay in execution reports; platform tests are preserved; no unsafe test-file parallelization added |

Whole-story decomposition with quality or exploration contracts remains explicitly unsupported: it refuses before a paid planning call because splitting those contracts safely requires a child-specific declaration. Additive change intake preserves existing task semantics and cannot silently redefine the original objective. These are concrete bounded contracts, not arbitrary parser failures.

The built-in dependency scanner reports which root lockfile it scanned and flags other known root/nested lockfiles as incomplete coverage. Yarn is explicitly unsupported by the generic npm parser; configure a version-appropriate `audit.command` (for modern Yarn, include `--all --recursive` when complete workspace/transitive coverage is intended). See [Yarn audit coverage](https://yarnpkg.com/cli/npm/audit). Generic empty/error JSON never means a clean npm/Cargo report.

## Planning publication and recovery

Draft and forced replacement now ask the provider to write temporary proposals under `.yoke/changes/draft-*`. The canonical PRD and requirement ledger stay in place while the provider works. The host validates the complete proposed contract, checks the original PRD/ledger/brief snapshot again, and then publishes through the same journal used by decomposition and incremental change intake. A failed or interrupted proposal does not require an in-memory rollback of canonical files. `--force` authorizes replacement using the explicitly supplied idea; it does not authorize a provider to silently remove retained story bindings before validation.

Publication/recovery authority is stored outside the workspace, under `Yoke/planning/<canonical-project-hash>` in the host state directory selected by `LOCALAPPDATA`, `XDG_STATE_HOME`, or the home-directory fallback. The host keeps the transaction journal, exact-state approval receipts, and immutable queued-request records there. Workspace proposals and inbox files remain inspectable inputs; writing a plausible journal or receipt into `.yoke/changes` cannot grant approval. Both committed and uncommitted change recovery require the exact host receipt; a clean Git commit alone does not prove review. Requirement changes retain the original objective and bind the exact approved additive request rather than treating a generated story summary as new authority.

`yoke change add` records the exact request ID, text, and creation time in host state before publishing its visible inbox file. Intake requires a matching record and checks regular files, ancestor links, filename/ID agreement, individual file bytes, total inbox bytes, and pending count before spending on a provider. A legacy or manually fabricated inbox file with no matching host record is preserved and rejected. To migrate an intended legacy request, preserve and move that file outside the pending directory, then requeue its exact intended text with `yoke change add`; do not fabricate an approval record. Copying a project to a different canonical location or host does not copy this local authority automatically.

The recovery guarantee covers **process interruption**, including an actual controller exit between individual file publications. Readers recover a valid host journal before parsing the planning contract. Ordinary failures restore known original bytes; an edit that matches neither recorded version is preserved and leaves the journal for inspection. Publication rechecks files between replacements, while the project lease coordinates cooperating Yoke commands. These are not a filesystem-wide atomic snapshot for lock-unaware external editors, and they are **not a full power-loss durability guarantee**: file contents are flushed, but directory metadata is not comprehensively synced across platforms. The tested journal scope is draft/force, decomposition, and incremental change publication; it is not a claim that every other Yoke state writer has been converted to this transaction mechanism.

Prepared assessment keys now bind relevant requirement semantics, preserved invariants, and quality/exploration declarations. Unrelated additive requirements do not invalidate independent tasks. Older prepared keys can require one explicit `yoke prd assess` after migration; the project execution budget remains the same account during that reassessment.

## Shared execution budget

Newly configured projects (`setup`, `new`, or the first `retrofit`) receive:

```yaml
executionBudget:
  id: default
  maxCalls: 24
  maxMinutes: 120
  maxPromptBytes: 128000
```

Existing projects with no `executionBudget` remain uncapped by this new account; their existing story/goal/quality limits still apply. Add the block deliberately to opt in. `maxTokens` is optional. Set limits appropriate to the task rather than treating these initial defaults as a productivity optimum.

The configured ID identifies one persistent budget across PRD hashes and command restarts. Host state lives outside the mutable project/worktree and reservations are serialized across processes. A host command freezes the original policy: a worker cannot opt out of later role admission by deleting settings, renaming the budget, or increasing its cap in project files during that command. The actual CLI/native dispatch consumes its inherited admission once and records its own usage; measurement wrappers cannot count it again. A second actual launch needs another reservation even when its provider and prompt are identical. The native goal ledger keeps its own independent semantics without adding duplicate usage to it.

```sh
yoke budget status . --json
yoke budget reset .
```

Reset is an explicit operator action that preserves the prior epoch and refuses while admitted calls may still be running. Do not automate resets to evade a blocked run. Replanning changes a story's contract account but does not renew this project budget. The host journal also has a storage bound of 10,000 admissions per epoch; reaching it requires inspection and an explicit reset, not automatic evidence deletion.

`maxCalls` is checked before dispatch. `maxMinutes` is **aggregate agent time**, summing durations of concurrent calls, not elapsed calendar time or a per-call hard kill. Time and token settings are admission ceilings: already admitted calls may overshoot them, and provider-internal turns are not individually reserved by Yoke. Existing process deadlines remain responsible for termination.

Unknown or interrupted usage remains visible and charged as an admitted call. A configured token ceiling blocks later starts after incomplete completed usage rather than treating it as zero. Reported token totals are lower bounds when incomplete; Claude's separate cache counters are handled explicitly. USD cost remains reported or unknown, never estimated from a model name. An oversized submitted prompt is rejected before dispatch; mandatory criteria are not silently clipped. Prompt bytes do not include provider-added instructions or discovered tool context.

This is a host workflow policy, not an OS sandbox against another process with the same user's filesystem privileges. Maintain the provider sandbox and project trust boundary.

## Quality and repair migration

`quality.consistencyChecks` now accepts `1`, `2`, or `adaptive`. Omitted values use `adaptive`. A current, contract-bound low-risk assessment plus a valid high-confidence first decision permits one call. Unknown/stale risk, higher risk, or lower confidence retains the swapped-label pair. Explicit `2` preserves the earlier paired policy; explicit `1` is an operator choice.

Models return only a strict decision: version, attempt ID, A/B winner, biggest gap, evidence, and confidence. The host maps labels and binds the artifact digests, rubric/prompt identity, requested model and reported actual model. Missing actual identity remains unknown; a reported model change within a pair invalidates the comparison. Filename labels and content-type handling are symmetric, though artifact content can still reveal its source and no perfect-blinding claim is made.

Repair prompts carry the actual story write scopes and relevant requirements. Diff previews are bounded and relevant; complete tracked/staged/new change evidence is retained with digest-bearing artifact pointers. There is no claim that a small preview by itself contains every fact needed for a repair. The repair must inspect the retained evidence when necessary, and independent mechanical/acceptance checks still run.

Quality, candidates, exploratory discovery, and specialist review remain opt-in judgment mechanisms. They can consume many calls and should be enabled for an actual uncertainty, within the shared allowance. This branch does not add a broad verdict cache or discard fresh integration checks.

## Setup and tool migration

- New setup/retrofit defaults are `codeGraph: none` and `browserTools: false`. Select `--code-graph=graphify|serena` and/or `--browser-tools` for tasks that need them; `--code-graph=none` and `--no-browser-tools` turn managed entries off.
- Browser launch configuration pins `@playwright/mcp@0.0.84`. MCP launch argument arrays are replaced as one command, not concatenated with an old `@latest` argument. JSON and Codex TOML configuration preserve unrelated servers and remove only recognized Yoke commands that are no longer selected. Managed changes are backed up. Codex TOML is parsed and reserialized, preserving values but not original comments/formatting; malformed configuration is refused before apply.
- Existing explicit graph/design choices are preserved. A previously implicit browser tool is no longer reintroduced unless selected. New UI detection records `design.mode: off`; choosing auto/on remains supported for an intentional project style policy.
- Heavy planning/product/release/retrospective workflows become manual entries in the canon manifest. All 34 skills remain available. Core guidance selects a specific method only when it serves the task and respects prior approval.
- Gemini defaults now provide only distinct light/standard invocations. Configure suitable stronger profiles for tasks whose risk floor requires them. Existing operator profiles remain; failed invocation aliases cannot masquerade as escalation.
- Code Intelligence remains optional and read-only. See [its migration guide](code-intelligence-remediation.md) for external-process trust, byte caps, retained evidence and disabled edit behavior.
- Criterion reuse remains opt-in. See [verification reuse](verification-reuse.md) before declaring `verify.reusableInputPaths`; a declaration asserts complete dependencies for every reusable command.

## Measurements and validation scope

The [dashboard comparison](../bench/results/dashboard-remediation-2026-11-01.json) uses three samples at each of four event counts in one shared Linux/Node 24.22.1 environment. At 32,000 events the median changes from 5,015.9 ms to 228.8 ms, about 21.9× for that component. Serialized analytics falls from 6,645,384 to 21,400 bytes, with all 32,000 events counted and equal aggregate/run totals. This is not a complete-workflow speedup.

The [cache profile](../bench/results/verification-cache-remediation-2026-11-01.json) is a single observation per fixture/implementation in separate Node processes. It preserves the same execution/reuse counts while reducing duplicate source reads and content-buffer size. Git subprocess I/O is outside the instrumented counters. Details and limitations are in the cache guide.

The [canon inventory](../bench/results/canon-size-2026-11-01.json) counts UTF-8 source bytes, not model tokens. Skills are loaded conditionally, so reduced repository text does not establish the same percentage reduction in billed context. A current native/Yoke accepted-outcome comparison needs authenticated providers; this environment has none. See [provider contracts](PROVIDER-CONTRACTS.md) and the existing controlled comparison harness before making economic claims.

Validation covers local TypeScript build, canonical package checks, negative contract fixtures, real local subprocess cancellation, concurrent budget reservation, crash/recovery, planning round trips, and the repository test suite. The [local validation record](../bench/results/remediation-validation-2026-11-01.json) records the frozen-source suite and production-only installed-package check. CI preserves the four platform/runtime combinations. Remote results are recorded on the PR; local POSIX tests do not certify native Windows process-tree behavior or live backend compatibility.

## Remaining product decisions

Retain the acceptance host, durable intent/coverage, recovery, native provider adapters, isolated worktrees, bounded tool actions, and measured routing. Keep speculative agents and extra critics optional. Do not reactivate facade edits until there is a separately reviewed complete transaction implementation. Evidence artifact retention remains manual and bounded per artifact; automatic retention/compaction needs a policy for outstanding cursors and operator evidence.

Retain TypeScript for this work. The [Rust decision record](RUST-DECISION-2026-11.md) identifies a possible process-supervisor or measured hot-path extraction and its acceptance criteria. No uncompiled full rewrite is presented as a performance fix.
