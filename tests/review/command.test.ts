import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReview } from '../../src/review/command.js'
import type { Invocation } from '../../src/loop/runner.js'
import type { Agent } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-review-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function harness(overrides: {
  available?: Agent[]
  succeed?: boolean
} = {}) {
  const available = new Set(overrides.available ?? ['codex', 'gemini', 'claude'])
  const calls: Invocation[] = []
  const run = (inv: Invocation) => {
    calls.push(inv)
    expect(inv.args.join(' ')).toMatch(inv.command === 'codex' ? /sandbox read-only/u : /plan/u)
    const verdict = JSON.stringify({
        schemaVersion: 1,
        approved: overrides.succeed ?? true,
        summary: overrides.succeed === false ? 'blocking issue' : 'sound',
        findings: [],
        provenance: { provider: inv.command, model: 'test-model', role: 'review', promptVersion: 1, permissions: 'read-only' },
      })
    const event = inv.command === 'codex'
      ? { type: 'item.completed', item: { type: 'agent_message', text: verdict } }
      : inv.command === 'gemini'
        ? { type: 'message', role: 'assistant', content: verdict }
        : { type: 'result', result: verdict }
    return { success: overrides.succeed ?? true, output: JSON.stringify(event), summary: overrides.succeed === false ? 'nope' : 'exited 0' }
  }
  const isAvailable = (a: Agent) => available.has(a)
  return { calls, run, isAvailable }
}

describe('runReview', () => {
  it('prefers a second model (codex) and approves with exit 0', () => {
    const h = harness()
    const code = runReview(dir, { run: h.run, isAvailable: h.isAvailable })
    expect(code).toBe(0)
    expect(h.calls[0].command).toBe('codex')
    expect(h.calls[0].input).toContain('uncommitted working-tree changes')
  })
  it('falls through codex -> gemini when codex is absent', () => {
    const h = harness({ available: ['gemini', 'claude'] })
    runReview(dir, { run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('refuses self-review unless explicitly allowed', () => {
    const h = harness({ available: ['claude'] })
    expect(runReview(dir, { run: h.run, isAvailable: h.isAvailable })).toBe(2)
    expect(h.calls).toHaveLength(0)
    expect(runReview(dir, { run: h.run, isAvailable: h.isAvailable, allowSelfReview: true })).toBe(0)
    expect(h.calls[0].command).toBe('claude')
  })
  it('errors (exit 2) when no agent CLI is available', () => {
    const h = harness({ available: [] })
    expect(runReview(dir, { run: h.run, isAvailable: h.isAvailable })).toBe(2)
    expect(h.calls).toHaveLength(0)
  })
  it('honours an explicit --reviewer', () => {
    const h = harness()
    runReview(dir, { reviewer: 'gemini', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].command).toBe('gemini')
  })
  it('errors (exit 2) when the explicit reviewer is unavailable', () => {
    const h = harness({ available: ['claude'] })
    expect(runReview(dir, { reviewer: 'codex', run: h.run, isAvailable: h.isAvailable })).toBe(2)
  })
  it('rejects with exit 1 when the reviewer finds issues', () => {
    const h = harness({ succeed: false })
    expect(runReview(dir, { run: h.run, isAvailable: h.isAvailable })).toBe(1)
  })
  it('builds a base-range scope with --base', () => {
    const h = harness()
    runReview(dir, { base: 'main', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('main..HEAD')
  })
  it('injects --focus into the prompt', () => {
    const h = harness()
    runReview(dir, { focus: 'the auth layer', run: h.run, isAvailable: h.isAvailable })
    expect(h.calls[0].input).toContain('the auth layer')
  })
})
