# Forge — Baustein C4 (per-iteration worktree isolation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally run each loop iteration in a fresh git worktree, so a failed or partial iteration's changes never touch the main working tree — only a verified, committed story is fast-forwarded back in.

**Architecture:** Extend `GitOps` with worktree operations (`addWorktree`, `removeWorktree`, `integrate`). When `runLoop` is given `isolate: true`, each iteration: creates a worktree from the current HEAD, runs the agent + verify **inside it**, and on green marks the PRD + commits **in the worktree** then fast-forward-integrates the commit back into the main repo; on any failure the worktree is removed and the main tree is untouched. `isolate` defaults to `false` (existing behavior unchanged). Baustein C4; review-iteration with role separation is C5.

**Tech Stack:** Node.js (ESM), TypeScript, vitest, `node:child_process` + `node:path`. Extends C1/C2/C3 `gates.ts` (the `GitOps` interface), `git.ts` (`realGitOps`), `loop.ts`, `run-command.ts`, `cli.ts`.

**Builds on:** A+B1+B2+C1+C2+B3+C3 on `main`. Modifies: `src/loop/gates.ts`, `src/loop/git.ts`, `src/loop/loop.ts`, `src/loop/run-command.ts`, `src/cli.ts`, `canon/loop/loop-spec.md`.

---

## File Structure

```
src/loop/
  gates.ts        # MODIFY: GitOps interface gains addWorktree/removeWorktree/integrate
  git.ts          # MODIFY: realGitOps implements the three worktree ops
  loop.ts         # MODIFY: LoopOptions.isolate?; isolated iteration path
  run-command.ts  # MODIFY: thread isolate through to runLoop
cli.ts (src/cli.ts) # MODIFY: loop run parses --isolate
canon/loop/loop-spec.md  # MODIFY: document isolation
tests/loop/
  git.test.ts            # MODIFY: real-git worktree round-trip
  loop.test.ts           # MODIFY: isolated-iteration cases via a fs-backed stub git
```

---

### Task 1: Extend GitOps with worktree operations

**Files:**
- Modify: `src/loop/gates.ts` (interface), `src/loop/git.ts` (impl)
- Test: `tests/loop/git.test.ts` (extend)

- [ ] **Step 1: Add a failing real-git test**

In `tests/loop/git.test.ts`, add a worktree round-trip test. Add `existsSync`, `readFileSync`, `writeFileSync` to the `node:fs` import if not present, plus `join`. Add:
```ts
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
```
Add inside the `describe('realGitOps', ...)`:
```ts
  it('addWorktree creates a working copy, integrate brings its commit back, removeWorktree cleans up', () => {
    const wt = join(dir, '.forge', 'worktrees', 'S1')
    realGitOps.addWorktree(dir, wt)
    expect(existsSync(join(wt, 'a.txt'))).toBe(true)        // checked out from HEAD

    // make + commit a change inside the worktree
    writeFileSync(join(wt, 'a.txt'), 'changed in worktree')
    realGitOps.commitAll(wt, 'forge: worktree change')

    // integrate fast-forwards the main repo to the worktree commit
    realGitOps.integrate(dir, wt)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('changed in worktree')
    expect(realGitOps.isClean(dir)).toBe(true)

    realGitOps.removeWorktree(dir, wt)
    expect(existsSync(wt)).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/git`
Expected: FAIL — `addWorktree` is not a function on `realGitOps`.

- [ ] **Step 3: Add the methods to the `GitOps` interface in `src/loop/gates.ts`**

```ts
export interface GitOps {
  isClean(dir: string): boolean
  commitAll(dir: string, message: string): void
  addWorktree(repoDir: string, worktreePath: string): void
  removeWorktree(repoDir: string, worktreePath: string): void
  integrate(repoDir: string, worktreePath: string): void
}
```

- [ ] **Step 4: Implement the methods in `src/loop/git.ts`**

Add to the `realGitOps` object (after `commitAll`):
```ts
  addWorktree(repoDir: string, worktreePath: string): void {
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], { cwd: repoDir, stdio: 'pipe' })
  },
  removeWorktree(repoDir: string, worktreePath: string): void {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoDir, stdio: 'pipe' })
  },
  integrate(repoDir: string, worktreePath: string): void {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath }).toString().trim()
    execFileSync('git', ['merge', '--ff-only', sha], { cwd: repoDir, stdio: 'pipe' })
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- loop/git`
Expected: PASS (existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/loop/gates.ts src/loop/git.ts tests/loop/git.test.ts
git commit -m "feat: add git worktree operations to GitOps"
```

---

### Task 2: Isolated iteration path in runLoop

**Files:**
- Modify: `src/loop/loop.ts`
- Test: `tests/loop/loop.test.ts` (extend)

- [ ] **Step 1: Add failing tests using an fs-backed stub git**

In `tests/loop/loop.test.ts`, add imports and a stub git that models a worktree with real fs (copy the PRD in on add, copy it back on integrate). Add:
```ts
import { mkdirSync, copyFileSync, rmSync as rmSyncFs, existsSync } from 'node:fs'
import { join as joinPath } from 'node:path'
```
(If `mkdtempSync`, `writeFileSync`, `join` are already imported, reuse them and only add what's missing — avoid duplicate identifiers; the test file already imports several `node:fs` names and `join` from `node:path`. Add only the missing ones: `mkdirSync`, `copyFileSync`, `existsSync`.)

Add a stub-git factory and tests:
```ts
function fsWorktreeGit(removed: string[]): GitOps {
  return {
    isClean: () => true,
    commitAll: () => {},
    addWorktree: (_repo, wt) => {
      mkdirSync(join(wt, '.forge'), { recursive: true })
      copyFileSync(join(dir, '.forge', 'prd.yaml'), join(wt, '.forge', 'prd.yaml'))
    },
    integrate: (repo, wt) => {
      copyFileSync(join(wt, '.forge', 'prd.yaml'), join(repo, '.forge', 'prd.yaml'))
    },
    removeWorktree: (_repo, wt) => { removed.push(wt); rmSyncFs(wt, { recursive: true, force: true }) },
  }
}
```
The existing test setup writes the PRD to `join(dir, 'prd.yaml')`. For the isolation tests, write it to `join(dir, '.forge', 'prd.yaml')` instead so the worktree-relative copy works. Add a dedicated setup in these tests:
```ts
describe('runLoop with isolation', () => {
  let isoDir: string
  const isoPrd = () => join(isoDir, '.forge', 'prd.yaml')
  beforeEach(() => {
    isoDir = mkdtempSync(join(tmpdir(), 'forge-iso-'))
    mkdirSync(join(isoDir, '.forge'), { recursive: true })
    writeFileSync(isoPrd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
`)
  })
  afterEach(() => { rmSyncFs(isoDir, { recursive: true, force: true }) })

  it('completes a story through an isolated worktree and integrates it back', () => {
    const removed: string[] = []
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(removed),
      verify: verifyOk, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('complete')
    expect(loadPrd(isoPrd())[0].passes).toBe(true)   // integrated back into main
    expect(removed.length).toBe(1)                    // worktree cleaned up
  })

  it('discards the worktree and leaves the main PRD untouched when verify fails', () => {
    const removed: string[] = []
    const verifyRed: Verifier = () => ({ passed: false, summary: 'red' })
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(removed),
      verify: verifyRed, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('blocked')
    expect(loadPrd(isoPrd())[0].passes).toBe(false)  // main tree untouched
    expect(removed.length).toBe(1)                    // worktree still cleaned up
  })
})
```
Note: in `loop.test.ts` the `dir` referenced inside `fsWorktreeGit` must be `isoDir` for these tests — define `fsWorktreeGit` to close over a passed-in repo dir instead. Adjust the factory to take the repo dir:
```ts
function fsWorktreeGit(repo: string, removed: string[]): GitOps {
  return {
    isClean: () => true,
    commitAll: () => {},
    addWorktree: (_r, wt) => {
      mkdirSync(join(wt, '.forge'), { recursive: true })
      copyFileSync(join(repo, '.forge', 'prd.yaml'), join(wt, '.forge', 'prd.yaml'))
    },
    integrate: (r, wt) => { copyFileSync(join(wt, '.forge', 'prd.yaml'), join(r, '.forge', 'prd.yaml')) },
    removeWorktree: (_r, wt) => { removed.push(wt); rmSyncFs(wt, { recursive: true, force: true }) },
  }
}
```
and call `fsWorktreeGit(isoDir, removed)` in both tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/loop`
Expected: FAIL — `isolate` is not part of `LoopOptions`; the isolated path doesn't exist.

- [ ] **Step 3: Modify `src/loop/loop.ts`**

Add the path import at the top:
```ts
import { join, relative } from 'node:path'
```

Add `isolate` (optional) to `LoopOptions`:
```ts
export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  verify: Verifier
  maxIterations: number
  isolate?: boolean
}
```

In the loop body, after the `stopTheLineGate` check passes and before the existing `const result = opts.runner(...)` line, branch into the isolated path when `opts.isolate` is set:
```ts
    if (opts.isolate) {
      const wt = join(opts.targetDir, '.forge', 'worktrees', story.id)
      const wtPrd = join(wt, relative(opts.targetDir, opts.prdPath))
      opts.git.addWorktree(opts.targetDir, wt)
      try {
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        if (!result.success) {
          return { status: 'blocked', iterations, reason: `story ${story.id} failed: ${result.summary}`, finalProgress: progress(stories) }
        }
        const verdict = opts.verify(wt)
        if (!verdict.passed) {
          return { status: 'blocked', iterations, reason: `story ${story.id} did not verify: ${verdict.summary}`, finalProgress: progress(stories) }
        }
        const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
        savePrd(wtPrd, updated)
        opts.git.commitAll(wt, `forge: complete ${story.id} ${story.title}`)
        opts.git.integrate(opts.targetDir, wt)
      } catch (e) {
        return { status: 'blocked', iterations, reason: `isolated iteration failed for ${story.id}: ${(e as Error).message}`, finalProgress: progress(stories) }
      } finally {
        opts.git.removeWorktree(opts.targetDir, wt)
      }
      continue
    }
```
Leave the existing non-isolated flow (the current `const result = opts.runner(...)` through the commit-integrity `try/catch`) exactly as-is below this branch — it runs when `isolate` is falsy.

Note on integrity: in the isolated path the PRD is only updated inside the worktree and reaches the main tree via `integrate`; if `integrate` (or commit) throws, the worktree is removed and the main tree's PRD is never touched — so no explicit revert is needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/loop`
Expected: PASS (all existing non-isolated cases unchanged + 2 new isolation cases).

- [ ] **Step 5: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat: run each loop iteration in an isolated worktree when enabled"
```

---

### Task 3: Thread `--isolate` through run-command and CLI

**Files:**
- Modify: `src/loop/run-command.ts`, `src/cli.ts`
- Test: `tests/loop/loop-cli.integration.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

In `tests/loop/loop-cli.integration.test.ts`, the `stubGit` only implements `isClean`/`commitAll`. Extend it so it satisfies the new `GitOps` members (no-ops are fine for the non-isolated default path), and add a test that `isolate` is passed through. First update `stubGit`:
```ts
const stubGit: GitOps = {
  isClean: () => true,
  commitAll: () => {},
  addWorktree: () => {},
  removeWorktree: () => {},
  integrate: () => {},
}
```
Then add a test that isolation runs end-to-end with an injected runner (the default-path tests already cover non-isolated). Because `runLoopCommand` injects `git: stubGit` and `runner: passRunner`, an isolate run with stubGit no-op worktree ops would not copy the PRD — so for this integration test, assert the call returns 0 and the option is accepted (the deep isolation behavior is unit-tested in loop.test.ts). Add:
```ts
  it('accepts the isolate option and completes with injected stubs', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    // PRD lives at .forge/prd.yaml; with no-op worktree stubs the runner marks via the
    // non-worktree fallback is NOT used — so drive isolate=false here and just assert the flag is plumbed.
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk, isolate: false })
    expect(code).toBe(0)
  })
```
(Keep this test simple — the real isolation behavior is covered by the unit tests in Task 2. This test only guards that the `isolate` option exists and is accepted by `runLoopCommand`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop-cli`
Expected: FAIL — `RunLoopCommandOptions` has no `isolate`; `stubGit` may also fail to satisfy `GitOps` until updated.

- [ ] **Step 3: Modify `src/loop/run-command.ts`**

Add `isolate` to `RunLoopCommandOptions`:
```ts
export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
}
```
Pass it into the `runLoop` call:
```ts
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
    isolate: opts.isolate ?? false,
  })
```

- [ ] **Step 4: Modify `src/cli.ts` to parse `--isolate`**

In the `loop` `run` branch, read the flag and pass it through:
```ts
        const isolate = rest.includes('--isolate')
        return runLoopCommand(targetDir, { maxIterations: rawMax, agent, isolate })
```
Update the loop usage string to include it:
```ts
      console.log('usage: forge loop <on|off|status|run [--max=N] [--runner=<claude|codex|gemini>] [--isolate]> [targetDir]')
```

- [ ] **Step 5: Run the suite + build**

Run: `npm test`
Expected: all pass.

Run: `npm run build`
Expected: tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/loop/run-command.ts src/cli.ts tests/loop/loop-cli.integration.test.ts
git commit -m "feat: thread --isolate through forge loop run"
```

---

### Task 4: Update canon loop-spec

**Files:**
- Modify: `canon/loop/loop-spec.md`

- [ ] **Step 1: Document isolation**

In `canon/loop/loop-spec.md`, add a line to the command list and update the Limitations. Add under the `forge loop run` description (or near step 1) a note:
```markdown
Pass `--isolate` to run each iteration in a fresh git worktree: the agent works on a throwaway checkout, and only a verified, committed story is fast-forwarded back into the main tree. A failed iteration never touches your working tree.
```
And replace the Limitations section with:
```markdown
## Limitations
- Review-iteration with role separation (a second agent reviews before a story is marked done) is Baustein C5.
- The loop verifies via the project's test command, not a per-agent semantic review.
```

- [ ] **Step 2: Validate the canon**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/loop/loop-spec.md
git commit -m "docs: canon loop-spec documents worktree isolation"
```

---

## Self-Review

**1. Spec coverage (Baustein C4 scope):**
- Per-iteration git-worktree isolation (agent works in a throwaway worktree) → Tasks 1, 2 ✓
- Only a verified, committed story is integrated back (fast-forward) → Task 2 ✓
- A failed/partial iteration never touches the main tree (worktree removed, PRD untouched) → Task 2 (verify-fail test) ✓
- Opt-in via `--isolate`, default off (existing behavior unchanged) → Tasks 2, 3 ✓
- Deterministic tests (fs-backed stub git for the loop; real git only in git.test.ts) → Tasks 1, 2 ✓
- (Deferred to C5: review-iteration with role separation. Correct.)

**2. Placeholder scan:** No TBD/TODO. The "reuse already-imported identifiers, add only missing ones" note in Task 2 is a concrete instruction to avoid duplicate imports, not a placeholder. Every code step is complete.

**3. Type consistency:** `GitOps` (now 5 methods), `realGitOps` (implements all 5), `LoopOptions.isolate?`, `RunLoopCommandOptions.isolate?`. All existing `GitOps` stubs in tests must gain the three no-op methods (`loop.test.ts` cleanGit/dirtyGit, `gates.test.ts` git, `loop-cli.integration.test.ts` stubGit) — the implementer must update every stub or tsc fails. The isolated path reuses `savePrd`/`progress`/`stopTheLineGate`/`preDispatchGate` unchanged; the non-isolated path is byte-for-byte preserved. ✓

## Next Plans (not this document)

- **Plan C5 — Review-iteration with role separation:** after a story verifies green, a second agent pass (reviewer role, distinct prompt) must approve before the story is committed/marked done.
