import { describe, it, expect } from 'vitest'
import { runReview } from '../../src/review/command.js'
import type { Invocation } from '../../src/loop/runner.js'
import type { Agent } from '../../src/retrofit/config.js'

function harness(overrides: {
  available?: Agent[]
  succeed?: boolean
} = {}) {
  const available = new Set(overrides.available ?? ['codex', 'gemini', 'claude'])
  const calls: Invocation[] = []
  const run = (inv: Invocation) => {
    calls.push(inv)
    return { success: overrides.succeed ?? true, summary: overrides.succeed === false ? 'nope' : 'exited 0' }
  }
  const isAvailable = (a: Agent) => available.has(a)
  return { calls, run, isAvailable }
}

describe('runReview', () => {
  it('prefers a second model (codex) and approves with exit 0', () => {
    const h = harness()
    const code = runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(code).toBe(0)
    expect(h.calls[0].command).toBe('codex')
    expect(h.calls[0].input).toContain('uncommitted working-tree changes')
  })
  it('falls through codex -> gemini when codex is absent', () => {
    const h = harness({ available: ['gemini', 'claude'] })
    runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('falls back to claude self-review when it is the only agent', () => {
    const h = harness({ available: ['claude'] })
    const code = runReview('.', { run: h.run, isAvailable: h.isAvailable })
    expect(code).toBe(0)
    expect(h.calls[0].command).toBe('claude')
  })
  it('errors (exit 2) when no agent CLI is available', () => {
    const h = harness({ available: [] })
    expect(runReview('.', { run: h.run, isAvailable: h.isAvailable })).toBe(2)
    expect(h.calls).toHaveLength(0)
  })
  it('honours an explicit --reviewer', () => {
    const h = harness()
    runReview('.', { reviewer: 'gemini', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('errors (exit 2) when the explicit reviewer is unavailable', () => {
    const h = harness({ available: ['claude'] })
    expect(runReview('.', { reviewer: 'codex', run: h.run, isAvailable: h.isAvailable })).toBe(2)
  })
  it('rejects with exit 1 when the reviewer finds issues', () => {
    const h = harness({ succeed: false })
    expect(runReview('.', { run: h.run, isAvailable: h.isAvailable })).toBe(1)
  })
  it('builds a base-range scope with --base', () => {
    const h = harness()
    runReview('.', { base: 'main', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('main..HEAD')
  })
  it('injects --focus into the prompt', () => {
    const h = harness()
    runReview('.', { focus: 'the auth layer', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('the auth layer')
  })
})
