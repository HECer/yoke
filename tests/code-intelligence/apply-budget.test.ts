import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { approveEditPlan } from '../../src/code-intelligence/edit-plans.js'
import { applyEditPlan } from '../../src/code-intelligence/transactions.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'

const roots: string[] = []
afterEach(() => { vi.useRealTimers(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'yoke-ci-disabled-edit-')); roots.push(root); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export const answer = 1;'); return root }

it('fails closed for legacy approval and transaction imports without writing receipts', () => {
  const root = fixture(), snapshot = createSnapshot(root)
  const before = readdirSync(root, { recursive: true }).sort()
  expect(() => approveEditPlan(root, '../../any-plan')).toThrow(/unavailable/)
  expect(() => applyEditPlan(root, {} as any, snapshot, '../../../escaped-receipt')).toThrow(/unavailable/)
  expect(readdirSync(root, { recursive: true }).sort()).toEqual(before)
})

it('rejects long edit bodies before snapshotting or starting a backend', async () => {
  const root = fixture(), call = vi.fn(), ci = new CodeIntelligenceCoordinator(root, { mode: 'active', adapters: { 'serena-lsp': { name: 'serena-lsp', version: 'fixture', semantic: true, documents: false, call, async close() {} } } })
  const before = readdirSync(root, { recursive: true }).sort()
  const response = await ci.dispatch('code_edit_preview', { workspace_id: ci.workspace_id, operations: [{ kind: 'replace_symbol_body', symbol_id: 'answer', content: 'x'.repeat(4000) }] })
  expect(response.error?.code).toBe('CAPABILITY_UNAVAILABLE')
  expect(call).not.toHaveBeenCalled(); expect(readdirSync(root, { recursive: true }).sort()).toEqual(before)
  await ci.close()
})

it('flags synchronous normalization crossing the shared request deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const root = fixture(), ci = new CodeIntelligenceCoordinator(root, { limits: { timeoutMs: 100 }, adapters: {
    graft: { name: 'graft', version: 'fixture', semantic: false, documents: false, async close() {}, async call() { return { toJSON() { vi.setSystemTime(Date.now() + 200); return 'src/main.ts:1 answer' } } } },
  } })
  const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' })
  expect(response.status).toBe('partial'); expect(response.warnings.join(' ')).toMatch(/deadline/i)
  await ci.close()
})
