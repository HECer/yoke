import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock } from '../../src/loop/lock.js'
import { accountRunIterations, createLoopRun, readRunState, writeRunState, recordGoalRun } from '../../src/loop/run-state.js'
import { noopReporter } from '../../src/loop/reporter.js'
import { runLoopCommand, resumeLoopCommand } from '../../src/loop/run-command.js'
import { requestLoopPause } from '../../src/loop/loop.js'
import { readLock } from '../../src/loop/lock.js'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function root() { const dir = mkdtempSync(join(tmpdir(), 'yoke-run-state-')); roots.push(dir); return dir }
it('persists only safe bounded options and the original exploration deadline under the lock', () => {
  const dir = root(); const lock = acquireLock(dir)
  const run = createLoopRun({ explore: true, exploreLimitMs: 1000, agent: 'codex', selection: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high', bare: true }, maxIterations: 3, permissions: 'unsafe', runner: () => ({ success: true }) }, 100)
  writeRunState(dir, run, lock.ownerToken)
  expect(readRunState(dir)).toMatchObject({ mode: 'explore', exploreDeadline: 1100, options: { agent: 'codex', selection: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high', bare: true }, maxIterations: 3 } })
  expect(readFileSync(join(dir, '.yoke/run-state.json'), 'utf8')).not.toMatch(/permissions|runner|exploreLimitMs/)
  releaseLock(dir, lock.ownerToken)
  expect(() => writeRunState(dir, run, lock.ownerToken)).toThrow(/lock/i)
})
it('rejects malformed or oversized saved options instead of resuming another mode', () => {
  const dir = root(); const lock = acquireLock(dir)
  writeFileSync(join(dir, '.yoke/run-state.json'), JSON.stringify({ version: 1, runId: 'bad', mode: 'explore', options: { maxIterations: -1 } }))
  expect(() => readRunState(dir)).toThrow()
  writeFileSync(join(dir, '.yoke/run-state.json'), 'x'.repeat(65537))
  expect(() => readRunState(dir)).toThrow(/large/)
  releaseLock(dir, lock.ownerToken)
})
it('records the actual goal identity rather than selecting a stale unfinished goal', () => {
  const dir = root(); const lock = acquireLock(dir)
  recordGoalRun(dir, '00000000-0000-4000-8000-000000000001', lock.ownerToken, { provider: 'codex', native: false })
  expect(readRunState(dir)).toMatchObject({ mode: 'goal', goalId: '00000000-0000-4000-8000-000000000001', options: { agent: 'codex', native: false } })
  const runId = readRunState(dir)?.runId
  recordGoalRun(dir, '00000000-0000-4000-8000-000000000001', lock.ownerToken, { provider: 'codex', native: false })
  expect(readRunState(dir)?.runId).toBe(runId)
  releaseLock(dir, lock.ownerToken)
})
it('resumes an expired exploration deadline without starting new work or granting a new window', async () => {
  const dir = root(); const lock = acquireLock(dir)
  const run = createLoopRun({ explore: true, exploreLimitMs: 1, agent: 'codex', selection: { model: 'gpt-5', bare: true } }, 100)
  writeRunState(dir, run, lock.ownerToken); releaseLock(dir, lock.ownerToken)
  expect(await resumeLoopCommand(dir)).toBe(3)
  expect(readRunState(dir)).toEqual(run)
})
it('refuses a second exploration supervisor without replacing the existing run identity', async () => {
  const dir = root(); const lock = acquireLock(dir)
  const run = createLoopRun({ explore: true })
  writeRunState(dir, run, lock.ownerToken)
  expect(await runLoopCommand(dir, { explore: true })).toBe(2)
  expect(readRunState(dir)?.runId).toBe(run.runId)
  releaseLock(dir, lock.ownerToken)
})
it('retains exclusive supervisor ownership while waiting for recovery and respects a user pause', async () => {
  const dir = root()
  const first = runLoopCommand(dir, { explore: true, agent: 'codex' })
  const run = readRunState(dir)
  expect(readLock(dir)?.pid).toBe(process.pid)
  expect(await runLoopCommand(dir, { explore: true, agent: 'codex' })).toBe(2)
  expect(readRunState(dir)?.runId).toBe(run?.runId)
  requestLoopPause(dir)
  expect(await first).toBe(3)
  expect(readLock(dir)).toBeNull()
})
it('rejects linked project state before acquiring or writing execution ownership', async () => {
  const dir = root(); const outside = root()
  symlinkSync(outside, join(dir, '.yoke'), 'junction')
  expect(() => readRunState(dir)).toThrow(/Linked/)
  expect(await runLoopCommand(dir, { explore: true })).toBe(2)
  expect(existsSync(join(outside, 'loop.lock'))).toBe(false)
  expect(existsSync(join(outside, 'run-state.json'))).toBe(false)
})
it('persists dispatch consumption before interruption and keeps it across a resumed batch', () => {
  const dir = root(); const lock = acquireLock(dir)
  const run = createLoopRun({ maxIterations: 2 })
  writeRunState(dir, run, lock.ownerToken)
  const interrupted = accountRunIterations(dir, run, lock.ownerToken, { ...noopReporter, storyStart: () => {
    expect(readRunState(dir)?.consumedIterations).toBe(1)
    throw new Error('process interrupted before provider completion')
  } })
  expect(() => interrupted.storyStart({ id: 'A', title: 'A' }, 1, { passed: 0, total: 2 })).toThrow(/interrupted/)
  const resumed = readRunState(dir)!
  const reporter = accountRunIterations(dir, resumed, lock.ownerToken, noopReporter)
  const status = { dispatcherId: 'resumed-batch', maxConcurrency: 1, activeWorkers: 1, queuedCandidates: 0, integrated: 0, reopened: 0, iteration: 1 }
  reporter.parallel?.(status)
  reporter.parallel?.(status)
  expect(readRunState(dir)).toMatchObject({ runId: run.runId, consumedIterations: 2, options: { maxIterations: 2 } })
  releaseLock(dir, lock.ownerToken)
})
