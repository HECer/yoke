# Baustein K — Zero-to-100 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `yoke new` (greenfield bootstrap: scaffold + retrofit + context + PRD template, optional idea→PRD draft), `yoke prd draft|check`, `yoke loop cleanup`, and a single-flight loop lock.

**Architecture:** Four small command modules following the existing seam pattern (`src/review/command.ts` is the model: injectable `isAvailable`/`run`/`git` functions, exit-code contracts). `runRetrofit` moves out of `cli.ts` into `src/retrofit/command.ts` to break the import cycle `cli → new → cli`. One new canon skill (`authoring-prd`).

**Tech Stack:** Node 20 ESM TypeScript (`.js` import specifiers!), vitest, zod, yaml. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-baustein-k-zero-to-100-bootstrap-design.md`

**Pitfalls for the implementer:**
- ESM: every relative import ends in `.js` even though sources are `.ts`.
- The rtk proxy mangles `grep`/`grep -c` output — verify test results with `npx vitest run --reporter=json --outputFile=.yoke-test.json` and parse with node, or read the vitest summary directly. A conda `pydantic_core` stderr banner appears on every shell command; it is harmless noise.
- Run `npx tsc --noEmit` before each commit.
- Deviation from spec §Testing: `tests/canon/real-canon.test.ts` has **no** skill-count assertion; Task 8 adds a registration assertion for `authoring-prd` instead.

---

### Task 1: Move `runRetrofit` to `src/retrofit/command.ts` (cycle-breaking refactor, no behavior change)

**Files:**
- Create: `src/retrofit/command.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create `src/retrofit/command.ts`** — move the entire `runRetrofit` function plus its imports out of `src/cli.ts` verbatim:

```ts
import { join } from 'node:path'
import { resolveCanonDir } from './canon-dir.js'
import { planRetrofit } from './plan.js'
import { applyActions } from './apply.js'
import { formatReport } from './report.js'
import { detectProject } from './detect.js'
import { ensureGitignore } from './gitignore.js'
import { loadConfig, saveConfig, defaultConfig, type Agent, type YokeConfig, type CodeGraph } from './config.js'
import { loadManifest } from '../canon/manifest.js'

export function runRetrofit(targetDir: string, opts: { loop: boolean; agents?: Agent[]; codeGraph?: CodeGraph }): number {
  // ... body copied 1:1 from src/cli.ts (lines 35-68) ...
}
```

Copy the body exactly as it is in `src/cli.ts:35-68` — do not "improve" it.

- [ ] **Step 2: Update `src/cli.ts`** — delete the moved function and its now-unused imports, and re-export for the existing tests:

```ts
export { runRetrofit } from './retrofit/command.js'
```

(`tests/retrofit/retrofit.integration.test.ts` imports `runRetrofit` from `../../src/cli.js`; the re-export keeps that import working.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean, then `npx vitest run tests/retrofit` → all pass.

- [ ] **Step 4: Commit** — `refactor(retrofit): extract runRetrofit into retrofit/command (break cli cycle)`

---

### Task 2: Loop lock module

**Files:**
- Create: `src/loop/lock.ts`
- Test: `tests/loop/lock.test.ts`

- [ ] **Step 1: Write the failing tests** (`tests/loop/lock.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock, readLock, isPidAlive, lockPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-lock-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loop lock', () => {
  it('acquires when no lock exists (creates .yoke if needed)', () => {
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
    expect(readLock(dir)?.pid).toBe(process.pid)
  })

  it('refuses when the holder pid is alive', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    const r = acquireLock(dir, 999999)
    expect(r.acquired).toBe(false)
    expect(r.holderPid).toBe(process.pid)
  })

  it('takes over a stale lock (dead pid) and reports it', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    // 2^22 exceeds the default pid_max on every platform we target — treat as dead
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 4194304 + 12345, startedAt: new Date().toISOString() }))
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
    expect(r.stalePid).toBe(4194304 + 12345)
    expect(readLock(dir)?.pid).toBe(process.pid)
  })

  it('takes over a corrupt lock file', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), 'not json')
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
  })

  it('releaseLock removes the file and never throws', () => {
    acquireLock(dir, process.pid)
    releaseLock(dir)
    expect(existsSync(lockPath(dir))).toBe(false)
    releaseLock(dir) // second call: no throw
  })

  it('isPidAlive: own pid true, absurd pid false, non-positive false', () => {
    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(4194304 + 54321)).toBe(false)
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/loop/lock.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/loop/lock.ts`:**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface LockInfo { pid: number; startedAt: string }
export interface LockResult { acquired: boolean; holderPid?: number; stalePid?: number }

export function lockPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.lock')
}

// Liveness probe via signal 0. EPERM means "exists but not ours" — alive.
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function readLock(targetDir: string): LockInfo | null {
  const file = lockPath(targetDir)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as LockInfo
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function acquireLock(targetDir: string, pid: number = process.pid): LockResult {
  const file = lockPath(targetDir)
  const holder = readLock(targetDir)
  if (holder && isPidAlive(holder.pid)) return { acquired: false, holderPid: holder.pid }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ pid, startedAt: new Date().toISOString() }))
  return holder ? { acquired: true, stalePid: holder.pid } : { acquired: true }
}

// Best-effort: a missing file or an unwritable disk must never crash loop teardown.
export function releaseLock(targetDir: string): void {
  try { rmSync(lockPath(targetDir), { force: true }) } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/loop/lock.test.ts` → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `feat(loop): single-flight lock module`

---

### Task 3: Wire the lock into `runLoopCommand` + gitignore line

**Files:**
- Modify: `src/loop/run-command.ts` (function `runLoopCommand`, currently lines 81-142)
- Modify: `src/retrofit/gitignore.ts` (const `YOKE_IGNORE_LINES`)
- Test: `tests/loop/run-command.test.ts` (add one case), `tests/retrofit/gitignore.test.ts` (extend)

- [ ] **Step 1: Write the failing tests.** In `tests/loop/run-command.test.ts`, add (reuse the file's existing helpers for a runnable temp project — config with loop enabled, PRD, injected runner/git/verify):

```ts
it('returns 2 when another loop holds the lock', () => {
  // arrange a fully runnable loop project exactly like the existing happy-path test,
  // then plant a live lock before calling runLoopCommand:
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'loop.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  const code = runLoopCommand(dir, { maxIterations: 1, runner, git, verify, reporter })
  expect(code).toBe(2)
})

it('releases the lock after a run', () => {
  // run the existing happy-path setup to completion, then:
  expect(existsSync(join(dir, '.yoke', 'loop.lock'))).toBe(false)
})
```

In `tests/retrofit/gitignore.test.ts`, extend the existing expectations so `.yoke/loop.lock` is one of the ensured lines.

- [ ] **Step 2: Run to verify failure** — the lock case fails (returns 0/1, not 2), gitignore case fails.

- [ ] **Step 3: Implement.** In `src/retrofit/gitignore.ts` add the line:

```ts
export const YOKE_IGNORE_LINES = [
  '.yoke/worktrees/',
  '.yoke/backup/',
  '.yoke/loop-status.json',
  '.yoke/loop.log',
  '.yoke/loop.lock',
]
```

In `src/loop/run-command.ts`: `import { acquireLock, releaseLock } from './lock.js'`, then in `runLoopCommand`, AFTER all existing pre-checks (loop enabled, PRD exists, verify resolved, runner/review available) and immediately BEFORE the `runLoop(...)` call, insert:

```ts
const lock = acquireLock(targetDir)
if (!lock.acquired) {
  console.error(`Another loop is already running here (pid ${lock.holderPid}). If that is wrong, run: yoke loop cleanup`)
  return 2
}
if (lock.stalePid !== undefined) {
  console.warn(`Took over a stale loop lock (pid ${lock.stalePid} is gone).`)
}
try {
  const result = runLoop({ /* unchanged existing args */ })
  /* unchanged existing console.log lines + return */
} finally {
  releaseLock(targetDir)
}
```

(The existing `result`/logging/return block moves inside the `try`.)

- [ ] **Step 4: Check the integration test.** `tests/loop/loop-cli.integration.test.ts` drives a real repo — if it writes its own `.gitignore` instead of calling retrofit/`ensureGitignore`, the untracked lock file cannot break its clean-tree gate because the lock is released before gates run per iteration and only exists during the run; but the pre-dispatch gate runs DURING the run while the lock exists. If that test's project lacks the ignore line, add `.yoke/loop.lock` to whatever `.gitignore` the test writes. Run the loop test suite: `npx vitest run tests/loop` → all pass.

- [ ] **Step 5: Commit** — `feat(loop): refuse concurrent runs via loop.lock; gitignore it`

---

### Task 4: PRD template, draft prompt, `runPrdDraft`

**Files:**
- Create: `src/prd/command.ts`
- Test: `tests/prd/command.test.ts`

- [ ] **Step 1: Write the failing tests** (`tests/prd/command.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPrdDraft, buildPrdDraftPrompt, PRD_TEMPLATE } from '../../src/prd/command.js'
import type { Invocation } from '../../src/loop/runner.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-prd-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const VALID_PRD = `- id: STORY-1\n  title: scaffold project\n  priority: 1\n  acceptance:\n    - "verify command exits 0"\n  passes: false\n`

function writingRun(content: string, calls: Invocation[] = []) {
  return (inv: Invocation) => {
    calls.push(inv)
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), content)
    return { success: true, summary: 'exited 0' }
  }
}

describe('buildPrdDraftPrompt', () => {
  it('contains the idea, the story band, the scaffold rule and the write-only rule', () => {
    const p = buildPrdDraftPrompt('a todo cli')
    expect(p).toContain('a todo cli')
    expect(p).toContain('5-12')
    expect(p).toContain('STORY-1')
    expect(p).toContain('.yoke/prd.yaml')
    expect(p).toContain('Do not commit')
  })
})

describe('PRD_TEMPLATE', () => {
  it('parses to an empty story array', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
    // loadPrd via runPrdCheck is Task 5; here just assert the YAML payload
    expect(PRD_TEMPLATE.trim().endsWith('[]')).toBe(true)
  })
})

describe('runPrdDraft', () => {
  it('invokes the resolved agent with the draft prompt and validates the result', () => {
    const calls: Invocation[] = []
    const code = runPrdDraft(dir, { idea: 'a todo cli', runner: 'codex', isAvailable: () => true, run: writingRun(VALID_PRD, calls) })
    expect(code).toBe(0)
    expect(calls[0].command).toBe('codex')
    expect(calls[0].input).toContain('a todo cli')
  })

  it('requires an idea', () => {
    expect(runPrdDraft(dir, { idea: '  ', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(1)
  })

  it('returns 2 when the requested agent is unavailable', () => {
    expect(runPrdDraft(dir, { idea: 'x', runner: 'gemini', isAvailable: () => false, run: writingRun(VALID_PRD) })).toBe(2)
  })

  it('refuses to overwrite a PRD with stories unless --force', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD)
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(1)
    expect(runPrdDraft(dir, { idea: 'x', force: true, isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(0)
  })

  it('the template (zero stories) does not trigger the overwrite guard', () => {
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun(VALID_PRD) })).toBe(0)
  })

  it('fails when the agent output is invalid YAML/schema', () => {
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun('- id: 1\n  nope: true\n') })).toBe(1)
  })

  it('fails when the agent produces an empty PRD', () => {
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run: writingRun('[]') })).toBe(1)
  })

  it('fails when the agent run fails', () => {
    const run = (_: Invocation) => ({ success: false, summary: 'boom' })
    expect(runPrdDraft(dir, { idea: 'x', isAvailable: () => true, run })).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement `src/prd/command.ts`:**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '../retrofit/config.js'
import { loadConfig } from '../retrofit/config.js'
import { loadPrd } from '../loop/prd.js'
import {
  agentInvocation,
  buildWatchdogInvocation,
  runAgent,
  isAgentAvailable,
  type Invocation,
  type AgentResult,
} from '../loop/runner.js'
import { resolveIdleMs } from '../loop/run-command.js'

export const PRD_TEMPLATE = `# Yoke PRD — the loop picks the lowest-priority open story each iteration.
# Story format (see canon/loop/prd.schema.md):
# - id: STORY-1
#   title: scaffold the project with a runnable test suite
#   priority: 1
#   acceptance:
#     - "the verify command exits 0"
#     - "a placeholder test exists and passes"
#   passes: false
[]
`

export function buildPrdDraftPrompt(idea: string): string {
  return [
    'You are drafting a PRD for the Yoke autonomous loop.',
    '',
    `Product idea: ${idea}`,
    '',
    'Break the idea into 5-12 small, independently shippable stories; each must fit one loop iteration.',
    'Each story needs:',
    '- id: STORY-1, STORY-2, ... (unique)',
    '- title: one imperative sentence',
    '- priority: dense integers from 1 (lower = built first)',
    '- acceptance: 2-5 testable, behavioral criteria (observable outcomes, never implementation steps)',
    '- passes: false',
    '',
    'If the project has no source code yet, STORY-1 must scaffold the project skeleton with a runnable',
    'test suite, and its acceptance must include that the verify command (verify.command in',
    '.yoke/config.yaml) exits 0.',
    '',
    'Write ONLY the file .yoke/prd.yaml as a YAML array of stories in exactly that shape.',
    'Do not modify any other file. Do not commit.',
  ].join('\n')
}

export interface PrdDraftOptions {
  idea: string
  runner?: Agent
  force?: boolean
  timeoutMinutes?: number
  isAvailable?: (a: Agent) => boolean
  run?: (inv: Invocation) => AgentResult
}

export function prdFile(targetDir: string): string {
  return join(targetDir, '.yoke', 'prd.yaml')
}

export function runPrdDraft(targetDir: string, opts: PrdDraftOptions): number {
  const idea = opts.idea?.trim()
  if (!idea) {
    console.error('yoke prd draft requires --idea="..."')
    return 1
  }
  const path = prdFile(targetDir)
  if (existsSync(path) && !opts.force) {
    try {
      const existing = loadPrd(path)
      if (existing.length > 0) {
        console.error(`PRD already has ${existing.length} stories — use --force to overwrite.`)
        return 1
      }
    } catch {
      // unparseable existing file: the draft will replace it
    }
  }
  const available = opts.isAvailable ?? isAgentAvailable
  const config = loadConfig(targetDir)
  const agent: Agent = opts.runner ?? config?.agents[0] ?? 'claude'
  if (!available(agent)) {
    console.error(`Agent CLI "${agent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
    return 2
  }
  const idleMs = resolveIdleMs(opts.timeoutMinutes, undefined)
  const inv = agentInvocation(agent, buildPrdDraftPrompt(idea), targetDir)
  console.log(`Drafting PRD with ${agent}...`)
  const run = opts.run ?? ((i: Invocation) => runAgent(buildWatchdogInvocation(i, idleMs)))
  const result = run(inv)
  if (!result.success) {
    console.error(`PRD draft failed: ${result.summary}`)
    return 1
  }
  let count: number
  try {
    count = loadPrd(path).length
  } catch (e) {
    console.error(`PRD draft produced an invalid PRD: ${(e as Error).message}`)
    return 1
  }
  if (count === 0) {
    console.error('PRD draft failed: agent produced an empty PRD.')
    return 1
  }
  console.log(`Drafted ${count} stories → ${path}`)
  return 0
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/prd` → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `feat(prd): PRD template + idea→PRD draft via agent`

---

### Task 5: `runPrdCheck`

**Files:**
- Modify: `src/prd/command.ts`
- Test: `tests/prd/command.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (append to `tests/prd/command.test.ts`; import `runPrdCheck`):

```ts
describe('runPrdCheck', () => {
  const write = (content: string) => writeFileSync(join(dir, '.yoke', 'prd.yaml'), content)

  it('passes a valid PRD', () => {
    write(VALID_PRD)
    expect(runPrdCheck(dir)).toBe(0)
  })

  it('fails when the file is missing', () => {
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on schema violations', () => {
    write('- id: STORY-1\n')
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on duplicate ids', () => {
    write(VALID_PRD + VALID_PRD.replace('scaffold project', 'again'))
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on empty acceptance', () => {
    write('- id: STORY-1\n  title: t\n  priority: 1\n  acceptance: []\n  passes: false\n')
    expect(runPrdCheck(dir)).toBe(1)
  })

  it('fails on zero stories (the untouched template)', () => {
    write(PRD_TEMPLATE)
    expect(runPrdCheck(dir)).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (append to `src/prd/command.ts`; add imports `progress` from `../loop/prd.js` and `Story` type):

```ts
export function runPrdCheck(targetDir: string): number {
  const path = prdFile(targetDir)
  if (!existsSync(path)) {
    console.error(`No PRD at ${path} — create one with yoke prd draft or yoke new.`)
    return 1
  }
  let stories: Story[]
  try {
    stories = loadPrd(path)
  } catch (e) {
    console.error(`Invalid PRD: ${(e as Error).message}`)
    return 1
  }
  const errors: string[] = []
  if (stories.length === 0) errors.push('PRD has no stories')
  const seen = new Set<string>()
  for (const s of stories) {
    if (seen.has(s.id)) errors.push(`duplicate story id: ${s.id}`)
    seen.add(s.id)
    // the schema allows [], but the loop's stop-the-line gate blocks it — fail fast here
    if (s.acceptance.length === 0) errors.push(`story ${s.id} has no acceptance criteria`)
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`)
    return 1
  }
  const p = progress(stories)
  console.log(`✓ PRD valid — ${p.total} stories, ${p.passed} pass`)
  return 0
}
```

(`import { loadPrd, progress, type Story } from '../loop/prd.js'` — merge with the existing loadPrd import.)

- [ ] **Step 4: Run** — `npx vitest run tests/prd` → PASS.

- [ ] **Step 5: Commit** — `feat(prd): yoke prd check lint gate`

---

### Task 6: `yoke loop cleanup`

**Files:**
- Create: `src/loop/cleanup.ts`
- Test: `tests/loop/cleanup.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCleanup } from '../../src/loop/cleanup.js'
import { lockPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-clean-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runLoopCleanup', () => {
  it('reports nothing to clean on a fresh dir', () => {
    expect(runLoopCleanup(dir, { git: () => { throw new Error('must not be called') } })).toBe(0)
  })

  it('removes every yoke worktree via git and prunes', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-1'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-2'), { recursive: true })
    const calls: string[][] = []
    const code = runLoopCleanup(dir, { git: (args) => { calls.push(args) } })
    expect(code).toBe(0)
    const removes = calls.filter(a => a[1] === 'remove')
    expect(removes).toHaveLength(2)
    expect(calls.some(a => a[1] === 'prune')).toBe(true)
  })

  it('returns 1 when a removal fails but continues with the rest', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'B'), { recursive: true })
    let n = 0
    const code = runLoopCleanup(dir, { git: (args) => { if (args[1] === 'remove' && n++ === 0) throw new Error('boom') } })
    expect(code).toBe(1)
    expect(n).toBeGreaterThan(0)
  })

  it('removes a stale lock but keeps a live one', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 4194304 + 999, startedAt: 'x' }))
    runLoopCleanup(dir, { git: () => {} })
    expect(existsSync(lockPath(dir))).toBe(false)

    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x' }))
    runLoopCleanup(dir, { git: () => {} })
    expect(existsSync(lockPath(dir))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/loop/cleanup.ts`:**

```ts
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { lockPath, readLock, isPidAlive } from './lock.js'

export interface CleanupOptions {
  git?: (args: string[], cwd: string) => void
}

// Cleans ONLY yoke-created runtime artifacts: .yoke/worktrees/* and a stale loop.lock.
// Never touches user-created worktrees or a lock whose holder is alive.
export function runLoopCleanup(targetDir: string, opts: CleanupOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const wtDir = join(targetDir, '.yoke', 'worktrees')
  let removed = 0
  let failed = 0
  if (existsSync(wtDir)) {
    for (const name of readdirSync(wtDir)) {
      const path = join(wtDir, name)
      try {
        git(['worktree', 'remove', '--force', path], targetDir)
        removed++
      } catch (e) {
        console.error(`Failed to remove worktree ${path}: ${(e as Error).message}`)
        failed++
      }
    }
    try { git(['worktree', 'prune'], targetDir) } catch { /* best-effort */ }
  }
  const lockFile = lockPath(targetDir)
  if (existsSync(lockFile)) {
    const holder = readLock(targetDir)
    if (holder && isPidAlive(holder.pid)) {
      console.log(`Loop lock held by a live process (pid ${holder.pid}) — left in place.`)
    } else {
      rmSync(lockFile, { force: true })
      console.log('Removed stale loop lock.')
    }
  }
  console.log(removed === 0 && failed === 0 ? 'Nothing to clean.' : `Removed ${removed} worktree(s)${failed > 0 ? `, ${failed} failed` : ''}.`)
  return failed === 0 ? 0 : 1
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/loop/cleanup.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(loop): yoke loop cleanup for orphaned worktrees + stale lock`

---

### Task 7: `yoke new`

**Files:**
- Create: `src/new/command.ts`
- Test: `tests/new/command.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from '../../src/new/command.js'
import type { Invocation } from '../../src/loop/runner.js'

const VALID_PRD = `- id: STORY-1\n  title: scaffold project\n  priority: 1\n  acceptance:\n    - "verify command exits 0"\n  passes: false\n`

let parent: string
beforeEach(() => { parent = mkdtempSync(join(tmpdir(), 'yoke-new-')) })
afterEach(() => { rmSync(parent, { recursive: true, force: true }) })

describe('runNew', () => {
  const noGit = { git: (_args: string[], _cwd: string) => {} }

  it('refuses a non-empty existing directory', () => {
    const dir = join(parent, 'app')
    mkdirSync(dir)
    writeFileSync(join(dir, 'x.txt'), 'x')
    expect(runNew(dir, { ...noGit })).toBe(1)
  })

  it('scaffolds README, .gitignore, retrofit artifacts, context and the PRD template', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, { git: (args) => { gitCalls.push(args) } })
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('# app')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('node_modules/')
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)              // retrofit ran
    expect(existsSync(join(dir, '.yoke', 'context', 'PROJECT.md'))).toBe(true) // context init ran
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8').trim().endsWith('[]')).toBe(true)
    expect(gitCalls[0]).toEqual(['init'])
    expect(gitCalls.some(a => a[0] === '-c' && a[2] === 'commit')).toBe(true) // initial commit
  })

  it('seeds PROJECT.md with the idea', () => {
    const dir = join(parent, 'app')
    runNew(dir, { ...noGit, idea: 'a todo cli', isAvailable: () => true, run: (inv: Invocation) => { writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD); return { success: true, summary: 'ok' } } })
    expect(readFileSync(join(dir, '.yoke', 'context', 'PROJECT.md'), 'utf8')).toContain('a todo cli')
  })

  it('with --idea drafts the PRD via the injected runner and commits twice', () => {
    const dir = join(parent, 'app')
    const gitCalls: string[][] = []
    const code = runNew(dir, {
      idea: 'a todo cli',
      git: (args) => { gitCalls.push(args) },
      isAvailable: () => true,
      run: (_inv: Invocation) => { writeFileSync(join(dir, '.yoke', 'prd.yaml'), VALID_PRD); return { success: true, summary: 'ok' } },
    })
    expect(code).toBe(0)
    const commits = gitCalls.filter(a => a.includes('commit'))
    expect(commits).toHaveLength(2)
  })

  it('keeps the template and returns non-zero when the draft fails', () => {
    const dir = join(parent, 'app')
    const code = runNew(dir, {
      idea: 'a todo cli',
      ...noGit,
      isAvailable: () => true,
      run: (_inv: Invocation) => ({ success: false, summary: 'boom' }),
    })
    expect(code).toBe(1)
    expect(readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8').trim().endsWith('[]')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/new/command.ts`:**

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Agent } from '../retrofit/config.js'
import { runRetrofit } from '../retrofit/command.js'
import { runContextInit } from '../context/command.js'
import { runPrdDraft, PRD_TEMPLATE, type PrdDraftOptions } from '../prd/command.js'

export interface RunNewOptions {
  idea?: string
  agents?: Agent[]
  runner?: Agent
  loop?: boolean
  timeoutMinutes?: number
  git?: (args: string[], cwd: string) => void
  isAvailable?: PrdDraftOptions['isAvailable']
  run?: PrdDraftOptions['run']
}

export function runNew(dir: string, opts: RunNewOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const target = resolve(dir)
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`${dir} already exists and is not empty — yoke new is greenfield-only (use yoke retrofit for existing projects).`)
    return 1
  }
  mkdirSync(target, { recursive: true })
  git(['init'], target)
  const name = basename(target)
  writeFileSync(join(target, 'README.md'), `# ${name}\n${opts.idea ? `\n${opts.idea}\n` : ''}`)
  writeFileSync(join(target, '.gitignore'), 'node_modules/\ndist/\n.env\n')
  runRetrofit(target, { loop: opts.loop ?? false, agents: opts.agents })
  runContextInit(target)
  if (opts.idea) {
    appendFileSync(join(target, '.yoke', 'context', 'PROJECT.md'), `\n## Idea\n\n${opts.idea}\n`)
  }
  writeFileSync(join(target, '.yoke', 'prd.yaml'), PRD_TEMPLATE)
  git(['add', '-A'], target)
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', `chore: bootstrap ${name} with yoke`], target)

  let code = 0
  if (opts.idea) {
    const draft = runPrdDraft(target, {
      idea: opts.idea,
      runner: opts.runner,
      timeoutMinutes: opts.timeoutMinutes,
      isAvailable: opts.isAvailable,
      run: opts.run,
    })
    if (draft === 0) {
      git(['add', '-A'], target)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'docs: draft PRD from idea'], target)
    } else {
      console.error(`PRD draft did not succeed. The project is ready anyway; retry with: yoke prd draft ${dir} --idea="..."`)
      code = draft
    }
  }

  console.log([
    `✓ ${name} bootstrapped.`,
    'Next steps:',
    '  1. Review .yoke/prd.yaml (or draft it: yoke prd draft --idea="...")',
    '  2. Set verify.command in .yoke/config.yaml (e.g. "npm test")',
    `  3. yoke loop on ${dir} && yoke loop run ${dir} --isolate`,
  ].join('\n'))
  return code
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/new` → PASS. Note: retrofit inside the test resolves the real bundled canon via `resolveCanonDir()` — the same mechanism `tests/retrofit/retrofit.integration.test.ts` relies on.

- [ ] **Step 5: Commit** — `feat(new): yoke new — greenfield bootstrap to loop-ready project`

---

### Task 8: Canon skill `authoring-prd`

**Files:**
- Create: `canon/skills/authoring-prd/SKILL.md`
- Modify: `canon/manifest.yaml`
- Test: `tests/canon/real-canon.test.ts` (add one assertion)

- [ ] **Step 1: Write the failing test** (append to `tests/canon/real-canon.test.ts`):

```ts
it('registers the authoring-prd skill', () => {
  const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
  expect(manifest.skills.some(s => s.id === 'authoring-prd')).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Create `canon/skills/authoring-prd/SKILL.md`:**

```markdown
---
name: authoring-prd
description: Use when turning a product idea into a loop-ready .yoke/prd.yaml — slice the idea into small, independently shippable stories with testable behavioral acceptance criteria; greenfield STORY-1 scaffolds the project and wires verify.command.
---

# Authoring a PRD

The Yoke loop is only as good as its stories. Bad stories ("build the app") stall it;
good stories (small, testable, ordered) let it run overnight.

## Story rules

1. **One iteration per story.** If you can't imagine an agent finishing it in one sitting,
   split it. Prefer 5-12 stories over 3 epics.
2. **Independently shippable.** After any story, the project builds and tests pass.
3. **Acceptance = observable behavior**, never implementation:
   - Good: "GET /health returns 200", "the CLI prints the sum of its arguments"
   - Bad: "create a HealthController class", "use express"
   2-5 criteria per story. Each must be checkable by a test or a command.
4. **Dense priorities from 1**; lower runs first. Order by dependency, then by risk.
5. **Greenfield: STORY-1 scaffolds.** Project skeleton + runnable test suite + a criterion
   that the verify command (`verify.command` in `.yoke/config.yaml`) exits 0. Every later
   story stands on a green pipeline.

## Format (`.yoke/prd.yaml`)

```yaml
- id: STORY-1
  title: scaffold a TypeScript CLI with vitest
  priority: 1
  acceptance:
    - "npm test exits 0 with at least one passing test"
    - "verify.command is set in .yoke/config.yaml"
  passes: false
- id: STORY-2
  title: add the sum command
  priority: 2
  acceptance:
    - "cli sum 1 2 prints 3"
    - "non-numeric input exits 1 with an error message"
  passes: false
```

`passes` is owned by the loop — always start `false`. Validate with `yoke prd check`.
```

- [ ] **Step 4: Register in `canon/manifest.yaml`** — append under the existing skills list:

```yaml
  # zero-to-100 bootstrap (kind: methodology)
  - { id: authoring-prd, path: skills/authoring-prd, kind: methodology }
```

- [ ] **Step 5: Run** — `npx vitest run tests/canon` → PASS (validateCanon must report zero errors — the frontmatter above matches the canon rules: `name` + one-line `description` starting with "Use when").

- [ ] **Step 6: Commit** — `feat(canon): authoring-prd skill (idea → loop-ready stories)`

---

### Task 9: CLI wiring + usage + README

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Test: existing suites (CLI dispatch is thin; behavior is covered by the module tests)

- [ ] **Step 1: Wire the commands in `src/cli.ts`.** Imports:

```ts
import { runNew } from './new/command.js'
import { runPrdDraft, runPrdCheck } from './prd/command.js'
import { runLoopCleanup } from './loop/cleanup.js'
```

New cases in `main()` (before `default`), plus one line in the existing `loop` case:

```ts
case 'new': {
  const dir = rest.find(a => !a.startsWith('-'))
  if (!dir) {
    console.error('usage: yoke new <dir> [--idea="..."] [--agent=claude,codex,gemini|all] [--runner=<claude|codex|gemini>] [--loop]')
    return 1
  }
  const idea = rest.find(a => a.startsWith('--idea='))?.slice('--idea='.length)
  const loop = rest.includes('--loop')
  const agentArg = rest.find(a => a.startsWith('--agent='))?.slice('--agent='.length)
  const all: Agent[] = ['claude', 'codex', 'gemini']
  const agents = !agentArg || agentArg === 'all'
    ? (agentArg === 'all' ? all : undefined)
    : agentArg.split(',').filter((a): a is Agent => (all as string[]).includes(a))
  const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
  if (runnerArg && !(all as string[]).includes(runnerArg)) {
    console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
    return 1
  }
  return runNew(dir, { idea, agents, runner: runnerArg as Agent | undefined, loop })
}
case 'prd': {
  const sub = rest[0]
  const targetDir = rest.slice(1).find(a => !a.startsWith('-')) ?? '.'
  if (sub === 'draft') {
    const idea = rest.find(a => a.startsWith('--idea='))?.slice('--idea='.length)
    if (!idea) {
      console.error('usage: yoke prd draft [dir] --idea="..." [--runner=<claude|codex|gemini>] [--force] [--timeout=<minutes>]')
      return 1
    }
    const valid = ['claude', 'codex', 'gemini']
    const runnerArg = rest.find(a => a.startsWith('--runner='))?.slice('--runner='.length)
    if (runnerArg && !valid.includes(runnerArg)) {
      console.error(`Invalid --runner value: ${runnerArg} (expected claude|codex|gemini)`)
      return 1
    }
    const force = rest.includes('--force')
    const toArg = rest.find(a => a.startsWith('--timeout='))
    let timeoutMinutes: number | undefined
    if (toArg) {
      const v = Number(toArg.slice('--timeout='.length))
      if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
      timeoutMinutes = v
    }
    return runPrdDraft(targetDir, { idea, runner: runnerArg as Agent | undefined, force, timeoutMinutes })
  }
  if (sub === 'check') return runPrdCheck(targetDir)
  console.log('usage: yoke prd <draft|check> [dir] [--idea="..."] [--runner=<claude|codex|gemini>] [--force] [--timeout=<minutes>]')
  return 1
}
```

In the `loop` case, next to the `on|off|status` one-liners:

```ts
if (sub === 'cleanup') return runLoopCleanup(targetDir)
```

…and add `cleanup` to the loop usage string. Update the `default` usage line to include
`new <dir> [--idea="..."]` and `prd <draft|check>`.

- [ ] **Step 2: README** (user rule: README moves with every change). Update:
  - Quickstart gains the greenfield path as the FIRST entry:

    ```
    # Greenfield: idea → loop-ready project in one command
    yoke new my-app --idea="a CLI that tracks reading lists"
    yoke loop on my-app && yoke loop run my-app --isolate
    ```
  - New section **`yoke new`** (scaffold, retrofit, context, PRD template/draft, two commits, exit codes) and **`yoke prd draft|check`** (overwrite guard, lint rules) — mirror the style of the existing `yoke review` section.
  - Loop section: document `yoke loop cleanup` and the `loop.lock` single-flight guard (`exit 2` + hint when another loop runs).
  - Skills table/count: add `authoring-prd` (26 → 27 skills wherever the count appears).
  - Update the test count badge/mentions to the real number after the full run (Step 3).

- [ ] **Step 3: Full verification** —

```
npx tsc --noEmit
npx vitest run --reporter=json --outputFile=.yoke-test.json
node -e "const r=require('./.yoke-test.json'); console.log('success', r.success, 'total', r.numTotalTests, 'failed', r.numFailedTests)"
node dist/cli.js validate canon   # after npm run build — zero errors
```

Delete `.yoke-test.json` afterwards. Put the real total into the README test count.

- [ ] **Step 4: Commit** — `feat(cli): wire new/prd/loop-cleanup; docs(readme): zero-to-100 quickstart`

---

## Self-review (done at plan time)

- Spec coverage: Part 1→Task 7, Part 2/2a→Task 4, Part 3→Task 5, Part 4→Task 6, Part 5→Tasks 2-3, Part 6→Task 8, CLI/README→Task 9. Cycle-breaker (Task 1) is plan-level necessity discovered against the spec.
- Deviation noted: real-canon has no count assertion; Task 8 adds a registration assertion (spec §Testing amended by this plan).
- Type consistency: `LockResult {acquired, holderPid?, stalePid?}` used identically in Tasks 2/3/6; `PrdDraftOptions` seams reused by `RunNewOptions` in Task 7; `prdFile` only used within `src/prd/command.ts`.
