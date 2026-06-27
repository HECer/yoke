# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able:

- `forge loop on` / `forge loop off` — enable/disable (recorded in `.forge/config.yaml`, default off).
- `forge loop status` — show enabled state + PRD progress.
- `forge loop run [--max=N]` — run the loop (default cap 25 iterations).

When enabled and run, each iteration:

1. Pre-dispatch gate: the git worktree must be clean, else `blocked`.
2. Pick the highest-priority unfinished PRD story (`.forge/prd.yaml`).
3. Stop-the-Line gate: the story must have acceptance criteria, else `blocked`.
4. Run a fresh agent to implement ONE story. The runner is selected by `--runner=<claude|codex|gemini>` or the first configured agent (default claude); the loop refuses to start if that agent's CLI is not installed.
5. On success: run the project's verify command (config `verify.command`, or detected `npm test`). Only if it passes, mark the story `passes: true`, save the PRD, and commit atomically. If the agent succeeds but verification fails: `blocked` (story stays open, no commit).
6. Stop when all stories `passes: true` (`complete`), or the iteration cap is reached (`cap-reached`).

State lives outside the model context: the PRD file + git. The agent runner is pluggable.

## Limitations
- Each iteration runs in the working tree directly; per-iteration git-worktree isolation and a review-iteration with role separation are Baustein C4.
- The loop verifies via the project's test command, not a per-agent semantic review.
