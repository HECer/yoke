# Forge — Baustein C1 (Loop-Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional autonomous Ralph loop: a PRD-driven driver that implements one story per iteration through an **injectable** agent runner, guarded by mechanical gates (Stop-the-Line + clean-worktree), plus `forge loop on|off|status|run`.

**Architecture:** The loop driver (`runLoop`) depends on two injected seams — an `AgentRunner` (real impl shells out to `claude -p`; tests pass a mock) and `GitOps` (real impl calls `git`; tests pass a real temp repo or a stub). This keeps the orchestration + gates **deterministic and free to test** with no real LLM calls. PRD parsing, story selection, and gates are pure. State lives outside any model context: the PRD file (`.forge/prd.yaml`) + git. This is Baustein C1 of the Forge spec; full per-iteration git-worktree isolation is C2.

**Tech Stack:** Node.js (ESM), TypeScript, vitest, `yaml`, `zod`, `node:child_process`. Reuses `loadConfig`/`saveConfig`/`ForgeConfig` from B1. Loop is OFF by default (set in B1's `.forge/config.yaml`).

**Builds on:** Baustein A + B1 (on `main`): `src/retrofit/config.ts` (`loadConfig`, `saveConfig`, `ForgeConfig`, `defaultConfig`), `src/cli.ts` (`main` dispatch with `validate` + `retrofit`, `isMain` guard).

---

## File Structure

```
src/
  loop/
    prd.ts          # Story type + loadPrd/savePrd/selectNextStory/allPass/progress
    gates.ts        # GateResult, stopTheLineGate, GitOps interface, preDispatchGate
    runner.ts       # AgentRunner type, buildClaudePrompt, claudeRunner (shells out)
    git.ts          # realGitOps — isClean/commitAll via `git` CLI
    loop.ts         # runLoop(opts) — the Ralph driver
    run-command.ts  # runLoopCommand(targetDir, opts) — wires config+PRD+real seams (injectable)
  cli.ts            # MODIFY: add `loop` subcommand (on|off|status|run)
tests/
  loop/
    prd.test.ts
    gates.test.ts
    runner.test.ts
    git.test.ts
    loop.test.ts
    loop-cli.integration.test.ts
```

Each module has one responsibility. The pure parts (`prd`, `gates`) test without a filesystem or git; `git.ts` tests against a real temp repo; `loop.ts` tests with a mock runner + stub git; the CLI integration test drives `runLoopCommand` with an injected mock runner so it stays deterministic.

---

### Task 1: PRD module

**Files:**
- Create: `src/loop/prd.ts`
- Test: `tests/loop/prd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/prd.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrd, savePrd, selectNextStory, allPass, progress } from '../../src/loop/prd.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-prd-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sample = `
- { id: S1, title: First, priority: 2, acceptance: ["does X"], passes: false }
- { id: S2, title: Second, priority: 1, acceptance: ["does Y"], passes: false }
- { id: S3, title: Third, priority: 3, acceptance: ["does Z"], passes: true }
`

describe('prd', () => {
  it('loads stories from yaml', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    expect(stories).toHaveLength(3)
    expect(stories[0]).toMatchObject({ id: 'S1', priority: 2, passes: false })
  })

  it('selects the highest-priority (lowest number) unfinished story', () => {
    writeFileSync(prd(), sample)
    const next = selectNextStory(loadPrd(prd()))
    expect(next?.id).toBe('S2')
  })

  it('selectNextStory returns null when all pass', () => {
    expect(selectNextStory([{ id: 'A', title: 't', priority: 1, acceptance: ['x'], passes: true }])).toBeNull()
  })

  it('allPass and progress report completion', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    expect(allPass(stories)).toBe(false)
    expect(progress(stories)).toEqual({ passed: 1, total: 3 })
  })

  it('saves stories back to yaml round-trip', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    stories[0].passes = true
    savePrd(prd(), stories)
    expect(progress(loadPrd(prd()))).toEqual({ passed: 2, total: 3 })
  })

  it('rejects a malformed story (missing acceptance)', () => {
    writeFileSync(prd(), `- { id: X, title: t, priority: 1, passes: false }`)
    expect(() => loadPrd(prd())).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/prd`
Expected: FAIL — cannot find module `src/loop/prd.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/loop/prd.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export const StorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  priority: z.number(),
  acceptance: z.array(z.string().min(1)),
  passes: z.boolean(),
})

export type Story = z.infer<typeof StorySchema>

const PrdSchema = z.array(StorySchema)

export function loadPrd(file: string): Story[] {
  return PrdSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function savePrd(file: string, stories: Story[]): void {
  writeFileSync(file, stringify(stories))
}

export function selectNextStory(stories: Story[]): Story | null {
  const open = stories.filter(s => !s.passes)
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.priority < best.priority ? s : best))
}

export function allPass(stories: Story[]): boolean {
  return stories.length > 0 && stories.every(s => s.passes)
}

export function progress(stories: Story[]): { passed: number; total: number } {
  return { passed: stories.filter(s => s.passes).length, total: stories.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/prd`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/prd.ts tests/loop/prd.test.ts
git commit -m "feat: add PRD module (load/save/select/progress)"
```

---

### Task 2: Gates module

**Files:**
- Create: `src/loop/gates.ts`
- Test: `tests/loop/gates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/gates.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { stopTheLineGate, preDispatchGate } from '../../src/loop/gates.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { Story } from '../../src/loop/prd.js'

const story = (over: Partial<Story> = {}): Story => ({
  id: 'S1', title: 't', priority: 1, acceptance: ['does X'], passes: false, ...over,
})

const git = (clean: boolean): GitOps => ({
  isClean: () => clean,
  commitAll: () => {},
})

describe('gates', () => {
  it('stopTheLineGate passes when acceptance criteria exist', () => {
    expect(stopTheLineGate(story()).ok).toBe(true)
  })

  it('stopTheLineGate blocks when acceptance is empty', () => {
    const r = stopTheLineGate(story({ acceptance: [] }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/acceptance/i)
  })

  it('preDispatchGate passes on a clean worktree', () => {
    expect(preDispatchGate('/x', git(true)).ok).toBe(true)
  })

  it('preDispatchGate blocks on a dirty worktree', () => {
    const r = preDispatchGate('/x', git(false))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/worktree/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/gates`
Expected: FAIL — cannot find module `src/loop/gates.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/loop/gates.ts`:
```ts
import type { Story } from './prd.js'

export interface GateResult {
  ok: boolean
  reason?: string
}

export interface GitOps {
  isClean(dir: string): boolean
  commitAll(dir: string, message: string): void
}

export function stopTheLineGate(story: Story): GateResult {
  if (story.acceptance.length === 0) {
    return { ok: false, reason: `story ${story.id} has no acceptance criteria (Stop-the-Line)` }
  }
  return { ok: true }
}

export function preDispatchGate(targetDir: string, git: GitOps): GateResult {
  if (!git.isClean(targetDir)) {
    return { ok: false, reason: 'git worktree is dirty — commit or stash before running the loop' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/gates`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/gates.ts tests/loop/gates.test.ts
git commit -m "feat: add loop gates (stop-the-line, pre-dispatch)"
```

---

### Task 3: Loop driver

**Files:**
- Create: `src/loop/loop.ts`
- Test: `tests/loop/loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/loop.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoop } from '../../src/loop/loop.js'
import { loadPrd } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
const cleanGit = (): GitOps => ({ isClean: () => true, commitAll: () => {} })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-loop-'))
  writeFileSync(prd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
- { id: S2, title: Second, priority: 2, acceptance: ["y"], passes: false }
`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const alwaysPass: AgentRunner = () => ({ success: true, summary: 'done' })

describe('runLoop', () => {
  it('completes all stories with a passing runner', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m) }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(res.iterations).toBe(2)
    expect(res.finalProgress).toEqual({ passed: 2, total: 2 })
    expect(loadPrd(prd()).every(s => s.passes)).toBe(true)
    expect(commits).toHaveLength(2)
  })

  it('blocks when the runner fails a story', () => {
    const failS1: AgentRunner = ({ story }) => ({ success: story.id !== 'S1', summary: 'boom' })
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: failS1, git: cleanGit(), maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/S1/)
  })

  it('stops at the iteration cap', () => {
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), maxIterations: 1 })
    expect(res.status).toBe('cap-reached')
    expect(res.iterations).toBe(1)
    expect(res.finalProgress).toEqual({ passed: 1, total: 2 })
  })

  it('blocks via pre-dispatch gate on a dirty worktree', () => {
    const dirtyGit: GitOps = { isClean: () => false, commitAll: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: dirtyGit, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/worktree/i)
    expect(res.iterations).toBe(0)
  })

  it('blocks via stop-the-line when the next story lacks acceptance', () => {
    writeFileSync(prd(), `- { id: S1, title: t, priority: 1, acceptance: [], passes: false }`)
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/acceptance/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/loop`
Expected: FAIL — cannot find module `src/loop/loop.js` (and `runner.js` not yet present; Task 4 adds the type, but this test only imports the `AgentRunner` type — create `runner.ts` in Task 4. To unblock this task, the loop imports the type from `./runner.js`, so do Step 3 here and if the type import fails, add a minimal `runner.ts` exporting just the types as part of this task, then flesh it out in Task 4).

Note: implement `src/loop/runner.ts` type exports now (the `AgentRunner`/`AgentResult`/`AgentContext` interfaces only — no `claudeRunner` yet) so this task compiles; Task 4 adds the real runner + its tests.

- [ ] **Step 3: Create the runner type stub, then the loop**

Create `src/loop/runner.ts` (types only for now):
```ts
import type { Story } from './prd.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
}

export type AgentRunner = (ctx: AgentContext) => AgentResult
```

Create `src/loop/loop.ts`:
```ts
import { loadPrd, savePrd, selectNextStory, allPass, progress } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentRunner } from './runner.js'

export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  maxIterations: number
}

export interface LoopResult {
  status: 'complete' | 'blocked' | 'cap-reached'
  iterations: number
  reason?: string
  finalProgress: { passed: number; total: number }
}

export function runLoop(opts: LoopOptions): LoopResult {
  let iterations = 0

  for (;;) {
    const stories = loadPrd(opts.prdPath)

    if (allPass(stories)) {
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }
    if (iterations >= opts.maxIterations) {
      return { status: 'cap-reached', iterations, finalProgress: progress(stories) }
    }

    const pre = preDispatchGate(opts.targetDir, opts.git)
    if (!pre.ok) {
      return { status: 'blocked', iterations, reason: pre.reason, finalProgress: progress(stories) }
    }

    const story = selectNextStory(stories)
    if (!story) {
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }

    const stl = stopTheLineGate(story)
    if (!stl.ok) {
      return { status: 'blocked', iterations, reason: stl.reason, finalProgress: progress(stories) }
    }

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

    const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
    savePrd(opts.prdPath, updated)
    opts.git.commitAll(opts.targetDir, `forge: complete ${story.id} ${story.title}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/loop`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat: add Ralph loop driver with gates and injectable runner"
```

---

### Task 4: Claude agent runner

**Files:**
- Modify: `src/loop/runner.ts` (add `buildClaudePrompt` + `claudeRunner`)
- Test: `tests/loop/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/runner.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildClaudePrompt } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'

const story: Story = {
  id: 'S1', title: 'Add login', priority: 1,
  acceptance: ['returns 200 for valid creds', 'rejects bad creds'], passes: false,
}

describe('buildClaudePrompt', () => {
  it('includes the story id, title, and every acceptance criterion', () => {
    const p = buildClaudePrompt(story)
    expect(p).toContain('S1')
    expect(p).toContain('Add login')
    expect(p).toContain('returns 200 for valid creds')
    expect(p).toContain('rejects bad creds')
  })

  it('instructs the agent to implement only this story and not commit', () => {
    const p = buildClaudePrompt(story)
    expect(p).toMatch(/only this story/i)
    expect(p).toMatch(/not commit/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/runner`
Expected: FAIL — `buildClaudePrompt` is not exported.

- [ ] **Step 3: Add the implementation to `src/loop/runner.ts`**

Append to `src/loop/runner.ts` (keep the existing type exports):
```ts
import { execFileSync } from 'node:child_process'

export function buildClaudePrompt(story: Story): string {
  const criteria = story.acceptance.map(a => `- ${a}`).join('\n')
  return [
    'You are an autonomous coding agent running inside the Forge loop.',
    'Implement ONLY this story and nothing else. Follow test-driven development.',
    '',
    `Story ${story.id}: ${story.title}`,
    'Acceptance criteria (Definition of Done):',
    criteria,
    '',
    "When done, ensure the project's full test suite passes.",
    'Do NOT commit — the loop commits on your behalf after verifying.',
  ].join('\n')
}

export function claudeRunner(ctx: AgentContext): AgentResult {
  const prompt = buildClaudePrompt(ctx.story)
  try {
    execFileSync('claude', ['-p', prompt], { cwd: ctx.targetDir, stdio: 'inherit' })
    return { success: true, summary: `claude implemented ${ctx.story.id}` }
  } catch (e) {
    return { success: false, summary: `claude failed on ${ctx.story.id}: ${(e as Error).message}` }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/runner`
Expected: PASS (2 tests). `claudeRunner` itself is not invoked in tests (it would shell out to a real `claude`); only prompt construction is tested.

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "feat: add claude agent runner and prompt builder"
```

---

### Task 5: Real GitOps

**Files:**
- Create: `src/loop/git.ts`
- Test: `tests/loop/git.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/loop/git.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { realGitOps } from '../../src/loop/git.js'

let dir: string
function git(...args: string[]) { execFileSync('git', args, { cwd: dir, stdio: 'pipe' }) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-git-'))
  git('init', '-q')
  git('config', 'user.email', 'test@forge.local')
  git('config', 'user.name', 'Forge Test')
  writeFileSync(join(dir, 'a.txt'), 'hello')
  git('add', '-A'); git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('realGitOps', () => {
  it('isClean is true on a committed tree', () => {
    expect(realGitOps.isClean(dir)).toBe(true)
  })

  it('isClean is false with uncommitted changes', () => {
    writeFileSync(join(dir, 'b.txt'), 'new')
    expect(realGitOps.isClean(dir)).toBe(false)
  })

  it('commitAll stages and commits, leaving a clean tree', () => {
    writeFileSync(join(dir, 'b.txt'), 'new')
    realGitOps.commitAll(dir, 'forge: test commit')
    expect(realGitOps.isClean(dir)).toBe(true)
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir }).toString()
    expect(log).toContain('forge: test commit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop/git`
Expected: FAIL — cannot find module `src/loop/git.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/loop/git.ts`:
```ts
import { execFileSync } from 'node:child_process'
import type { GitOps } from './gates.js'

export const realGitOps: GitOps = {
  isClean(dir: string): boolean {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()
    return out.trim() === ''
  },
  commitAll(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', message], { cwd: dir, stdio: 'pipe' })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- loop/git`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/git.ts tests/loop/git.test.ts
git commit -m "feat: add real GitOps (isClean, commitAll)"
```

---

### Task 6: Run-command wiring + `forge loop` CLI

**Files:**
- Create: `src/loop/run-command.ts`
- Modify: `src/cli.ts`
- Test: `tests/loop/loop-cli.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/loop/loop-cli.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { setLoopEnabled, loopStatus } from '../../src/loop/run-command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { loadConfig } from '../../src/retrofit/config.js'
import { loadPrd } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'

let dir: string
const cfg = () => ({ canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } })
const stubGit: GitOps = { isClean: () => true, commitAll: () => {} }
const passRunner: AgentRunner = () => ({ success: true, summary: 'ok' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-loopcli-'))
  mkdirSync(join(dir, '.forge'), { recursive: true })
  writeFileSync(join(dir, '.forge', 'prd.yaml'),
    `- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('forge loop CLI', () => {
  it('setLoopEnabled on/off updates the config', () => {
    saveConfig(dir, cfg())
    setLoopEnabled(dir, false)
    expect(loadConfig(dir)!.loop.enabled).toBe(false)
    setLoopEnabled(dir, true)
    expect(loadConfig(dir)!.loop.enabled).toBe(true)
  })

  it('loopStatus reports enabled state and progress', () => {
    saveConfig(dir, cfg())
    const out = loopStatus(dir)
    expect(out).toMatch(/enabled/i)
    expect(out).toContain('0/1')
  })

  it('run refuses when the loop is disabled', () => {
    saveConfig(dir, { ...cfg(), loop: { enabled: false } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('run completes the PRD with an injected passing runner', () => {
    saveConfig(dir, cfg())
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- loop-cli`
Expected: FAIL — cannot find module `src/loop/run-command.js`.

- [ ] **Step 3: Create `src/loop/run-command.ts`**

```ts
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { realGitOps } from './git.js'
import { claudeRunner, type AgentRunner } from './runner.js'
import type { GitOps } from './gates.js'

export function prdPath(targetDir: string): string {
  return join(targetDir, '.forge', 'prd.yaml')
}

export function setLoopEnabled(targetDir: string, enabled: boolean): void {
  const config = loadConfig(targetDir) ?? defaultConfig('0.0.0')
  config.loop = { enabled }
  saveConfig(targetDir, config)
}

export function loopStatus(targetDir: string): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}`
}

export interface RunLoopCommandOptions {
  maxIterations: number
  runner?: AgentRunner
  git?: GitOps
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number {
  const config = loadConfig(targetDir)
  if (!config?.loop.enabled) {
    console.error('Loop is disabled. Enable it with: forge loop on')
    return 2
  }
  const path = prdPath(targetDir)
  if (!existsSync(path)) {
    console.error(`No PRD found at ${path}. Create one (see canon loop/prd.schema.md).`)
    return 2
  }
  const result = runLoop({
    prdPath: path,
    targetDir,
    runner: opts.runner ?? claudeRunner,
    git: opts.git ?? realGitOps,
    maxIterations: opts.maxIterations,
  })
  console.log(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
  if (result.reason) console.log(`Reason: ${result.reason}`)
  return result.status === 'complete' ? 0 : 1
}
```

- [ ] **Step 4: Modify `src/cli.ts` to add the `loop` subcommand**

Add imports near the other retrofit imports in `src/cli.ts`:
```ts
import { setLoopEnabled, loopStatus, runLoopCommand } from './loop/run-command.js'
```

Add a `loop` case to the `switch` in `main` (before `default`):
```ts
    case 'loop': {
      const sub = rest[0]
      const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
      if (sub === 'on') { setLoopEnabled(targetDir, true); console.log('Loop enabled.'); return 0 }
      if (sub === 'off') { setLoopEnabled(targetDir, false); console.log('Loop disabled.'); return 0 }
      if (sub === 'status') { console.log(loopStatus(targetDir)); return 0 }
      if (sub === 'run') {
        const maxArg = rest.find(a => a.startsWith('--max='))
        const maxIterations = maxArg ? Number(maxArg.slice('--max='.length)) : 25
        return runLoopCommand(targetDir, { maxIterations })
      }
      console.log('usage: forge loop <on|off|status|run [--max=N]> [targetDir]')
      return 1
    }
```

Update the `default` usage line:
```ts
    default:
      console.log('usage: forge <validate [canonDir] | retrofit [targetDir] [--loop] | loop <on|off|status|run>>')
      return cmd ? 1 : 0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- loop-cli`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass (A's 17 + B1's 39-17=22 + C1's new tests).

Run (PowerShell) smoke for the toggle:
```
npm run forge -- loop status .
```
Expected: prints `Loop: disabled` (or enabled) and PRD progress for the repo (likely `no PRD`).

- [ ] **Step 7: Commit**

```bash
git add src/loop/run-command.ts src/cli.ts tests/loop/loop-cli.integration.test.ts
git commit -m "feat: wire forge loop on|off|status|run command"
```

---

### Task 7: Document the loop in the canon

**Files:**
- Modify: `canon/loop/loop-spec.md`

- [ ] **Step 1: Update `canon/loop/loop-spec.md` to match the implemented commands**

Replace the file content with:
```markdown
# Loop Specification (Ralph + GSD)

The autonomous loop is OPTIONAL and toggle-able:

- `forge loop on` / `forge loop off` — enable/disable (recorded in `.forge/config.yaml`, default off).
- `forge loop status` — show enabled state + PRD progress.
- `forge loop run [--max=N]` — run the loop (default cap 25 iterations).

When enabled and run, each iteration:

1. Pre-dispatch gate: the git worktree must be clean, else `blocked`.
2. Pick the highest-priority unfinished PRD story (`.forge/prd.yaml`).
3. Stop-the-Line gate: the story must have acceptance criteria, else `blocked`.
4. Run a fresh agent (default `claude -p`) to implement ONE story.
5. On success: mark the story `passes: true`, save the PRD, and commit atomically.
   On failure: `blocked`.
6. Stop when all stories `passes: true` (`complete`), or the iteration cap is reached (`cap-reached`).

State lives outside the model context: the PRD file + git. The agent runner is
pluggable; Codex/Gemini runners and full per-iteration worktree isolation are Baustein C2.
```

- [ ] **Step 2: Validate the canon still passes**

Run: `npm run forge -- validate canon`
Expected: `✓ canon valid (canon)`.

Run: `npm test -- real-canon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add canon/loop/loop-spec.md
git commit -m "docs: align canon loop-spec with implemented forge loop commands"
```

---

## Self-Review

**1. Spec coverage (Baustein C1 scope):**
- Aggressive-autonomous loop, hard mechanical gates → Tasks 2, 3 ✓
- PRD-driven, stop when all `passes:true` → Tasks 1, 3 ✓
- Stop-the-Line gate (acceptance required) → Task 2 ✓
- Pre-dispatch gate (clean worktree) → Tasks 2, 5 ✓
- Fresh agent per iteration, state outside context (PRD + git) → Tasks 3, 4 ✓
- `forge loop on|off|status|run`, default off → Task 6 ✓
- Toggle is non-destructive (config-only) → Task 6 ✓
- Iteration cap → Tasks 3, 6 ✓
- (Deferred to C2: Codex/Gemini runners, full per-iteration git-worktree isolation, tool-readiness gate. Correct — C1 is the loop core + claude runner.)

**2. Placeholder scan:** No TBD/TODO; every step has complete code/content. The Task 3 note about creating `runner.ts` types before `loop.ts` is an ordering instruction, not a placeholder. ✓

**3. Type consistency:** `Story`, `GateResult`, `GitOps{isClean,commitAll}`, `AgentContext{targetDir,story}`, `AgentResult{success,summary}`, `AgentRunner`, `LoopOptions`, `LoopResult{status,iterations,reason?,finalProgress}`, `runLoop`, `buildClaudePrompt`, `claudeRunner`, `realGitOps`, `runLoopCommand`, `setLoopEnabled`, `loopStatus`, `prdPath` — consistent across tasks. `loadConfig/saveConfig/defaultConfig/ForgeConfig` reused from B1 unchanged. `progress` returns `{passed,total}` used consistently. ✓

---

## Next Plans (not this document)

- **Plan B2 — Retrofit for Codex + Gemini + tool wiring** (rtk/graphify/playwright MCP, rtk WSL detection).
- **Plan C2 — Loop hardening:** Codex/Gemini runners, per-iteration git-worktree isolation, review-iteration with role separation, tool-surface-readiness gate.
