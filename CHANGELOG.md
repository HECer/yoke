# Changelog

## 0.3.0 — 2026-07-10

### Added
- **Claude Code plugin packaging** — the repo is now its own plugin marketplace
  (`.claude-plugin/plugin.json` + `marketplace.json`): `/plugin marketplace add HECer/yoke`,
  then `/plugin install yoke@yoke` installs the full canon under the `yoke:` skill namespace.
- **Gemini CLI extension manifest** (`gemini-extension.json` + `GEMINI-EXTENSION.md`) —
  installable via `gemini extensions install https://github.com/HECer/yoke`, listed in the
  daily-crawled extensions gallery.
- **Benchmark harness** (`bench/`) — reproducible cross-runner benchmark (tokens · speed ·
  quality) with a fixed fixture, pre-written objective tests, and committed result data.
- **Companion tool docs** — `canon/tools/claude-mem.md` (persistent memory; interactive
  sessions only, explicitly kept out of loop runs) and `canon/tools/ui-ux-pro-max.md`
  (design generation paired with Yoke's design verification gates).
- **Multi-agent parallel loop design** — evaluation + phased design for distributing PRD
  stories across parallel workers (`needs` dependency field, claim files, merge queue,
  heterogeneous cross-agent dispatch): `docs/superpowers/specs/2026-07-10-multi-agent-parallel-loop-design.md`.

### Fixed
- Agent-availability probe timeout raised 5s → 20s: Gemini CLI cold-starts in ~6s on
  Windows, so the loop misreported an installed `gemini` as "not found on PATH"
  (found by the new benchmark harness).
- Gemini runner invocation: dropped the bare `-p` flag — current Gemini CLI (0.33+)
  requires a value after `-p` and errored with "Not enough arguments following: p".
  Piped stdin selects headless mode by itself, so the runner now passes only `--yolo`
  (also found by the benchmark harness).

### Changed
- README: npm install is now the primary quickstart path; documented plugin/extension
  installs and optional companions.
- npm package now ships `CHANGELOG.md`, `bench/` (harness + result data), and
  `docs/superpowers/` (all specs and plans, including the multi-agent parallel loop design).

## 0.2.0 — 2026-07-09

- First npm release as `@hecer/yoke`.
- Hyperflow integration surface: `yoke loop run --json` NDJSON stream, pause signal,
  token-usage + model-id reporting for the claude runner.
- `yoke new` greenfield bootstrap, `yoke prd draft`, cross-model `yoke review`,
  `yoke flow-smoke` browser gate with proof artifacts, `yoke design-scan`.
- Retrofit planners for Claude Code, Codex CLI, Gemini CLI; canon of 26 skills;
  loop with worktree isolation, watchdog, single-flight lock, commit integrity.
