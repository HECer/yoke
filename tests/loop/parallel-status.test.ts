import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd } from '../../src/loop/prd.js'
import { makeReporter, readStatus, writeStatus } from '../../src/loop/reporter.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { loopStatus } from '../../src/loop/run-command.js'
import type { AgentResult } from '../../src/loop/runner.js'
import type { GitOps } from '../../src/loop/gates.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-status-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  saveConfig(dir, {
    canonVersion: 'test',
    agents: ['claude'],
    loop: { enabled: true },
    verify: { command: 'node -e "process.exit(0)"' },
  })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
    '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, area: api }',
    '- { id: B, title: Web, priority: 2, acceptance: ["b"], passes: false, area: web }',
  ].join('\n'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parallel status reporting', () => {
  it('reports PRD progress, dispatch iterations, and active worker attribution during a concurrent run', async () => {
    const completeWorkers = new Map<string, () => void>()
    let signalWorkersStarted: () => void = () => undefined
    const workersStarted = new Promise<void>(resolve => { signalWorkersStarted = resolve })

    const run = Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 2,
      git: parallelGit(),
      verify: () => ({ passed: true, summary: 'green' }),
      runner: context => new Promise<AgentResult>(resolve => {
        completeWorkers.set(context.story.id, () => resolve({ success: true, summary: 'implemented' }))
        if (completeWorkers.size === 2) signalWorkersStarted()
      }),
    }))

    await workersStarted
    const activeStatus = readStatus(dir)
    for (const complete of completeWorkers.values()) complete()

    expect(await run).toBe(0)
    expect(activeStatus).toMatchObject({
      state: 'running',
      iteration: 2,
      progress: { passed: 0, total: 2 },
      parallel: {
        activeWorkers: 2,
        workers: [
          { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'implementing' },
          { story: 'B', storyTitle: 'Web', provider: 'claude', phase: 'implementing' },
        ],
      },
    })
    expect(readStatus(dir)).toMatchObject({
      state: 'complete',
      iteration: 2,
      progress: { passed: 2, total: 2 },
    })
  })

  it('retains phase and quality state for each worker rather than replacing another worker state', () => {
    const reporter = makeReporter(dir, { log: () => {} })
    reporter.parallel({
      dispatcherId: 'dispatch-1',
      maxConcurrency: 2,
      activeWorkers: 2,
      queuedCandidates: 0,
      integrated: 0,
      reopened: 0,
      iteration: 2,
      progress: { passed: 0, total: 2 },
      workers: [
        { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'implementing' },
        { story: 'B', storyTitle: 'Web', provider: 'codex', phase: 'implementing' },
      ],
    })

    const parallelWorker = reporter.parallelWorker
    if (!parallelWorker) throw new Error('parallel worker reporting is unavailable')
    parallelWorker({ story: 'A', storyTitle: 'API', provider: 'claude', phase: 'verifying' })
    parallelWorker({
      story: 'B',
      storyTitle: 'Web',
      provider: 'codex',
      phase: 'repairing',
      quality: { currentRound: 2, usedRepairs: 1, maxRepairs: 3, elapsedMs: 1_000, policy: 'blocking' },
    })

    expect(readStatus(dir)?.parallel?.workers).toEqual([
      { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'verifying' },
      {
        story: 'B',
        storyTitle: 'Web',
        provider: 'codex',
        phase: 'repairing',
        quality: { currentRound: 2, usedRepairs: 1, maxRepairs: 3, elapsedMs: 1_000, policy: 'blocking' },
      },
    ])
  })

  it('adds worker attribution to the existing human parallel summary', () => {
    writeStatus(dir, {
      state: 'running',
      iteration: 2,
      progress: { passed: 0, total: 2 },
      startedAt: '2026-06-29T10:00:00.000Z',
      updatedAt: '2026-06-29T10:00:00.000Z',
      parallel: {
        dispatcherId: 'dispatch-1',
        maxConcurrency: 2,
        activeWorkers: 2,
        queuedCandidates: 0,
        integrated: 0,
        reopened: 0,
        workers: [
          { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'verifying' },
          { story: 'B', storyTitle: 'Web', provider: 'codex', phase: 'repairing' },
        ],
      },
    })

    const output = loopStatus(dir, () => new Date('2026-06-29T10:01:00.000Z'))
    expect(output).toContain('2/2 workers')
    expect(output).toContain('A "API" (claude) · verifying')
    expect(output).toContain('B "Web" (codex) · repairing')
  })

  it('keeps three candidate lifecycle rows in machine, NDJSON, and human status output', () => {
    const lines: string[] = []
    const reporter = makeReporter(dir, { json: true, log: line => lines.push(line) })
    reporter.parallel({
      dispatcherId: 'dispatch-1', maxConcurrency: 1, activeWorkers: 1, queuedCandidates: 0, integrated: 0, reopened: 0,
      iteration: 1, progress: { passed: 0, total: 1 }, workers: [],
    })
    const report = reporter.parallelWorker
    if (!report) throw new Error('candidate status reporting is unavailable')
    for (const candidateId of ['candidate-1', 'candidate-2', 'candidate-3']) {
      report({
        story: 'S1', storyTitle: 'Candidate race', provider: 'codex', candidateId,
        worktree: `C:\\work\\${candidateId}`, lifecycle: 'running', phase: 'implementing',
      })
    }

    const machine = readStatus(dir)
    const human = loopStatus(dir)
    expect(machine?.parallel?.workers).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: 'candidate-1', worktree: 'C:\\work\\candidate-1', lifecycle: 'running' }),
      expect.objectContaining({ candidateId: 'candidate-2', worktree: 'C:\\work\\candidate-2', lifecycle: 'running' }),
      expect.objectContaining({ candidateId: 'candidate-3', worktree: 'C:\\work\\candidate-3', lifecycle: 'running' }),
    ]))
    expect(lines.some(line => line.includes('candidate-1') && line.includes('candidate-2') && line.includes('candidate-3'))).toBe(true)
    expect(human).toContain('candidate candidate-1 · C:\\work\\candidate-1 · running')
    expect(human).toContain('candidate candidate-2 · C:\\work\\candidate-2 · running')
    expect(human).toContain('candidate candidate-3 · C:\\work\\candidate-3 · running')
  })
})

function parallelGit(): GitOps {
  return {
    isClean: () => true,
    addWorktree: (_target, worktree) => {
      mkdirSync(join(worktree, '.yoke'), { recursive: true })
      writeFileSync(join(worktree, '.yoke', 'prd.yaml'), readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8'))
    },
    removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
    commitAll: () => undefined,
    integrate: (_target, worktree) => {
      savePrd(join(dir, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
    },
  }
}
