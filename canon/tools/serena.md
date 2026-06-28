# Tool: Serena (code-graph, LSP-accurate)

MIT, MCP-first. The alternative to graphify, selected via `forge retrofit --code-graph=serena`. Serena uses real language servers (LSP) for symbol-accurate, cross-file retrieval and refactoring (`find_symbol`, `find_referencing_symbols`, rename/move) — no static index that goes stale, so it will not miss a reference.

Wired as an MCP server for all three agents. Best for large, strongly-typed codebases (TypeScript, Python, Go) doing systematic refactoring, where missing a caller is costly.

Caveat: needs one language server per language (can be fiddly on Windows for exotic languages) and requires `uv`. The launch command is a best-effort template — adjust to your install, e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`.
