# Loop Specification (Ralph + GSD)

The autonomous loop is optional and toggle-able:

- `yoke loop on` / `yoke loop off` — enable or disable it in `.yoke/config.yaml`.
- `yoke loop status` — show enabled state and backlog progress.
- `yoke loop run [--max=N] [--isolate] [--decision-policy=auto|critical]` — run until the current backlog is green or a gate blocks.
- `yoke change add --idea="..."` — queue a product change at any time, including while the loop is running.
- `yoke loop decision` / `yoke loop answer --choice=<id>` — inspect and answer a structured critical stop.

Pass `--isolate` to implement each story in a fresh git worktree. Only a verified, committed
story is fast-forwarded to the main tree. Pass `--review` or `--reviewer=<provider>` to require
a separate, schema-validated review. Pass `--json` for NDJSON status on stdout.

At every story boundary, Yoke consumes at most one queued change. The configured Claude,
Codex, or Gemini provider may propose only new stories in a separate runtime file. A fresh
coverage-review pass must account for every distinct requested outcome before Yoke validates
strict criterion evidence, appends the stories itself, commits only the PRD, and leaves existing
stories untouched. The request stays pending on any failure or uncovered outcome.

For each story:

1. Require a clean git worktree.
2. Pick the highest-priority ready unfinished story.
3. Stop the line if acceptance is empty. With `verify.requireCriteria: true`, every criterion
   must be structured. Every structured criterion, including in compatible legacy projects,
   must use a single approved test command containing its criterion ID and no shell operators.
4. Run a fresh configured provider to implement exactly one story. Under the `critical`
   decision policy, only high-impact architecture, security/privacy, destructive data,
   material cost, compliance, or irreversible choices may pause for a human decision.
5. Run every structured criterion's targeted commands and write
   `.yoke/proof/<story>/evidence.json`. Then run project-wide `verify.command` (or detected
   `npm test`). Performance, audit, and independent review gates follow when configured. Any
   failure blocks, and no proof command runs after review.
6. Only after all gates pass, mark the story `passes: true`, log the decision, and commit
   atomically. A failed commit restores the PRD state.
7. When all current stories pass, run optional `completion.command` against the integrated
   system. Only a green result reports `complete`; otherwise the loop blocks. This readiness
   result is ephemeral, not a release and not a freeze on future changes.

A supervisor can pause the loop by creating `.yoke/loop.pause`. The running story finishes;
the signal is consumed at the next story boundary and the process exits with code `3`.

State lives outside model context: PRD, git, and the ignored `.yoke/changes/` inbox. All are
re-read at story boundaries, so a request queued mid-run becomes additional stories without a
restart.

## Limitations

Yoke cannot infer the correct end-to-end journey command. Projects that need integrated
readiness must configure `completion.command`, for example a Playwright journey suite.
