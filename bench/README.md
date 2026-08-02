# Yoke benchmark — tokens · speed · quality

Reproducible cross-runner and routing A/B benchmarks for the Yoke loop. Fixed fixture projects,
the same PRD within each comparison, and three measured dimensions:

Adaptive routing is implemented for Claude Code, Codex CLI, and Gemini CLI. The checked-in
multi-run performance study currently measures Codex only; provider support tests are not treated
as performance evidence for Claude or Gemini.

| Dimension | How it is measured |
|---|---|
| **Tokens** | The loop's own provider telemetry in `.yoke/loop-status.json`, split into total input, cached input, fresh input (`input − cached`), output, and reasoning tokens when the provider reports them. Adaptive runs preserve one entry per orchestrator/worker call. Missing telemetry is `null`, never estimated. |
| **Speed** | Wall-clock, measured by the harness from outside: total run + per-story (from `--json` NDJSON event timestamps). The loop itself stores no durations. |
| **Quality** | Objective, not judged by any model: the fixture ships **pre-written tests** the agent never has to write (only satisfy). After the run, each story's test file is executed against the final tree. `srcLoc` (non-empty lines in `src/`) is a code-economy proxy. |

## The fixture (`fixtures/string-kit`)

A dependency-free ESM library with 3 stories (`slugify`, `truncate`, `titleCase`) and 16
`node:test` assertions total. `bench-verify.mjs` is cumulative: story N runs the tests of
stories 1…N (the loop exports `YOKE_STORY`), so later stories cannot break earlier work; the
final quality check runs everything. No npm installs, so results measure the agent — not the
network.

## The routing fixture (`fixtures/routing-queue`)

A dependency-free in-memory priority queue with two cumulative stories and 10 pre-written
`node:test` cases covering idempotency, priority/FIFO ordering, leases, retry/backoff, dead
letters, expired lease recovery, filters, and state statistics. It is intentionally substantial
enough that a lower-cost worker can potentially repay one routing-controller call per story.

## Running it

```bash
npm run build
node bench/run.mjs --runner=claude   # or gemini / codex
node bench/run.mjs --runner=codex --fixture=routing-queue --routing=off --unsafe --run-root=G:\NN-Developed\Yoke-Testground
node bench/run.mjs --runner=codex --fixture=routing-queue --routing=on  --unsafe --run-root=G:\NN-Developed\Yoke-Testground
node bench/run-large.mjs --seed=G:\NN-Developed\Yoke-Testground\yoke-large-seed-2026-08-02 --routing=off --run-root=G:\NN-Developed\Yoke-Testground
node bench/run-large.mjs --seed=G:\NN-Developed\Yoke-Testground\yoke-large-seed-2026-08-02 --routing=on  --run-root=G:\NN-Developed\Yoke-Testground
node bench/run-large.mjs --seed=G:\NN-Developed\Yoke-Testground\yoke-codex-study-seed-2026-08-02 --routing=on  --label=codex-only-pair1-on  --run-root=G:\NN-Developed\Yoke-Testground
node bench/run-large.mjs --seed=G:\NN-Developed\Yoke-Testground\yoke-codex-study-seed-2026-08-02 --routing=off --label=codex-only-pair1-off --run-root=G:\NN-Developed\Yoke-Testground
node bench/analyze-routing-study.mjs
node bench/run-matrix.mjs --label=release-1.0
```

Each run copies the fixture to `bench/.runs/<fixture>-<runner>-<routing>-<stamp>` (or the
explicit `--run-root`), git-inits it,
drives `yoke loop run --json --max=6 --timeout=10`, and writes a result JSON to
`bench/results/`. Runs are billed against your own accounts for the agent CLIs involved.
The matrix is sequential to avoid cross-provider load distortion. Missing CLIs and authentication
failures are stored as honest `unavailable`/`auth-failed` rows and never presented as quality measurements.

`run-large.mjs` accepts an external full-repository seed, starts each arm with a separate empty
routing registry, junctions this checkout's dependencies, and replays the seed's original
acceptance tests under fresh filenames after the agent run. This prevents an agent editing a
visible test from turning into false benchmark evidence. A seed can provide `bench-acceptance.json`
to declare its fixture identity and hidden-test files. `analyze-routing-study.mjs` validates and
aggregates the checked-in three-pair Codex-only study.

## Caveats (read before quoting numbers)

- Agent runs are stochastic. Older rows are N=1; the 2026-08-02 Codex-only study uses three
  alternating-order pairs per arm. Re-run before setting broad policy defaults.
- Compare routing on/off only when fixture, parent model/effort, permissions, native-subagent
  policy, and host load are controlled. The checked-in routing fixture uses `runner.bare: true`
  to exclude personal MCP/plugin startup from both sides.
- Model identity matters more than CLI identity: `tokens.model` records what actually served
  the run. Different default models per CLI make "claude vs gemini" really "model X vs model Y".
- Codex input telemetry includes cache reads. Compare both total input and fresh input; do not
  treat cached input as equivalent to newly processed input. Dollar cost is reported only when
  the provider emits it—Yoke does not guess prices from a model name.
- The fixture is deliberately small (a loop-overhead + basic-competence probe, minutes not
  hours). It does not measure large-context refactoring, UI work, or long-horizon planning.
- Cumulative verify means a story's duration includes fixing any regressions it caused.

Results live in [`results/`](results/) — one JSON per run, summarized in
[`RESULTS.md`](RESULTS.md).
