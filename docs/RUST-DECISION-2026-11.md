# Decision: simplify and measure before a Rust migration

Date: 2026-11-01. Status: retain TypeScript for the current remediation; consider a bounded native component only after profiling. This is an implementation decision for this branch, not a claim about future Rust or provider capabilities.

## Why this branch remains TypeScript

The reproduced acceptance, audit, planning, routing, and model-context defects were semantic errors. A different compiler would still accept contradictory review policy, a lossy result codec, a non-atomic planning workflow, or unnecessary model calls. The fixes now address those contracts in the existing implementation, with negative fixtures and recovery checks.

The clearest measured CPU problem was repeated copying of growing dashboard event arrays. The TypeScript correction reduces the 32,000-event median from 5,015.9 ms to 228.8 ms in the same-process synthetic comparison, while preserving all aggregate/run totals. Its serialized response falls from 6,645,384 to 21,400 bytes by returning bounded details. These are local component measurements, not total task acceleration or a Rust comparison. See [raw evidence](../bench/results/dashboard-remediation-2026-11-01.json).

The verification cache and Code Intelligence snapshots also allocated or read more than necessary. Streaming, early eligibility bounds, declared input sets, and clearer cache diagnostics address those costs without replacing the host. Source instruction size and quality-call admission are separate cost drivers; compiling them in Rust cannot reduce the model calls they request.

The existing project includes native CLI adapters, provider event codecs, filesystem transactions, platform process behavior, Git/worktree integration, YAML configuration, browser delivery checks, generated skills/configuration, and a local browser dashboard. A complete port must preserve all of those behaviors and their migration contracts. The browser UI and portable skill assets would remain web/text artifacts even with a native host.

## Where a native component could be useful

| Boundary | Possible value | Evidence required |
|---|---|---|
| Process supervisor | Native process ownership and platform cancellation primitives; less reliance on wrapper process trees | Linux/macOS/Windows process-tree, interruption, identity, orphan, and crash-recovery tests |
| Large history/query engine | Lower CPU/RSS if aggregation and bounded I/O still dominate after the algorithm fix | Representative distributions and p50/p95 CPU, RSS, bytes read, and response times |
| Large repository index/snapshot worker | Bounded memory and parallel CPU hashing under a stable protocol | Large cold/warm fixtures, changed-content invalidation, path policy, and cancellation parity |
| Packaging/startup | A standalone executable may improve a measured installation/startup problem | Actual installation, cold-start, signing/update, and platform support data |

Prefer one sidecar behind a narrow, versioned protocol over a simultaneous rewrite of every module. For a supervisor experiment, keep policy, acceptance, provider selection, budget admission, and integration in TypeScript. The native component owns only process start/stop/stream events and explicit ownership receipts. It must not interpret model text or decide that a task passed.

Specify protocol version negotiation, request IDs, bounded framing, backpressure, partial output, structured errors, cancellation acknowledgments, and lifecycle identity before implementing a sidecar. A “kill requested” response must remain distinct from confirmed tree termination. Do not introduce a second scheduler or independent retry policy.

## Decision experiment

1. Profile the simplified TypeScript host on small edits, debugging, multi-file changes, long histories, and large repositories. Separate provider wait time, model calls, host CPU, Git, filesystem I/O, test time, and human decisions.
2. Select one boundary only if it still causes a material user-visible cost. As a proposed investment threshold, investigate when host work exceeds 15% of the relevant task's elapsed time or repeatedly exceeds the project's declared memory/latency budget. This is a decision policy, not a measured property of Yoke.
3. Build a prototype that implements the same versioned contract and replay the same immutable acceptance/failure fixtures. Benchmark it against the corrected TypeScript implementation, not the removed quadratic algorithm.
4. Require useful end-to-end improvement, unchanged accepted outcomes, comparable crash recovery, no weaker permissions, and acceptable packaging/update complexity. Include migration and ongoing dual-language maintenance in the decision.
5. Retain the TypeScript path until platform parity and rollback are proven. Remove the experiment if it does not justify those costs.

For perspective, Amdahl's law gives maximum total speedup `1 / (1 - p + p/s)`, where `p` is the fraction actually accelerated and `s` its speedup. If native code made a host component five times faster but it represented only 5% of a task, the task improves by about 4.2%. If that component represented 40%, the same local speedup could improve the task by about 47.1%. These are illustrations, not Yoke timing measurements.

## What is intentionally unclaimed

No Rust toolchain or authenticated provider CLIs were available in the audit environment, and no Rust prototype or complete port was compiled. No language-level speed, RAM, binary size, or model-token saving is reported. This branch implements the supported corrections first and retains a concrete, falsifiable gate for deciding whether a native extraction earns its maintenance cost.
