# Benchmark results

Result schema v1 records fixture version, sample label, permission profile, telemetry/model
availability, verdict/blocker, conflicts, wall time, iterations, and final fixture-test status.

Fixture `string-kit` (3 stories, 16 pre-written assertions). Methodology and caveats:
[README.md](README.md). One row per run — raw JSON in [`results/`](results/).

## Runs

| Date | Runner | Model (reported) | Result | Wall-clock | Input tok | Output tok | First-pass stories | src LOC |
|---|---|---|---|---|---|---|---|---|
| 2026-07-27 | claude | unavailable | ⛔ blocked before implementation; zero synthetic usage is not counted | 11 s | — | — | 0/3 | 3 |
| 2026-07-27 | codex | unavailable | ⛔ CLI probe failed on Windows with access denied | — | — | — | — | — |
| 2026-07-27 | gemini | unavailable | ⛔ runner exited before implementation | 14 s | — | — | 0/3 | 3 |
| 2026-07-10 | claude | claude-opus-4-8 | ✅ 3/3 complete | 4 m 28 s | 42 957 | 9 817 | 3/3 (1 iteration each) | 39 |
| 2026-07-10 | gemini | — | ⛔ blocked: CLI not authenticated on the bench machine (headless needs `GEMINI_API_KEY` or configured OAuth) | — | — | — | — | — |
| — | codex | — | ⛔ not installed on the bench machine | — | — | — | — | — |

Per-story wall-clock (claude run): STORY-1 72 s · STORY-2 114 s · STORY-3 81 s. Every story
passed verify on the first iteration; the final quality check (all 16 assertions on the final
tree, outside the loop) is green.

## Codex-only full-repository routing study (2026-08-02)

This replaces the earlier single-run impression with three paired comparisons. Fixture
`yoke-codex-study@1` is a full Yoke snapshot with 571 existing tests and two coupled telemetry
implementation stories. Every arm used the same `gpt-5.6-sol` high-effort parent, Bare mode,
disabled native Codex multi-agent, an isolated empty registry, and the same machine. Routing was
the only policy change: the routed arm used a low-effort `gpt-5.6-sol` controller and selected
`gpt-5.6-luna` for all six story executions. Pair order alternated on/off, off/on, on/off.

All **6/6 runs**, **12/12 stories**, and **36/36 independently replayed hidden acceptance
checks** passed. Each story completed in one iteration.

| Metric (median of 3) | Routing off: Sol high | Routing on: Sol controller + Luna worker | Delta |
|---|---:|---:|---:|
| Wall-clock | 579.139 s (561.860–589.501) | 383.099 s (350.819–523.110) | **−196.040 s (−33.8%)** |
| Input tokens, total | 2,279,164 | 1,561,371 | **−31.5%** |
| Cached input tokens | 2,147,584 | 1,436,672 | **−33.1%** |
| Fresh input (`input − cached`) | 140,130 (131,580–205,142) | 124,699 (110,541–127,507) | **−15,431 (−11.0%)** |
| Output tokens | 16,008 | 8,080 | **−49.5%** |
| Reasoning tokens | 6,536 | 1,426 | **−78.2%** |

| Pair | Execution order | Wall-clock delta | Fresh-input delta |
|---|---|---:|---:|
| 1 | on → off | −31.8% | −39.2% |
| 2 | off → on | −39.4% | −21.1% |
| 3 | on → off | −11.3% | −3.1% |

The routing controller is included in those numbers. Across the three routed runs its six calls
used 82.251 s, 114,767 total input tokens (66,048 cached; 48,719 fresh), and 187 output tokens.
All three pairs improved both wall-clock and fresh input, although the third pair shows meaningful
latency variance. This is convincing evidence for **bounded, delegable repository work**, not a
claim that every task should be routed.

The Codex CLI did not report dollar cost for these plan-backed runs, so no USD value is invented.
The evidence supports lower token/compute use; an exact currency saving still depends on the
account's current Sol/Luna billing. Reproduce the aggregate with
`node bench/analyze-routing-study.mjs`. Raw valid rows:
[`pair 1 on`](results/yoke-codex-study-codex-routing-on-2026-08-02T07-51-59.json),
[`pair 1 off`](results/yoke-codex-study-codex-routing-off-2026-08-02T07-58-56.json),
[`pair 2 off`](results/yoke-codex-study-codex-routing-off-2026-08-02T08-08-48.json),
[`pair 2 on`](results/yoke-codex-study-codex-routing-on-2026-08-02T08-18-59.json),
[`pair 3 on`](results/yoke-codex-study-codex-routing-on-2026-08-02T08-25-25.json), and
[`pair 3 off`](results/yoke-codex-study-codex-routing-off-2026-08-02T08-34-45.json).

## Controlled adaptive-routing A/B (2026-08-01)

Fixture `routing-queue@1`: two cumulative implementation stories, 10 pre-written assertions.
Both arms used Codex as the `gpt-5.6-sol` high-effort parent, `runner.bare: true`, native Codex
multi-agent disabled, the same isolated Testground host, unsafe permission mode, and one
iteration per story. The routed arm chose `codex-light` (provider current/default model,
low reasoning effort) for both stories; the high-effort parent made the routing decisions.

| Routing | Quality | Wall-clock | Input tok | Output tok | Total tok | Story 1 | Story 2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 2/2 stories; 10/10 tests | 299.787 s | 579,301 | 9,103 | 588,404 | 173.400 s | 125.693 s |
| on | 2/2 stories; 10/10 tests | 283.134 s | 542,788 | 5,486 | 548,274 | 148.000 s | 122.288 s |
| delta | same measured quality | **−16.653 s (−5.6%)** | **−36,513 (−6.3%)** | **−3,617 (−39.7%)** | **−40,130 (−6.8%)** | −25.400 s | −3.405 s |

The two read-only controller calls account for 41.332 s and 38,169 tokens of the routed total.
The worker savings exceeded that overhead in this sample. This is **N=1**, not a universal
speed/cost claim; stochastic model output, provider pricing, cache accounting, and host/API load
can move the result. Raw valid rows:
[`routing off`](results/routing-queue-codex-routing-off-2026-08-01T21-44-00.json) and
[`routing on`](results/routing-queue-codex-routing-on-2026-08-01T21-50-31.json).

## Full-repository adaptive-routing A/B (2026-08-02)

Fixture `yoke-large@1` is a snapshot of Yoke itself: 171 relevant files and 17,798 lines across
source, tests, and canon. Two coupled stories added a privacy-safe registry status API/CLI and
then circuit-breaker evidence plus automatic strong-parent fallback. Each story ran TypeScript
build and the 571-test existing suite. Final trees passed 578 tests (routing off) and 579 tests
(routing on), plus a separate replay of the **four original acceptance tests copied from the
immutable seed** after the agents had finished.

Both arms used the same `gpt-5.6-sol` high-effort parent, Bare mode, disabled native Codex
multi-agent, isolated empty registries, unsafe permissions, dependency junction, and sequential
host load.

| Routing | Quality | Wall-clock | Input tok | Output tok | Total tok | Story 1 | Story 2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 2/2; build + 578 + 4 hidden pass | 660.843 s | 1,971,273 | 16,850 | 1,988,123 | 333.022 s | 327.176 s |
| on | 2/2; build + 579 + 4 hidden pass | 640.151 s | 2,035,962 | 15,483 | 2,051,445 | 322.735 s | 303.662 s |
| delta | same acceptance quality | **−20.692 s (−3.1%)** | **+64,689 (+3.3%)** | −1,367 (−8.1%) | **+63,322 (+3.2%)** | −10.287 s | −23.514 s |

The controller chose `SELF` for **both** stories. Its two calls cost 35.381 s and 38,457 tokens;
no cheaper worker executed. The small wall-clock improvement therefore cannot be attributed to
worker routing and is within the range where stochastic parent execution/API load is a plausible
explanation. For this complex architecture workload, balanced routing preserved quality through
a conservative decision but **did not meet the token-cost goal**. A useful next optimization is a
zero-token deterministic SELF fast path for clearly high-risk architecture/privacy stories.

This is again N=1. Raw valid rows:
[`routing off`](results/yoke-large-codex-routing-off-2026-08-01T22-58-01.json) and
[`routing on`](results/yoke-large-codex-routing-on-2026-08-01T23-09-39.json).

The 2026-07-27 release matrix produced no quality measurement: Claude and Gemini exited
before changing the fixture, and the Codex executable could not be probed in this Windows
environment. Raw rows preserve the exact runner diagnostics; no scores were inferred.

## What the harness caught before producing a single number

Building an honest benchmark is itself a verification pass. The first runs found two real
Yoke bugs, both fixed in 0.3.0:

1. **Availability-probe timeout** — `gemini --version` cold-starts in ~5.8 s on Windows; the
   5 s probe timeout misreported an installed CLI as "not found on PATH". Now 20 s.
2. **Gemini invocation** — Gemini CLI 0.33+ requires a value after `-p`; the runner's bare
   `-p --yolo` died with "Not enough arguments following: p". The runner now relies on piped
   stdin (which selects headless mode) and passes only `--yolo`.

## Reading the numbers

- Tokens come from provider telemetry when available; missing telemetry is recorded as missing,
  never estimated. New Codex rows separate cache reads from fresh input; adaptive rows retain
  controller/worker/parent call splits.
- The two older A/B rows are N=1 diagnostics. The Codex-only study above is N=3 per arm with
  alternating pair order; it is stronger evidence but still workload-specific.
- Fixture size changes the outcome: the small queue delegated to a lower-effort worker and saved
  tokens; the architecture/privacy task stayed on SELF and paid controller overhead; the newer
  bounded full-repository telemetry task delegated consistently and saved fresh-input tokens.
