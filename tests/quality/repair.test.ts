import { describe, expect, it } from 'vitest'
import { authorizeRepair } from '../../src/quality/repair.js'

describe('authorizeRepair', () => {
  it('starts the first bounded repair round', () => {
    const outcome = authorizeRepair({ usedRounds: 0, elapsedMs: 0 })

    expect(outcome).toEqual({ kind: 'authorized', round: 1 })
  })

  it('enforces the default three-round repair budget', () => {
    const outcome = authorizeRepair({ usedRounds: 3, elapsedMs: 0 })

    expect(outcome).toEqual({ kind: 'blocked', reason: 'round-budget-exhausted' })
  })

  it('enforces the default sixty-minute quality budget', () => {
    const outcome = authorizeRepair({ usedRounds: 0, elapsedMs: 60 * 60 * 1000 })

    expect(outcome).toEqual({ kind: 'blocked', reason: 'time-budget-exhausted' })
  })

  it('removes only the repair round and quality minute limits in unbounded mode', () => {
    const outcome = authorizeRepair({
      usedRounds: 999,
      elapsedMs: 999 * 60 * 60 * 1000,
      limits: { unbounded: true },
    })

    expect(outcome).toEqual({ kind: 'authorized', round: 1000 })
  })
})
