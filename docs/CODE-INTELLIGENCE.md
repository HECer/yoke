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
- Read calls are bounded by timeout and output budgets. Results carry backend, version, source path, content hash, resolution and freshness.
- Edits run in a disposable Yoke sandbox. Preview writes a durable plan and diff but requires an approval record created by the Yoke control layer.
- Apply rechecks the snapshot, plan expiry, plan hash, an exclusive transaction lock and idempotency. It produces a managed worktree and does not commit or merge; the existing Yoke loop and gates remain authoritative for integration.
- Network access is not needed by the facade. Backend installation and any backend-specific network behavior remain an explicit environment concern.

For a host that has no native MCP support (currently Pi), use the normal Yoke loop and bounded CLI/skill adapter. Yoke does not invent a second MCP transport for that host.
