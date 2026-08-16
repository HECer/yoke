# Artifact-backed output compaction design

**Date:** 2026-08-16  
**Status:** implemented, hardened, and verified on `main`
**Target:** Yoke 1.5.0

## Problem

Yoke already reduces shell noise through RTK and keeps loop prompts intentionally small. It does not, however, retain complete evidence from failed verify, criterion, performance, or completion commands. `commandVerifier` currently chooses stderr or stdout and keeps only the final five lines. That is token-cheap, but it can discard the first error, structured summaries, and the stdout half of a mixed failure.

Aphrodite demonstrates a useful pattern: keep a compact, type-aware preview in model-visible context and place the complete output behind a stable reference. Embedding Aphrodite itself is not a good fit because its primary integration is Hermes-specific, while Yoke must behave consistently across Claude Code, Codex, and Gemini and preserve its explicit fresh-context model.

## Goals

- Produce short, deterministic failure previews that retain the most actionable error and warning lines.
- Preserve complete stdout and stderr as a local artifact when output exceeds the inline budget.
- Put only the preview and a verifiable artifact reference into loop evidence and repair/review context.
- Use the same implementation for verify, executable acceptance criteria, performance, audit, and completion gates.
- Remain provider-independent and add no runtime dependency, daemon, database, proxy, or network request.
- Make savings and correctness measurable with Yoke's existing tests and benchmark schema.

## Non-goals

- Intercepting tool calls occurring inside Claude Code, Codex, or Gemini. Yoke cannot transparently alter those provider-internal streams.
- Replacing RTK, provider prompt caching, or Yoke's versioned context files.
- Semantic summarization by another model.
- Persisting interactive conversation memory or automatically injecting historical artifacts into later stories.
- Claiming Aphrodite's published compression ratios for Yoke.

## Chosen approach

Implement a small Yoke-native output subsystem with two isolated units:

1. `compactCommandOutput` is a pure deterministic function. It normalizes ANSI/control noise, classifies high-signal lines, removes repeated lines, and constructs a byte-bounded preview.
2. `writeOutputArtifact` stores the unmodified captured stdout and stderr in `.yoke/artifacts/` under a content-addressed filename and returns a relative path, byte count, and SHA-256 digest.

The gate runner combines both units. Small failures remain inline and create no artifact. Large failures include a compact preview followed by an artifact marker. Successful gates retain today's one-line summary and do not persist their output because success logs do not feed repair decisions.

This approach is preferred over:

- **Embedding Aphrodite:** stronger generic CCR machinery, but Hermes-oriented and operationally disproportionate for Yoke.
- **Adding a Chat Completions proxy:** could theoretically observe more traffic, but would couple Yoke to provider protocols, credentials, streaming semantics, and tool-call formats.
- **Only documenting Aphrodite as a companion:** zero maintenance, but provides no consistent behavior for Yoke's three supported providers and does not fix Yoke's current loss of gate evidence.

## Configuration

The feature is configured under an optional `output` block:

```yaml
output:
  previewBytes: 2048
  artifactThresholdBytes: 8192
```

Defaults apply when the block is absent:

- `previewBytes`: 2,048 bytes
- `artifactThresholdBytes`: 8,192 bytes

Both values are positive integers. `artifactThresholdBytes` must be greater than or equal to `previewBytes`. Existing configurations remain valid.

Artifact persistence is automatic only after the threshold is crossed. The artifacts directory is added to Yoke's managed `.gitignore` block. Files are created with user-only permissions where the platform supports POSIX modes. Yoke does not redact or transform the stored raw evidence, and documentation must therefore state that command output can contain secrets and must not be published blindly.

## Classification and preview rules

The compactor operates line-by-line without parsing project-specific formats:

1. Strip ANSI escape sequences and disallowed control characters from the preview only.
2. Mark case-insensitive error signals as highest priority: `error`, `failed`, `failure`, `fatal`, `panic`, `exception`, `traceback`, compiler error codes, and test failure markers.
3. Mark warnings as second priority: `warn`, `warning`, and deprecation notices.
4. Retain bounded context immediately around the first high-priority lines.
5. Retain the final non-empty lines because many test runners put totals and exit summaries at the end.
6. Remove duplicate preview lines while preserving their first selected order.
7. Enforce the preview byte budget at UTF-8 boundaries and append a deterministic omission line containing original line and byte counts.

The raw artifact contains the exact captured stdout and stderr with explicit stream headings.
Preview cleanup must never modify the artifact. Capture is bounded at 16 MiB per stream; if that
quota is exceeded, the command fails closed and the retained prefix is explicitly marked truncated.

## Artifact identity and layout

Artifacts use this layout:

```text
.yoke/artifacts/<story-or-session>/<phase>-<sha256-prefix>.log
```

- `story-or-session` is the sanitized `YOKE_STORY` value, falling back to `session`.
- `phase` is one of `criterion`, `verify`, `perf`, `audit`, or `completion`.
- The digest is computed from the complete artifact bytes; the filename uses a readable prefix while the marker records the full SHA-256.
- Repeating the same failure for the same story and phase resolves to the same path and content rather than generating timestamp noise.
- Paths returned to summaries are project-relative and use `/` separators so evidence is portable across Windows and Unix output.

The marker format is human-readable rather than a proprietary retrieval protocol:

```text
[full output: .yoke/artifacts/STORY/verify-0123abcd.log | 42,810 bytes | sha256:0123...]
```

Agents can retrieve it with their normal file-reading tools when the preview is insufficient.

## Data flow

1. A Yoke gate executes a configured command with stdout and stderr captured.
2. On exit zero, Yoke discards captured bytes and returns the existing compact success summary.
3. On timeout or non-zero exit, Yoke combines both streams with labels.
   Capture quota overflow follows the same failure path but marks the retained prefix as truncated.
4. The pure compactor creates the bounded preview.
5. If the combined raw output crosses `artifactThresholdBytes`, Yoke writes the content-addressed artifact.
6. `VerifyResult.summary` carries the command, timeout state, preview, and optional artifact marker.
7. Existing worker evidence, status reporting, quality repair, and retry logic transport that bounded summary unchanged.

## Failure handling

- An artifact write failure must not hide the original gate failure or crash the loop. The summary keeps the compact preview and adds a bounded `artifact unavailable` reason.
- Invalid configuration is rejected by the existing Zod configuration boundary before any command runs.
- Empty command output produces the current command-only failure summary.
- stdout and stderr are both retained even when one is empty.
- Retried identical failures reuse the same artifact; a changed failure gets a different digest.
- Artifact paths are built from fixed directories and sanitized labels. User-controlled story IDs never become raw path segments.
- stdout and stderr capture is capped at 16 MiB per stream. Overflow fails closed, retains only the
  bounded prefix, and uses a `truncated output` marker rather than a `full output` marker.

## Security and privacy

- `.yoke/artifacts/` is runtime state and must be gitignored by retrofit/setup.
- Artifacts never leave the local project through Yoke.
- No artifact content is injected automatically into prompts; only the bounded preview and reference are transported.
- The full digest lets reviewers verify that retrieved evidence matches the retained artifact bytes.
- Raw logs may contain credentials or personal data emitted by project commands. The README must warn users to inspect artifacts before sharing them.
- Absence of provenance metadata or detectable text markers must never be treated as evidence of human authorship.

## Testing strategy

Implementation follows red-green-refactor cycles:

- Pure compactor tests cover error prioritization, warning/context selection, duplicate removal, ANSI cleanup, UTF-8 byte bounds, tail summaries, empty input, and deterministic output.
- Artifact tests cover content fidelity, SHA-256 identity, stable paths, story sanitization, directory creation, and project-relative markers.
- Verifier integration tests prove that small failures remain inline, large failures create retrievable artifacts, mixed stdout/stderr is retained, successful commands create no artifacts, timeouts remain labelled, capture overflow fails closed as truncated, and artifact-write failures preserve the gate result.
- Configuration tests cover defaults, valid overrides, and the threshold invariant.
- Retrofit tests require `.yoke/artifacts/` in the managed ignore set.
- Existing loop, parallel-worker, quality, and retry suites must stay green.

## Measurement and release claims

Add a deterministic benchmark fixture that emits a large noisy failure containing an early actionable error and a final test summary. Record:

- raw byte and approximate token counts,
- preview byte and approximate token counts,
- compression ratio,
- whether the early error and final summary survived,
- whether the artifact digest round-trips.

The benchmark is for the Yoke-visible gate summary only. Release notes must not imply savings for provider-internal tool usage and must not reuse Aphrodite's reported ratios.

## Documentation and compatibility

- Add an output-compaction section to the README describing defaults, configuration, retrieval, privacy, and scope limitations.
- Add a changelog entry under the next unreleased section, without changing the already published `1.4.0` package version during implementation.
- Existing `Verifier` callers remain source-compatible. New options are threaded from the loaded Yoke config by `runLoopCommand`.
- No migration is required; projects receive the new gitignore line on their next setup/retrofit run.

## Acceptance criteria

1. A failed gate whose combined stdout/stderr is at most 8 KiB returns a deterministic preview and writes no artifact under default configuration.
2. A failed gate larger than 8 KiB but within the 16 MiB-per-stream capture quota writes the complete combined output below `.yoke/artifacts/` and returns a preview of at most 2 KiB plus a relative path, byte count, and full SHA-256 digest. Quota overflow fails closed and labels the bounded retained prefix as truncated.
3. The preview retains an early error and a final runner summary for the benchmark fixture.
4. Successful gates retain current summaries and write no artifacts.
5. Artifact failures do not change a gate's pass/fail result and cannot remove its inline preview.
6. `.yoke/artifacts/` is managed runtime state and is gitignored.
7. Configuration is validated and remains backward-compatible when `output` is absent.
8. The full test suite, lint, build, documentation check, package dry-run, audit, and benchmark verification complete successfully before release readiness is claimed.

## Implementation outcome

The implementation covers verify, executable-criterion, performance, completion, and configured
custom-audit commands. Yoke's structured built-in audit findings remain bounded by their existing
finding schema. The deterministic `gate-output-v1` fixture measured 26,699 raw bytes versus 470
bytes for the preview plus artifact reference (56.81×) while retaining its early compiler error,
final test summary, and SHA-256 round-trip. This is fixture-specific Yoke gate evidence, not a
provider-token or billing claim.
