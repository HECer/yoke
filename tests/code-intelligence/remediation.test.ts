import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeIntelligenceCoordinator } from '../../src/code-intelligence/coordinator.js'
import { normalizeDiagnostics, normalizeSymbols } from '../../src/code-intelligence/evidence.js'
import { assertSafePath, createSnapshot } from '../../src/code-intelligence/snapshots.js'
import type { BackendAdapter } from '../../src/code-intelligence/adapters/types.js'

const roots: string[] = [], clients: CodeIntelligenceCoordinator[] = []
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'yoke-ci-remediation-')); roots.push(root); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export function answer() { return 42; }'); return root }
function adapter(name: 'graft' | 'graphify' | 'serena-lsp', result: unknown): BackendAdapter { return { name, version: 'fixture', semantic: name === 'serena-lsp', documents: name === 'graphify', call: vi.fn(async () => result), async close() {} } }
function coordinator(root: string, options: ConstructorParameters<typeof CodeIntelligenceCoordinator>[1]) { const client = new CodeIntelligenceCoordinator(root, options); clients.push(client); return client }

it('excludes recursive and zero-directory glob matches consistently', () => {
  const root = fixture(); mkdirSync(join(root, 'private/deep'), { recursive: true }); writeFileSync(join(root, 'private/deep/file.txt'), 'excluded'); writeFileSync(join(root, 'secret.txt'), 'excluded');
  const policy = { excludePatterns: ['private/**', '**/secret.txt'] }
  const snapshot = createSnapshot(root, policy)
  expect(snapshot.files.map(file => file.path)).toEqual(['src/main.ts'])
  expect(() => assertSafePath(root, 'private/deep/file.txt', policy)).toThrow(/policy/)
  expect(() => assertSafePath(root, 'secret.txt', policy)).toThrow(/policy/)
})

it('does not follow a tracked directory replaced by a symlink', () => {
  const root = fixture(), outside = fixture()
  execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'add', 'src/main.ts'])
  rmSync(join(root, 'src'), { recursive: true }); symlinkSync(join(outside, 'src'), join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => assertSafePath(root, 'src/main.ts')).toThrow(/symbolic/)
  expect(createSnapshot(root).files).toEqual([])
})

it('does not write snapshot metadata through a symlinked metadata ancestor', () => {
  const root = fixture(), outside = fixture()
  symlinkSync(outside, join(root, '.yoke'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => createSnapshot(root)).toThrow(/symbolic/)
  expect(existsSync(join(outside, 'code-intelligence'))).toBe(false)
})

it('rejects every explicit scope before backend dispatch and rejects sensitive returned records', async () => {
  const root = fixture(), graft = adapter('graft', { relative_path: '.env', excerpt: 'SYNTHETIC_DO_NOT_RETURN' }), ci = coordinator(root, { adapters: { graft } })
  for (const paths of [['src', '../outside'], ['.env']]) {
    const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'config', paths })
    expect(response.status).toBe('blocked')
  }
  expect(graft.call).not.toHaveBeenCalled()
  const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'config' })
  expect(JSON.stringify(response)).not.toContain('SYNTHETIC_DO_NOT_RETURN')
  if (response.artifact_uri) expect(readFileSync(join(root, response.artifact_uri), 'utf8')).not.toContain('SYNTHETIC_DO_NOT_RETURN')
  expect(response.warnings.join(' ')).toContain('rejected')
})

it('decodes pinned Serena path/kind groups, singleton records and diagnostic severity/ranges', () => {
  const root = fixture(), snapshot = createSnapshot(root), options = { root, snapshot, adapter: adapter('serena-lsp', null) }
  const records = Array.from({ length: 20 }, (_, i) => ({ name_path: `caller${i}`, body_location: { start_line: i, end_line: i }, content_around_reference: `answer(); // ${i}` }))
  const normalized = normalizeSymbols({ 'src/main.ts': { Function: records } }, options)
  expect(normalized.symbols).toHaveLength(20)
  expect(normalized.symbols[0]).toMatchObject({ path: 'src/main.ts', kind: 'Function', line: 1 })
  expect(normalizeSymbols({ 'src/main.ts': { Function: records[0] } }, options).symbols).toHaveLength(1)
  const diagnostics = normalizeDiagnostics({ 'src/main.ts': { '1': { 'Service/answer': [{ message: 'Type mismatch', range: { start: { line: 4, character: 0 } } }] } } }, options)
  expect(diagnostics.diagnostics[0]).toMatchObject({ path: 'src/main.ts', line: 5, severity: 'error', message: 'Type mismatch' })
})

it('uses the useful semantic backend under maxBackends=1 without a discarded Graft query', async () => {
  const root = fixture(), snapshot = createSnapshot(root), graft = adapter('graft', 'discarded'), serena = adapter('serena-lsp', [{ name_path: 'answer', relative_path: 'src/main.ts' }])
  const ci = coordinator(root, { limits: { maxBackends: 1 }, adapters: { graft, 'serena-lsp': serena } })
  const response = await ci.dispatch('code_symbol', { workspace_id: ci.workspace_id, snapshot_id: snapshot.snapshot_id, query: 'answer' })
  expect((response.data as any).symbols).toHaveLength(1)
  expect(graft.call).not.toHaveBeenCalled(); expect(serena.call).toHaveBeenCalledTimes(1)
})

it('retains all graph edges and Unicode in bounded evidence pages without repeating backends', async () => {
  const root = fixture(), nodes = Array.from({ length: 12 }, (_, i) => `NODE n${i} [src=src/main.ts loc=${i + 1} community=example]`)
  const edges: string[] = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) edges.push(`EDGE n${i} --calls [1.0]--> n${j} at=src/main.ts:${i + 1}`)
  const raw = [...nodes, ...edges, 'Unicode 🧪字 evidence'].join('\n'), graphify = adapter('graphify', raw), ci = coordinator(root, { limits: { outputBytes: 2400 }, adapters: { graft: adapter('graft', ''), graphify } })
  const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'relationships', include_docs: true })
  expect(response.evidence_cursor).toMatch(/^[a-f0-9]{64}:0$/)
  expect(JSON.stringify(response.data)).toContain('EDGE')
  let cursor = response.evidence_cursor, text = '', pages = 0
  while (cursor) {
    expect(pages++).toBeLessThan(100)
    const page = await ci.dispatch('code_evidence', { workspace_id: ci.workspace_id, cursor, max_output_bytes: 2400 })
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2400)
    expect(page.error).toBeNull()
    text += (page.data as any).text; cursor = (page.data as any).next_cursor
  }
  const retained = JSON.parse(text)
  expect(retained.payload.backends.find((backend: any) => backend.backend === 'graphify').data).toBe(raw)
  expect(graphify.call).toHaveBeenCalledTimes(1)
  expect(response.metrics.result_tokens).toBe(Math.ceil(response.metrics.returned_bytes / 4))
  const stricter = coordinator(root, { policy: { excludePatterns: ['src/**'] } })
  const denied = await stricter.dispatch('code_evidence', { workspace_id: stricter.workspace_id, cursor: response.evidence_cursor })
  expect(denied.status).toBe('blocked')
})

it('refuses unsupported network-denial policy without launching the configured executable', async () => {
  const root = fixture(), marker = join(root, 'unexpected-launch'), server = join(root, 'server.mjs')
  writeFileSync(server, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'launched');`)
  const ci = coordinator(root, { policy: { allowNetwork: false }, graft: { command: process.execPath, args: [server] } })
  const response = await ci.dispatch('code_context', { workspace_id: ci.workspace_id, query: 'answer' })
  expect(response.warnings.join(' ')).toContain('network denial cannot be enforced')
  expect(existsSync(marker)).toBe(false)
})
