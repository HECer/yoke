import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { normalizeEdges, normalizeItems, normalizeSymbols } from '../../src/code-intelligence/evidence.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'
import { ResponseBaseSchema } from '../../src/code-intelligence/contracts.js'
import type { BackendAdapter } from '../../src/code-intelligence/adapters/types.js'

const roots: string[] = []
const clients: CodeIntelligenceCoordinator[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(clients.splice(0).map(client => client.close()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'yoke-ci-integrity-')); roots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/shared.ts'), 'export function shared() { return 1 }\n')
  writeFileSync(join(root, 'src/a.ts'), 'import { shared } from "./shared"; export const a = shared;\n')
  writeFileSync(join(root, 'src/b.ts'), 'import { shared } from "./shared"; export const b = shared;\n')
  return root
}
function adapter(name: 'graft' | 'graphify' | 'serena-lsp', raw: unknown): BackendAdapter {
  return { name, version: 'fixture', semantic: name === 'serena-lsp', documents: name === 'graphify', call: vi.fn(async () => raw), close: vi.fn(async () => {}) }
}
const references = [
  { name_path: 'a', relative_path: 'src/a.ts', body_location: { start_line: 0, end_line: 0 } },
  { name_path: 'b', relative_path: 'src/b.ts', body_location: { start_line: 0, end_line: 0 } },
]
const symbolId = 'serena:' + encodeURIComponent(JSON.stringify({ name_path: 'shared', relative_path: 'src/shared.ts' }))

describe('evidence and reference integrity', () => {
  it('never converts adjacent search hits into graph edges', () => {
    const root = workspace(); const snapshot = createSnapshot(root)
    const result = normalizeEdges(references, { root, snapshot, adapter: adapter('graft', null) }, 'references')
    expect(result.edges).toEqual([])
  })

  it('connects each incoming Serena reference to the requested symbol', async () => {
    const root = workspace(); const snapshot = createSnapshot(root)
    const serena = adapter('serena-lsp', references)
    const ci = new CodeIntelligenceCoordinator(root, { limits: { tokenBudget: 16000 }, adapters: { graft: adapter('graft', ''), 'serena-lsp': serena } }); clients.push(ci)
    const response = await ci.dispatch('code_trace', { workspace_id: ci.workspace_id, snapshot_id: snapshot.snapshot_id, symbol_id: symbolId, direction: 'in', relations: ['references'], max_depth: 1, require_resolved: true })
    const data = response.data as any; const paths = new Map(data.nodes.map((node: any) => [node.id, node.path]))
    expect(serena.call).toHaveBeenCalledWith(expect.objectContaining({ tool: 'references', arguments: expect.objectContaining({ name_path: 'shared', relative_path: 'src/shared.ts' }) }), expect.any(Number))
    expect(data.edges.map((edge: any) => [paths.get(edge.from), paths.get(edge.to), edge.relation])).toEqual([
      ['src/a.ts', 'src/shared.ts', 'references'], ['src/b.ts', 'src/shared.ts', 'references'],
    ])
    expect(response.coverage.semantic).toBe('partial')
    expect(response.status).toBe('partial')
    expect(response.provenance.every(item => item.freshness === 'unknown')).toBe(true)
  })

  it('does not use incoming reference results to claim outgoing or inheritance edges', async () => {
    const root = workspace(); const snapshot = createSnapshot(root)
    const serena = adapter('serena-lsp', references)
    const ci = new CodeIntelligenceCoordinator(root, { adapters: { graft: adapter('graft', ''), 'serena-lsp': serena } }); clients.push(ci)
    const response = await ci.dispatch('code_trace', { workspace_id: ci.workspace_id, snapshot_id: snapshot.snapshot_id, symbol_id: symbolId, direction: 'out', relations: ['extends'], require_resolved: true })
    expect((response.data as any).edges).toEqual([])
    expect(serena.call).not.toHaveBeenCalled()
    expect(response.status).toBe('partial')
  })

  it('does not invent symbols or current backend evidence from unknown payloads', () => {
    const root = workspace(); const snapshot = createSnapshot(root); const backend = adapter('serena-lsp', null)
    const unknown = normalizeSymbols({ message: 'Index unavailable' }, { root, snapshot, adapter: backend })
    expect(unknown.symbols).toEqual([])
    expect(unknown.provenance.every(item => item.resolution === 'unresolved' && item.freshness === 'unknown')).toBe(true)
    const stale = normalizeItems({ relative_path: 'src/shared.ts', excerpt: 'old source', content_hash: snapshot.files.find(file => file.path === 'src/shared.ts')!.hash, freshness: 'current' }, { root, snapshot, adapter: backend })
    expect(stale.provenance[0]?.freshness).toBe('unknown')
    expect(stale.provenance[0]?.content_hash).toBeNull()
  })

  it('reports node truncation as unfinished traversal without dangling edges', async () => {
    const root = workspace(); const snapshot = createSnapshot(root)
    const ci = new CodeIntelligenceCoordinator(root, { limits: { tokenBudget: 16000 }, adapters: { graft: adapter('graft', ''), 'serena-lsp': adapter('serena-lsp', references) } }); clients.push(ci)
    const response = await ci.dispatch('code_trace', { workspace_id: ci.workspace_id, snapshot_id: snapshot.snapshot_id, symbol_id: symbolId, direction: 'in', relations: ['references'], max_nodes: 2, max_depth: 1, require_resolved: true })
    const data = response.data as any
    expect(data.nodes).toHaveLength(2)
    expect(data.frontier_remaining).toBeGreaterThan(0)
    expect(data.edges.every((edge: any) => data.nodes.some((node: any) => node.id === edge.from) && data.nodes.some((node: any) => node.id === edge.to))).toBe(true)
    expect(response.status).toBe('partial')
  })
})

describe('complete response limits', () => {
  it('rejects an impossible budget before invoking a backend', async () => {
    const root = workspace(); const graft = adapter('graft', 'src/shared.ts:1 ' + 'x'.repeat(11900))
    const ci = new CodeIntelligenceCoordinator(root, { limits: { tokenBudget: 128 }, adapters: { graft } }); clients.push(ci)
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'shared', token_budget: 128 })
    expect(response.status).toBe('error')
    expect(response.error?.code).toBe('BUDGET_EXCEEDED')
    expect(graft.call).not.toHaveBeenCalled()
    expect(response.metrics.returned_bytes).toBe(Buffer.byteLength(JSON.stringify(response)))
    expect(response.metrics.token_count_kind).toBe('estimated')
  })

  it('bounds data, provenance, and metadata together and preserves Unicode and result shape', async () => {
    const root = workspace(); const graft = adapter('graft', 'src/shared.ts:L1 ' + '字😀'.repeat(5000))
    const ci = new CodeIntelligenceCoordinator(root, { limits: { tokenBudget: 2200, maxBytes: 2100 }, adapters: { graft } }); clients.push(ci)
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'shared', token_budget: 16000 })
    expect(response.status).toBe('partial')
    expect(ResponseBaseSchema.safeParse(response).success).toBe(true)
    expect(Array.isArray((response.data as any).items)).toBe(true)
    expect((response.data as any).next_cursor).toBeNull()
    const serialized = JSON.stringify(response); const bytes = Buffer.byteLength(serialized)
    expect(bytes).toBeLessThanOrEqual(2100)
    expect(response.metrics.returned_bytes).toBe(bytes)
    expect(response.metrics.result_tokens).toBe(bytes)
    expect(response.metrics.token_count_kind).toBe('estimated')
    expect(serialized).not.toMatch(/\\ud[89ab][0-9a-f]{2}|\\ud[cdef][0-9a-f]{2}/i)
    expect(response.warnings.join(' ')).toMatch(/budget|truncat/i)
    const ids = new Set(response.provenance.map(item => (item as any).evidence_id))
    expect((response.data as any).items.every((item: any) => item.evidence_ids.every((id: string) => ids.has(id)))).toBe(true)
  })

  it('gives sequential backends only the remaining request time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const root = workspace(); const calls: number[] = []
    const graft = adapter('graft', null); graft.call = vi.fn(async (_request, timeout) => { calls.push(timeout); vi.setSystemTime(Date.now() + 70); return 'src/shared.ts:1 shared' })
    const graphify = adapter('graphify', null); graphify.call = vi.fn(async (_request, timeout) => { calls.push(timeout); return 'architecture' })
    const ci = new CodeIntelligenceCoordinator(root, { limits: { timeoutMs: 100, tokenBudget: 16000 }, adapters: { graft, graphify } }); clients.push(ci)
    await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'shared', include_docs: true, timeout_ms: 1000 })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBeLessThanOrEqual(100)
    expect(calls[1]).toBeLessThanOrEqual(30)
    expect(calls[1]).toBeGreaterThan(0)
  })

  it('bounds a backend that ignores its timeout and skips subsequent work', async () => {
    vi.useFakeTimers()
    const root = workspace(); const graft = adapter('graft', null); graft.call = vi.fn(() => new Promise(() => {}))
    const graphify = adapter('graphify', 'unexpected')
    const ci = new CodeIntelligenceCoordinator(root, { limits: { timeoutMs: 100 }, adapters: { graft, graphify } }); clients.push(ci)
    let response: any
    void ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'shared', include_docs: true }).then(value => { response = value })
    await vi.advanceTimersByTimeAsync(110)
    expect(response?.status).toBe('partial')
    expect(response?.warnings.join(' ')).toMatch(/deadline|timed out/i)
    expect(graphify.call).not.toHaveBeenCalled()
    expect(graft.close).toHaveBeenCalled()
  })
})
