# Baustein G — Loop Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous loop observable (token-free console + `.yoke/loop-status.json` + `.yoke/loop.log`) and self-limiting (an idle-timeout watchdog that kills only truly silent agents), so a blocked or hung run is visible at a glance instead of stalling invisibly.

**Architecture:** A new injectable `LoopReporter` narrates each story phase to three harness-side channels (all Node, zero agent tokens). A standalone `watchdog.ts` wraps the agent process and kills it only after N minutes of *no output* (idle, not total runtime), keeping the loop synchronous. `yoke loop status` reads the status file. Retrofit gains a `.gitignore` manager so the runtime files don't break the clean-tree gate.

**Tech Stack:** Node.js + TypeScript (ESM, `.js` import specifiers, `moduleResolution: Bundler`), vitest, zod (existing). Run tests: `npx vitest run <path>`; types: `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/loop/reporter.ts` (create) | `LoopState`/`LoopPhase`/`LoopStatus` types, `writeStatus`/`readStatus` (atomic), `LoopReporter` interface, `makeReporter` (console+file+log), `noopReporter` |
| `src/loop/watchdog.ts` (create) | `runWatchdog` core (injectable spawn) + CLI entry; idle-timeout wrapper |
| `src/loop/runner.ts` (modify) | `Invocation.idleTimeoutMs`; route through watchdog; thread into `makeRunner`/`makeReviewRunner` |
| `src/loop/loop.ts` (modify) | Drive the reporter at each phase; enrich `blocked` reason with leftover hint |
| `src/loop/run-command.ts` (modify) | Resolve idle timeout; build reporter + runners; upgrade `loopStatus` output |
| `src/retrofit/config.ts` (modify) | optional `loop.timeoutMinutes` |
| `src/retrofit/gitignore.ts` (create) | `ensureGitignore(targetDir, block)` — idempotent managed-block append |
| `src/retrofit/plan.ts` or `cli.ts` (modify) | call `ensureGitignore` during retrofit |
| `src/cli.ts` (modify) | parse `--timeout=<minutes>` on `yoke loop run` |
| `README.md` (modify) | document status/log + `--timeout` |

**Constants:** `DEFAULT_IDLE_MINUTES = 20` (in `run-command.ts`).

---

### Task 1: reporter — status types + atomic read/write

**Files:** Create `src/loop/reporter.ts`; Test `tests/loop/reporter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/loop/reporter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus, readStatus, type LoopStatus } from '../../src/loop/reporter.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-rep-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sample: LoopStatus = {
  state: 'running', phase: 'implementing', story: 'S1', storyTitle: 'First',
  iteration: 1, progress: { passed: 0, total: 2 },
  startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z',
}

describe('writeStatus / readStatus', () => {
  it('returns null when no status file exists', () => {
    expect(readStatus(dir)).toBeNull()
  })
  it('round-trips a status through .yoke/loop-status.json', () => {
    writeStatus(dir, sample)
    expect(readStatus(dir)).toEqual(sample)
  })
  it('overwrites in place and leaves no temp file behind', () => {
    writeStatus(dir, sample)
    writeStatus(dir, { ...sample, phase: 'verifying' })
    expect(readStatus(dir)?.phase).toBe('verifying')
    const leftovers = readdirSync(join(dir, '.yoke')).filter(f => f.includes('.tmp'))
    expect(leftovers).toEqual([])
  })
  it('returns null on a corrupt status file', () => {
    writeFileSync(join(dir, '.yoke', 'loop-status.json'), '{ not json')
    expect(readStatus(dir)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/reporter.test.ts`
Expected: FAIL — `Cannot find module '../../src/loop/reporter.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/loop/reporter.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export type LoopState = 'running' | 'blocked' | 'complete' | 'cap-reached'
export type LoopPhase = 'implementing' | 'verifying' | 'reviewing' | 'committing'

export interface LoopStatus {
  state: LoopState
  phase?: LoopPhase
  story?: string
  storyTitle?: string
  reason?: string
  iteration: number
  progress: { passed: number; total: number }
  startedAt: string
  updatedAt: string
}

function statusPath(dir: string): string {
  return join(dir, '.yoke', 'loop-status.json')
}

export function writeStatus(dir: string, status: LoopStatus): void {
  const file = statusPath(dir)
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(status, null, 2))
  renameSync(tmp, file) // atomic replace
}

export function readStatus(dir: string): LoopStatus | null {
  const file = statusPath(dir)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LoopStatus
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loop/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/loop/reporter.ts tests/loop/reporter.test.ts
git commit -m "feat(loop): LoopStatus types + atomic writeStatus/readStatus"
```

---

### Task 2: reporter — LoopReporter (console + status + log)

**Files:** Modify `src/loop/reporter.ts`; Test `tests/loop/reporter.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```typescript
import { readFileSync, existsSync } from 'node:fs'
import { makeReporter, noopReporter, type LoopReporter } from '../../src/loop/reporter.js'

const fixedNow = () => new Date('2026-06-29T10:00:00.000Z')
const prog = { passed: 0, total: 2 }

describe('makeReporter', () => {
  it('writes running state + a log line + console line on storyStart', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s) }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    const st = readStatus(dir)!
    expect(st.state).toBe('running')
    expect(st.phase).toBe('implementing')
    expect(st.story).toBe('S1')
    expect(lines.join('\n')).toContain('S1')
    const log = readFileSync(join(dir, '.yoke', 'loop.log'), 'utf8')
    expect(log).toContain('implementing')
    expect(log).toContain('S1')
  })
  it('phase() updates phase but keeps story', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.phase('verifying')
    expect(readStatus(dir)).toMatchObject({ state: 'running', phase: 'verifying', story: 'S1' })
  })
  it('blocked() records state + reason', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.blocked('verify failed')
    expect(readStatus(dir)).toMatchObject({ state: 'blocked', reason: 'verify failed' })
  })
  it('complete() records state + final progress', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.complete({ passed: 2, total: 2 })
    expect(readStatus(dir)).toMatchObject({ state: 'complete', progress: { passed: 2, total: 2 } })
  })
  it('quiet suppresses the console callback but still writes files', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s), quiet: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    expect(lines).toEqual([])
    expect(readStatus(dir)?.story).toBe('S1')
  })
})

describe('noopReporter', () => {
  it('does nothing and writes no files', () => {
    noopReporter.storyStart({ id: 'S1', title: 'x' }, 1, prog)
    noopReporter.blocked('x')
    expect(existsSync(join(dir, '.yoke', 'loop-status.json'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/reporter.test.ts`
Expected: FAIL — `makeReporter`/`noopReporter` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/loop/reporter.ts`)

```typescript
import { appendFileSync } from 'node:fs'

export interface StoryRef { id: string; title: string }
export interface Progress { passed: number; total: number }

export interface LoopReporter {
  storyStart(story: StoryRef, iteration: number, progress: Progress): void
  phase(phase: LoopPhase): void
  blocked(reason: string): void
  complete(progress: Progress): void
  capReached(progress: Progress): void
}

export interface ReporterOpts {
  log?: (line: string) => void   // console sink (defaults to process.stdout)
  quiet?: boolean
}

export function makeReporter(
  dir: string,
  opts: ReporterOpts = {},
  now: () => Date = () => new Date(),
): LoopReporter {
  const sink = opts.log ?? ((line: string) => process.stdout.write(line + '\n'))
  const emitConsole = (line: string) => { if (!opts.quiet) sink(line) }
  let current: LoopStatus | null = null

  const persist = (next: LoopStatus, logLabel: string, consoleLine: string) => {
    current = next
    try {
      writeStatus(dir, next)
      mkdirSync(join(dir, '.yoke'), { recursive: true })
      appendFileSync(
        join(dir, '.yoke', 'loop.log'),
        `${next.updatedAt}  ${logLabel}  ${next.story ?? '-'}  ${next.reason ?? ''}`.trimEnd() + '\n',
      )
    } catch { /* observability must never abort the loop */ }
    emitConsole(consoleLine)
  }

  return {
    storyStart(story, iteration, progress) {
      const ts = now().toISOString()
      persist(
        { state: 'running', phase: 'implementing', story: story.id, storyTitle: story.title,
          iteration, progress, startedAt: ts, updatedAt: ts },
        'implementing',
        `▶ ${story.id} (${progress.passed}/${progress.total}) — implementing…`,
      )
    },
    phase(phase) {
      if (!current) return
      persist({ ...current, phase, updatedAt: now().toISOString() }, phase, `  · ${phase}…`)
    },
    blocked(reason) {
      const base = current ?? emptyStatus(now().toISOString())
      persist({ ...base, state: 'blocked', reason, updatedAt: now().toISOString() },
        'blocked', `■ blocked on ${base.story ?? '?'}: ${reason}`)
    },
    complete(progress) {
      persist({ ...(current ?? emptyStatus(now().toISOString())), state: 'complete', phase: undefined,
        progress, reason: undefined, updatedAt: now().toISOString() },
        'complete', `✔ loop complete — ${progress.passed}/${progress.total}`)
    },
    capReached(progress) {
      persist({ ...(current ?? emptyStatus(now().toISOString())), state: 'cap-reached', phase: undefined,
        progress, updatedAt: now().toISOString() },
        'cap-reached', `◾ iteration cap reached — ${progress.passed}/${progress.total}`)
    },
  }
}

function emptyStatus(ts: string): LoopStatus {
  return { state: 'running', iteration: 0, progress: { passed: 0, total: 0 }, startedAt: ts, updatedAt: ts }
}

export const noopReporter: LoopReporter = {
  storyStart() {}, phase() {}, blocked() {}, complete() {}, capReached() {},
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loop/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/loop/reporter.ts tests/loop/reporter.test.ts
git commit -m "feat(loop): LoopReporter writing console + loop-status.json + loop.log"
```

---

### Task 3: watchdog — idle-timeout wrapper

**Files:** Create `src/loop/watchdog.ts`; Test `tests/loop/watchdog.test.ts`

The core `runWatchdog` takes an injectable spawn so timing logic is unit-tested with fake timers; the CLI entry wires real spawn + process streams.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/loop/watchdog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { runWatchdog, type SpawnLike } from '../../src/loop/watchdog.js'

function fakeChild() {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { }
  child.kill = vi.fn()
  child.pid = 4242
  return child
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('runWatchdog', () => {
  it('does NOT kill while the child keeps emitting output, and passes its exit code', async () => {
    const child = fakeChild()
    const spawnFn: SpawnLike = () => child
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn, stdin: new EventEmitter() as any })
    // emit every 50ms for 300ms — never idle for 100ms
    for (let t = 0; t < 300; t += 50) { vi.advanceTimersByTime(50); child.stdout.emit('data', Buffer.from('x')) }
    child.emit('close', 0)
    await expect(p).resolves.toBe(0)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills a silent child after the idle window and resolves 124', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn: () => child, stdin: new EventEmitter() as any })
    vi.advanceTimersByTime(150)        // no output for >100ms
    expect(child.kill).toHaveBeenCalled()
    child.emit('close', null)          // child dies after kill
    await expect(p).resolves.toBe(124)
  })

  it('with idleMs=0 never starts a timer and passes the exit code through', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 0, spawnFn: () => child, stdin: new EventEmitter() as any })
    vi.advanceTimersByTime(10_000)
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('close', 3)
    await expect(p).resolves.toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/watchdog.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/loop/watchdog.ts
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'

export interface SpawnLike {
  (command: string, args: string[], opts: { shell: boolean }): {
    stdout: { on(ev: 'data', cb: (d: unknown) => void): void }
    stderr: { on(ev: 'data', cb: (d: unknown) => void): void }
    stdin: unknown
    kill(signal?: string): void
    pid?: number
    on(ev: 'close', cb: (code: number | null) => void): void
    on(ev: 'error', cb: (e: Error) => void): void
  }
}

export interface WatchdogOpts {
  command: string
  args: string[]
  idleMs: number
  spawnFn?: SpawnLike
  stdin?: Readable
  out?: (d: unknown) => void
  err?: (d: unknown) => void
}

// Run `command args`, forwarding stdin in and stdout/stderr out. Reset an idle
// timer on every output chunk; if no output for idleMs, kill the child and
// resolve 124. idleMs<=0 disables the timer. Resolves the child's exit code.
export function runWatchdog(opts: WatchdogOpts): Promise<number> {
  const spawnFn = opts.spawnFn ?? (spawn as unknown as SpawnLike)
  const out = opts.out ?? ((d) => process.stdout.write(d as Buffer))
  const err = opts.err ?? ((d) => process.stderr.write(d as Buffer))
  const child = spawnFn(opts.command, opts.args, { shell: process.platform === 'win32' })

  if (opts.stdin && (child.stdin as { } )) {
    try { (opts.stdin as Readable).pipe(child.stdin as never) } catch { /* no stdin */ }
  }

  return new Promise<number>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let killedForIdle = false
    const clear = () => { if (timer) { clearTimeout(timer); timer = undefined } }
    const arm = () => {
      if (opts.idleMs <= 0) return
      clear()
      timer = setTimeout(() => {
        killedForIdle = true
        try { child.kill('SIGTERM') } catch { /* already gone */ }
      }, opts.idleMs)
    }
    child.stdout.on('data', (d) => { out(d); arm() })
    child.stderr.on('data', (d) => { err(d); arm() })
    child.on('error', () => { clear(); resolve(127) })
    child.on('close', (code) => { clear(); resolve(killedForIdle ? 124 : (code ?? 0)) })
    arm() // start the clock so a child that emits nothing is still bounded
  })
}

// CLI: node watchdog.js --idle-ms=N -- <command> [args...]
export function parseWatchdogArgs(argv: string[]): { idleMs: number; command: string; args: string[] } {
  const sep = argv.indexOf('--')
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const rest = sep === -1 ? [] : argv.slice(sep + 1)
  const idleArg = flags.find((a) => a.startsWith('--idle-ms='))
  const idleMs = idleArg ? Number(idleArg.slice('--idle-ms='.length)) : 0
  const [command, ...args] = rest
  return { idleMs: Number.isFinite(idleMs) ? idleMs : 0, command: command ?? '', args }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  const { idleMs, command, args } = parseWatchdogArgs(process.argv.slice(2))
  if (!command) { process.stderr.write('watchdog: no command given\n'); process.exit(2) }
  runWatchdog({ command, args, idleMs, stdin: process.stdin }).then((code) => process.exit(code))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/loop/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Add a parse unit test + commit**

```typescript
// append to tests/loop/watchdog.test.ts
import { parseWatchdogArgs } from '../../src/loop/watchdog.js'
describe('parseWatchdogArgs', () => {
  it('splits flags from the command after --', () => {
    expect(parseWatchdogArgs(['--idle-ms=500', '--', 'claude', '-p'])).toEqual({ idleMs: 500, command: 'claude', args: ['-p'] })
  })
  it('defaults idleMs to 0 when absent', () => {
    expect(parseWatchdogArgs(['--', 'node']).idleMs).toBe(0)
  })
})
```
Run: `npx vitest run tests/loop/watchdog.test.ts` → PASS, then:
```bash
git add src/loop/watchdog.ts tests/loop/watchdog.test.ts
git commit -m "feat(loop): idle-timeout watchdog (kills only on no-output, not total runtime)"
```

---

### Task 4: runner — route the agent through the watchdog

**Files:** Modify `src/loop/runner.ts`; Test `tests/loop/runner.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```typescript
import { buildWatchdogInvocation } from '../../src/loop/runner.js'

describe('idle-timeout wiring', () => {
  it('wraps the agent command in the watchdog when idleTimeoutMs > 0', () => {
    const inv = buildWatchdogInvocation({ command: 'claude', args: ['-p'], input: 'hi', cwd: '.' }, 1200000)
    expect(inv.command).toBe('node')
    expect(inv.args.join(' ')).toContain('watchdog.js')
    expect(inv.args.join(' ')).toContain('--idle-ms=1200000')
    expect(inv.args.join(' ')).toContain('-- claude -p')   // original command after --
    expect(inv.input).toBe('hi')
  })
  it('returns the invocation unchanged when idleTimeoutMs is 0', () => {
    const base = { command: 'claude', args: ['-p'], input: 'hi', cwd: '.' }
    expect(buildWatchdogInvocation(base, 0)).toEqual(base)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/runner.test.ts`
Expected: FAIL — `buildWatchdogInvocation` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/loop/runner.ts` add the import and helper (near `agentInvocation`):
```typescript
import { fileURLToPath } from 'node:url'

function watchdogPath(): string {
  // runner.js and watchdog.js sit side by side in dist/loop/ (and src/loop/ under tsx)
  return fileURLToPath(new URL('./watchdog.js', import.meta.url))
}

// When idleTimeoutMs > 0, run the agent THROUGH the watchdog so a silent hang is
// killed after idleTimeoutMs of no output. The prompt still flows via stdin.
export function buildWatchdogInvocation(inv: Invocation, idleTimeoutMs: number): Invocation {
  if (idleTimeoutMs <= 0) return inv
  return {
    command: 'node',
    args: [watchdogPath(), `--idle-ms=${idleTimeoutMs}`, '--', inv.command, ...inv.args],
    input: inv.input,
    cwd: inv.cwd,
  }
}
```

Thread an optional `idleTimeoutMs` into the runner factories. Change `makeRunner` and `makeReviewRunner` signatures:
```typescript
export function makeRunner(agent: Agent, idleTimeoutMs = 0): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const base = agentInvocation(agent, buildClaudePrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    try {
      runCli(inv)
      return { success: true, summary: `${agent} implemented ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} failed on ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}

export function makeReviewRunner(agent: Agent, idleTimeoutMs = 0): AgentRunner {
  return (ctx: AgentContext): AgentResult => {
    const base = agentInvocation(agent, buildReviewPrompt(ctx.story, contextBlockFor(ctx.targetDir)), ctx.targetDir)
    const inv = buildWatchdogInvocation(base, idleTimeoutMs)
    try {
      runCli(inv)
      return { success: true, summary: `${agent} approved ${ctx.story.id}` }
    } catch (e) {
      return { success: false, summary: `${agent} rejected ${ctx.story.id}: ${(e as Error).message}` }
    }
  }
}
```
`claudeRunner` stays `makeRunner('claude')` (idle 0 → unchanged behavior).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loop/runner.test.ts`
Expected: PASS (new + existing runner tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts tests/loop/runner.test.ts
git commit -m "feat(loop): route agent + reviewer runs through the idle watchdog"
```

---

### Task 5: loop — drive the reporter + leftover hint

**Files:** Modify `src/loop/loop.ts`; Test `tests/loop/loop.test.ts`

- [ ] **Step 1: Write the failing test** (append; reuses existing `dir`, `prd()`, fakes)

```typescript
import { makeReporter, type LoopReporter } from '../../src/loop/reporter.js'

function recordingReporter(): { reporter: LoopReporter; events: string[] } {
  const events: string[] = []
  const reporter: LoopReporter = {
    storyStart: (s) => events.push(`start:${s.id}`),
    phase: (p) => events.push(`phase:${p}`),
    blocked: (r) => events.push(`blocked:${r}`),
    complete: () => events.push('complete'),
    capReached: () => events.push('cap'),
  }
  return { reporter, events }
}

it('drives the reporter through phases on success and reports complete', () => {
  const { reporter, events } = recordingReporter()
  runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, maxIterations: 10, reporter })
  expect(events).toContain('start:S1')
  expect(events).toContain('phase:verifying')
  expect(events).toContain('phase:committing')
  expect(events[events.length - 1]).toBe('complete')
})

it('reports blocked with a leftover hint when the tree is dirty after a block', () => {
  const { reporter, events } = recordingReporter()
  const dirtyAfter: GitOps = { isClean: () => false, commitAll: () => { throw new Error('boom') }, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
  runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: dirtyAfter, verify: verifyOk, maxIterations: 10, reporter })
  const blocked = events.find(e => e.startsWith('blocked:'))!
  expect(blocked).toMatch(/uncommitted changes/i)
})
```
Note: the dirty-tree block path — the commit throws, the loop reverts and returns blocked; the reporter's `blocked` reason should carry the leftover hint because `git.isClean` is false. (The pre-dispatch gate runs at the top of the NEXT iteration; for this test the first iteration reaches the commit and fails there.) If `isClean:()=>false` also trips the pre-dispatch gate first, adjust the fake so `isClean` returns true for the gate then false after — simplest: keep a counter. Implement the fake as: first call (pre-dispatch) true, later false. Use a closure counter so the gate passes but the post-block leftover check sees dirty.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: FAIL — `LoopOptions` has no `reporter`; events empty.

- [ ] **Step 3: Write minimal implementation**

In `src/loop/loop.ts`:
- Import: `import { noopReporter, type LoopReporter } from './reporter.js'`
- Add `reporter?: LoopReporter` to `LoopOptions`. At the top of `runLoop`, `const reporter = opts.reporter ?? noopReporter`.
- Add a helper for the block path:
```typescript
function blockReason(base: string, targetDir: string, git: GitOps): string {
  let dirty = false
  try { dirty = !git.isClean(targetDir) } catch { /* ignore */ }
  return dirty
    ? `${base} (working tree has uncommitted changes from the blocked story — review/clean before re-running)`
    : base
}
```
- Call the reporter at each boundary. Wherever the loop currently `return { status: 'blocked', ... reason }`, first call `reporter.blocked(blockReason(reason, opts.targetDir, opts.git))` (use the same string in the return `reason`). Wherever it returns `complete`, call `reporter.complete(progress(stories))`; for `cap-reached`, `reporter.capReached(...)`. After selecting a story (both isolate and non-isolate paths), call `reporter.storyStart({ id: story.id, title: story.title }, iterations + 1, progress(stories))` before dispatch; call `reporter.phase('verifying')` before `opts.verify(...)`, `reporter.phase('reviewing')` before the review call, and `reporter.phase('committing')` before `appendDecision`/`commitAll`.

Apply to BOTH the isolate and non-isolate branches. Keep the returned `reason` strings identical to what `reporter.blocked` was given (so console and return value agree). Example for the non-isolate verify-fail:
```typescript
const verdict = opts.verify(opts.targetDir)
if (!verdict.passed) {
  const reason = blockReason(`story ${story.id} did not verify: ${verdict.summary}`, opts.targetDir, opts.git)
  reporter.blocked(reason)
  return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loop/loop.test.ts`
Expected: PASS (new + all existing loop tests — existing ones use no `reporter`, so `noopReporter` keeps them green).

- [ ] **Step 5: Commit**

```bash
git add src/loop/loop.ts tests/loop/loop.test.ts
git commit -m "feat(loop): narrate phases via LoopReporter + leftover hint on block"
```

---

### Task 6: run-command + cli — resolve timeout, wire reporter, upgrade `loop status`

**Files:** Modify `src/loop/run-command.ts`, `src/cli.ts`; Test `tests/loop/run-command` coverage via a new `tests/loop/loop-status-render.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/loop/loop-status-render.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus } from '../../src/loop/reporter.js'
import { loopStatus } from '../../src/loop/run-command.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-ls-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'config.yaml'), 'canonVersion: "0.1.0"\nagents: [claude]\nloop:\n  enabled: true\n')
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: S1, title: t, priority: 1, acceptance: ["x"], passes: true }')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loopStatus with a status file', () => {
  it('renders state, story and reason when blocked', () => {
    writeStatus(dir, { state: 'blocked', story: 'S5', storyTitle: 'Schemas', reason: 'verify failed',
      iteration: 19, progress: { passed: 18, total: 45 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const out = loopStatus(dir)
    expect(out).toMatch(/blocked/i)
    expect(out).toContain('S5')
    expect(out).toContain('verify failed')
    expect(out).toContain('18/45')
  })
  it('falls back to enabled + PRD progress when no status file exists', () => {
    const out = loopStatus(dir)
    expect(out).toMatch(/enabled/i)
    expect(out).toMatch(/1\/1/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/loop-status-render.test.ts`
Expected: FAIL — `loopStatus` does not yet read the status file.

- [ ] **Step 3: Implement** in `src/loop/run-command.ts`

Add imports:
```typescript
import { readStatus, makeReporter } from './reporter.js'
export const DEFAULT_IDLE_MINUTES = 20
```
Replace `loopStatus` with a version that prefers the status file:
```typescript
export function loopStatus(targetDir: string): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  const st = readStatus(targetDir)
  if (!st) return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}`
  const lines = [
    `Loop: ${st.state.toUpperCase()}${st.story ? ` on ${st.story}${st.storyTitle ? ` "${st.storyTitle}"` : ''}` : ''}`,
  ]
  const meta = [st.phase, `iteration ${st.iteration}`, `${st.progress.passed}/${st.progress.total}`,
    `updated ${st.updatedAt}`].filter(Boolean).join(' · ')
  lines.push(`  ${meta}`)
  if (st.reason) lines.push(`  reason: ${st.reason}`)
  return lines.join('\n')
}
```
Add the timeout resolution + reporter/runner wiring in `runLoopCommand`. Extend `RunLoopCommandOptions` with `timeoutMinutes?: number`. After resolving `runnerAgent` and before building runners:
```typescript
const idleMinutes = opts.timeoutMinutes ?? config.loop.timeoutMinutes ?? DEFAULT_IDLE_MINUTES
const idleMs = idleMinutes > 0 ? idleMinutes * 60_000 : 0
```
Build runners with the idle budget (only when not injected for tests):
```typescript
runner = makeRunner(runnerAgent, idleMs)
// ...
review = makeReviewRunner(reviewerAgent, idleMs)
```
Pass a real reporter into `runLoop`:
```typescript
const result = runLoop({
  prdPath: path, targetDir, runner, git: opts.git ?? realGitOps, verify,
  maxIterations: opts.maxIterations, isolate: opts.isolate ?? false, review,
  reporter: opts.reporter ?? makeReporter(targetDir),
})
```
Add `reporter?: LoopReporter` (import the type) and `timeoutMinutes?: number` to `RunLoopCommandOptions`.

- [ ] **Step 4: Wire the CLI flag** in `src/cli.ts` (inside the `loop run` branch, mirror `--max` parsing):
```typescript
const toArg = rest.find(a => a.startsWith('--timeout='))
let timeoutMinutes: number | undefined
if (toArg) {
  const v = Number(toArg.slice('--timeout='.length))
  if (!Number.isFinite(v) || v < 0) { console.error(`Invalid --timeout value: ${toArg}`); return 1 }
  timeoutMinutes = v
}
```
and pass `timeoutMinutes` into the `runLoopCommand(targetDir, { ... })` call. Add `--timeout=<minutes>` to the `loop` usage strings.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/loop/ && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/loop/run-command.ts src/cli.ts tests/loop/loop-status-render.test.ts
git commit -m "feat(loop): resolve idle timeout, wire reporter, upgrade yoke loop status"
```

---

### Task 7: config — optional `loop.timeoutMinutes`

**Files:** Modify `src/retrofit/config.ts`; Test `tests/retrofit/config.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```typescript
it('accepts an optional loop.timeoutMinutes', () => {
  const cfg = { canonVersion: '0.1.0', agents: ['claude'], loop: { enabled: true, timeoutMinutes: 30 } }
  const parsed = YokeConfigSchema.parse(cfg)
  expect(parsed.loop.timeoutMinutes).toBe(30)
})
it('still accepts a loop without timeoutMinutes', () => {
  const parsed = YokeConfigSchema.parse({ canonVersion: '0.1.0', agents: [], loop: { enabled: false } })
  expect(parsed.loop.timeoutMinutes).toBeUndefined()
})
```
(If `YokeConfigSchema` isn't exported, export it, or assert via `loadConfig` against a temp file — match the file's existing idiom.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/config.test.ts`
Expected: FAIL — `timeoutMinutes` rejected/stripped.

- [ ] **Step 3: Implement** — update the schema + interface in `src/retrofit/config.ts`:
```typescript
const YokeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({ enabled: z.boolean(), timeoutMinutes: z.number().nonnegative().optional() }),
  verify: z.object({ command: z.string().min(1) }).optional(),
  codeGraph: CodeGraphSchema.optional(),
})

export interface YokeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean; timeoutMinutes?: number }
  verify?: { command: string }
  codeGraph?: CodeGraph
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/retrofit/config.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/retrofit/config.ts tests/retrofit/config.test.ts
git commit -m "feat(config): optional loop.timeoutMinutes (idle minutes)"
```

---

### Task 8: retrofit — `.gitignore` manager for `.yoke/` runtime files

**Files:** Create `src/retrofit/gitignore.ts`; Modify `src/cli.ts` (`runRetrofit`); Test `tests/retrofit/gitignore.test.ts`

This closes a real gap: retrofit never managed the target `.gitignore`, so `.yoke/loop-status.json` / `.yoke/loop.log` (and `worktrees`/`backup`) would dirty the tree and break the clean-tree gate.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/retrofit/gitignore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureGitignore, YOKE_IGNORE_LINES } from '../../src/retrofit/gitignore.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-gi-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const gi = () => join(dir, '.gitignore')

describe('ensureGitignore', () => {
  it('creates .gitignore with the managed block when absent', () => {
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    for (const line of YOKE_IGNORE_LINES) expect(text).toContain(line)
  })
  it('appends the block without disturbing existing content', () => {
    writeFileSync(gi(), 'node_modules/\n')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).toContain('node_modules/')
    expect(text).toContain('.yoke/loop-status.json')
  })
  it('is idempotent — a second run adds nothing', () => {
    ensureGitignore(dir)
    const first = readFileSync(gi(), 'utf8')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toBe(first)
  })
  it('does not re-add a line that already exists individually', () => {
    writeFileSync(gi(), '.yoke/backup/\n')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text.match(/\.yoke\/backup\//g)?.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrofit/gitignore.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/retrofit/gitignore.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const YOKE_IGNORE_LINES = [
  '.yoke/worktrees/',
  '.yoke/backup/',
  '.yoke/loop-status.json',
  '.yoke/loop.log',
]

const HEADER = '# Yoke runtime artifacts (managed by yoke retrofit)'

// Idempotently ensure each Yoke runtime path is gitignored. Appends only the
// lines that are not already present (matched verbatim, line-wise). Preserves
// all existing content. Returns true if the file changed.
export function ensureGitignore(targetDir: string): boolean {
  const file = join(targetDir, '.gitignore')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const present = new Set(current.split(/\r?\n/).map((l) => l.trim()))
  const missing = YOKE_IGNORE_LINES.filter((l) => !present.has(l))
  if (missing.length === 0) return false
  const prefix = current === '' ? '' : current.endsWith('\n') ? '' : '\n'
  const block = `${prefix}${current === '' ? '' : '\n'}${HEADER}\n${missing.join('\n')}\n`
  writeFileSync(file, current + block)
  return true
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/retrofit/gitignore.test.ts` → PASS.

- [ ] **Step 5: Wire into retrofit** — in `src/cli.ts` `runRetrofit`, after `applyActions(...)` and before `saveConfig`/report, add:
```typescript
import { ensureGitignore } from './retrofit/gitignore.js'
// ...
ensureGitignore(targetDir)
```
(Place the import with the other retrofit imports.)

- [ ] **Step 6: Run the full suite + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, clean.
```bash
git add src/retrofit/gitignore.ts src/cli.ts tests/retrofit/gitignore.test.ts
git commit -m "feat(retrofit): manage .gitignore for .yoke runtime files (status/log/worktrees/backup)"
```

---

### Task 9: docs — README loop observability

**Files:** Modify `README.md`

- [ ] **Step 1: Update the autonomous-loop section** — add after the `yoke loop ...` example block:
```markdown
### Watching a run

Every iteration writes token-free, harness-side feedback:

- **Live console** — `▶ S6 (19/45) — implementing… · verifying… ✔ committed`.
- **`.yoke/loop-status.json`** — the current state; read it with `yoke loop status`:
  ```
  Loop: BLOCKED on S5 "Segment schemas"
    verifying · iteration 19 · 18/45 · updated 2026-06-29T10:00:00Z
    reason: story did not verify (working tree has uncommitted changes — clean before re-running)
  ```
- **`.yoke/loop.log`** — an append-only timeline of every phase transition.

A per-iteration **idle timeout** guards against a genuinely hung agent: if the agent
produces *no output at all* for `--timeout` minutes (default 20; `0` disables), the loop
kills it and marks the story blocked. A slow-but-working agent that keeps streaming output
is never killed — the output stream is the liveness signal. Set a project default with
`loop.timeoutMinutes` in `.yoke/config.yaml`.

`.yoke/loop-status.json` and `.yoke/loop.log` are runtime artifacts; `yoke retrofit`
gitignores them so they never trip the clean-tree gate.
```

- [ ] **Step 2: Verify nothing references removed symbols** — `npx vitest run` → PASS.

- [ ] **Step 3: Commit**
```bash
git add README.md
git commit -m "docs: document loop observability (status, log, idle timeout)"
```

---

## Self-Review

**Spec coverage:**
- Status types + atomic read/write → Task 1.
- LoopReporter (console + status + log), zero-token feedback → Task 2.
- Idle watchdog (kills only on no-output, not total runtime) → Task 3.
- Runner routes agent + reviewer through the watchdog; `idleTimeoutMs` resolution → Tasks 4 & 6.
- Loop drives the reporter at each phase + leftover hint → Task 5.
- `yoke loop status` upgrade with fallback → Task 6.
- `--timeout` flag + resolution (flag > config > 20) → Tasks 6 & 7.
- `loop.timeoutMinutes` config → Task 7.
- gitignore so runtime files don't break the clean-tree gate → Task 8 (also fixes the pre-existing worktrees/backup gap).
- Docs → Task 9.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The Task 5 fake-Git note explains the closure-counter for the dirty-after-block case explicitly rather than hand-waving.

**Type consistency:** `LoopStatus`/`LoopPhase`/`LoopReporter`/`StoryRef`/`Progress`, `makeReporter(dir, opts, now)`, `noopReporter`, `runWatchdog`/`parseWatchdogArgs`/`SpawnLike`, `buildWatchdogInvocation(inv, idleTimeoutMs)`, `makeRunner(agent, idleTimeoutMs)`, `ensureGitignore`/`YOKE_IGNORE_LINES`, `loop.timeoutMinutes`, `DEFAULT_IDLE_MINUTES` are defined once and referenced consistently. The `Invocation` shape (`{command,args,input,cwd}`) is unchanged; the watchdog wrapping produces a new `Invocation` of the same shape.

**Integration note:** the clean-tree gate concern is covered by Task 8 (gitignore). Existing downstream projects must re-run `yoke retrofit` (or add the four lines manually) to benefit — documented in Task 9.
