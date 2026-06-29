import { describe, it, expect } from 'vitest'
import { resolveIdleMs, DEFAULT_IDLE_MINUTES } from '../../src/loop/run-command.js'

describe('resolveIdleMs', () => {
  it('uses the flag when present (minutes → ms)', () => {
    expect(resolveIdleMs(5, 30)).toBe(5 * 60_000)
  })
  it('falls back to config when no flag', () => {
    expect(resolveIdleMs(undefined, 30)).toBe(30 * 60_000)
  })
  it('falls back to the default when neither is set', () => {
    expect(resolveIdleMs(undefined, undefined)).toBe(DEFAULT_IDLE_MINUTES * 60_000)
  })
  it('returns 0 (disabled) when the resolved value is 0', () => {
    expect(resolveIdleMs(0, 30)).toBe(0)
  })
})
