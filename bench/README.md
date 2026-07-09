# Yoke benchmark — tokens · speed · quality

Reproducible cross-runner benchmark for the Yoke loop. One fixed fixture project, the same
PRD for every runner, three measured dimensions:

| Dimension | How it is measured |
|---|---|
| **Tokens** | The loop's own token hook (`.yoke/loop-status.json`, claude runner via `--output-format stream-json`; model id included). Gemini/Codex runners do not report usage yet — recorded as `null`, a documented gap. |
| **Speed** | Wall-clock, measured by the harness from outside: total run + per-story (from `--json` NDJSON event timestamps). The loop itself stores no durations. |
| **Quality** | Objective, not judged by any model: the fixture ships **pre-written tests** the agent never has to write (only satisfy). After the run, each story's test file is executed against the final tree. `srcLoc` (non-empty lines in `src/`) is a code-economy proxy. |

## The fixture (`fixtures/string-kit`)

A dependency-free ESM library with 3 stories (`slugify`, `truncate`, `titleCase`) and 16
`node:test` assertions total. `bench-verify.mjs` is cumulative: story N runs the tests of
stories 1…N (the loop exports `YOKE_STORY`), so later stories cannot break earlier work; the
final quality check runs everything. No npm installs, so results measure the agent — not the
network.

## Running it

```bash
npm run build
node bench/run.mjs --runner=claude   # or gemini / codex
```

Each run copies the fixture to `bench/.runs/<runner>-<stamp>` (git-ignored), git-inits it,
drives `yoke loop run --json --max=6 --timeout=10`, and writes a result JSON to
`bench/results/`. Runs are billed against your own accounts for the agent CLIs involved.

## Caveats (read before quoting numbers)

- **N=1 per run.** Agent runs are stochastic; treat single runs as indicative, not
  statistically robust. Re-run and compare.
- Model identity matters more than CLI identity: `tokens.model` records what actually served
  the run. Different default models per CLI make "claude vs gemini" really "model X vs model Y".
- The fixture is deliberately small (a loop-overhead + basic-competence probe, minutes not
  hours). It does not measure large-context refactoring, UI work, or long-horizon planning.
- Cumulative verify means a story's duration includes fixing any regressions it caused.

Results live in [`results/`](results/) — one JSON per run, summarized in
[`RESULTS.md`](RESULTS.md).
