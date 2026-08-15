import { describe, expect, it } from 'vitest'
import { runStoryWorker, type StoryWorkerInput } from '../../src/loop/worker.js'
import type { Story } from '../../src/loop/prd.js'

function story(): Story {
  return {
    id: 'S1',
    title: 'Worker candidate',
    priority: 1,
    acceptance: [
      { id: 'criterion-one', text: 'First criterion', verify: ['npm run test:criterion-one'] },
      { id: 'criterion-two', text: 'Second criterion', verify: ['npm run test:criterion-two'] },
    ],
    passes: false,
  }
}

function workerInput(overrides: Partial<StoryWorkerInput> = {}): StoryWorkerInput {
  return {
    story: story(),
    worktree: '/tmp/yoke-worker/S1',
    baseCommit: 'abc123',
    provider: { provider: 'codex', model: 'gpt-5.6-terra', role: 'implementation' },
    runner: () => ({ success: true, summary: 'implemented' }),
    verifyCriterion: () => ({ passed: true, summary: 'criterion passed' }),
    verify: () => ({ passed: true, summary: 'verify passed' }),
    ...overrides,
  }
}

describe('runStoryWorker', () => {
  it('returns a fully gated candidate without mutating the supplied story or owning integration', async () => {
    const events: string[] = []
    const sourceStory = story()
    const result = await runStoryWorker({
      ...workerInput({ story: sourceStory }),
      runner: context => {
        events.push('implementation')
        context.story.passes = true
        return { success: true, summary: 'implemented' }
      },
      verifyCriterion: () => {
        events.push('criterion')
        return { passed: true, summary: 'criterion passed' }
      },
      verify: () => {
        events.push('verify')
        return { passed: true, summary: 'verify passed' }
      },
      perf: () => {
        events.push('perf')
        return { passed: true, summary: 'perf passed' }
      },
      audit: () => {
        events.push('audit')
        return { passed: true, summary: 'audit passed' }
      },
      qualityStage: () => {
        events.push('quality')
        return { kind: 'pass' }
      },
      review: () => {
        events.push('review')
        return {
          success: true,
          summary: 'approved',
          reviewOutcome: { kind: 'approved', verdict: { approved: true, summary: 'approved', findings: [] } },
        }
      },
      reporter: {
        phase: phase => events.push(`phase:${phase}`),
        addTokens: () => {},
        quality: () => {},
      },
    })

    expect(result).toMatchObject({
      kind: 'candidate',
      summary: 'implemented',
      worktree: '/tmp/yoke-worker/S1',
      baseCommit: 'abc123',
      provider: { provider: 'codex', model: 'gpt-5.6-terra', role: 'implementation' },
      routing: { outcome: 'pending-integration' },
      evidence: {
        criteria: [
          { id: 'criterion-one', passed: true },
          { id: 'criterion-two', passed: true },
        ],
        verify: { passed: true },
        perf: { passed: true },
        audit: { passed: true },
        quality: { kind: 'approved' },
      },
    })
    expect(events).toEqual([
      'implementation',
      'criterion',
      'criterion',
      'phase:verifying',
      'verify',
      'phase:perf',
      'perf',
      'phase:audit',
      'audit',
      'phase:comparing',
      'quality',
      'phase:reviewing',
      'review',
    ])
    expect(sourceStory.passes).toBe(false)
  })

  it('returns a typed mechanical failure when verification is red', async () => {
    const result = await runStoryWorker(workerInput({
      verify: () => ({ passed: false, summary: 'tests are red' }),
    }))

    expect(result).toMatchObject({ kind: 'mechanical-failure', stage: 'verify', summary: 'tests are red' })
  })

  it('returns a typed quality infrastructure failure', async () => {
    const result = await runStoryWorker(workerInput({
      qualityStage: () => ({ kind: 'infrastructure', summary: 'critic unavailable' }),
    }))

    expect(result).toMatchObject({ kind: 'quality-failure', reason: 'infrastructure', summary: 'critic unavailable' })
  })

  it('returns a typed malformed review failure', async () => {
    const result = await runStoryWorker(workerInput({
      review: () => ({
        success: false,
        summary: 'invalid verdict',
        reviewOutcome: { kind: 'malformed', summary: 'invalid verdict' },
      }),
    }))

    expect(result).toMatchObject({ kind: 'review-failure', reason: 'malformed', summary: 'invalid verdict' })
  })

  it('returns cancellation before invoking the provider', async () => {
    const controller = new AbortController()
    controller.abort('operator requested cancellation')
    let implementations = 0
    const result = await runStoryWorker(workerInput({
      cancellation: { signal: controller.signal },
      runner: () => {
        implementations += 1
        return { success: true, summary: 'unexpected implementation' }
      },
    }))

    expect(result).toMatchObject({ kind: 'cancelled', summary: 'operator requested cancellation' })
    expect(implementations).toBe(0)
  })

  it('returns cancellation during criterion verification before later gates run', async () => {
    const controller = new AbortController()
    const events: string[] = []
    const result = await runStoryWorker(workerInput({
      story: { ...story(), acceptance: [{ id: 'criterion', text: 'criterion', verify: ['npm run test:criterion'] }] },
      cancellation: { signal: controller.signal },
      verifyCriterion: () => {
        events.push('criterion')
        controller.abort('criterion cancelled')
        return { passed: true, summary: 'criterion passed' }
      },
      verify: () => {
        events.push('verify')
        return { passed: true, summary: 'verify passed' }
      },
    }))

    expect(result).toMatchObject({ kind: 'cancelled', summary: 'criterion cancelled' })
    expect(events).toEqual(['criterion'])
  })

  it('returns cancellation during perf before audit or quality runs', async () => {
    const controller = new AbortController()
    const events: string[] = []
    const result = await runStoryWorker(workerInput({
      story: { ...story(), acceptance: [{ id: 'criterion', text: 'criterion', verify: ['npm run test:criterion'] }] },
      cancellation: { signal: controller.signal },
      verifyCriterion: () => ({ passed: true, summary: 'criterion passed' }),
      verify: () => {
        events.push('verify')
        return { passed: true, summary: 'verify passed' }
      },
      perf: () => {
        events.push('perf')
        controller.abort('perf cancelled')
        return { passed: true, summary: 'perf passed' }
      },
      audit: () => {
        events.push('audit')
        return { passed: true, summary: 'audit passed' }
      },
      qualityStage: () => {
        events.push('quality')
        return { kind: 'pass' }
      },
    }))

    expect(result).toMatchObject({ kind: 'cancelled', summary: 'perf cancelled' })
    expect(events).toEqual(['verify', 'perf'])
  })

  it('returns cancellation from a repair rerun without a later quality or review', async () => {
    const controller = new AbortController()
    const events: string[] = []
    let auditRuns = 0
    const result = await runStoryWorker(workerInput({
      story: { ...story(), acceptance: [{ id: 'criterion', text: 'criterion', verify: ['npm run test:criterion'] }] },
      cancellation: { signal: controller.signal },
      verifyCriterion: () => {
        events.push('criterion')
        return { passed: true, summary: 'criterion passed' }
      },
      verify: () => {
        events.push('verify')
        return { passed: true, summary: 'verify passed' }
      },
      perf: () => {
        events.push('perf')
        return { passed: true, summary: 'perf passed' }
      },
      audit: () => {
        auditRuns += 1
        events.push('audit')
        if (auditRuns === 2) controller.abort('repair audit cancelled')
        return { passed: true, summary: 'audit passed' }
      },
      qualityStage: () => {
        events.push('quality')
        return { kind: 'lose', biggestGap: 'alignment', evidence: ['screenshot'], summary: 'repair alignment' }
      },
      repair: () => {
        events.push('repair')
        return { success: true, summary: 'repaired' }
      },
      review: () => {
        events.push('review')
        return { success: true, summary: 'approved' }
      },
    }))

    expect(result).toMatchObject({ kind: 'cancelled', summary: 'repair audit cancelled' })
    expect(events).toEqual(['criterion', 'verify', 'perf', 'audit', 'quality', 'repair', 'criterion', 'verify', 'perf', 'audit'])
  })

  it('returns a pause result after a repair reruns the mechanical gates', async () => {
    const result = await runStoryWorker(workerInput({
      qualityStage: () => ({ kind: 'lose', biggestGap: 'alignment', evidence: ['screenshot'], summary: 'repair alignment' }),
      repair: () => ({ success: true, summary: 'repaired' }),
      pause: () => true,
    }))

    expect(result).toMatchObject({ kind: 'paused' })
  })
})
