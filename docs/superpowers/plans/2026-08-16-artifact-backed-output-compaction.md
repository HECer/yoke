# Artifact-backed Output Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, artifact-backed compaction for failed Yoke gate commands without changing provider internals or adding runtime dependencies.

**Architecture:** A pure output compactor selects high-signal failure lines within a UTF-8 byte budget. A separate content-addressed artifact writer preserves exact combined stdout/stderr. Gate verifiers compose both units, while config and loop wiring supply phase-specific options.

**Tech Stack:** TypeScript ESM, Node.js built-ins, Zod, Vitest, existing Yoke benchmark scripts.

---

## File map

- Create `src/output/compact.ts`: pure preview selection and byte bounding.
- Create `src/output/artifact.ts`: content-addressed local artifact persistence and marker formatting.
- Create `src/output/types.ts`: shared output policy, phase, and artifact contracts.
- Create `tests/output/compact.test.ts`: compactor behavior.
- Create `tests/output/artifact.test.ts`: artifact fidelity and identity.
- Modify `src/loop/verify.ts`: capture both streams, compact failures, and optionally persist artifacts.
- Modify `tests/loop/verify.test.ts`: verifier integration and regression coverage.
- Modify `src/retrofit/config.ts`: validate optional output policy and expose resolved defaults.
- Modify `tests/retrofit/config.test.ts`: output configuration coverage.
- Modify `src/loop/run-command.ts`: thread resolved phase-specific verifier options.
- Modify `src/retrofit/gitignore.ts` and `tests/retrofit/gitignore.test.ts`: ignore `.yoke/artifacts/`.
- Create `bench/output-compaction.mjs`: deterministic local compression and digest benchmark.
- Create `tests/bench/output-compaction.test.ts`: benchmark acceptance checks.
- Modify `bench/README.md`, `README.md`, and `CHANGELOG.md`: document scope, privacy, and honest claims.

### Task 1: Pure deterministic preview compactor

**Files:**
- Create: `src/output/types.ts`
- Create: `src/output/compact.ts`
- Create: `tests/output/compact.test.ts`

- [ ] **Step 1: Write failing compactor tests**

Add tests calling the wished-for API:

```ts
import { compactCommandOutput } from '../../src/output/compact.js'

const result = compactCommandOutput(noisyOutput, { previewBytes: 256 })
expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(256)
expect(result.preview).toContain('error TS2304')
expect(result.preview).toContain('Tests: 1 failed, 20 passed')
expect(result.preview).not.toContain('\u001b[')
expect(compactCommandOutput(noisyOutput, { previewBytes: 256 })).toEqual(result)
```

Cover error priority, warning selection, adjacent context, duplicate removal, final summary retention, empty input, ANSI/control cleanup, deterministic output, and multibyte UTF-8 bounds.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/output/compact.test.ts`

Expected: FAIL because `src/output/compact.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure API**

Define these contracts:

```ts
export type OutputPhase = 'criterion' | 'verify' | 'perf' | 'audit' | 'completion'
export interface OutputPolicy { readonly previewBytes: number; readonly artifactThresholdBytes: number }
export interface CompactedOutput { readonly preview: string; readonly originalBytes: number; readonly originalLines: number; readonly omitted: boolean }
export const DEFAULT_OUTPUT_POLICY: OutputPolicy = { previewBytes: 2_048, artifactThresholdBytes: 8_192 }
```

Implement `compactCommandOutput(raw, { previewBytes })` with signal-priority selection, ordered de-duplication, tail retention, and safe UTF-8 truncation. Keep the implementation dependency-free and deterministic.

- [ ] **Step 4: Verify GREEN and refactor**

Run: `npx vitest run tests/output/compact.test.ts`

Expected: all compactor tests PASS with no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/output/types.ts src/output/compact.ts tests/output/compact.test.ts
git commit -m "feat(output): add deterministic failure previews"
```

### Task 2: Content-addressed artifact persistence

**Files:**
- Create: `src/output/artifact.ts`
- Create: `tests/output/artifact.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Test exact content, stable SHA-256 identity, stable repeated paths, sanitized story labels, relative forward-slash paths, and user-only file mode where observable:

```ts
const artifact = writeOutputArtifact(dir, raw, { phase: 'verify', storyId: '../STORY 1' })
expect(readFileSync(join(dir, artifact.relativePath), 'utf8')).toBe(raw)
expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
expect(artifact.relativePath).toMatch(/^\.yoke\/artifacts\/STORY-1\/verify-[a-f0-9]{12}\.log$/)
expect(writeOutputArtifact(dir, raw, { phase: 'verify', storyId: '../STORY 1' })).toEqual(artifact)
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/output/artifact.test.ts`

Expected: FAIL because the writer does not exist.

- [ ] **Step 3: Implement minimal persistence**

Use `createHash('sha256')`, sanitize labels to `[A-Za-z0-9._-]`, fall back to `session`, create `.yoke/artifacts/<label>/`, and write the raw UTF-8 bytes with mode `0o600`. Return:

```ts
export interface OutputArtifact {
  readonly relativePath: string
  readonly bytes: number
  readonly sha256: string
  readonly marker: string
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/output/artifact.test.ts`

Expected: all artifact tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output/artifact.ts tests/output/artifact.test.ts
git commit -m "feat(output): persist content-addressed gate artifacts"
```

### Task 3: Gate verifier integration

**Files:**
- Modify: `src/loop/verify.ts`
- Modify: `tests/loop/verify.test.ts`

- [ ] **Step 1: Write failing verifier integration tests**

Add tests proving:

```ts
const small = commandVerifier('node small-failure.js', { phase: 'verify', policy })(dir)
expect(small.summary).toContain('EARLY_ERROR')
expect(existsSync(join(dir, '.yoke', 'artifacts'))).toBe(false)

const large = commandVerifier('node large-failure.js', { phase: 'verify', policy })(dir)
expect(large.summary).toMatch(/\[full output: \.yoke\/artifacts\//)
expect(readFileSync(resolvedArtifactPath, 'utf8')).toContain('=== stdout ===')
expect(readFileSync(resolvedArtifactPath, 'utf8')).toContain('=== stderr ===')
```

Also cover success without artifacts, timeout labelling, mixed streams, custom writer failure, and source-compatible calls without options.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/loop/verify.test.ts`

Expected: new assertions FAIL because verifier options and artifacts are absent.

- [ ] **Step 3: Integrate compaction and artifact writing**

Add optional verifier options:

```ts
export interface CommandVerifierOptions {
  readonly phase?: OutputPhase
  readonly policy?: OutputPolicy
  readonly artifactWriter?: typeof writeOutputArtifact
}
```

Capture stdout and stderr together with labelled headings. On failure, build the preview and write an artifact only when raw bytes meet the threshold. Catch writer errors and append a bounded `artifact unavailable` message without altering `passed: false`. Pass options through `commandsVerifier`.

- [ ] **Step 4: Verify GREEN and regression tests**

Run: `npx vitest run tests/loop/verify.test.ts tests/output/*.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/loop/verify.ts tests/loop/verify.test.ts
git commit -m "feat(loop): compact failed gate output"
```

### Task 4: Configuration, phase wiring, and ignored runtime state

**Files:**
- Modify: `src/retrofit/config.ts`
- Modify: `tests/retrofit/config.test.ts`
- Modify: `src/loop/run-command.ts`
- Modify: `src/retrofit/gitignore.ts`
- Modify: `tests/retrofit/gitignore.test.ts`

- [ ] **Step 1: Write failing configuration and ignore tests**

Add tests for absent defaults, valid overrides, non-positive values, `artifactThresholdBytes < previewBytes`, and `.yoke/artifacts/` in `YOKE_IGNORE_LINES`.

```ts
expect(resolveOutputPolicy(defaultConfig('1.4.0'))).toEqual(DEFAULT_OUTPUT_POLICY)
expect(() => YokeConfigSchema.parse({ ...defaultConfig('1'), output: { previewBytes: 4096, artifactThresholdBytes: 2048 } })).toThrow()
expect(YOKE_IGNORE_LINES).toContain('.yoke/artifacts/')
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/retrofit/config.test.ts tests/retrofit/gitignore.test.ts`

Expected: FAIL because output config and ignore entry are absent.

- [ ] **Step 3: Implement schema and resolver**

Add an optional output schema with positive integer fields and a `superRefine` threshold invariant. Export `resolveOutputPolicy(config): OutputPolicy`, merging partial config over `DEFAULT_OUTPUT_POLICY` and validating the resolved pair.

- [ ] **Step 4: Wire every command gate phase**

In `runLoopCommand`, resolve one policy and create verifiers with explicit phases:

```ts
const outputPolicy = resolveOutputPolicy(config)
commandVerifier(command, { phase: 'verify', policy: outputPolicy })
commandVerifier(config.perf.command, { phase: 'perf', policy: outputPolicy })
commandVerifier(config.completion.command, { phase: 'completion', policy: outputPolicy })
commandsVerifier(criterion.verify, { phase: 'criterion', policy: outputPolicy })
```

Retain the existing dedicated `runAudit` path; it already returns bounded findings rather than raw command output.

- [ ] **Step 5: Verify GREEN and typecheck**

Run: `npx vitest run tests/retrofit/config.test.ts tests/retrofit/gitignore.test.ts tests/loop/verify.test.ts`

Run: `npm run lint`

Expected: all tests and TypeScript checks PASS.

- [ ] **Step 6: Commit**

```bash
git add src/retrofit/config.ts tests/retrofit/config.test.ts src/loop/run-command.ts src/retrofit/gitignore.ts tests/retrofit/gitignore.test.ts
git commit -m "feat(config): wire gate output budgets"
```

### Task 5: Deterministic benchmark evidence

**Files:**
- Create: `bench/output-compaction.mjs`
- Create: `tests/bench/output-compaction.test.ts`
- Modify: `bench/README.md`

- [ ] **Step 1: Write the failing benchmark test**

Import `runOutputCompactionBenchmark` and assert that its fixed noisy fixture reports bounded preview bytes, a ratio above one, retained early error and final summary, and a digest round-trip.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/bench/output-compaction.test.ts`

Expected: FAIL because the benchmark module is absent.

- [ ] **Step 3: Implement benchmark module**

Build a deterministic failure fixture, call the production compactor and artifact writer, verify the stored digest, and return a JSON-serializable result. When executed directly, print formatted JSON and exit non-zero if any acceptance boolean is false.

- [ ] **Step 4: Verify GREEN and run benchmark**

Run: `npx vitest run tests/bench/output-compaction.test.ts`

Run: `node bench/output-compaction.mjs`

Expected: test PASS; benchmark reports retained signals, bounded preview, and digest round-trip.

- [ ] **Step 5: Commit**

```bash
git add bench/output-compaction.mjs tests/bench/output-compaction.test.ts bench/README.md
git commit -m "bench: measure gate output compaction"
```

### Task 6: User documentation, release note, and final verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-16-artifact-backed-output-compaction-design.md`

- [ ] **Step 1: Document exact behavior and limitations**

Add README configuration and retrieval examples, state that only Yoke-controlled gate summaries are compacted, and warn that local raw artifacts may contain secrets. Add an `Unreleased` changelog section without changing version `1.4.0`. Update spec status to implemented after verification.

- [ ] **Step 2: Run targeted and complete verification**

Run in order:

```bash
npm test
npm run lint
npm run build
npm run docs:check
npm run package:check
npm audit --audit-level=high
node bench/output-compaction.mjs
git diff --check
```

Expected: every command exits zero; all Vitest tests pass; docs metadata remains synchronized with package `1.4.0`; package dry-run contains the new runtime modules and documentation; benchmark acceptance booleans are true.

- [ ] **Step 3: Run final provenance audit**

Run the global `audit-provenance` script on the changed README and design document. Report `located`, `verified`, `trusted`, `scan_complete`, and every unknown. Do not infer authorship.

- [ ] **Step 4: Commit final documentation**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-16-artifact-backed-output-compaction-design.md
git commit -m "docs: explain artifact-backed output compaction"
```

- [ ] **Step 5: Verify repository state**

Run: `git status --short` and `git log --oneline --decorate -8`

Expected: clean feature worktree and a reviewable series of focused commits.
