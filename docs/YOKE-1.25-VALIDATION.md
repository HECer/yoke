# Yoke 1.25 efficiency and reliability validation

Date: 2026-10-05. Base: `2746728`, Yoke 1.24.0. Implementation branch: `codex/yoke-1.25-efficiency-reliability`.

## What changed and why

| Problem | Implemented control | Remaining limit |
| --- | --- | --- |
| Model-driven status polling | Deterministic filesystem-notification `loop wait`, bounded output and explicit timeout | External controllers must use this command; existing terminal status belongs to the current stored run |
| Replaying large plans and failure text | Deterministic 6,000-character secondary references and 2,400-character repair packets, source hashes and artifact markers | Character limits are not token counts; full authoritative objectives/criteria/invariants are retained |
| Losing requirements during decomposition | Original idea/approved plan binding, host story activation markers, requirement/invariant proof references | Formal coverage cannot prove completeness or meaningful tests; legacy unbound PRDs retain legacy guarantees |
| Shared-file conflicts and needless task splitting | Smallest coherent decomposition; explicit writes; overlapping owners require dependencies | No optimal schedule or full development-time improvement is guaranteed |
| Blind infrastructure escalation | Structured pre-model evidence and complete zero usage/cost required for bounded infrastructure restarts | Ambiguous execution remains charged; no automatic blind restart loop |
| Windows startup failures | Absolute child cwd, normalized child PATH, provider/watchdog prerequisite checks | No permission relaxation; environment identity remains local |
| Repeated checks | Exact opt-in pure criterion commands, invocation-local success reuse with complete local byte identity | Hashing overhead, linked/oversized inputs disable reuse; external state is excluded by the operator's purity contract |
| Misleading usage totals | Fresh/cached/reasoning fields with missing/partial evidence and provider semantics | Native input totals retain historical provider semantics; compare per provider, not a universal billable total; unknown prices stay unknown |
| Weak reviews | Preserved-capability, original-objective, boundary/state and test-adequacy instructions | Review is probabilistic and must remain independent |

## Compatibility and usage

```sh
yoke loop wait ./project --timeout=60 --json
yoke loop wait ./project --until=change --since=<previous-cursor> --timeout=60 --json
```

Wait timeout is seconds; run timeout remains minutes. Changed exits 0, timeout 3, malformed state/error 1. The API accepts an AbortSignal and returns cancellation; the CLI maps a cancellation result to 130. A terminal state already stored is returned immediately.

New drafts keep `.yoke/requirements.yaml`, `.yoke/plan.md` and `.yoke/prd.yaml` together. Every drafted story carries a host-written `requirementsFor` objective hash. Missing ledgers and self-consistent objective rewrites fail. A host-authorized forced redraft can replace the objective while retaining story IDs. Isolated workers cannot replace these contracts; prepared assessments are invalidated when they change. Active-ledger change intake is blocked until the coverage ledger can be updated safely.

```yaml
verify:
  command: npm test
  reusableCommands:
    - npm run test:pure-contract
```

Only add commands without network, external files/state, time dependency or side effects. Reuse applies to exact criterion commands, not full verification, integration or completion. Identities include absolute root, command, phase, environment, policy, Node binary and all local bytes including ignored inputs. Git metadata is excluded. Linked inputs and local inputs over 10,000 files or 64 MiB disable reuse. Runtime changes or command-created files invalidate results. Reuse is off by default because identity hashing can cost more than short checks.

Fresh usage requires known semantics: Claude's native input is already uncached ([Anthropic documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)); Codex/Gemini input includes cached input and subtraction requires complete measured cache counts. Other providers remain unknown. Cached/reasoning fields are not added again to totals. Mixed known/unknown calls do not produce an exact fresh aggregate. Provider prices, authentication waits and unavailable measurements remain unknown.

## Evidence

- Baseline suite: 186 files passed, 1,759 tests passed, two skipped; runner 492.31 seconds on Windows. One observed execution, not a future duration promise.
- Development used failing regression tests for each domain. Independent review found and drove fixes for ledger downgrade, mutable objective source, unknown-cost attempt release, ignored local cache inputs, forced redraft compatibility, provider token semantics and mixed-known usage aggregation.
- Implementation validation at `1cf30b6`: `npm run prepublishOnly` passed typecheck, build, 203 test files, 1,879 tests passed and two skipped (1,881 registered), docs consistency and package dry-run. Runner duration was 484.46 seconds on Windows/Node v24.13.0; one observed sample. The baseline and implementation timings are not a controlled speed comparison.
- Fresh `npm run yoke -- validate canon`, `npm run audit:ci` and `git diff --check` passed; audit reported zero vulnerabilities. Version metadata matches 1.25.0 across package/lock, canon and provider manifests.
- Independent code, security, documentation and measurement reviews approved with no remaining blocking finding after fixes. The first integration suite exposed a stale planner fixture and ran the framing regression before its fix; it is not counted as a passing release gate.
- Standalone tarball installation passed installed canon validation, terminal JSON handoff and explicit timeout exit code 3, without provider calls. Final package validation additionally compares installed CLI/check/cache/usage bytes against the final built code.
- The first CI matrix passed all gates on Windows/Node 20 and 24. Linux/Node 20 and 24 passed their tests but rejected stale release metadata: five Windows-only tests lacked the existing metadata-discovery override. The metadata follow-up preserves runtime platform guards, enables discovery with `YOKE_INCLUDE_PLATFORM_TESTS=1`, and adds a real Vitest-list regression (0/5 before the fix, 5/5 after). Focused follow-up tests passed 26/26; full discovery found 1,882 registered tests. Product code remains unchanged. Full CI and refreshed packaging gates apply to the follow-up.

### Synthetic regression benchmark

Run `npm run bench:efficiency`. Five samples check bounded references, feedback, successful same-state criterion reuse and event-based handoff with zero provider calls. Record empirical timing ranges including identity overhead. The baseline fixture replays 82,489 reference characters and 30,000 feedback characters; the new packets are at most 6,000 and 2,400 characters. These are character counts, not actual provider tokens.

Five requested pure checks execute once and reuse four successes per sample. This reduces logical executions only; the fixture does not imply faster real tests. A 20 ms terminal-write fixture measures notification handoff; it does not measure development duration. Complete results are retained in `docs/benchmarks/2026-10-05-yoke-1.25-host.json`.

Observed five-sample ranges on Windows/Node v24.13.0: repeated controlled checks including identity work took 1,148.53–1,592.55 ms per sample; terminal handoff took 25.20–30.07 ms including the 20 ms fixture delay. No future completion time or complete-product savings follows from these ranges.

## Remaining work and evaluation order

1. Run matched fresh-isolated NEXUS comparisons with identical task, model/reasoning, tool availability and immutable behavioral oracle. Separate download caches from provider cached/fresh tokens; record controller and worker usage without overlap.
2. Measure first-pass acceptance, regressions and semantic completeness alongside time/tokens; reject efficiency changes that weaken protected behavior.
3. Measure hashing break-even on real pure commands before enabling criterion reuse broadly. Keep independent gates fresh.
4. Extend change intake to update objective-bound coverage atomically, with original contract approval and new proof references.
5. Improve quality/routing policies only against repeated, independently reviewed samples. This version does not claim the quality problem is solved by prompt changes or green unit tests.

## Publication status

Version metadata is prepared as 1.25.0. A locally validated package and reviewable branch are distinct from a published release. GitHub CI and npm publication must be observed before reporting a public release complete.
