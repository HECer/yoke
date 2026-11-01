# Yoke Code Intelligence

The optional facade now exposes five read operations: `code_context`, `code_symbol`, `code_trace`, `code_impact`, and paginated `code_evidence`. New setups leave it off. Both `shadow` and `active` currently provide the same read-only surface. Preview and apply are disabled until host-owned authorization, real worktrees, complete change tracking, and actual validation are implemented and reviewed.

Read [the current contract and migration guide](code-intelligence-remediation.md) before enabling it. That document covers path/exclusion policy, backend trust, byte budgets, evidence retrieval, snapshot limits, process lifecycle, and validation scope.

```sh
yoke retrofit . --code-intelligence=shadow
```

External backends require explicit `codeIntelligence.policy.allowNetwork: true`: the facade cannot enforce a network sandbox and does not silently launch a process while claiming otherwise. This setting acknowledges trusted local executable access; use OS/container isolation when backend filesystem or network access must be restricted. Declared exclusions filter recognized evidence and snapshots; they do not constrain everything an external executable can read.

| Backend | Intended use | Compatibility evidence |
|---|---|---|
| [Graft](https://github.com/trailhq/Graft) | Structural search and repository candidates | Configured codec expectation; observed server identity reported separately |
| [Graphify](https://github.com/Graphify-Labs/graphify) | Architecture/document graph evidence | Structured and supported NODE/EDGE fixtures |
| [Serena](https://github.com/oraios/serena) | Semantic symbols and references | Grouped path/kind and singleton result fixtures |

A codec fixture or expected pin does not prove the installed backend's version, complete coverage, or index freshness. Unknown formats and unverified freshness stay explicit. Use `yoke tools-preflight . --json` for the limited installed capability probe. Custom commands remain unprobed by that model-free diagnostic. No authenticated external-backend acceptance result is claimed by the November local tests.

Use `limits.outputBytes` (default 9,600) and request `max_output_bytes`. The old token-named settings remain deprecated byte aliases when explicitly supplied. Reduced responses retain content-addressed full permitted evidence and continuation cursors instead of discarding the only copy of references or graph edges. See the migration guide for envelope exceptions and retention limits.
