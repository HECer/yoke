# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able:

- `yoke loop on` / `yoke loop off` — enable/disable (recorded in `.yoke/config.yaml`, default off).
- `yoke loop status` — show enabled state + PRD progress.
- `yoke loop run [--max=N] [--isolate]` — run the loop (default cap 25 iterations).

Pass `--isolate` to run each iteration in a fresh git worktree: the agent works on a throwaway checkout, and only a verified, committed story is fast-forwarded back into the main tree. A failed iteration never touches your working tree. Requires `.yoke/prd.yaml` to be committed to git, since the worktree is a checkout of HEAD.

Pass `--review` (or `--reviewer=<claude|codex|gemini>` for a different agent) to add a role-separated review step: after the tests pass, an independent reviewer agent must approve the change before the story is committed and marked done. A rejection blocks the story (no commit). The reviewer is a fresh agent pass — the implementer never reviews its own work.

Pass `--json` for machine mode: each status transition is emitted as one NDJSON line on stdout (the `.yoke/loop-status.json` shape, tagged `"type":"status"`) instead of the human narrative, so a supervisor can consume the stream instead of polling the file.

When enabled and run, each iteration:

1. Pre-dispatch gate: the git worktree must be clean, else `blocked`.
2. Pick the highest-priority unfinished PRD story (`.yoke/prd.yaml`).
3. Stop-the-Line gate: the story must have acceptance criteria, else `blocked`.
4. Run a fresh agent to implement ONE story. The runner is selected by `--runner=<claude|codex|gemini>` or the first configured agent (default claude); the loop refuses to start if that agent's CLI is not installed.
5. Run the project's verify command (config `verify.command`, or detected `npm test`).
   **Verify is the source of truth** — the agent's exit code is advisory, so a spurious
   non-zero exit (e.g. a Windows `.cmd` wrapper) cannot block a story whose tests are green.
   A failing verify is retried up to `verify.retries` times (default 1) so a transient flake
   self-heals; a real failure still fails. Only if verify passes is the story marked
   `passes: true`, committed atomically, and a decision logged. If verify fails: `blocked`.
6. Stop when all stories `passes: true` (`complete`), or the iteration cap is reached (`cap-reached`).

A supervisor can pause the loop by creating `.yoke/loop.pause`: at the next story boundary (before the next story is selected — the running story always finishes) the loop consumes the file, records `paused` in the status file and log, and exits with code `3`. Running `yoke loop run` again resumes.

State lives outside the model context: the PRD file + git. The agent runner is pluggable.

## Limitations
- The loop verifies via the project's test command and an optional agent review; it has no formal merge-queue or multi-reviewer quorum.
