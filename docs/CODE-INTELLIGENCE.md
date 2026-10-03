# Yoke Code Intelligence

Yoke integrates Graphify, Graft and Serena as a federation. Their repositories are not merged into Yoke and their individual MCP tools are not published to agents. Yoke publishes one snapshot-bound facade with six tools:

`code_context`, `code_symbol`, `code_trace`, `code_impact`, `code_edit_preview`, and `code_edit_apply`.

## Enable it

```sh
yoke setup . --yes --code-intelligence=active
# or, for an existing project:
yoke retrofit . --code-intelligence=active
```

The default is `off`, which preserves the previous `codeGraph` behavior. `shadow` enables a read-only canary and keeps all edits blocked. `active` enables read operations and snapshot-bound edit previews. The generated host configuration exposes only Yoke's facade, so an agent cannot accidentally combine duplicate backend tools.

## Backend roles and tested pins

| Backend | Role | Launch command | Pin checked during integration |
|---|---|---|---|
| [Graft](https://github.com/trailhq/Graft) | structural code search, repo map, call graph | `graft mcp` | `05760b07abc0e427f5af8ad378889ee402c5afc6` / 0.17.0 |
| [Graphify](https://github.com/Graphify-Labs/graphify) | architecture/document knowledge graph | `python -m graphify.serve` | `67f99bd0059dd1bac9e44382907ef9f10098b39f` / 0.9.56 |
| [Serena](https://github.com/oraios/serena) | LSP symbols, references, implementations and semantic edits | `serena start-mcp-server --project-from-cwd --context codex` | `701e7c843f46c6a649203a488cece1bf19f1df90` / 1.7.1-dev |

Install and pin these tools in the project or developer environment before enabling the facade. Yoke never installs `latest` during a task. Missing tools produce an explicit `partial` response with backend warnings and provenance; they are never interpreted as “no references”.

## Safety contract

- Every request is tied to a workspace and a content-addressed snapshot of committed and uncommitted, non-sensitive files.
- Paths are workspace-relative; traversal, symlinks, `.env`/key material and policy-excluded paths are rejected.
- Read calls share a request deadline and a complete-response output budget. Results distinguish backend identity, source location, semantic resolution and unverified index freshness. See the limits and evidence contracts below.
- Edits run in a disposable Yoke sandbox. Preview writes a durable plan and diff but requires an approval record created by the Yoke control layer.
- Apply rechecks the snapshot, plan expiry, plan hash, an exclusive transaction lock and idempotency. It produces a managed worktree and does not commit or merge; the existing Yoke loop and gates remain authoritative for integration.
- Network access is not needed by the facade. Backend installation and any backend-specific network behavior remain an explicit environment concern.

For a host that has no native MCP support (currently Pi), use the normal Yoke loop and bounded CLI/skill adapter. Yoke does not invent a second MCP transport for that host.

## Evidence and trace contracts

`code_trace` treats Serena's incoming reference list as references to the requested symbol. Each validated referencing symbol has an edge **to the requested target**. Two adjacent results never imply an edge between those results. Incoming implementation lists similarly use the `implements` relation. A bare symbol name is resolved to a unique path-bound Serena identity before requesting these relations; ambiguous targets remain unresolved.

The pinned Graft trace interface returns text. Until an explicit edge format is validated, its output is retained as structural candidates, without invented call edges. Incoming references cannot establish outgoing calls, imports or inheritance: unsupported direction/relation combinations return partial results and explain the missing contract. `require_resolved` excludes unresolved structural candidates; it does not turn an unsupported query into a resolved graph. Semantic trace results currently cover one hop. Requests for greater depth are marked unverified instead of pretending traversal was completed.

`frontier_remaining` counts known entries omitted by result limits, and `traversal_complete` is false when exhaustive traversal is unverified. Zero known omissions does not prove that no other references exist. Node limits preserve graph endpoints: returned edges never point at removed nodes.

The workspace snapshot is content-addressed and an explicitly supplied snapshot is checked against the current workspace before processing. This check does **not** prove that Graft's index, Graphify's graph or the language server has processed those exact file contents. The supported wire contracts do not provide an independently validated index-to-snapshot binding. Consequently backend evidence uses `freshness: "unknown"` and `content_hash: null`; an untrusted backend field claiming `current` is not accepted as proof. The facade no longer stamps a current workspace file hash onto potentially older evidence.

Recognized, path-bound Serena symbol records can have `resolution: "resolved"` while freshness remains unknown. Unrecognized records remain unresolved and cannot create symbols or edges. Read responses use `status: "partial"` and partial coverage for available backends because index freshness and exhaustive coverage are not established. A successful process call alone does not imply complete coverage. Missing backends remain separately identified in `backends_missing`.

Each retained evidence link has a matching `provenance.evidence_id`. This additive field allows callers to resolve evidence IDs and lets output reduction remove unused provenance without breaking retained links. No response cache is used; no stale evidence is reused under a new snapshot or query.

## Output and time limits

The facade forwards all four configured limits:

```yaml
codeIntelligence:
  mode: shadow
  limits:
    tokenBudget: 2400
    timeoutMs: 10000
    maxBytes: 2000000
    maxBackends: 3
```

The effective output cap is the smaller of `maxBytes` and the effective token budget. A request's `token_budget`, where supported, can lower the configured cap, but cannot raise it. The default configured token budget is 2400. The budget covers the entire serialized JSON response in MCP `structuredContent`: result data, provenance, warnings, identifiers, coverage, errors and the metrics themselves. The outer JSON-RPC framing and the short MCP text summary are outside that response.

**Token accounting is deliberately conservative:** one UTF-8 byte consumes one budget unit. `metrics.result_tokens` is therefore an estimate with `token_count_kind: "estimated"` and `token_count_method: "utf8_bytes_conservative"`. It is not provider-measured usage, a tokenizer-specific exact count or a billing estimate. `metrics.returned_bytes` is the actual UTF-8 size of the serialized structured response, including the metrics. This replaces the earlier four-bytes-per-token approximation and makes the same numeric budget stricter; increase the configured budget explicitly if a workflow requires larger context, rather than treating the old number as an exact token allowance.

When an answer does not fit, text is shortened at Unicode-safe boundaries and lower-ranked entries are removed. Arrays and operation receipt fields keep their schema, retained graph edges have valid endpoints, and unused provenance is removed. The answer reports `partial`, adds a truncation warning and never claims complete coverage. Narrow the query or raise the configured budget to obtain omitted content; `next_cursor: null` does not imply a complete search.

A budget can be smaller than the mandatory response envelope. For example, 128 budget units cannot encode all required identifiers and error fields. Such requests fail with `BUDGET_EXCEEDED` **before a backend is invoked**. The small, fixed-shape error envelope is the only output-cap exception; its size is reported accurately, and it contains no backend payload or unbounded error text. Apply additionally reserves space for its entire concrete receipt, including all changed paths and a possible deadline warning, before starting a transaction. An insufficient receipt budget rejects the apply without mutating. A completed apply keeps its transaction receipt even if synchronous work crossed the deadline.

The effective deadline is the smaller of configured `timeoutMs` (10000 ms by default) and the request's `timeout_ms`/tool default. All backend calls, semantic target resolution and preview operations consume the same remaining time. MCP initialization and its subsequent tool call also share that allowance. A backend which ignores its timeout is closed, late results are discarded, and no subsequent backend starts after expiry. Backend shutdown has a separate bounded cleanup grace; synchronous filesystem snapshot/transaction operations cannot be preempted mid-operation, so the deadline is not an exact end-to-end wall-clock promise. A final deadline check after normalization and output reduction marks delayed results partial and keeps any completed operation's receipt. A preview needing the former 120000 ms tool default must also have a configured timeout of at least that size.

## Validation scope

The regression suite uses model-free adapters and local synthetic MCP processes. It verifies reference direction and endpoints, unknown payload handling, honest freshness and coverage, aggregate output limits, Unicode boundaries, evidence link preservation, tiny-budget failures, limit propagation, and shared deadlines including initialization. It does not assert a successful run against installed authenticated backends or an exact provider-token saving.
