# Changelog

## 0.8.0 — 2026-07-20

### Added
- **Live progress + ETA.** Story completions are now first-class events: the console shows
  `✓ S6 done in 4m28s — 20/45 (44%) · ~1h40m left`, every status (file, NDJSON stream,
  `yoke loop status`) carries `percent` and an `eta` block. The estimate averages the
  durations of stories completed **in this run** (current velocity) and falls back to the
  persisted history of previous runs (`.yoke/story-durations.json`, last 50, gitignored).
  No data → no estimate, never an invented one.
- **Ambiguity policy** (`loop.onAmbiguity` / `--on-ambiguity=<resolve|abort>`). The runner
  prompt now always forbids asking questions (a loop run has nobody to answer). Default
  `resolve`: the agent settles ambiguous criteria itself, states the interpretation, and the
  loop never stops. Opt-in `abort`: the agent writes its open questions to
  `.yoke/ambiguity.md` and stops; the loop consumes the file, skips verify (an unimplemented
  story would otherwise pass on pre-existing green tests), and blocks with the question as
  the reason. Companion principle: clarifying questions belong in the planning round, before
  the loop starts.

## 0.7.0 — 2026-07-17

### Added
- **Update check + `yoke upgrade`.** Every CLI invocation ends with a non-blocking
  version hint (npm/gh-style): a detached background refresher caches the registry's
  latest at most once a day; when it is newer, a one-line stderr hint suggests
  `yoke upgrade` (which runs `npm install -g @hecer/yoke@latest`). Silent in CI,
  `--json` runs, non-TTY pipes, and under `YOKE_NO_UPDATE_CHECK=1`.
- **Opt-in auto-upgrade** (`update.auto: true` in `.yoke/config.yaml`): evaluated at
  loop START only — never mid-run; the running process finishes on its version and
  the upgrade applies from the next invocation. Deliberately NOT the default:
  a gate harness must not change itself mid-project (determinism), and unreviewed
  auto-installs are a supply-chain hazard.

## 0.6.0 — 2026-07-17

### Added
- **Project-scoped orphan reaping.** The watchdog now records its pids in the project's
  `.yoke/runner.pid` (main dir and per-story worktrees; removed on clean exit), and
  `yoke loop cleanup` kills exactly those recorded process trees — and only while no
  live loop holds the lock. Background: without a scoped mechanism, users and agents
  resorted to machine-wide pattern kills (every process matching
  `dangerously-skip-permissions`), which took down *healthy* runners of other projects
  mid-story and stalled their loops. Never kill by pattern; `yoke loop cleanup` is the
  safe path. `.yoke/runner.pid` is gitignored by retrofit.

## 0.5.0 — 2026-07-17

Root-cause fixes for the two "yoke keeps hanging" failure modes observed in the field
(orphaned `claude.exe` runners piling up, healthy long stories dying at exactly the
idle window):

### Fixed
- **Watchdog now kills the whole process tree on Windows** (`taskkill /T /F`).
  Previously it killed only the spawned shell (`shell: true`), orphaning the actual
  agent process — which kept writing to the worktree (dirty-tree blocks, failing
  worktree removal) and kept burning API tokens. Observed in the field as ~10
  zombie `claude.exe` per machine plus surviving dev servers.
- **Claude runner always runs in stream-json mode.** Plain `-p` prints nothing until
  the run finishes, so the idle watchdog mistook healthy >20-minute stories for dead
  processes and killed them at exactly the idle timeout — while the user saw dead air.
  The stream doubles as liveness; token usage is now reported on every run (not just
  `--json` mode).

### Changed
- README: operating notes for driving the loop from inside an agent session
  (background execution, small `--max` batches, `yoke loop cleanup` after interrupts) —
  outer shell-tool timeouts killing a foreground `yoke loop run` were the third
  observed "hang" pattern.

## 0.4.0 — 2026-07-17

### Added
- **Hardened runner prompts** — distilled agent-harness patterns for headless runs:
  scope discipline (nothing beyond the story), no unsolicited summary/plan/analysis
  documents, root-cause fixes instead of gate bypasses, faithful outcome reporting,
  bounded final messages (cuts output-token waste). Review prompts now ground verdicts
  in observed evidence only and keep them brief.

### Fixed
- `.yoke/loop.pause` is now gitignored by retrofit. Previously the loop's own
  `git add -A` story commit swept the pause control file into history in
  un-retrofitted targets; removing it dirtied the tree and the clean-tree gate
  blocked the resume run — the loop locked itself out.

> Note: 0.3.0 was tagged and released on GitHub but never reached npm (2FA re-login
> was pending), so for npm users 0.4.0 is the first release with the 0.3.0 changes below.

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
