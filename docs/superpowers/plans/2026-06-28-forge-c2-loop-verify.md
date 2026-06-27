# Forge — Baustein C2 (Loop verification hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous loop production-safe by running the project's real test suite after each agent iteration and only marking a story `passes: true` (and committing) when tests are GREEN — replacing C1's "trust the agent's exit code" behavior. Plus: configurable verify command and a clearer error when the agent run fails for auth/setup reasons.

**Architecture:** Add an injectable `Verifier` seam (like `AgentRunner`/`GitOps`). `runLoop` gains a `verify` step: after `runner.success`, it runs `verify(targetDir)`; the story is marked/committed only if BOTH the runner succeeded AND verification passed. A red verify → `blocked` (story stays `passes:false`, no commit). The real verifier runs a shell command (default detected `npm test`, or `.forge/config.yaml` `verify.command`). This is Baustein C2; multi-agent runners (codex/gemini) and per-iteration git-worktree isolation are C3.

**Tech Stack:** Node.js (ESM), TypeScript, vitest, `node:child_process` (`execSync`, shell-resolved so `npm.cmd` works on Windows). Extends C1 (`runLoop`, `run-command`, `ForgeConfig`).

**Builds on:** Baustein A+B1+B2+C1 (on `main`). Key reuse/modify: `src/loop/loop.ts` (`runLoop`), `src/loop/run-command.ts` (`runLoopCommand`), `src/retrofit/config.ts` (`ForgeConfig` + schema).

---

## File Structure

```
src/
  loop/
    verify.ts        # NEW: VerifyResult, Verifier type, commandVerifier(command)
    loop.ts          # MODIFY: LoopOptions gains verify; gate mark+commit on verify.passed
    run-command.ts   # MODIFY: resolve verifier (config or detected npm test); auth hint; pass into runLoop
  retrofit/
    config.ts        # MODIFY: ForgeConfig gains optional verify:{command}; schema + resolveVerifyCommand()
canon/loop/loop-spec.md  # MODIFY: document the real verify step
tests/loop/
  verify.test.ts          # NEW
  loop.test.ts            # MODIFY: add verify-gating cases
  loop-cli.integration.test.ts  # MODIFY: verify wiring + refusal when no command
tests/retrofit/
  config.test.ts          # MODIFY: verify field round-trip + resolveVerifyCommand
```

---

### Task 1: Verify module

**Files:**
- Create: `src/loop/verify.ts`
- Test: `tests/loop/verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/verify.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commandVerifier } from '../../src/loop/verify.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-verify-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('commandVerifier', () => {
  it('passes when the command exits 0', () => {
    const r = commandVerifier('node -e "process.exit(0)"')(dir)
    expect(r.passed).toBe(true)
  })

  it('fails when the command exits non-zero', () => {
    const r = commandVerifier('node -e "process.exit(1)"')(dir)
    expect(r.passed).toBe(false)
    expect(r.summary).toMatch(/verify failed/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/verify`
Expected: FAIL — cannot find module `src/loop/verify.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/loop/verify.ts`:
```ts
import { execSync } from 'node:child_process'

export interface VerifyResult {
  passed: boolean
  summary: string
}

export type Verifier = (targetDir: string) => VerifyResult

// Runs a shell command in the target dir; passed = exit 0. execSync goes through the
// shell, so `npm test` resolves npm.cmd on Windows. Output is captured (not streamed).
export function commandVerifier(command: string): Verifier {
  return (targetDir: string): VerifyResult => {
    try {
      execSync(command, { cwd: targetDir, stdio: 'pipe' })
      return { passed: true, summary: `verify passed: ${command}` }
    } catch {
      return { passed: false, summary: `verify failed: ${command}` }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/verify`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/verify.ts tests/loop/verify.test.ts
git commit -m "feat: add command verifier for independent test runs"
```

---

### Task 2: Config verify command + resolver

**Files:**
- Modify: `src/retrofit/config.ts`
- Test: `tests/retrofit/config.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `tests/retrofit/config.test.ts` (inside the existing `describe`, and add imports `mkdirSync`, `writeFileSync` from `node:fs` if not present, plus `resolveVerifyCommand`):

Add to the import line:
```ts
import { loadConfig, saveConfig, defaultConfig, resolveVerifyCommand } from '../../src/retrofit/config.js'
import { writeFileSync } from 'node:fs'
```
Add these tests:
```ts
  it('round-trips an optional verify command', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false }, verify: { command: 'npm test' } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('resolveVerifyCommand prefers config.verify.command', () => {
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true }, verify: { command: 'pytest' } })).toBe('pytest')
  })

  it('resolveVerifyCommand falls back to npm test when package.json has a test script', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true } })).toBe('npm test')
  })

  it('resolveVerifyCommand returns null when nothing is configured or detectable', () => {
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true } })).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- retrofit/config`
Expected: FAIL — `resolveVerifyCommand` is not exported; `verify` not in schema.

- [ ] **Step 3: Modify `src/retrofit/config.ts`**

Add `existsSync, readFileSync` to the `node:fs` import (keep existing imports):
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
```

Extend the `ForgeConfig` interface:
```ts
export interface ForgeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean }
  verify?: { command: string }
}
```

Extend the zod schema (the `ForgeConfigSchema` added in B1) with the optional field:
```ts
const ForgeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({ enabled: z.boolean() }),
  verify: z.object({ command: z.string().min(1) }).optional(),
})
```

Add the resolver at the end of the file:
```ts
// Decide which command verifies a story is done: explicit config wins; otherwise
// detect an npm test script; otherwise null (caller must refuse to run blindly).
export function resolveVerifyCommand(targetDir: string, config: ForgeConfig): string | null {
  if (config.verify?.command) return config.verify.command
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg?.scripts?.test) return 'npm test'
    } catch {
      // ignore malformed package.json
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- retrofit/config`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/retrofit/config.ts tests/retrofit/config.test.ts
git commit -m "feat: add verify command to config with detection fallback"
```

---

### Task 3: Gate the loop on verification

**Files:**
- Modify: `src/loop/loop.ts`
- Test: `tests/loop/loop.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/loop.test.ts`, add a verifier import and a passing-verifier default, and new cases. Add the import:
```ts
import type { Verifier } from '../../src/loop/verify.js'
```
Add near the other test stubs (after `alwaysPass`):
```ts
const verifyOk: Verifier = () => ({ passed: true, summary: 'green' })
```
Update existing `runLoop` calls in this file to pass `verify: verifyOk` in their options object (the new required field). Then add:
```ts
  it('does NOT mark a story passed when verification fails after a successful runner', () => {
    const verifyRed: Verifier = () => ({ passed: false, summary: 'tests red' })
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m) }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyRed, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/verif/i)
    expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)
    expect(commits).toHaveLength(0)
  })

  it('marks passed and commits only when runner AND verify both succeed', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m) }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(commits).toHaveLength(2)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/loop`
Expected: FAIL — `verify` is not part of `LoopOptions` (type error) and the verify-red case isn't handled.

- [ ] **Step 3: Modify `src/loop/loop.ts`**

Add the import:
```ts
import type { Verifier } from './verify.js'
```

Add `verify` to `LoopOptions`:
```ts
export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  verify: Verifier
  maxIterations: number
}
```

In the loop body, after the runner-success check and before marking/committing, insert the verify gate. Replace the success block:
```ts
    const result = opts.runner({ targetDir: opts.targetDir, story })
    iterations++

    if (!result.success) {
      return {
        status: 'blocked',
        iterations,
        reason: `story ${story.id} failed: ${result.summary}`,
        finalProgress: progress(stories),
      }
    }

    const verdict = opts.verify(opts.targetDir)
    if (!verdict.passed) {
      return {
        status: 'blocked',
        iterations,
        reason: `story ${story.id} did not verify: ${verdict.summary}`,
        finalProgress: progress(stories),
      }
    }

    try {
      const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
      savePrd(opts.prdPath, updated)
      opts.git.commitAll(opts.targetDir, `forge: complete ${story.id} ${story.title}`)
    } catch (e) {
      savePrd(opts.prdPath, stories)
      return {
        status: 'blocked',
        iterations,
        reason: `commit failed for ${story.id}: ${(e as Error).message}`,
        finalProgress: progress(stories),
      }
    }
```
(This keeps the C1 commit-integrity try/catch intact and adds the verify gate before it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/loop`
Expected: PASS (all existing C1 cases — now passing `verify: verifyOk` — plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat: gate story completion on independent verification"
```

---

### Task 4: Wire the verifier + auth hint in run-command

**Files:**
- Modify: `src/loop/run-command.ts`
- Test: `tests/loop/loop-cli.integration.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

In `tests/loop/loop-cli.integration.test.ts`, add an import for a Verifier and update existing `runLoopCommand` calls plus add new cases. Add import:
```ts
import type { Verifier } from '../../src/loop/verify.js'
```
Add stubs near the top:
```ts
const verifyOk: Verifier = () => ({ passed: true, summary: 'ok' })
```
Update the existing `runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })` calls to also pass `verify: verifyOk`. Then add:
```ts
  it('refuses to run when no verify command is configured or detectable', () => {
    saveConfig(dir, cfg())
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('runs when a verify command is configured', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(true)
  })
```
Note: the earlier "run completes" test must now configure a verify command too (add `verify: { command: 'node -e "process.exit(0)"' }` to its `saveConfig`), since runs without one now refuse. Update that test's `saveConfig(dir, cfg())` to `saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop-cli`
Expected: FAIL — `runLoopCommand` does not yet accept/inject a verifier or refuse on missing command.

- [ ] **Step 3: Modify `src/loop/run-command.ts`**

Add imports:
```ts
import { resolveVerifyCommand } from '../retrofit/config.js'
import { commandVerifier, type Verifier } from './verify.js'
```

Extend `RunLoopCommandOptions`:
```ts
export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
}
```

In `runLoopCommand`, after the existing PRD-existence check and before calling `runLoop`, resolve the verifier and refuse if none:
```ts
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .forge/config.yaml (e.g. "npm test") so the loop can confirm tests pass before marking work done.')
      return 2
    }
    verify = commandVerifier(command)
  }
```
Pass `verify` into the `runLoop` call:
```ts
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner: opts.runner ?? claudeRunner,
    git: opts.git ?? realGitOps,
    verify,
    maxIterations: opts.maxIterations,
  })
```

After computing `result`, add an auth hint when the run was blocked by an agent auth failure (from the dogfood finding):
```ts
  if (result.reason && /invalid api key|please run \/login|not logged in/i.test(result.reason)) {
    console.log('Hint: the agent CLI has no credentials in this environment. Set ANTHROPIC_API_KEY or log the agent in for headless use.')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop-cli`
Expected: PASS (updated existing + 2 new).

- [ ] **Step 5: Run full suite + smoke**

Run: `npm test`
Expected: all pass.

Run (PowerShell) — confirm the refusal message in a temp project with the loop enabled but no verify command:
```
# (covered by tests; optional manual check)
```

- [ ] **Step 6: Commit**

```bash
git add src/loop/run-command.ts tests/loop/loop-cli.integration.test.ts
git commit -m "feat: wire verifier into forge loop run; refuse without one; auth hint"
```

---

### Task 5: Update canon loop-spec

**Files:**
- Modify: `canon/loop/loop-spec.md`

- [ ] **Step 1: Update the verification language**

In `canon/loop/loop-spec.md`, change step 5 of the iteration list from trusting the agent to independent verification, and update the "C1 limitations" section. Replace step 5 and the limitations section with:
```markdown
5. On success: run the project's verify command (config `verify.command`, or detected `npm test`). Only if it passes, mark the story `passes: true`, save the PRD, and commit atomically. If the agent succeeds but verification fails: `blocked` (story stays open, no commit).
```
And replace the `## C1 limitations` section with:
```markdown
## Limitations
- The agent runner is claude-only; Codex/Gemini runners and per-iteration git-worktree isolation are Baustein C3.
- The loop run refuses to start if no verify command is configured or detectable, so it never marks work done without a green test run.
```

- [ ] **Step 2: Validate the canon**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/loop/loop-spec.md
git commit -m "docs: canon loop-spec now requires independent verification"
```

---

## Self-Review

**1. Spec coverage (Baustein C2 scope):**
- Independent test run replaces exit-code trust → Tasks 1, 3 ✓
- Story marked/committed only when runner AND verify both pass → Task 3 ✓
- Verify failure → blocked, no false `passes:true`, no commit → Task 3 ✓
- Configurable verify command + npm-test detection → Task 2 ✓
- Loop refuses to run with no verify command (never blind) → Task 4 ✓
- Clearer auth/setup error (dogfood finding) → Task 4 ✓
- Canon doc reflects real verification → Task 5 ✓
- (Deferred to C3: codex/gemini runners, per-iteration git-worktree isolation, review-iteration with role separation, tool-surface-readiness gate. Correct.)

**2. Placeholder scan:** No TBD/TODO. The "update existing runLoop calls to pass verify" instructions are concrete edits, not placeholders. Every code step is complete.

**3. Type consistency:** `VerifyResult{passed,summary}`, `Verifier`, `commandVerifier`, `resolveVerifyCommand`, `ForgeConfig.verify?:{command}`, `LoopOptions.verify`, `RunLoopCommandOptions.verify?` — consistent. `runLoop` now REQUIRES `verify` (all call sites updated in Tasks 3 & 4 tests). `commandVerifier` uses `execSync` (shell-resolved) consistent with the Windows lesson from the C1 dogfood runner fix. `ForgeConfig` extension is additive/optional so B1/B2 configs still parse. ✓

---

## Next Plans (not this document)

- **Plan C3 — Multi-agent + isolation:** `codexRunner`/`geminiRunner` (generalize `claudeInvocation`), runner selection by config/flag, per-iteration git-worktree isolation, review-iteration with role separation, tool-surface-readiness gate.
- **Plan B3 — settings.json merge:** merge into an existing `.claude/settings.json` instead of replacing.
