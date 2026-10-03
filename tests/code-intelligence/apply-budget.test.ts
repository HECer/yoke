import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'
import { approveEditPlan, createEditPlan } from '../../src/code-intelligence/edit-plans.js'

vi.mock('../../src/code-intelligence/transactions.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/code-intelligence/transactions.js')>()
  return { ...actual, applyEditPlan: (...args: Parameters<typeof actual.applyEditPlan>) => {
    const result = actual.applyEditPlan(...args)
    if (vi.isFakeTimers()) vi.setSystemTime(Date.now() + 200)
    return result
  } }
})
const roots: string[] = []
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'yoke-ci-apply-budget-')); roots.push(root)
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export const answer = 1;\n')
  const snapshot = createSnapshot(root)
  const sandbox = join(root, '.yoke/code-intelligence/worktrees/preview-fixture')
  mkdirSync(join(sandbox, 'src'), { recursive: true }); writeFileSync(join(sandbox, 'src/main.ts'), 'export const answer = 2;\n')
  const plan = createEditPlan(root, snapshot, sandbox, [], 'passed', 'default', ['src/main.ts'], '-1\n+2\n')
  approveEditPlan(root, plan.plan_id)
  return { root, snapshot, plan }
}

it('rejects apply before mutation when its receipt cannot fit even though an error can', async () => {
  const { root, snapshot, plan } = fixture()
  const ci = new CodeIntelligenceCoordinator(root, { mode: 'active', limits: { tokenBudget: 800 } })
  try {
    const response = await ci.dispatch('code_edit_apply', { workspace_id: ci.workspace_id, plan_id: plan.plan_id, expected_snapshot_id: snapshot.snapshot_id, idempotency_key: 'receipt-budget-key' })
    expect(response.error?.code).toBe('BUDGET_EXCEEDED')
    expect(existsSync(join(root, '.yoke/code-intelligence/transactions/receipt-budget-key.json'))).toBe(false)
    expect(response.metrics.returned_bytes).toBe(Buffer.byteLength(JSON.stringify(response)))
  } finally { await ci.close() }
})

it('retains a completed apply receipt when synchronous work crosses the deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const { root, snapshot, plan } = fixture()
  const ci = new CodeIntelligenceCoordinator(root, { mode: 'active', limits: { tokenBudget: 2400, timeoutMs: 100 } })
  try {
    const response = await ci.dispatch('code_edit_apply', { workspace_id: ci.workspace_id, plan_id: plan.plan_id, expected_snapshot_id: snapshot.snapshot_id, idempotency_key: 'late-receipt-key' })
    expect(existsSync(join(root, '.yoke/code-intelligence/transactions/late-receipt-key.json'))).toBe(true)
    expect(response.status).toBe('partial')
    expect(response.error).toBeNull()
    expect(response.data).toMatchObject({ plan_id: plan.plan_id, changed_paths: ['src/main.ts'], committed: false, merged: false })
    expect(response.warnings.join(' ')).toMatch(/deadline/i)
    expect(response.metrics.returned_bytes).toBe(Buffer.byteLength(JSON.stringify(response)))
    expect(response.metrics.returned_bytes).toBeLessThanOrEqual(2400)
  } finally { await ci.close() }
})

it('flags a deadline crossed during result normalization without starting more work', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const { root } = fixture()
  const ci = new CodeIntelligenceCoordinator(root, { limits: { timeoutMs: 100 }, adapters: {
    graft: { name: 'graft', version: 'fixture', semantic: false, documents: false, async close() {}, async call() { return { toJSON() { vi.setSystemTime(Date.now() + 200); return 'src/main.ts:1 answer' } } } },
  } })
  try {
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' })
    expect(response.status).toBe('partial')
    expect(response.warnings.join(' ')).toMatch(/deadline/i)
    expect(response.metrics.latency_ms).toBeGreaterThanOrEqual(200)
  } finally { await ci.close() }
})
