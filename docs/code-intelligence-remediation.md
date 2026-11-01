# Code Intelligence remediation and migration

This document describes the November 2026 remediation in this branch. It supersedes the previous Code Intelligence preview/apply claims. No authenticated external-backend acceptance run or model-cost comparison is implied by the local regression tests.

## Supported surface

The facade advertises five read tools: `code_context`, `code_symbol`, `code_trace`, `code_impact`, and `code_evidence`. `off` advertises none. Both `shadow` and `active` expose the same read surface for now.

`code_edit_preview` and `code_edit_apply` are unavailable in every mode. Direct calls return `CAPABILITY_UNAVAILABLE` before snapshotting, launching a backend, or changing source files. Legacy plan creation, loading, approval and transaction helpers also fail closed; a hand-written approval file cannot reactivate them. The former implementation did not implement host-owned approval, complete add/delete/rename accounting, actual validation, or trustworthy worktree integration. Use the native worker and Yoke's existing acceptance workflow for changes.

Re-enabling facade edits requires a separately reviewed transaction implementation: a real isolated worktree, complete change tracking, explicit validation results, approval bound to the exact plan and policy, conflict handling, and integration through the host. A copied directory or a successful backend call does not establish those properties.

## External processes and policy

The facade cannot impose a network sandbox on arbitrary local backend commands. With the default `policy.allowNetwork: false`, it therefore refuses to launch external backends, including preflight capability probes. An explicit `true` permits execution of trusted local programs. It does not make their filesystem access safe, verify their installed version, or guarantee that their indexes excluded particular files. Isolate those processes at the OS/container boundary when that is required.

Example configuration for backends that the project owner trusts to run:

```yaml
codeIntelligence:
  mode: shadow
  policy:
    allowNetwork: true
    excludePatterns:
      - private/**
      - '**/credentials/**'
    maxFileBytes: 2000000
  limits:
    outputBytes: 9600
    timeoutMs: 10000
    maxBytes: 2000000
    maxBackends: 3
```

Exclusions use an explicit `*`, `?`, `**` grammar. `**/` matches zero or more directories. Requests validate every supplied path before dispatch. Evidence records with recognized forbidden or out-of-snapshot paths are discarded, including their text, rather than retaining the text with a null path. This validation is a filter for known evidence formats, not a generic secrets scanner or a substitute for process isolation.

Snapshot and metadata access reject symlinks in existing ancestors as well as at the leaf. Standard exclusions cover `.git`, the facade's own metadata, `.env` and `.env.*`, and common private-key extensions. Concurrent adversarial ancestor replacement is not claimed to be prevented by a portable JavaScript path check. Edit containment avoids presenting those checks as a secure write transaction.

## Byte budgets and retained evidence

Use configuration `limits.outputBytes` and request `max_output_bytes`. These bound UTF-8 bytes in the complete structured response, including metadata and provenance. An unset limit defaults to 9,600 bytes. The transport's `maxBytes` remains an additional cap. A request may lower the configured cap.

Legacy `limits.tokenBudget` and request `token_budget` still work as byte caps when explicitly set. They are deprecated and emit a migration warning. Their old name never meant measured provider tokens. `metrics.returned_bytes` is exact for the structured response; `result_tokens` uses a labelled bytes/4 heuristic and is neither a billing figure nor a guaranteed upper bound. The JSON-RPC transport envelope and short MCP text notice are additional bytes.

Results retain permitted backend evidence, normalized data, provenance and the original request in a content-addressed local artifact before display reduction. Responses return `artifact_uri` and `evidence_cursor`. Call `code_evidence` with the cursor; concatenate each page's `data.text` in order and continue with `data.next_cursor` until it is null. The pages reconstruct the artifact's UTF-8 JSON without repeating backend queries. Unicode boundaries are preserved. The artifact is bound to workspace identity, snapshot ID and the exclusion/file-size policy, and its hash is verified when read. A policy change prevents reading an artifact created under the old policy.

Evidence is historical. Reading a page does not establish current source or backend-index freshness. Artifacts are deduplicated by content and individually capped at 32 MiB. There is currently no automatic retention cleanup; project owners may remove old `.yoke/code-intelligence/evidence` and snapshot artifacts when their cursors are no longer needed. A response budget smaller than the mandatory error envelope returns a minimal `BUDGET_EXCEEDED` envelope, which can itself exceed such an unusable requested cap. No backend query runs when this is known before dispatch.

## Useful dispatch and wire formats

`code_symbol` goes directly to the semantic backend. It no longer pays for a Graft query whose output is discarded, and `maxBackends: 1` can serve a semantic request. Pinned Serena path/kind groups and collapsed singleton records preserve symbol paths, available reference locations and diagnostic severity, including diagnostics grouped under slash-containing symbol names. Its labelled shortened-reference JSON is decoded with an explicit shortening warning; counts-only or unknown semantic shapes remain unresolved. Raw permitted evidence remains retrievable. MCP adapters retain all text content blocks and unwrap the supported structured result envelopes. The codec fixture follows [the pinned Serena implementation](https://github.com/oraios/serena/blob/701e7c843f46c6a649203a488cece1bf19f1df90/src/serena/tools/symbol_tools.py).

`code_context` validates and queries multiple explicit scopes within a fixed eight-call request ceiling. `code_impact` requires explicit nonempty targets; edit-plan targets are not advertised. It tries semantic evidence first, uses structural search when needed, and does not attach unrelated test paths. Document retrieval is opt-in. A file symbol overview is labelled as an overview, not a complete impact analysis.

Graphify NODE/EDGE text is split into complete items with edges first for display reduction. This improves the chance of retaining relationships under small budgets; the full permitted result is available through the evidence cursor. Graft prose does not become invented graph edges. Semantic traces report their supported one-hop direction/relations, and mark deeper or unsupported coverage unverified. The facade does not claim that a current workspace snapshot proves a backend index used that snapshot. Provenance reports observed server versions where available, otherwise `unknown`; the configured pin is an expectation, not an observation.

## Process and filesystem costs

Each MCP process generation has one shared initialization promise and its own parser, pending requests and output counters. Concurrent callers retain individual deadlines. Restarts do not inherit partial frames, and old process events cannot reject a new generation's requests. Incoming frames, pending server requests and backend calls are bounded. Shutdown uses the existing process-tree cleanup helper; restart is refused if cleanup cannot be confirmed. Environment inheritance uses a documented implementation allowlist for basic runtime/path/locale variables rather than copying unrelated API credentials. This is not a full process supervisor or a guarantee after an uncatchable facade crash.

Snapshots hash files with a reusable 128 KiB buffer, reject changes observed during hashing, and retain metadata rather than repository-wide content buffers. Duplicate Git paths are removed. Git corruption or permission failures do not silently turn into a plain-directory scan. Identical snapshot manifests are reused without rewriting. Limits are 100,000 listed files and 128 MiB of permitted source bytes; oversized configured files can be excluded with `maxFileBytes`. Snapshot manifests are integrity checked and bounded when loaded.

Current source content is still hashed on snapshot validation. No metadata-only cache claims freshness for changed files, and no measured end-to-end speedup or Rust speedup is asserted here.

## Validation scope

Focused tests exercise recursive globs, symlink ancestors, excluded payload rejection, all-scope validation, grouped Serena references and diagnostics, semantic-first dispatch, Unicode evidence pagination and policy binding, a synthetic 12-node/66-edge graph, read-only edit containment, complete tool input shapes, input frame bounds, initialization races, per-caller deadlines, process restart and POSIX descendant termination. These are deterministic local contract tests. They do not certify every installed backend version, platform process boundary or language-server result format.
