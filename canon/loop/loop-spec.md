# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able:

- `forge loop on` / `forge loop off` — enable/disable (recorded in `.forge/config.yaml`, default off).
- `forge loop status` — show enabled state + PRD progress.
- `forge loop run [--max=N]` — run the loop (default cap 25 iterations).

When enabled and run, each iteration:

1. Pre-dispatch gate: the git worktree must be clean, else `blocked`.
2. Pick the highest-priority unfinished PRD story (`.forge/prd.yaml`).
3. Stop-the-Line gate: the story must have acceptance criteria, else `blocked`.
4. Run a fresh agent (default `claude -p`) to implement ONE story.
5. On success: mark the story `passes: true`, save the PRD, and commit atomically.
   On failure: `blocked`.
6. Stop when all stories `passes: true` (`complete`), or the iteration cap is reached (`cap-reached`).

State lives outside the model context: the PRD file + git. The agent runner is
pluggable; Codex/Gemini runners and full per-iteration worktree isolation are Baustein C2.

## C1 limitations
- The loop trusts the agent's exit code as a proxy for "tests pass"; there is no independent test run yet (deferred to C2).
- The agent runner is claude-only; Codex/Gemini runners and per-iteration git-worktree isolation are C2.
