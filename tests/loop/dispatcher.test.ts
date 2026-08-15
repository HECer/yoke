import { describe, expect, it } from 'vitest'
import { createDispatcher, type DispatcherWorkerInput, type DispatcherWorktree } from '../../src/loop/dispatcher.js'
import type { Story } from '../../src/loop/prd.js'
import type { StoryWorkerResult } from '../../src/loop/worker.js'

const story = (id: string, extra: Partial<Story> = {}): Story => ({
  id,
  title: id,
  priority: 1,
  acceptance: ['legacy acceptance'],
  passes: false,
  ...extra,
})

function candidate(input: DispatcherWorkerInput): StoryWorkerResult {
  return {
    kind: 'candidate',
    storyId: input.story.id,
    worktree: input.worktree.path,
    baseCommit: input.worktree.baseCommit,
    provider: input.provider,
    summary: `${input.story.id} implemented`,
    evidence: { criteria: [] },
    routing: { outcome: 'pending-integration' },
  }
}

function worktree(input: Pick<DispatcherWorkerInput, 'story'>): DispatcherWorktree {
  return { path: `/repo/.yoke/worktrees/${input.story.id}`, baseCommit: 'base' }
}

const rebased = { kind: 'rebased', expectedHead: 'target-head' } as const

describe('dispatcher', () => {
  it('runs independent stories concurrently while withholding dependent stories until integration', async () => {
    const stories = [
      story('A', { area: 'api', agent: 'codex' }),
      story('B'),
      story('C', { area: 'api', agent: 'gemini' }),
      story('D', { needs: ['A'] }),
    ]
    const starts: string[] = []
    const providers: string[] = []
    let active = 0
    let peak = 0

    const result = await createDispatcher({
      targetDir: '/repo',
      stories,
      maxConcurrency: 2,
      maxIterations: 4,
      providers: [{ provider: 'claude', model: 'fallback' }],
      worker: async input => {
        starts.push(input.story.id)
        providers.push(`${input.story.id}:${input.provider.provider}`)
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
        return candidate(input)
      },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: {
        isClean: () => true,
        rebase: () => rebased,
        commit: () => undefined,
        integrate: () => undefined,
      },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result.status).toBe('complete')
    expect([...result.integrated].sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(peak).toBe(2)
    expect([...starts.slice(0, 2)].sort()).toEqual(['A', 'B'])
    expect(starts.indexOf('D')).toBeGreaterThan(starts.indexOf('A'))
    expect(providers).toContain('A:codex')
    expect(providers).toContain('C:gemini')
    expect(stories.every(item => item.passes)).toBe(true)
  })

  it('serializes integrated gates and commits only after the candidate is rebased', async () => {
    const acceptance = [
      { id: 'first', text: 'first proof', verify: ['npm run test:first'] },
      { id: 'second', text: 'second proof', verify: ['npm run test:second'] },
    ]
    const stories = [story('A', { acceptance }), story('B', { acceptance })]
    const events: string[] = []
    const result = await createDispatcher({
      targetDir: '/repo',
      stories,
      maxConcurrency: 2,
      maxIterations: 2,
      worker: async input => {
        if (input.story.id === 'B') await Promise.resolve()
        return candidate(input)
      },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: {
        isClean: () => true,
        rebase: input => {
          events.push(`rebase:${input.story.id}`)
          return { kind: 'rebased', expectedHead: `target-${input.story.id}` }
        },
        commit: input => {
          expect(input.story.passes).toBe(false)
          events.push(`commit:${input.story.id}`)
        },
        integrate: (input, expectedHead) => events.push(`integrate:${input.story.id}:${expectedHead}`),
      },
      gates: {
        verifyCriterion: (_path, item, criterion) => {
          events.push(`criterion:${item.id}:${criterion.id}`)
          return { passed: true, summary: 'green' }
        },
        verify: (_path, item) => {
          events.push(`verify:${item.id}`)
          return { passed: true, summary: 'green' }
        },
        perf: (_path, item) => {
          events.push(`perf:${item.id}`)
          return { passed: true, summary: 'green' }
        },
        audit: (_path, item) => {
          events.push(`audit:${item.id}`)
          return { passed: true, summary: 'green' }
        },
        qualityReview: (_path, item) => {
          events.push(`quality-review:${item.id}`)
          return { passed: true, summary: 'approved' }
        },
      },
    }).run()

    expect(result.integrated).toEqual(['A', 'B'])
    expect(events).toEqual([
      'rebase:A', 'criterion:A:first', 'criterion:A:second', 'verify:A', 'perf:A', 'audit:A', 'quality-review:A', 'commit:A', 'integrate:A:target-A',
      'rebase:B', 'criterion:B:first', 'criterion:B:second', 'verify:B', 'perf:B', 'audit:B', 'quality-review:B', 'commit:B', 'integrate:B:target-B',
    ])
  })

  it('reopens a conflicted candidate without committing or marking it passed', async () => {
    const stories = [story('A')]
    const outcomes: boolean[] = []
    const result = await createDispatcher({
      targetDir: '/repo',
      stories,
      maxConcurrency: 1,
      maxIterations: 1,
      worker: async input => ({ ...candidate(input), routing: { outcome: 'pending-integration', recordOutcome: outcome => outcomes.push(outcome) } }),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: {
        isClean: () => true,
        rebase: () => ({ kind: 'reopen', reason: 'rebase conflict' }),
        commit: () => { throw new Error('must not commit') },
        integrate: () => { throw new Error('must not integrate') },
      },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result.status).toBe('cap-reached')
    expect(result.reopened).toEqual(['A'])
    expect(stories[0]?.passes).toBe(false)
    expect(outcomes).toEqual([false])
  })

  it('reopens a failed integrated gate without weakening verification', async () => {
    const stories = [story('GATE')]
    const result = await createDispatcher({
      targetDir: '/repo',
      stories,
      maxConcurrency: 1,
      maxIterations: 1,
      worker: async input => candidate(input),
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: {
        isClean: () => true,
        rebase: () => rebased,
        commit: () => { throw new Error('must not commit') },
        integrate: () => { throw new Error('must not integrate') },
      },
      gates: { verify: () => ({ passed: false, summary: 'integrated suite red' }) },
    }).run()

    expect(result.reopened).toEqual(['GATE'])
    expect(stories[0]?.passes).toBe(false)
  })

  it('stops before launch when paused and cleans only the rejected worker resources', async () => {
    const pausedStories = [story('PAUSED')]
    let started = 0
    const paused = await createDispatcher({
      targetDir: '/repo',
      stories: pausedStories,
      maxConcurrency: 1,
      maxIterations: 1,
      pause: () => true,
      worker: async input => {
        started += 1
        return candidate(input)
      },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: worktree, remove: () => undefined },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    const removed: string[] = []
    const released: string[] = []
    const crashed = await createDispatcher({
      targetDir: '/repo',
      stories: [story('CRASHED')],
      maxConcurrency: 1,
      maxIterations: 1,
      worker: async () => Promise.reject(new Error('provider exited')),
      claims: {
        acquire: () => true,
        heartbeat: () => undefined,
        release: input => { released.push(input.story.id) },
      },
      worktrees: { create: worktree, remove: input => { removed.push(input.worktree.path) } },
      git: { isClean: () => true, rebase: () => rebased, commit: () => undefined, integrate: () => undefined },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(paused.status).toBe('paused')
    expect(started).toBe(0)
    expect(crashed.failed).toEqual(['CRASHED'])
    expect(removed).toEqual(['/repo/.yoke/worktrees/CRASHED'])
    expect(released).toEqual(['CRASHED'])
  })
})
