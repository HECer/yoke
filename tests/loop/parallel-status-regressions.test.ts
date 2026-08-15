import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDispatcher, type DispatcherWorkerInput, type DispatcherWorktree } from '../../src/loop/dispatcher.js'
import { loopStatus, runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { makeReporter, readStatus, writeStatus } from '../../src/loop/reporter.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { AgentResult } from '../../src/loop/runner.js'
import type { GitOps } from '../../src/loop/gates.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-status-regression-'))
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

describe('parallel status regressions', () => {
  it('clears a rejected worker from live status and reports its failure reason', async () => {
    const reporter = makeReporter(dir, { log: () => {} })
    const parallel = reporter.parallel
    if (!parallel) throw new Error('parallel reporting is unavailable')
    const reported: unknown[] = []
    const result = await createDispatcher({
      targetDir: dir,
      stories: [story('A')],
      maxConcurrency: 1,
      maxIterations: 2,
      worker: async () => { throw new Error('provider rejected') },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: cleanGit(),
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
      onProgress: status => {
        reported.push(status)
        parallel(status)
      },
    }).run()

    reporter.blocked(result.reason ?? 'parallel dispatcher blocked')

    expect(reported.at(-1)).toMatchObject({ activeWorkers: 0, workers: [] })
    expect(readStatus(dir)).toMatchObject({
      state: 'blocked',
      reason: 'worker A failed: provider rejected',
    })
    expect(readStatus(dir)?.parallel).toBeUndefined()
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'worker A failed: provider rejected',
      failed: ['A'],
    })
  })

  it('attributes serialized integration review separately while another worker is implementing', async () => {
    let releaseWorkerB: (() => void) | undefined
    let signalIntegrationReview: () => void = () => undefined
    const integrationReview = new Promise<void>(resolve => { signalIntegrationReview = resolve })
    let integrationStatus: ReturnType<typeof readStatus> = null
    let reviewCalls = 0

    const run = Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 2,
      git: parallelGit(),
      verify: () => ({ passed: true, summary: 'green' }),
      runner: context => context.story.id === 'A'
        ? { success: true, summary: 'implemented' }
        : new Promise<AgentResult>(resolve => { releaseWorkerB = () => resolve({ success: true, summary: 'implemented' }) }),
      reviewRunner: () => {
        reviewCalls += 1
        if (reviewCalls === 2) {
          integrationStatus = readStatus(dir)
          signalIntegrationReview()
        }
        return { success: true, summary: 'approved' }
      },
    }))

    await integrationReview
    if (!releaseWorkerB) throw new Error('worker B did not start')
    releaseWorkerB()

    expect(await run).toBe(0)
    expect(integrationStatus).toMatchObject({
      state: 'running',
      parallel: {
        activeWorkers: 1,
        workers: [{ story: 'B', phase: 'implementing' }],
        integrator: { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'reviewing' },
      },
    })
    expect(integrationStatus?.phase).toBeUndefined()
    expect(readStatus(dir)).toMatchObject({ state: 'complete' })
    expect(readStatus(dir)?.phase).toBeUndefined()
    expect(readStatus(dir)?.parallel).toBeUndefined()
  })

  it('renders a serialized integrator separately from active workers', () => {
    writeStatus(dir, {
      state: 'running',
      iteration: 2,
      progress: { passed: 0, total: 2 },
      startedAt: '2026-06-29T10:00:00.000Z',
      updatedAt: '2026-06-29T10:00:00.000Z',
      parallel: {
        dispatcherId: 'dispatch-1',
        maxConcurrency: 2,
        activeWorkers: 1,
        queuedCandidates: 1,
        integrated: 0,
        reopened: 0,
        workers: [{ story: 'B', storyTitle: 'Web', provider: 'codex', phase: 'implementing' }],
        integrator: { story: 'A', storyTitle: 'API', provider: 'claude', phase: 'reviewing' },
      },
    })

    const output = loopStatus(dir, () => new Date('2026-06-29T10:01:00.000Z'))
    expect(output).toContain('1/2 workers')
    expect(output).toContain('integrator A "API" (claude) · reviewing')
    expect(output).toContain('worker B "Web" (codex) · implementing')
  })
})

function story(id: string): Story {
  return { id, title: id, priority: 1, acceptance: ['legacy acceptance'], passes: false }
}

function worktree(input: Pick<DispatcherWorkerInput, 'story'>): DispatcherWorktree {
  return { path: join(dir, '.yoke', 'worktrees', input.story.id), baseCommit: 'base' }
}

function cleanGit(): GitOps {
  return {
    isClean: () => true,
    addWorktree: () => undefined,
    removeWorktree: () => undefined,
    commitAll: () => undefined,
    integrate: () => undefined,
  }
}

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
