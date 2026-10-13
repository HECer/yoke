# Efficiency handoff implementation — 2026-10-13

Unreleased corrections based on `56691e694874dbf1166b461e1994172567bf9a17` (Yoke 1.25.0). The original checkout at 1.22.0 and its user edits were preserved; implementation and baseline checks use separate worktrees with separate `npm ci` installations. No merge, tag or npm publication was performed.

The supplied patch SHA-256 is `37016e362910e49964e3abe868d7a277bb4db19576d7be0f3f23a93ccd7d8f0b`; all 21 manifest file hashes were verified. Original inputs and Linux measurements remain unchanged. The [historical candidate audit](EFFICIENCY-AUDIT-2026-10-12.md) records its previous environment, not current results.

## Implemented findings

| Cause | Correction | Behavioral evidence | Remaining boundary |
| --- | --- | --- | --- |
| Recopying retained output on every append; zero retained unlimited output. | Bounded lazy byte ring with Unicode-safe tail and explicit zero retention. | `stream-efficiency.test.ts`: limits, Unicode, lazy reads and bounded retention. | Snapshot reads still cost work; console retention does not bound provider output or heap. |
| Incomplete lines grew indefinitely or discarded suffixes became false events. | Shared bounded NDJSON framer discards through the logical newline; flush clears ownership before invoking callbacks. | Stream tests, supervision framing and `efficiency-boundaries.test.ts` cover overflow, recovery, reentrant flush and throwing callbacks. | Telemetry gaps remain partial; empty `modelUsage` cannot restore coverage. |
| Zeroed Claude crash envelopes erased known consumption. | Deduplicate message snapshots; preserve result checkpoints plus later input/cache deltas; report crash lower bounds as partial. Keep reported models. | `claude-crash-accounting.test.ts`: all three supplied sequences in batch and fragmented paths, snapshot-plus-later-input, partially zeroed crashes, positive error results, genuine zero results and session changes. | Single `claude -p` invocation scope. No authenticated resumed/reset session trace or billing reconciliation was measured. |
| Assistant placeholders/nested events distorted totals. | Use assistant input/cache lower bounds only; final model-level aggregation accounts for nested work and preserves missing fields. | Original 15 Claude cases plus additional crash cases. | Missing fields remain unknown; output placeholders never become measured totals. |
| Cancellation, storage/observer errors and separate pipe decoding could start unnecessary work, strand completion or corrupt Unicode. | Check before dispatch; typed preflight errors; incremental decoding; idempotent settlement; distinguish failures after prompt dispatch from dispatch-free failure. | `process-efficiency.test.ts` covers initial storage failure, publication-time abort, pre-abort, invalid limits, split Unicode, cleanup exception, zero retention and observer failure. Test teardown cancels its owned handles even on failure. | OS termination can remain unconfirmed; preserve ownership and block another launch. |
| Dead leaders, display truncation, disappearing entries and Windows path casing could hide retained process trees. | Complete admission scan separate from bounded display; per-entry race handling; reject malformed/unsafe records; matching retained PIDs conservatively block regardless of target spelling. | Supervision tests cover dead leader/retained ownership, >200 records, malformed state and Windows casing; mocked races assert interception for ownership, supervision and worktrees. | Explicit ownership cleanup is required when termination cannot be proved; no destructive cleanup behavior was broadened. |
| Feedback amplified small budgets; retrieval lost late matches and added unrelated history. | Nonnegative feedback allocation with full hash and complete references; deterministic matching excerpts with full-source hashes. | Packet efficiency cases and existing ranked retrieval test. | Character counts are not tokens; long artifact paths may not fit. `referencePacket` may include lower-ranked unmatched sections. |
| Lexical filtering could remove binding rules without a literal match. | Production prompts retain complete unclassified project/glossary/knowledge/context-map rules; only classified history is bounded. Preserve ledger objectives, invariants, criteria, commands and write scopes. | `binding-prompt-efficiency.test.ts` checks actual worker and reviewer prompts, including late unmatched rules and ledger requirements. | This intentionally limits prompt shrinkage. Standalone retrieval measurements do not measure complete prompts. |
| Worker full-suite instructions duplicated configured host work. | Focused worker TDD plus required broader checks; host owns configured independent verification and required gates. No nested agents, loop orchestration or commits by workers. | Worker contract plus existing host verification, protected gate, budget and completion tests. | A configured smoke check is not a promised full suite; no gate is removed or cached. |
| Five-iteration workflow restarts reset effective budgets; model polling wastes calls. | One attached blocking backlog run; deterministic host handling of `loop wait`; respect explicit caps and blockers. | Existing wait/budget tests plus disposable retrofit integration proving managed skill refresh preserves timeout and critical-decision policy. | Existing projects need normal managed updates. No global user-project configuration rewrite or automatic exploration. |
| Every routing profile repeated the same initialization probe. | Probe once per provider at setup, including negative results; retain each actual dispatch admission check. | Four routing efficiency cases include sync/async availability changes after setup. | No persistent cache, fallback expansion or model/reasoning change. |
| Baseline dependency audit blocked acceptance. | Targeted lockfile updates to `smol-toml` 1.9.1 and `source-map-js` 1.2.2. | Dependency audit and full compatibility checks. | No new production dependency, force update or release version bump. |

The accounting boundaries follow [Claude's usage guidance](https://code.claude.com/docs/en/agent-sdk/cost-tracking); incremental pipe decoding follows [Node's stream contract](https://nodejs.org/api/stream.html#readablesetencodingencoding).

## Validation evidence

Environment: Windows x64, Node v24.13.0, npm 11.9.0. The unchanged baseline full suite passed: 204 files, 1,897 passed and 2 skipped (1,899 cases), 541.05 seconds, exit 0. Its dependency audit exposed moderate `smol-toml` and high `source-map-js` findings, recorded separately from candidate regressions.

Tests were copied before production code: the baseline produced 33 failures and a missing-module collection failure; after applying the original candidate all 57 supplied cases passed. Additional crash, binding-context and admission defects were reproduced with failing tests before correction. An intermediate run during active edits failed old accounting/guard snapshots plus a 4,639 ms result against an unchanged 4,500 ms wall-time assertion; the unchanged goals suite passed in the focused repeat. This intermediate run is not final acceptance evidence.

An independent read-only reviewer approved the corrected source for correctness/security, after finding and verifying the accounting, context and admission issues. That review does not replace the final full suite or exact-head cross-platform CI.

A subsequent complete run had 1,988 passes, two skips and one Git infrastructure failure (`malloc` while creating a tiny CRLF fixture worktree). Its unchanged 16-case recovery file passed in the focused repeat. Windows' G: pagefile had grown to 43,749 MiB, leaving about 255 MB free; system RAM after the failure was available, so the precise allocation-failure cause is unproved. Task-owned baseline dependencies were relocated to C: after all baseline checks, without changing tests or timeouts, before repeating full acceptance. This failed run remains recorded rather than being presented as green.

Final local gates and exact-head CI are recorded with the delivered commit/PR. Required commands are `npm run lint`, `npm run build`, `npm test`, `npm run yoke -- validate canon`, `npm run docs:check`, `npm run audit:ci`, `npm run package:check`, and both working/staged `git diff --check`. CI retains Linux/Windows × Node 20/24 with the same checks. README test metadata is generated by Vitest discovery, including platform-gated cases; discovery counts are distinct from passing counts.

The final complete local suite passed: 215 files, 1,989 passed and two skipped (1,991 discovered cases), 462.64 seconds, exit 0. This includes all 57 supplied cases and 35 additional cases: 92 more than the unchanged baseline. The unchanged three-case handoff probe also passed with assertions against the corrected module. No timeout, required gate or assertion was removed to obtain this result.

All final local gates exited 0: lint (3.930 s), build (4.375 s), full test command (463.338 s), Canon (1.442 s), docs (75.057 s), audit (2.269 s), packaging (2.814 s), working diff check and staged diff check. These are observations from one accepted run, not future completion estimates. Exact final commit and CI job URLs belong to the external delivery report so recording them does not change the tested PR head.

## New synthetic measurement

Raw decoded JSON is in [measurements.json](benchmarks/2026-10-13-efficiency/measurements.json); [provenance.json](benchmarks/2026-10-13-efficiency/provenance.json) records original raw-byte SHA-256 and benchmarked source hashes. Five samples on this Windows host:

| Fixture | Baseline | Corrected implementation |
| --- | ---: | ---: |
| Append 4 MiB in 4 KiB chunks, retain 1 MiB; median | 3,306.075 ms | 13.4381 ms |
| Same fixture; empirical range | 2,930.023–3,356.8863 ms | 11.9199–13.7985 ms |
| Feedback under a 256-character budget | 61,396 characters | 256 characters |
| Standalone historical retrieval with no matching section | 6,000 characters | 168 characters |
| Explicit zero retention | 15 bytes | 0 bytes |

This measures functions, not total Yoke time, accepted-change cost or provider tokens. Background load and future waiting time are unknown. Production prompts preserve complete unclassified binding rules. The benchmark uses development TypeScript and is excluded by the explicit npm package file list; reproduce from a development checkout with `npm run build` then `node bench/stream-efficiency.mjs` and the exact baseline Git blobs available.

## Operational evidence and limits

Read-only `yoke usage . --json` and `yoke tools-preflight . --json` against the authorized project both returned exit 0. There were zero recorded provider calls; consumption totals/phase timings were unknown, not proven zero. Code Intelligence was off and Graft/Graphify/Serena backends were unprobed. This supplies no measured backend readiness or saving. Installed CLI versions observed: Claude 2.1.295 and codex-cli 0.161.0-alpha.2.

`npm list --global @hecer/yoke --depth=0` reported Yoke 1.25.0, matching `npm view @hecer/yoke version`. The global CLI was already current; the original source checkout was 1.22.0 and 33 commits behind the verified remote main. No global install or original-checkout update was needed for this branch.

No authenticated baseline/corrected/direct-provider comparison was performed and no paid provider call was dispatched. Model, reasoning, first-pass acceptance, repairs, external controller costs and real end-to-end savings remain unmeasured. Future phase attribution, policy tuning, exploration reuse and story regrouping from the handoff remain separate product ideas. No universal percentage saving or complete operational optimization is claimed.
