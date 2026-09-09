import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { approveEditPlan } from '../../src/code-intelligence/edit-plans.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'
import type { BackendAdapter } from '../../src/code-intelligence/adapters/types.js'

function root(): string { const value = mkdtempSync(join(tmpdir(), 'yoke-ci-coordinator-')); mkdirSync(join(value, 'src')); writeFileSync(join(value, 'src', 'index.ts'), 'export function answer() { return 42 }\n'); return value }
function adapter(name: 'graft' | 'graphify' | 'serena-lsp', result: unknown, calls: string[], failure = false): BackendAdapter {
  return { name, version: 'test', semantic: name === 'serena-lsp', documents: name === 'graphify', async call(request) { calls.push(`${name}:${request.tool}`); if (failure) throw new Error('unavailable'); return result }, async close() {} }
}

describe('code intelligence coordinator', () => {
  it('runs structural context before optional architecture context and preserves provenance', async () => {
    const calls: string[] = []; const ci = new CodeIntelligenceCoordinator(root(), { adapters: { graft: adapter('graft', 'src/index.ts:1 answer', calls), graphify: adapter('graphify', 'Architecture: src/index.ts:1', calls) } })
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer', include_docs: true })
    expect(calls).toEqual(['graft:context', 'graphify:context']); expect(response.status).toBe('success'); expect(response.provenance.map(item => item.backend)).toEqual(['graft', 'graphify']); await ci.close()
  })

  it('reports partial coverage when one backend is unavailable', async () => {
    const calls: string[] = []; const ci = new CodeIntelligenceCoordinator(root(), { adapters: { graft: adapter('graft', 'none', calls, true) } })
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' }); expect(response.status).toBe('partial'); expect(response.coverage.backends_missing).toContain('graft'); expect(response.warnings[0]).toContain('unavailable'); await ci.close()
  })

  it('requires active mode and Yoke approval before an isolated apply', async () => {
    const calls: string[] = []; const project = root(); const snapshot = createSnapshot(project); const ci = new CodeIntelligenceCoordinator(project, { mode: 'active', adapters: { 'serena-lsp': adapter('serena-lsp', 'ok', calls) } })
    const preview = await ci.dispatch('code_edit_preview', { workspace_id: ci.workspace_id, snapshot_id: snapshot.snapshot_id, validation_profile: 'default', operations: [{ kind: 'rename', symbol_id: 'answer', new_name: 'result' }] })
    expect(['success', 'partial']).toContain(preview.status); const planId = (preview.data as any).plan_id as string
    const denied = await ci.dispatch('code_edit_apply', { workspace_id: ci.workspace_id, plan_id: planId, expected_snapshot_id: snapshot.snapshot_id, idempotency_key: 'idempotency-123' }); expect(denied.status).toBe('blocked'); expect(denied.error?.code).toBe('APPROVAL_REQUIRED')
    approveEditPlan(project, planId); const applied = await ci.dispatch('code_edit_apply', { workspace_id: ci.workspace_id, plan_id: planId, expected_snapshot_id: snapshot.snapshot_id, idempotency_key: 'idempotency-123' }); expect(applied.status).toBe('success'); expect((applied.data as any).committed).toBe(false); expect((applied.data as any).merged).toBe(false); await ci.close()
  })
})
