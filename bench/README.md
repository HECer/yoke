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
node bench/output-compaction.mjs  # deterministic local gate-output benchmark; no provider call
node bench/run-parallel-matrix.mjs # synthetic dispatcher; deterministic local delays, no provider call
```

Each run copies the fixture to `bench/.runs/<fixture>-<runner>-<routing>-<stamp>` (or the
explicit `--run-root`), git-inits it,
drives `yoke loop run --json --max=6 --timeout=10`, and writes a result JSON to
`bench/results/`. Runs are billed against your own accounts for the agent CLIs involved.
The matrix is sequential to avoid cross-provider load distortion. Missing CLIs and authentication
failures are stored as honest `unavailable`/`auth-failed` rows and never presented as quality measurements.

### Full-repository dependency setup

`run-large.mjs` requires the copied seed's own `package.json` and `package-lock.json`.
It runs project-local `npm ci --ignore-scripts --no-audit --no-fund --json --fetch-retries=0`
before model dispatch. Invalid inputs or failed setup stop the benchmark. Build and test
commands use the copied project's installed tools. Lifecycle scripts stay disabled; fixtures
that require generated assets must prepare those assets explicitly and declare their state.

The default package-download cache is `.yoke/npm-download-cache` inside the copied project.
Use `--npm-cache=<directory>` to share a download store and `--offline` to require cached
packages. Installed dependencies and conventional writable runtime caches remain local.
Linked inputs, receipts and cache paths are rejected. Reusing a download store does not
establish installation readiness or provider-cache warmth.

`setupNpmDependencies(projectDir, options)` in `dependency-setup.mjs` supports `offline`,
`cacheDir`, `timeoutMs`, `reuse` and a trusted `npm: { command, args }` invocation override.
Its ignored `node_modules/.yoke-dependency-setup.json` receipt binds package/lock bytes,
Node/platform/architecture, observed npm version, exact installation arguments and
digests of the executed npm command and any trusted invocation prefix. Prefix digests
bind policy changes without persisting credential arguments. Default npm discovery uses
Node argv for npm CLI scripts beside Node or PATH shims, including Windows `npm.cmd` layouts.
Matching receipts allow reuse only with a present local installation. Changed inputs,
missing installs and failed setup invalidate reuse. A receipt records setup readiness;
it does not attest every installed byte. Setup refuses success if npm changes package inputs
and preserves those changes for diagnosis.

The helper returns observed `durationMs` and `installed`, `reused` or `failed` state.
Successful benchmark setup adds `dependencySetup` to the run result; failed setup prints
a safe diagnostic and exits before model dispatch. Setup time is separate from the existing
loop `wallClockMs`. Structured npm errors
distinguish offline cache misses, network and authentication failures. Process launch and
timeout failures have separate causes; unsupported and lifecycle failures remain unknown.
The helper performs no automatic retry and records no raw npm output or environment secrets.
It provisions benchmark projects only; Yoke core does not install unmanaged project dependencies.

### Yoke 1.25 host efficiency regression

Run `npm run bench:efficiency` for five deterministic local samples of bounded planning references/repair feedback, invocation-local pure check reuse and event-based terminal handoff. It asserts packet bounds and logical execution counts. Timings include identity hashing; a short command may be cheaper to rerun. The benchmark invokes no model and measures no billed tokens or complete product quality. See [validation](../docs/YOKE-1.25-VALIDATION.md) for compatibility and unmeasured real-project outcomes.

### Gate-output compaction benchmark

`output-compaction.mjs` exercises only Yoke's deterministic failure-preview and artifact path.
It emits a fixed noisy gate failure, verifies that the early compiler error and final test summary
remain visible, and checks the stored SHA-256 digest. Its byte/token approximation is not a provider
bill and says nothing about tool output generated inside Claude Code, Codex, or Gemini. It makes no
comparison to Aphrodite's corpus or published ratios.

`run-large.mjs` accepts an external full-repository seed, starts each arm with a separate empty
routing registry, junctions this checkout's dependencies, and replays the seed's original
acceptance tests under fresh filenames after the agent run. This prevents an agent editing a
visible test from turning into false benchmark evidence. A seed can provide `bench-acceptance.json`
to declare its fixture identity and hidden-test files. `analyze-routing-study.mjs` validates and
aggregates the checked-in three-pair Codex-only study.

### Parallel dispatcher matrix

`run-parallel-matrix.mjs` exercises the real dispatcher with a deterministic local worker over a
dependency chain, independent write scopes and conflicting scopes at concurrency 1, 2 and 3. It
reports wall time, summed worker time, integration queue wait, integration time, attempts and
accepted results. Fixed delays make scheduler comparisons repeatable; these rows do not measure
provider latency, token cost, model quality, global cross-project contention or large-repository
work. Run `npm run build` first so `dist/loop/dispatcher.js` exists.

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
