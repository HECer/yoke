import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-wait-')); mkdirSync(join(root, '.yoke')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
function status(state = 'running', passed = 0, extra = {}) {
  const temporary = join(root, '.yoke', 'status.tmp')
  writeFileSync(temporary, JSON.stringify({ state, iteration: 1, progress: { passed, total: 2 }, updatedAt: new Date().toISOString(), ...extra }))
  renameSync(temporary, join(root, '.yoke', 'loop-status.json'))
}
async function api() {
  expect(existsSync('src/loop/wait.ts'), 'Event-based loop handoff exists').toBe(true)
  const path = '../../src/loop/wait'
  return await import(/* @vite-ignore */ path)
}
describe('model-free loop handoff', () => {
  it('returns an existing terminal state immediately with bounded fields', async () => {
    const { waitForLoop } = await api()
    status('blocked', 1, { reason: 'x'.repeat(50000), tokens: { arbitrary: 'x'.repeat(50000) } })
    const result = await waitForLoop(root, { timeoutMs: 1000 })
    expect(result.outcome).toBe('changed')
    expect(result.status).toMatchObject({ state: 'blocked', progress: { passed: 1, total: 2 } })
    expect(result.cursor).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result).length).toBeLessThan(3000)
    expect(result.status.tokens).toBeUndefined()
  })
  it('waits through running phases and resolves after atomic terminal replacement', async () => {
    const { waitForLoop } = await api()
    status()
    const timer = setTimeout(() => status('complete', 2), 30)
    try {
      expect(await waitForLoop(root, { timeoutMs: 1000 })).toMatchObject({ outcome: 'changed', status: { state: 'complete' } })
    } finally { clearTimeout(timer) }
  })
  it('ignores timestamp/token noise while waiting for semantic change', async () => {
    const { waitForLoop, loopSnapshot } = await api()
    status()
    const first = loopSnapshot(root)
    const timer = setTimeout(() => status('running', 0, { tokens: { inputTokens: 999 }, updatedAt: 'later' }), 15)
    try {
      expect(await waitForLoop(root, { timeoutMs: 70, until: 'change', since: first.cursor })).toMatchObject({ outcome: 'timeout', cursor: first.cursor })
    } finally { clearTimeout(timer) }
  })
  it('returns changed progress and a resumable cursor', async () => {
    const { waitForLoop, loopSnapshot } = await api()
    status()
    const first = loopSnapshot(root)
    status('running', 1)
    const result = await waitForLoop(root, { timeoutMs: 1000, until: 'change', since: first.cursor })
    expect(result.outcome).toBe('changed')
    expect(result.cursor).not.toBe(first.cursor)
  })
  it('times out explicitly and observes pre-aborted cancellation', async () => {
    const { waitForLoop } = await api()
    status()
    expect(await waitForLoop(root, { timeoutMs: 10 })).toMatchObject({ outcome: 'timeout' })
    const signal = AbortSignal.abort()
    expect(await waitForLoop(root, { timeoutMs: 1000, signal })).toMatchObject({ outcome: 'cancelled' })
  })
  it('cancels an active wait and releases notification resources', async () => {
    const { waitForLoop } = await api()
    status()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15)
    try { expect(await waitForLoop(root, { timeoutMs: 1000, signal: controller.signal })).toMatchObject({ outcome: 'cancelled' }) }
    finally { clearTimeout(timer) }
    // Windows permits removing the watched state directory once the wait is done.
    rmSync(join(root, '.yoke'), { recursive: true, force: true })
  })
  it('observes a state directory created after the wait begins', async () => {
    const { waitForLoop } = await api()
    rmSync(join(root, '.yoke'), { recursive: true })
    const timer = setTimeout(() => { mkdirSync(join(root, '.yoke')); status('complete', 2) }, 20)
    try { expect(await waitForLoop(root, { timeoutMs: 1000 })).toMatchObject({ outcome: 'changed' }) }
    finally { clearTimeout(timer) }
  })
  it('rejects invalid budgets and corrupt state rather than reporting completion', async () => {
    const { waitForLoop } = await api()
    await expect(waitForLoop(root, { timeoutMs: NaN })).rejects.toThrow(/timeout/i)
    writeFileSync(join(root, '.yoke', 'loop-status.json'), JSON.stringify({ state: 'complete', progress: { passed: 10, total: 1 } }))
    await expect(waitForLoop(root, { timeoutMs: 10 })).rejects.toThrow(/status/i)
  })
})
