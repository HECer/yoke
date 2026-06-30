# Baustein H — Loop Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous loop trust **verify** rather than the agent's exit code, and tolerate transient test flakes — closing two real block causes (SE5, T4) seen in production.

**Architecture:** A `retryingVerifier` wrapper in `src/loop/verify.ts`; `runLoop` runs verify regardless of the implementer runner's exit and blocks only on verify failure (the reviewer keeps exit-as-verdict); `verify.retries` config wired in `run-command.ts`. No new modules.

**Tech Stack:** Node.js + TypeScript (ESM, `.js` specifiers, strict), vitest. `npx vitest run`, `npx tsc --noEmit`.

---

## File Structure

| File | Change |
|------|--------|
| `src/loop/verify.ts` | Add `retryingVerifier(inner, retries)` |
| `src/loop/loop.ts` | Verify-as-truth in both isolate + non-isolate paths |
| `src/retrofit/config.ts` | `verify.retries?: number` |
| `src/loop/run-command.ts` | Wrap the command verifier with the resolved retry count |
| `canon/loop/loop-spec.md`, `README.md` | Document verify-as-truth + `verify.retries` |

---

### Task 1: `retryingVerifier`

**Files:** Modify `src/loop/verify.ts`; Test `tests/loop/verify.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/loop/verify.test.ts`; if the file doesn't exist, create it with the vitest imports):

```typescript
import { describe, it, expect } from 'vitest'
import { retryingVerifier, type Verifier, type VerifyResult } from '../../src/loop/verify.js'

function stub(results: VerifyResult[]): Verifier {
  let i = 0
  return () => results[Math.min(i++, results.length - 1)]
}
const ok: VerifyResult = { passed: true, summary: 'green' }
const bad: VerifyResult = { passed: false, summary: 'red' }

describe('retryingVerifier', () => {
  it('passes immediately without retrying when the inner verifier passes', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return ok }
    expect(retryingVerifier(inner, 2)('/d').passed).toBe(true)
    expect(calls).toBe(1)
  })
  it('passes on a retry when the inner fails then passes', () => {
    const r = retryingVerifier(stub([bad, ok]), 2)('/d')
    expect(r.passed).toBe(true)
    expect(r.summary).toMatch(/retry 1/i)
  })
  it('fails after exhausting the retries', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return bad }
    const r = retryingVerifier(inner, 2)('/d')
    expect(r.passed).toBe(false)
    expect(calls).toBe(3) // 1 initial + 2 retries
    expect(r.summary).toMatch(/after 2 retr/i)
  })
  it('retries:0 is a single shot', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return bad }
    expect(retryingVerifier(inner, 0)('/d').passed).toBe(false)
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/verify.test.ts`
Expected: FAIL — `retryingVerifier` not exported.

- [ ] **Step 3: Implement** — append to `src/loop/verify.ts`:

```typescript
// Re-run a failing verifier up to `retries` times; the first pass wins. Lets a
// transient flake (e.g. a load-induced async timeout) self-heal while a real
// failure still fails (it stays red across every attempt).
export function retryingVerifier(inner: Verifier, retries: number): Verifier {
  return (targetDir: string): VerifyResult => {
    let last = inner(targetDir)
    let attempt = 0
    while (!last.passed && attempt < retries) {
      attempt++
      last = inner(targetDir)
    }
    if (last.passed && attempt > 0) {
      return { passed: true, summary: `${last.summary} (passed on retry ${attempt})` }
    }
    if (!last.passed && attempt > 0) {
      return { passed: false, summary: `${last.summary} (still failing after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` }
    }
    return last
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loop/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/loop/verify.ts tests/loop/verify.test.ts
git commit -m "feat(loop): retryingVerifier — tolerate transient verify flakes"
```

---

### Task 2: verify is the source of truth in `runLoop`

**Files:** Modify `src/loop/loop.ts`; Test `tests/loop/loop.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/loop/loop.test.ts`; reuse existing `dir`, `prd()`, `cleanGit`, `verifyOk`, and add a failing runner):

```typescript
it('commits a story when the runner reports failure but verify is GREEN (exit-code ghost)', () => {
  const commits: string[] = []
  const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
  const runnerGhost: AgentRunner = () => ({ success: false, summary: 'exit 127 from claude.cmd' })
  const res = runLoop({ prdPath: prd(), targetDir: dir, runner: runnerGhost, git, verify: verifyOk, maxIterations: 10 })
  expect(res.status).toBe('complete')
  expect(commits.length).toBe(2)               // both stories committed despite runner "failure"
  expect(loadPrd(prd()).every(s => s.passes)).toBe(true)
})

it('blocks when the runner fails AND verify is red, naming both', () => {
  const runnerBad: AgentRunner = () => ({ success: false, summary: 'agent boom' })
  const verifyBad: Verifier = () => ({ passed: false, summary: 'tests red' })
  const res = runLoop({ prdPath: prd(), targetDir: dir, runner: runnerBad, git: cleanGit(), verify: verifyBad, maxIterations: 10 })
  expect(res.status).toBe('blocked')
  expect(res.reason).toMatch(/agent boom/)
  expect(res.reason).toMatch(/tests red/)
})
```
(The existing "blocks when the runner fails a story" test asserted a runner failure blocks; it used a passing verify implicitly? Check it — if it relied on runner-failure-blocks-before-verify with a passing verify, it now changes meaning. UPDATE that existing test: a runner failure with a GREEN verify should now COMPLETE, not block. Find the test "blocks when the runner fails a story" and either repurpose it to the ghost case above or pair the failing runner with a failing verify so it still blocks. Make the existing test internally consistent with verify-as-truth — do NOT just delete coverage.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: FAIL — the ghost case currently blocks (runner failure is checked before verify).

- [ ] **Step 3: Implement — non-isolate path.** In `src/loop/loop.ts`, find the non-isolate block:
```typescript
    const result = opts.runner({ targetDir: opts.targetDir, story })
    iterations++

    if (!result.success) {
      const reason = blockReason(`story ${story.id} failed: ${result.summary}`, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    reporter.phase('verifying')
    const verdict = opts.verify(opts.targetDir)
    if (!verdict.passed) {
      const reason = blockReason(`story ${story.id} did not verify: ${verdict.summary}`, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }
```
Replace it with (delete the early `if (!result.success)` block; verify decides):
```typescript
    const result = opts.runner({ targetDir: opts.targetDir, story })
    iterations++

    // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
    // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
    reporter.phase('verifying')
    const verdict = opts.verify(opts.targetDir)
    if (!verdict.passed) {
      const base = result.success
        ? `story ${story.id} did not verify: ${verdict.summary}`
        : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
      const reason = blockReason(base, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }
    const summary = result.success
      ? result.summary
      : `${result.summary} (runner exited non-zero but verify is green)`
```
Then change the non-isolate `appendDecision(...)` call's `summary:` field from `result.summary` to the new `summary` variable:
```typescript
    const dec = appendDecision(contextDir(opts.targetDir), {
      storyId: story.id,
      title: story.title,
      summary,
    })
```
Leave the `if (opts.review) { ... }` block and the commit/rollback logic exactly as-is.

- [ ] **Step 4: Implement — isolate path.** In the `if (opts.isolate)` block, apply the same transformation. Replace:
```typescript
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        if (!result.success) {
          const reason = blockReason(`story ${story.id} failed: ${result.summary}`, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        reporter.phase('verifying')
        const verdict = opts.verify(wt)
        if (!verdict.passed) {
          const reason = blockReason(`story ${story.id} did not verify: ${verdict.summary}`, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
```
with:
```typescript
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        reporter.phase('verifying')
        const verdict = opts.verify(wt)
        if (!verdict.passed) {
          const base = result.success
            ? `story ${story.id} did not verify: ${verdict.summary}`
            : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
          const reason = blockReason(base, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const summary = result.success
          ? result.summary
          : `${result.summary} (runner exited non-zero but verify is green)`
```
and change the isolate `appendDecision(contextDir(wt), { ... summary: result.summary })` to use `summary`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: PASS — ghost case completes; runner-fail+verify-fail blocks naming both; runner-pass+verify-fail still blocks; reviewer-reject still blocks; the commit-revert invariant + leftover-hint tests stay green.

- [ ] **Step 6: Run the full suite + types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat(loop): verify is the source of truth (runner exit code is advisory)"
```

---

### Task 3: `verify.retries` config + wiring

**Files:** Modify `src/retrofit/config.ts`, `src/loop/run-command.ts`; Test `tests/retrofit/config.test.ts`, `tests/loop/loop-status-render.test.ts` (or the run-command test file)

- [ ] **Step 1: Write the failing config test** (append to `tests/retrofit/config.test.ts`):

```typescript
it('accepts an optional verify.retries', () => {
  const parsed = YokeConfigSchema.parse({ canonVersion: '0.1.0', agents: ['claude'], loop: { enabled: true }, verify: { command: 'npm test', retries: 2 } })
  expect(parsed.verify?.retries).toBe(2)
})
it('accepts verify without retries', () => {
  const parsed = YokeConfigSchema.parse({ canonVersion: '0.1.0', agents: [], loop: { enabled: false }, verify: { command: 'npm test' } })
  expect(parsed.verify?.retries).toBeUndefined()
})
```
(Match the file's idiom — if it tests via `loadConfig`/`saveConfig` round-trip rather than `YokeConfigSchema` directly, use that instead.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/retrofit/config.test.ts`
Expected: FAIL — `retries` rejected/stripped.

- [ ] **Step 3: Implement the config field.** In `src/retrofit/config.ts`, extend the verify schema + interface:
```typescript
  verify: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
```
```typescript
  verify?: { command: string; retries?: number }
```

- [ ] **Step 4: Wire the retry into `run-command.ts`.** In `src/loop/run-command.ts`, import `retryingVerifier` and wrap the command verifier. Find:
```typescript
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .yoke/config.yaml ...')
      return 2
    }
    verify = commandVerifier(command)
  }
```
Change the construction to wrap with the resolved retry count:
```typescript
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .yoke/config.yaml ...')
      return 2
    }
    verify = retryingVerifier(commandVerifier(command), config.verify?.retries ?? 1)
  }
```
Add the import: `import { commandVerifier, retryingVerifier, type Verifier } from './verify.js'` (extend the existing import line — it already imports `commandVerifier`/`Verifier`).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/retrofit/config.test.ts && npx vitest run` then `npx tsc --noEmit`
Expected: PASS, clean. (The injected-`opts.verify` test path in `loop-cli.integration.test.ts` is unchanged — wrapping only happens when no verifier is injected.)

- [ ] **Step 6: Commit**

```bash
git add src/retrofit/config.ts src/loop/run-command.ts tests/retrofit/config.test.ts
git commit -m "feat(loop): verify.retries config (default 1) wired into the loop"
```

---

### Task 4: Document verify-as-truth + retries

**Files:** Modify `canon/loop/loop-spec.md`, `README.md`

- [ ] **Step 1: Update `canon/loop/loop-spec.md`.** Find step 5 (the verify step, "On success: run the project's verify command ... Only if it passes, mark the story passes: true"). Replace its body to reflect verify-as-truth + retries:
```markdown
5. Run the project's verify command (config `verify.command`, or detected `npm test`).
   **Verify is the source of truth** — the agent's exit code is advisory, so a spurious
   non-zero exit (e.g. a Windows `.cmd` wrapper) cannot block a story whose tests are green.
   A failing verify is retried up to `verify.retries` times (default 1) so a transient flake
   self-heals; a real failure still fails. Only if verify passes is the story marked
   `passes: true`, committed atomically, and a decision logged. If verify fails: `blocked`.
```

- [ ] **Step 2: Update `README.md`** — in the autonomous-loop section (near the `--timeout` / idle paragraph or the PRD/verify description), add:
```markdown
The loop trusts **verify**, not the agent's exit code: a story whose tests are green is
committed even if the agent process exited non-zero (a common Windows `.cmd`-wrapper ghost).
A failing verify is retried up to `verify.retries` times (default 1) so a transient flake
self-heals while a real failure still blocks.
```

- [ ] **Step 3: Verify the suite still passes** (docs change):

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add canon/loop/loop-spec.md README.md
git commit -m "docs: verify is the source of truth + verify.retries"
```

---

## Self-Review

**Spec coverage:**
- `retryingVerifier` → Task 1.
- Verify-as-truth in both paths (runner exit advisory; combined reason on dual failure; ghost noted in the decision summary) → Task 2.
- `verify.retries` config + run-command wiring (default 1) → Task 3.
- Reviewer unchanged (its exit is the verdict) → Task 2 leaves the review block untouched.
- Docs (loop-spec + README) → Task 4.

**Placeholder scan:** No TBD/TODO. Every code step shows the exact before/after. Task 2 step 1 explicitly flags the existing "blocks when the runner fails a story" test for repurposing rather than silent deletion.

**Type consistency:** `retryingVerifier(inner: Verifier, retries: number): Verifier`, `VerifyResult`, `verify?: { command; retries? }`, the `summary` local in both loop paths, and `config.verify?.retries ?? 1` are consistent. The `appendDecision` summary field changes from `result.summary` to `summary` in both paths.

**Invariant note:** The Baustein-E commit-integrity invariant and the Baustein-G reporter/leftover-hint are preserved — Task 2 only moves the implementer-failure decision from "before verify" to "verify decides"; the commit/rollback/reporter calls are untouched.
