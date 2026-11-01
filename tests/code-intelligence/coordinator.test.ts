import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'
import type { BackendAdapter } from '../../src/code-intelligence/adapters/types.js'

function root(): string { const value = mkdtempSync(join(tmpdir(), 'yoke-ci-coordinator-')); mkdirSync(join(value, 'src')); writeFileSync(join(value, 'src', 'index.ts'), 'export function answer() { return 42 }\n'); return value }
function adapter(name: 'graft' | 'graphify' | 'serena-lsp', result: unknown, calls: string[], failure = false): BackendAdapter {
  return { name, version: 'test', semantic: name === 'serena-lsp', documents: name === 'graphify', async call(request) { calls.push(`${name}:${request.tool}`); if (failure) throw new Error('unavailable'); return result }, async close() {} }
}

describe('code intelligence coordinator', () => {
  it('honors a configured workspace identifier and denies foreign identifiers before backend access', async () => {
    const calls: string[] = []; const project = root()
    const ci = new CodeIntelligenceCoordinator(project, { workspaceId: 'customer-project', adapters: { graft: adapter('graft', 'src/index.ts:1 answer', calls) } })
    try {
      const denied = await ci.dispatch('code_context', { workspace_id: 'foreign', query: 'answer' })
      expect(denied.error?.code).toBe('WORKSPACE_DENIED'); expect(calls).toEqual([])
      const response = await ci.dispatch('code_context', { workspace_id: 'customer-project', query: 'answer' })
      expect(response.workspace_id).toBe('customer-project'); expect(response.error).toBeNull()
      expect(JSON.parse(readFileSync(join(project, '.yoke/code-intelligence/snapshots', `${response.snapshot_id}.json`), 'utf8')).workspace_id).toBe('customer-project')
    } finally { await ci.close() }
  })
  it('does not invent a symbol from Graft prose search output', async () => {
    const calls: string[] = []
    const ci = new CodeIntelligenceCoordinator(root(), { adapters: {
      graft: adapter('graft', 'graft ask — "answer"\n1. answer · function\n src/index.ts:L1-L1', calls),
      'serena-lsp': adapter('serena-lsp', [{ name_path: 'answer', relative_path: 'src/index.ts', kind: 'Function' }], calls),
    } })
    try {
      const context = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' })
      const response = await ci.dispatch('code_symbol', { workspace_id: ci.workspace_id, snapshot_id: context.snapshot_id, query: 'answer' })
      expect((response.data as any).symbols.map((symbol: any) => symbol.name)).toEqual(['answer'])
    } finally { await ci.close() }
  })
  it('runs structural context before optional architecture context and preserves provenance', async () => {
    const calls: string[] = []; const ci = new CodeIntelligenceCoordinator(root(), { adapters: { graft: adapter('graft', 'src/index.ts:1 answer', calls), graphify: adapter('graphify', 'Architecture: src/index.ts:1', calls) } })
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer', include_docs: true })
    expect(calls).toEqual(['graft:context', 'graphify:context']); expect(response.status).toBe('partial'); expect(response.provenance.map(item => item.backend)).toEqual(['graft', 'graphify']); expect(response.coverage.structural).toBe('partial'); expect(response.coverage.documents).toBe('partial'); await ci.close()
  })

  it('reports partial coverage when one backend is unavailable', async () => {
    const calls: string[] = []; const ci = new CodeIntelligenceCoordinator(root(), { adapters: { graft: adapter('graft', 'none', calls, true) } })
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' }); expect(response.status).toBe('partial'); expect(response.coverage.backends_missing).toContain('graft'); expect(response.warnings[0]).toContain('unavailable'); await ci.close()
  })

  it.each(['shadow', 'active'] as const)('does not expose or execute edits in %s mode', async mode => {
    const calls: string[] = []; const project = root(); const ci = new CodeIntelligenceCoordinator(project, { mode, adapters: { 'serena-lsp': adapter('serena-lsp', 'ok', calls) } })
    for (const tool of ['code_edit_preview', 'code_edit_apply']) {
      const response = await ci.dispatch(tool, { workspace_id: ci.workspace_id })
      expect(response.status).toBe('blocked')
      expect(response.error?.code).toBe('CAPABILITY_UNAVAILABLE')
      expect(response.error?.message).toContain('unavailable')
    }
    expect(calls).toEqual([])
    expect(readFileSync(join(project, 'src/index.ts'), 'utf8')).toContain('function answer')
    await ci.close()
  })
})
