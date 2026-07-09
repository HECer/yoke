# Yoke — cross-agent coding harness

Yoke keeps **one** curated canon of engineering skills (TDD, brainstorming → spec → plan,
systematic debugging, cross-model review, design verification) and generates the idiomatic
native artifacts for Claude Code, Codex CLI, **and Gemini CLI** — plus an opt-in autonomous
loop that ships a story backlog behind mechanical gates (clean tree → acceptance criteria →
real tests green → independent review → commit), with screenshot proofs per story.

## Using Yoke from Gemini CLI

The `yoke` CLI is installed separately: `npm i -g @hecer/yoke` (Node ≥ 20, git required).

- `yoke retrofit . --agent=gemini` — install the harness into this project: `GEMINI.md`,
  one `.gemini/commands/<skill>.toml` per canon skill, settings merge. Non-destructive;
  existing files are backed up. Use `--agent=all` to wire Claude Code and Codex CLI too.
- `yoke new <dir> --idea="..."` — greenfield: git repo + harness + story backlog from the idea.
- `yoke loop on . && yoke loop run . --isolate` — the autonomous loop. A story counts as done
  only when the project's own verify command exits 0 — never because the agent said so.
- `yoke review [dir] --reviewer=<agent>` — independent second-model diff review as an
  exit-code gate.
- Every command is an exit-code contract (0 = success), so you can chain them with `&&`.

Docs: https://github.com/HECer/yoke#readme
