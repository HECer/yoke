import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeReporter } from '../../src/loop/reporter.js'
import { commandVerifier, retryingVerifier } from '../../src/loop/verify.js'
import { runLoop } from '../../src/loop/loop.js'
import { providerProcessResultToAgentResult, runParallelLoopCommand } from '../../src/loop/parallel-command.js'
import { localUsageReport, summarizeUsageEvents } from '../../src/observability/local-report.js'
import { readMeasurements } from '../../src/observability/history.js'
import { makeRunner } from '../../src/loop/runner.js'
import { MergeQueue } from '../../src/loop/merge-queue.js'
import { createDispatcher } from '../../src/loop/dispatcher.js'
import { retainRuntimeProof } from '../../src/loop/proof-retention.js'
import { appendEvent } from '../../src/observability/events.js'
import { runStoryWorker } from '../../src/loop/worker.js'

const roots: string[] = []
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'yoke-failure-')); roots.push(dir); return dir }
const period = () => ({ from: Date.now() - 60_000, to: Date.now() + 60_000 })
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 400)); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })

it.each([1, 2])('archives completion timeout without an active story for %s workers', async parallel => {
  const dir = root(); mkdirSync(join(dir, '.yoke'))
  writeFileSync(join(dir, '.yoke/prd.yaml'), '- { id: S1, title: done, priority: 1, acceptance: [done], passes: true }')
  const timeout = commandVerifier('node -e "setTimeout(() => {}, 300)"', { timeoutMs: 20 })
  const input = { targetDir: dir, prdPath: join(dir, '.yoke/prd.yaml'), maxIterations: 1, completion: timeout,
    runner: () => ({ success: true, summary: 'done' }), verify: () => ({ passed: true, summary: 'done' }),
    reporter: makeReporter(dir, { quiet: true }),
    git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } }
  const result = parallel === 1 ? runLoop(input).status : await runParallelLoopCommand({ ...input,
    maxConcurrency: 2, runnerAgent: 'codex', idleMs: 0, permissions: 'safe', selection: {}, providers: [], affinityProviders: [], onAmbiguity: 'resolve', requireCriterionEvidence: false, verifyCriterion: input.verify })
  expect(result).not.toBe(parallel === 1 ? 'complete' : 0)
  const archived = readMeasurements(dir, period().from, period().to).events
  expect(archived.find(e => e.type === 'failure')).toMatchObject({ data: { failureCategory: 'infrastructure', failureCause: 'timeout' } })
  expect(localUsageReport(dir, period()).failures.infrastructure).toBe(1)
})

it('retains typed verifier timeout through retries and leaves an ordinary nonzero exit unknown', () => {
  const dir = root()
  const timeout = retryingVerifier(commandVerifier('node -e "setTimeout(() => {}, 300)"', { timeoutMs: 20 }), 1)(dir)
  expect(timeout).toMatchObject({ failure: { failureCategory: 'infrastructure', failureCause: 'timeout' } })
  const exit = commandVerifier('node -e "process.exit(7)"')(dir)
  expect(exit).toMatchObject({ failure: { failureCategory: 'unknown', failureCause: 'unknown' } })
})

it('archives a blocked attempt once without copying diagnostics and distinguishes cancellation', () => {
  const dir = root(); const reporter = makeReporter(dir, { quiet: true })
  reporter.storyStart({ id: 'S1', title: 'first' }, 1, { passed: 0, total: 1 })
  reporter.blocked('SECRET diagnostic', { kind: 'verification-failed', stage: 'verify', observation: {
    failureId: '12345678-1234-1234-1234-123456789abc', failureCategory: 'product', failureCause: 'assertion',
  } } as any)
  const events = readMeasurements(dir, period().from, period().to).events
  expect(events.filter(e => e.data?.failureId)).toHaveLength(2)
  expect(JSON.stringify(events)).not.toContain('SECRET')
  expect(localUsageReport(dir, period()).failures).toMatchObject({ product: 1, unknown: 0 })
  const cancelled = { ...events.find(e => e.type === 'failure')!, id: 'cancelled', data: { failureId: '12345678-1234-1234-1234-123456789abd', failureCategory: 'cancellation', failureCause: 'cancelled' } }
  expect(summarizeUsageEvents([cancelled]).failures).toMatchObject({ cancellation: 1, unknown: 0 })
})

it('preserves provider usage and distinguishes spawn metadata from an arbitrary failed exit', () => {
  const dir = root(); const story = { id: 'S1', title: 'first', priority: 1, acceptance: ['done'], passes: false }
  const run = (code: string | number) => makeRunner('codex', 0, { execCapture: () => { throw Object.assign(new Error('SECRET'), { code, stdout: '' }) } })({ targetDir: dir, story })
  expect(run('ENOENT')).toMatchObject({ success: false, failure: { failureCategory: 'infrastructure', failureCause: 'spawn' } })
  expect(run(7)).toMatchObject({ success: false, failure: { failureCategory: 'unknown', failureCause: 'unknown' } })
})

it('preserves structured gate failure through the merge queue instead of stringifying its origin', async () => {
  const observation = { failureId: '12345678-1234-1234-1234-123456789abc', failureCategory: 'observer', failureCause: 'invalid-evidence' }
  const result = await new MergeQueue().enqueue({ storyId: 'S1', rebase: () => 1,
    verify: () => { throw Object.assign(new Error('SECRET'), { failure: observation }) }, integrate: () => {} })
  expect(result).toMatchObject({ status: 'reopened', failure: observation })
})

it.each(['timed-out', 'spawn-failed', 'cancelled', 'failed'])('archives provider %s with salvaged usage through the serial emitter', kind => {
  const dir = root(); mkdirSync(join(dir, '.yoke'))
  writeFileSync(join(dir, '.yoke/prd.yaml'), '- { id: S1, title: first, priority: 1, acceptance: [done], passes: false }')
  const result = providerProcessResultToAgentResult('codex', 'S1', { kind, exitCode: 7, reason: 'SECRET', error: 'SECRET', telemetry: { usageAvailable: true, tokens: { inputTokens: 3, outputTokens: 2 } } } as any)
  runLoop({ targetDir: dir, prdPath: join(dir, '.yoke/prd.yaml'), maxIterations: 1, runner: () => result,
    verify: () => ({ passed: true, summary: 'done' }), reporter: makeReporter(dir, { quiet: true }),
    git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } })
  const report = localUsageReport(dir, period())
  const expected = kind === 'cancelled' ? 'cancellation' : kind === 'failed' ? 'unknown' : 'infrastructure'
  expect(report.failures[expected]).toBe(1)
  expect(report.total.inputTokens).toBe(3)
  expect(JSON.stringify(readMeasurements(dir, period().from, period().to).events)).not.toContain('SECRET')
})

it('archives a known verifier failure from a serial story and ignores summary-based classification', () => {
  const dir = root(); mkdirSync(join(dir, '.yoke'))
  writeFileSync(join(dir, '.yoke/prd.yaml'), '- { id: S1, title: first, priority: 1, acceptance: [done], passes: false }')
  const reporter = makeReporter(dir, { quiet: true })
  runLoop({ targetDir: dir, prdPath: join(dir, '.yoke/prd.yaml'), maxIterations: 1,
    runner: () => ({ success: true, summary: 'done' }), verify: commandVerifier('node -e "setTimeout(() => {}, 300)"', { timeoutMs: 20 }), reporter,
    git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } })
  expect(localUsageReport(dir, period()).failures.infrastructure).toBe(1)
  reporter.blocked('assertion failed timeout authentication SECRET')
  expect(localUsageReport(dir, period()).failures.unknown).toBe(1)
})

it('preserves typed integration rejection through dispatcher and archived report', async () => {
  const dir = root(); const reporter = makeReporter(dir, { quiet: true })
  const observation = { failureId: '12345678-1234-1234-1234-123456789abc', failureCategory: 'product', failureCause: 'assertion' }
  const story = { id: 'S1', title: 'first', priority: 1, acceptance: ['done'], passes: false }
  const result = await createDispatcher({ targetDir: dir, stories: [story], maxConcurrency: 1, maxIterations: 1,
    claims: { acquire: () => true, heartbeat: () => {}, release: () => {} },
    worktrees: { create: () => ({ path: dir, baseCommit: 'base' }), remove: () => {}, retain: () => {} },
    git: { isClean: () => true, rebase: () => ({ kind: 'rebased', expectedHead: 'base' }), commit: () => {}, integrate: () => {} },
    worker: async input => ({ kind: 'candidate', storyId: story.id, worktree: dir, baseCommit: 'base', provider: input.provider, summary: 'ready', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' } }),
    gates: { verify: () => ({ passed: false, summary: 'SECRET assertion', failure: observation }) },
    onFailure: (failure: any) => reporter.failure?.(failure),
  } as any).run()
  reporter.blocked(result.reason ?? 'blocked', result.failure)
  expect(localUsageReport(dir, period()).failures).toMatchObject({ product: 1, unknown: 0 })
})

it('tags proof integrity failures as observer evidence and preserves failed copy candidates', () => {
  const dir = root(), target = root(); mkdirSync(join(dir, '.yoke/artifacts'), { recursive: true })
  writeFileSync(join(dir, '.yoke/artifacts/proof.txt'), 'original')
  retainRuntimeProof(dir, 'S1', target)
  const walk = (path: string): string[] => require('node:fs').readdirSync(path, { withFileTypes: true }).flatMap((entry: any) => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)])
  writeFileSync(walk(join(target, '.yoke/proof')).find(p => p.endsWith('proof.txt'))!, 'tampered')
  try { retainRuntimeProof(dir, 'S1', target); throw Error('expected rejection') }
  catch (error) { expect(error).toMatchObject({ failure: { failureCategory: 'observer', failureCause: 'invalid-evidence' } }) }
  expect(readFileSync(join(dir, '.yoke/artifacts/proof.txt'), 'utf8')).toBe('original')
})

it('rejects unbounded failure metadata at the archive boundary', () => {
  const dir = root()
  appendEvent(dir, { runId: 'run', timestamp: new Date().toISOString(), type: 'failure' as any, outcome: 'failed',
    data: { failureId: 'SECRET', failureCategory: 'infrastructure', failureCause: 'SECRET', summary: 'SECRET', stdout: 'SECRET' } })
  const events = readMeasurements(dir, period().from, period().to).events
  expect(events).toHaveLength(1)
  expect(JSON.stringify(events)).not.toContain('SECRET')
  expect(summarizeUsageEvents(events).failures.unknown).toBe(1)
})

it('archives a known verifier failure from a parallel worker and deduplicates parent blocking', async () => {
  const dir = root(); const reporter = makeReporter(dir, { quiet: true })
  const result = await runStoryWorker({ story: { id: 'S1', title: 'first', priority: 1, acceptance: ['done'], passes: false },
    worktree: dir, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' }, failureRoot: dir,
    runner: () => ({ success: true, summary: 'done' }), verify: commandVerifier('node -e "setTimeout(() => {}, 300)"', { timeoutMs: 20 }), reporter })
  expect(result).toMatchObject({ kind: 'mechanical-failure', failure: { observation: { failureCause: 'timeout' } } })
  reporter.blocked(result.summary, result.failure)
  expect(localUsageReport(dir, period()).failures).toMatchObject({ infrastructure: 1, unknown: 0 })
})

it('keeps a dispatcher outcome when an optional telemetry sink throws', async () => {
  const dir = root()
  const result = await createDispatcher({ targetDir: dir, stories: [{ id: 'S1', title: 'first', priority: 1, acceptance: ['done'], passes: false }],
    maxConcurrency: 1, maxIterations: 1, worker: async () => { throw Error('original') },
    worktrees: { create: () => { throw Object.assign(new Error('original'), { code: 'ENOENT' }) }, remove: () => {} },
    git: { isClean: () => true }, gates: { verify: () => ({ passed: true, summary: 'done' }) },
    onFailure: () => { throw Error('telemetry failed') } } as any).run()
  expect(result).toMatchObject({ status: 'blocked', reason: expect.stringContaining('original') })
})

it('classifies a proof filesystem failure as storage while preserving the source proof', () => {
  const dir = root(), target = root(); mkdirSync(join(dir, '.yoke/artifacts'), { recursive: true })
  writeFileSync(join(dir, '.yoke/artifacts/proof.txt'), 'proof')
  mkdirSync(join(target, '.yoke')); writeFileSync(join(target, '.yoke/proof'), 'file blocks directory')
  expect(() => retainRuntimeProof(dir, 'S1', target)).toThrow()
  try { retainRuntimeProof(dir, 'S1', target) } catch (error) { expect(error).toMatchObject({ failure: { failureCategory: 'infrastructure', failureCause: 'storage' } }) }
  expect(readFileSync(join(dir, '.yoke/artifacts/proof.txt'), 'utf8')).toBe('proof')
})

it('preserves an explicit criterion assertion observation through saved criterion evidence', () => {
  const dir = root(); mkdirSync(join(dir, '.yoke'))
  writeFileSync(join(dir, '.yoke/prd.yaml'), JSON.stringify([{ id: 'S1', title: 'first', priority: 1, acceptance: [
    { id: 'assertion', text: 'verified assertion', verify: ['npm test -- assertion'] },
    { id: 'secondary', text: 'secondary assertion', verify: ['npm test -- secondary'] },
  ], passes: false }]))
  const observation = { failureId: '12345678-1234-1234-1234-123456789abc', failureCategory: 'product', failureCause: 'assertion' } as const
  runLoop({ targetDir: dir, prdPath: join(dir, '.yoke/prd.yaml'), maxIterations: 1, runner: () => ({ success: true, summary: 'done' }),
    verify: () => ({ passed: true, summary: 'done' }), verifyCriterion: () => ({ passed: false, summary: 'assertion', failure: observation }), reporter: makeReporter(dir, { quiet: true }),
    git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} } })
  expect(localUsageReport(dir, period()).failures).toMatchObject({ product: 1, unknown: 0 })
})
