import { describe, expect, it } from 'vitest'
import { runQualityRepairLoop } from '../../src/quality/loop.js'
import type { ReviewOutcome } from '../../src/quality/repair.js'

const rejected: ReviewOutcome = {
  kind: 'rejected',
  verdict: {
    approved: false,
    summary: 'repair required',
    findings: [{ severity: 'blocking', message: 'missing boundary test' }],
  },
}

const approved: ReviewOutcome = {
  kind: 'approved',
  verdict: { approved: true, summary: 'approved', findings: [] },
}

describe('runQualityRepairLoop', () => {
  it('repairs an actionable rejection then reruns every supplied gate before a fresh approval', () => {
    const events: string[] = []
    const outcomes = [rejected, approved]
    const result = runQualityRepairLoop({
      review: () => {
        events.push('review')
        const outcome = outcomes.shift()
        if (!outcome) throw new Error('unexpected review')
        return outcome
      },
      repair: request => {
        events.push(`repair:${request.round}:${request.finding.message}`)
        return { kind: 'repaired' }
      },
      rerunGates: () => {
        events.push('gates')
        return { kind: 'passed' }
      },
      now: () => 1_000,
    })

    expect(result).toEqual({ kind: 'approved', repairs: 1 })
    expect(events).toEqual(['review', 'repair:1:missing boundary test', 'gates', 'review'])
  })

  it('blocks a mechanical gate failure after repair without invoking another repair', () => {
    let repairs = 0
    const result = runQualityRepairLoop({
      review: () => rejected,
      repair: () => {
        repairs += 1
        return { kind: 'repaired' }
      },
      rerunGates: () => ({ kind: 'failed', stage: 'audit', summary: 'secret scan red' }),
      now: () => 1_000,
    })

    expect(result).toEqual({ kind: 'blocked', reason: 'gate-failed', stage: 'audit', summary: 'secret scan red', repairs: 1 })
    expect(repairs).toBe(1)
  })

  it('blocks an infrastructure review result without invoking repair', () => {
    let repairs = 0
    const result = runQualityRepairLoop({
      review: () => ({ kind: 'infrastructure', summary: 'reviewer unavailable' }),
      repair: () => {
        repairs += 1
        return { kind: 'repaired' }
      },
      rerunGates: () => ({ kind: 'passed' }),
      now: () => 1_000,
    })

    expect(result).toEqual({ kind: 'blocked', reason: 'review-infrastructure', summary: 'reviewer unavailable', repairs: 0 })
    expect(repairs).toBe(0)
  })

  it('allows more than three review repairs when unbounded', () => {
    const rounds: number[] = []
    let reviews = 0
    const result = runQualityRepairLoop({
      review: () => {
        reviews += 1
        return reviews <= 4 ? rejected : approved
      },
      repair: request => {
        rounds.push(request.round)
        return { kind: 'repaired' }
      },
      rerunGates: () => ({ kind: 'passed' }),
      limits: { unbounded: true, maxRounds: 1 },
      now: () => 1_000,
    })

    expect(result).toEqual({ kind: 'approved', repairs: 4 })
    expect(rounds).toEqual([1, 2, 3, 4])
  })

  it('blocks before a repair when the shared time budget expires', () => {
    let repairs = 0
    let calls = 0
    const result = runQualityRepairLoop({
      review: () => rejected,
      repair: () => {
        repairs += 1
        return { kind: 'repaired' }
      },
      rerunGates: () => ({ kind: 'passed' }),
      now: () => {
        calls += 1
        return calls === 1 ? 0 : 60 * 60 * 1_000
      },
    })

    expect(result).toEqual({ kind: 'blocked', reason: 'time-budget-exhausted', summary: 'missing boundary test', repairs: 0 })
    expect(repairs).toBe(0)
  })

  it('pauses after a repaired gate cycle before the next quality or review assessment', () => {
    const outcomes = [rejected, approved]
    const statuses: Array<{ readonly usedRepairs: number }> = []
    const result = runQualityRepairLoop({
      review: () => outcomes.shift() ?? approved,
      repair: () => ({ kind: 'repaired' }),
      rerunGates: () => ({ kind: 'passed' }),
      pause: () => true,
      onStatus: status => { statuses.push(status) },
      now: () => 1_000,
    })

    expect(result).toEqual({ kind: 'paused', repairs: 1 })
    expect(statuses[statuses.length - 1]).toMatchObject({ currentRound: 1, usedRepairs: 1, maxRepairs: 3 })
  })
})
