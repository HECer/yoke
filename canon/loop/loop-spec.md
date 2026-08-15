# Loop Specification (Ralph + GSD)

The autonomous loop is optional and toggle-able:

- `yoke loop on` / `yoke loop off` — enable or disable it in `.yoke/config.yaml`.
- `yoke loop status` — show enabled state and backlog progress.
- `yoke loop run [--max=N] [--parallel=N] [--isolate] [--decision-policy=auto|critical] [--quality|--no-quality] [--quality-rounds=N] [--quality-minutes=N] [--quality-policy=blocking|advisory] [--quality-unbounded] [--candidates=N]` — run until the current backlog is green or a gate blocks.
- `yoke change add --idea="..."` — queue a product change at any time, including while the loop is running.
- `yoke loop decision` / `yoke loop answer --choice=<id>` — inspect and answer a structured critical stop.

Pass `--isolate` to implement each story in a fresh git worktree. Only a verified, committed
story is fast-forwarded to the main tree. Pass `--review` or `--reviewer=<provider>` to require
a separate, schema-validated review. Pass `--parallel=N` to dispatch ready, non-colliding stories
concurrently. Pass `--json` for NDJSON status on stdout.

Stories may declare a reference, candidate artifact, rubric, and blocking/advisory quality policy.
`--quality` runs a read-only blind critic plus bounded repair before review; every repair reruns the
mechanical gates. `--candidates=N` requires quality declarations and dispatches multiple isolated
implementations, rejects mechanically red candidates, selects one green candidate through opaque
pairwise handles, and retains every candidate's terminal proof before cleanup. Parallel/candidate
runs do not combine with adaptive routing.

At every story boundary, Yoke consumes at most one queued change. The configured Claude,
Codex, or Gemini provider may propose only new stories in a separate runtime file. A fresh
coverage-review pass must account for every distinct requested outcome before Yoke validates
strict criterion evidence, appends the stories itself, commits only the PRD, and leaves existing
stories untouched. The request stays pending on any failure or uncovered outcome.

For each story:

1. Require a clean git worktree.
2. Pick the highest-priority ready unfinished story, or claim multiple dependency-ready stories
   whose collision areas do not overlap when parallel dispatch is enabled.
3. Stop the line if acceptance is empty. With `verify.requireCriteria: true`, every criterion
   must be structured. Every structured criterion, including in compatible legacy projects,
   must use a single approved test command containing its criterion ID and no shell operators.
4. Run a fresh configured provider to implement exactly one story. Under the `critical`
   decision policy, only high-impact architecture, security/privacy, destructive data,
   material cost, compliance, or irreversible choices may pause for a human decision.
5. Run every structured criterion's targeted commands and write
   `.yoke/proof/<story>/evidence.json`. Then run project-wide `verify.command` (or detected
   `npm test`). Performance and audit follow when configured. If quality is enabled, collect the
   declared artifact, run the blind critic, and repair within the configured round/time bounds.
   Independent review follows. Any blocking failure stops the candidate.
6. Parallel workers enqueue green candidate commits. The integrator applies one at a time and
   reruns mechanical gates, fresh quality, and review against the integrated tree. Failed
   integration reopens the story and retains proof.
7. Only after all gates pass, mark the story `passes: true`, log the decision, and commit
   atomically. A failed commit restores the PRD state.
8. When all current stories pass, run optional `completion.command` against the integrated
   system. Only a green result reports `complete`; otherwise the loop blocks. This readiness
   result is ephemeral, not a release and not a freeze on future changes.

A supervisor can pause the loop by creating `.yoke/loop.pause`. The running story finishes;
the dispatcher latches the signal, stops launching new workers, lets active workers reach safe
terminal proof/cleanup, and exits with code `3` before another story is integrated.

State lives outside model context: PRD, git, and the ignored `.yoke/changes/` inbox. All are
re-read at story boundaries, so a request queued mid-run becomes additional stories without a
restart.

## Limitations

Yoke cannot infer the correct end-to-end journey command. Projects that need integrated
readiness must configure `completion.command`, for example a Playwright journey suite.
