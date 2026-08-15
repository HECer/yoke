import { describe, expect, it } from 'vitest'
import { createDispatcher } from '../../src/loop/dispatcher.js'
import type { Story } from '../../src/loop/prd.js'

describe('dispatcher post-integration state', () => {
  it('blocks after an irreversible integration dirties the target without relaunching the story', async () => {
    const story: Story = { id: 'A', title: 'API', priority: 1, acceptance: ['a'], passes: false }
    const starts: string[] = []
    let targetIsClean = true

    const result = await createDispatcher({
      targetDir: '/repo',
      stories: [story],
      maxConcurrency: 1,
      maxIterations: 2,
      worker: async input => {
        starts.push(input.story.id)
        return {
          kind: 'candidate',
          storyId: input.story.id,
          worktree: input.worktree.path,
          baseCommit: input.worktree.baseCommit,
          provider: input.provider,
          summary: 'candidate',
          evidence: { criteria: [] },
          routing: { outcome: 'pending-integration' },
        }
      },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: () => ({ path: '/repo/worktree', baseCommit: 'base' }), remove: () => undefined },
      git: {
        isClean: () => targetIsClean,
        rebase: () => ({ kind: 'rebased', expectedHead: 'target-head' }),
        commit: () => undefined,
        integrate: () => { targetIsClean = false },
      },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result).toMatchObject({ status: 'blocked', integrated: ['A'], reopened: [] })
    expect(story.passes).toBe(true)
    expect(starts).toEqual(['A'])
  })

  it('does not launch a newly unblocked sibling after an irreversible integration blocks the dispatcher', async () => {
    const first: Story = { id: 'A', title: 'API', priority: 1, acceptance: ['a'], passes: false }
    const second: Story = { id: 'B', title: 'Web', priority: 2, acceptance: ['b'], passes: false, needs: ['A'] }
    const starts: string[] = []
    let targetIsClean = true

    const result = await createDispatcher({
      targetDir: '/repo',
      stories: [first, second],
      maxConcurrency: 1,
      maxIterations: 2,
      worker: async input => {
        starts.push(input.story.id)
        return {
          kind: 'candidate',
          storyId: input.story.id,
          worktree: input.worktree.path,
          baseCommit: input.worktree.baseCommit,
          provider: input.provider,
          summary: 'candidate',
          evidence: { criteria: [] },
          routing: { outcome: 'pending-integration' },
        }
      },
      claims: { acquire: () => true, heartbeat: () => undefined, release: () => undefined },
      worktrees: { create: input => ({ path: `/repo/${input.story.id}`, baseCommit: 'base' }), remove: () => undefined },
      git: {
        isClean: () => targetIsClean,
        rebase: () => ({ kind: 'rebased', expectedHead: 'target-head' }),
        commit: () => undefined,
        integrate: () => { targetIsClean = false },
      },
      gates: { verify: () => ({ passed: true, summary: 'green' }) },
    }).run()

    expect(result).toMatchObject({ status: 'blocked', integrated: ['A'], reopened: [] })
    expect(first.passes).toBe(true)
    expect(second.passes).toBe(false)
    expect(starts).toEqual(['A'])
  })
})
