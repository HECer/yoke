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

- Tokens come from the loop's own hook (claude runner only — gemini/codex reporting is an
  open gap, see the multi-agent design doc).
- N=1: indicative, not statistics. Re-run with `node bench/run.mjs --runner=<agent>` and
  compare rows.
- ~53 k tokens / ~4.5 minutes for a 3-story micro-backlog is the current price of the full
  gate pipeline (fresh headless session per story + verify + atomic commit) on this fixture.
