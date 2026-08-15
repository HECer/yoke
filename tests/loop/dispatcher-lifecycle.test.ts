import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDispatcher, type DispatcherWorkerInput, type DispatcherWorktree } from '../../src/loop/dispatcher.js'
import { makeParallelAdapters } from '../../src/loop/parallel-adapters.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { Story } from '../../src/loop/prd.js'
import type { StoryWorkerResult } from '../../src/loop/worker.js'

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>(resolve => { resolveValue = resolve })
  return { promise, resolve: value => { if (resolveValue) resolveValue(value) } }
}

const story = (id: string): Story => ({ id, title: id, priority: 1, acceptance: ['legacy'], passes: false, area: 'api' })
const worktree = (input: Pick<DispatcherWorkerInput, 'story'>): DispatcherWorktree => ({ path: `/repo/${input.story.id}`, baseCommit: 'base' })
const candidate = (input: DispatcherWorkerInput): StoryWorkerResult => ({ kind: 'candidate', storyId: input.story.id, worktree: input.worktree.path, baseCommit: 'base', provider: input.provider, summary: 'candidate', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' } })
const rebased = { kind: 'rebased', expectedHead: 'target-head' } as const

describe('dispatcher lifecycle', () => {
  it('holds an area through queued integration cleanup before starting its sibling', async () => {
    const rebase = deferred<{ readonly kind: 'rebased'; readonly expectedHead: string }>()
    const starts: string[] = []
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A'), story('B')], maxConcurrency: 2, maxIterations: 2,
      worker: async input => { starts.push(input.story.id); return candidate(input) },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: { isClean: () => true, rebase: input => input.story.id === 'A' ? rebase.promise : rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })
    const running = dispatcher.run()
    await Promise.resolve()
    await Promise.resolve()
    expect(starts).toEqual(['A'])
    rebase.resolve(rebased)
    await running
    expect(starts).toEqual(['A', 'B'])
  })

  it('releases an area after failed or locally cancelled workers clean up', async () => {
    for (const kind of ['mechanical-failure', 'cancelled'] as const) {
      const starts: string[] = []
      const result = await createDispatcher({
        targetDir: '/repo', stories: [story('A'), story('B')], maxConcurrency: 2, maxIterations: 2,
        worker: async input => {
          starts.push(input.story.id)
          if (input.story.id === 'A') return { ...candidate(input), kind, ...(kind === 'mechanical-failure' ? { stage: 'implementation' as const } : {}) }
          return candidate(input)
        },
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
        worktrees: { create: worktree, remove: () => undefined },
        git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
        gates: { verify: () => ({ passed: true, summary: 'green' }) },
      }).run()
      expect(starts).toEqual(['A', 'B'])
      expect(result.integrated).toEqual(['B'])
    }
  })

  it('returns cancelled before launch without committing', async () => {
    let starts = 0
    let commits = 0
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => { starts += 1; return candidate(input) },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: { isClean: () => true, rebase: () => rebased, commit: () => { commits += 1 }, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })
    dispatcher.cancel('operator stop')
    const result = await dispatcher.run()
    expect(result.status).toBe('cancelled')
    expect(starts).toBe(0)
    expect(commits).toBe(0)
  })

  it('cancels active workers once, cleans their owners, and never integrates them', async () => {
    const workers = new Map<string, ReturnType<typeof deferred<StoryWorkerResult>>>()
    const cancels: string[] = []
    const releases: string[] = []
    let integrations = 0
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A'), { ...story('B'), area: 'web' }], maxConcurrency: 2, maxIterations: 4,
      worker: input => { const pending = deferred<StoryWorkerResult>(); workers.set(input.story.id, pending); return pending.promise },
      claims: { acquire: () => true, heartbeat: () => undefined, release: input => { releases.push(input.story.id) }, cancel: (input, reason) => { cancels.push(`${input.story.id}:${reason}`) } },
      worktrees: { create: worktree, remove: () => undefined },
      git: { isClean: () => true, rebase: () => rebased, commit: () => { throw new Error('must not commit') }, integrate: () => { integrations += 1 } },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })
    const running = dispatcher.run()
    await Promise.resolve()
    dispatcher.cancel('operator stop')
    dispatcher.cancel('ignored')
    for (const [id, pending] of workers) pending.resolve(candidate({ story: story(id), worktree: { path: `/repo/${id}`, baseCommit: 'base' }, provider: { provider: 'claude', role: 'implementation' }, cancellation: {}, dispatcherId: 'test', ownerToken: id }))
    const result = await running
    expect(result.status).toBe('cancelled')
    expect(cancels).toEqual(['A:operator stop', 'B:operator stop'])
    expect(releases.sort()).toEqual(['A', 'B'])
    expect(integrations).toBe(0)
  })

  it('retains the worktree and claim when process cleanup repeatedly fails', async () => {
    const events: string[] = []
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { events.push('release') } },
      worktrees: {
        create: worktree,
        cleanupProcess: () => { events.push('process'); throw new Error('process cleanup failed') },
        remove: () => { events.push('remove') },
      },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })

    await expect(dispatcher.run()).rejects.toThrow('process cleanup failed')
    expect(events).toEqual(['process', 'process'])
  })

  it('retries process cleanup before removing the worktree and releasing the claim', async () => {
    const events: string[] = []
    let attempts = 0
    const result = await createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { events.push('release') } },
      worktrees: {
        create: worktree,
        cleanupProcess: () => {
          attempts += 1
          events.push('process')
          if (attempts === 1) throw new Error('process cleanup failed')
        },
        remove: () => { events.push('remove') },
      },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result.failed).toEqual(['A'])
    expect(events).toEqual(['process', 'process', 'remove', 'release'])
  })

  it('retries each cleanup prerequisite after staggered transient failures', async () => {
    const events: string[] = []
    const attempts = new Map<string, number>()
    const retryOnce = (step: string): void => {
      const attempt = (attempts.get(step) ?? 0) + 1
      attempts.set(step, attempt)
      events.push(step)
      if (attempt === 1) throw new Error(`${step} failed`)
    }
    const result = await createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { retryOnce('release') } },
      worktrees: {
        create: worktree,
        cleanupProcess: () => { retryOnce('process') },
        remove: () => { retryOnce('remove') },
      },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result.failed).toEqual(['A'])
    expect(events).toEqual(['process', 'process', 'remove', 'remove', 'release', 'release'])
  })

  it('treats a false claim release result as cleanup failure', async () => {
    const releases: boolean[] = []
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { releases.push(false); return false } },
      worktrees: { create: worktree, remove: () => undefined },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })

    await expect(dispatcher.run()).rejects.toThrow('claim release failed')
    expect(releases).toEqual([false, false])
  })

  it('retains the claim when worktree removal repeatedly fails after process cleanup', async () => {
    const events: string[] = []
    const dispatcher = createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { events.push('release') } },
      worktrees: {
        create: worktree,
        cleanupProcess: () => { events.push('process') },
        remove: () => { events.push('remove'); throw new Error('worktree removal failed') },
      },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    })

    await expect(dispatcher.run()).rejects.toThrow('worktree removal failed')
    expect(events).toEqual(['process', 'remove', 'remove'])
  })

  it('retries owned worktree removal without releasing the claim twice', async () => {
    let removeAttempts = 0
    let releases = 0
    const git: GitOps = {
      isClean: () => true,
      addWorktree: () => undefined,
      removeWorktree: () => {
        removeAttempts += 1
        if (removeAttempts === 1) throw new Error('worktree removal failed')
      },
      commitAll: () => undefined,
      integrate: () => undefined,
    }
    const adapters = makeParallelAdapters('/repo', undefined, git)

    const result = await createDispatcher({
      targetDir: '/repo', stories: [story('A')], maxConcurrency: 1, maxIterations: 1,
      worker: async input => ({ ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => { releases += 1 } },
      worktrees: adapters.worktrees,
      git: adapters.git,
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result.failed).toEqual(['A'])
    expect(removeAttempts).toBe(2)
    expect(releases).toBe(1)
  })

  it('reaps a candidate provider record before normal worker cleanup removes its worktree', async () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'yoke-dispatcher-'))
    let recordPath = ''
    let recordPresentDuringRemoval = false
    try {
      const git: GitOps = {
        isClean: () => true,
        addWorktree: (_target, path) => { mkdirSync(path, { recursive: true }) },
        removeWorktree: () => { recordPresentDuringRemoval = existsSync(recordPath) },
        commitAll: () => undefined,
        integrate: () => undefined,
      }
      const adapters = makeParallelAdapters(targetDir, undefined, git)

      await createDispatcher({
        targetDir,
        stories: [story('A')],
        maxConcurrency: 1,
        maxIterations: 1,
        worker: async input => {
          recordPath = join(input.worktree.path, '.yoke', 'provider-processes', 'worker.json')
          mkdirSync(join(input.worktree.path, '.yoke', 'provider-processes'), { recursive: true })
          writeFileSync(recordPath, JSON.stringify({
            version: 1,
            owner: 'provider-process',
             targetDir: input.worktree.path,
             childPid: 2_147_483_647,
             startedAt: 'incarnation-a',
          }))
          return { ...candidate(input), kind: 'mechanical-failure', stage: 'implementation' }
        },
        claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
        worktrees: adapters.worktrees,
        git: adapters.git,
        gates: { verify: () => ({ passed: true, summary: 'green' }) },
      }).run()

      expect(recordPresentDuringRemoval).toBe(false)
      expect(existsSync(recordPath)).toBe(false)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })
})
