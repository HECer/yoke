# Yoke — cross-agent coding harness

Yoke keeps **one** curated canon of engineering skills (TDD, brainstorming → spec → plan,
systematic debugging, cross-model review, design verification) and generates the idiomatic
native artifacts for Claude Code, Codex CLI, **and Gemini CLI** — plus an opt-in autonomous
loop that ships a story backlog behind mechanical gates (clean tree → criterion-targeted tests →
project tests green → independent review → commit), with evidence per criterion, screenshot proofs
per story, and an optional integrated completion check when the current backlog is green.

## Using Yoke from Gemini CLI

The `yoke` CLI is installed separately: `npm i -g @hecer/yoke` (Node ≥ 20, git required).

- `yoke retrofit . --agent=gemini` — install the harness into this project: `GEMINI.md`,
  one `.gemini/commands/<skill>.toml` per canon skill, settings merge. Non-destructive;
  existing files are backed up. Use `--agent=all` to wire Claude Code and Codex CLI too.
- `yoke new <dir> --idea="..."` — greenfield: git repo + harness + story backlog from the idea.
- `yoke change add . --idea="..."` — queue another requirement at any time; the loop turns it
  into append-only stories at the next safe boundary after an independent coverage check.
- `yoke loop on . && yoke loop run . --isolate` — the autonomous loop. A story counts as done
  only when the project's own verify command exits 0 — never because the agent said so.
- `yoke loop run . --isolate --parallel=3` — dispatch dependency-ready, non-colliding stories
  through separate Gemini/Claude/Codex workers and rerun all gates after FIFO integration.
- `yoke loop run . --quality --quality-rounds=3` — compare a story's declared candidate artifact
  with its approved reference through a blind critic and bounded repair loop. Add `--candidates=2`
  to select one mechanically green implementation while retaining proof for every candidate.
- `yoke loop status .` — inspect worker, provider, worktree, candidate lifecycle, integration queue,
  quality round, and repair-budget state without spending agent tokens.
- `yoke loop cleanup .` — reap recorded orphan runners and stale locks; worktrees are retained
  unless `--remove-worktrees` is explicit.
- `yoke review [dir] --reviewer=<agent>` — independent second-model diff review as an
  exit-code gate.
- Every command is an exit-code contract (0 = success), so you can chain them with `&&`.

Docs: https://github.com/HECer/yoke#readme
