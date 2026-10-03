# Direct Codex comparison — 2026-09-29

AI-assisted authenticated evaluation of Yoke **1.19.0**, commit `05fac3db1a51412563005e07f80e6e5a9aab8e06`. A fresh origin fetch confirmed that revision remains the remote main head.

All arms requested **gpt-6.1-sol / low**, disabled routing and native multi-agent delegation, and used disposable Git fixtures with the same source and acceptance tests within each comparison. User config was disabled; removal of every host skill/plugin was not certified. The direct Codex arm received all story requirements in one call. Yoke used its normal per-story implementation, verification and commit workflow. This compares complete user workflows, not just model-call latency. Permissions allowed changes in the disposable fixture projects. The protected seed tests were replayed after execution; they were visible to agents, not hidden tests.

| Fixture | Arm | Accepted runs | Median elapsed seconds | Fresh input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- |
| routing-queue | codex | 2/2 | 118.3 | 25,292 | 2,162 |
| routing-queue | yoke-serial | 2/2 | 274.9 | 48,524 | 4,822 |
| independent-utils | codex | 1/1 | 71.3 | 10,263 | 797 |
| independent-utils | yoke-serial | 1/1 | 442.2 | 92,330 | 3,905 |
| independent-utils | yoke-parallel | 0/1 | 117.1 | 81,497 | 3,487 |

Queue: **two alternating pairs**, each evaluated against ten original tests. Both arms passed both times. Yoke's serial workflow took **2.32 times** the elapsed time, with **91.9% more fresh input tokens**. Input totals also include cached tokens; fresh input is aggregate input minus cached input. This is not a USD cost calculation.

Independent utilities: **one run per arm**, with three disjoint source scopes and fifteen original tests. Direct Codex and Yoke serial passed. Parallel Yoke started three real workers but accepted no stories after its integration checks lost the `YOKE_STORY` context. It stopped at the explicit three-attempt cap. **Its shorter failure time is not a performance improvement.** The deterministic control probe reproduced the context loss independently of model quality.

The initial independent fixture lacked runtime ignore rules; its serial run stopped after one story. Its parallel attempt also hit Git's Windows worktree path limit before model execution. The fixture was corrected and all three arms rerun under shorter paths. Those initial records are retained separately as setup diagnostics, not silently discarded or mixed into accepted performance statistics.

These are small fixtures on one Windows machine with uncontrolled background load. CPU, memory and USD cost were not measured. Routing, cheap-worker selection, native Codex subagents, large repositories and prolonged exploration were not compared. There is no evidence here that Yoke generally outperforms direct Codex. The observed serial overhead and parallel failure warrant fixing workflow/context correctness before promoting universal efficiency claims.

See the [Goals/resource audit](GOALS-RESOURCE-AUDIT-2026-09-29.md) for implementation priorities. Machine-readable records: [comparison results](../bench/results/codex-comparison-2026-09-29.json), [integration probes](../bench/results/goal-integration-probes-2026-09-29.json). Full raw logs remain in the local testground; they are not included in these summaries.

Reproduce with `bench/compare-codex.mjs`, then `bench/analyze-codex-comparison.mjs`. Use fresh, short output roots on Windows. The new summary tests verify median arithmetic, cache subtraction, unknown usage, incompatible policies and invalid measurements.

Provenance: this report is disclosed as AI-assisted. Read-only text scans cannot establish human authorship or verify proprietary keyed watermarks; cryptographic verification and signer trust remain unknown without the corresponding verifier and trust policy.

## Later tooling update — 1.22.0

The measurements above remain the historical 1.19.0 results. The current analyzer
reads their aggregate JSON as legacy/unverified because those runs did not record
the new complete comparison manifest. It preserves the reported values and does
not manufacture missing provenance or reinterpret them as 1.22.0 measurements.

New runs record source/build, fixture, acceptance and submitted-input digests,
requested and reported model identities, and explicit startup conditions.
The historical direct-arm ignore-rules difference is now an expressly declared
workflow variable. Undeclared cross-arm differences, missing provenance and
failed acceptance do not produce performance comparison groups.
See [benchmark manifests](BENCHMARK-MANIFEST.md) for the contract and limitations.
This is a tooling change; no new authenticated comparison was performed for it.
