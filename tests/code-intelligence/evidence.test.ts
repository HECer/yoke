import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeItems, normalizeSymbols } from '../../src/code-intelligence/evidence.js'
import { createSnapshot } from '../../src/code-intelligence/snapshots.js'

it('locates Graft colon-L source ranges and attaches snapshot hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-evidence-'))
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export function answer() {}')
  const snapshot = createSnapshot(root)
  const adapter = { name: 'graft' as const, version: 'test', semantic: false, documents: false, async call() {}, async close() {} }
  const result = normalizeItems('1. answer · function\n   src/main.ts:L1-L3\n   function answer()', { root, snapshot, adapter })
  expect(result.items[0]?.path).toBe('src/main.ts')
  expect(result.provenance[0]?.content_hash).toBe(snapshot.files[0]?.hash)
})

it('attaches source provenance to structured Serena symbols', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-symbol-evidence-'))
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/main.ts'), 'export function answer() {}')
  const snapshot = createSnapshot(root)
  const adapter = { name: 'serena-lsp' as const, version: 'test', semantic: true, documents: false, async call() {}, async close() {} }
  const result = normalizeSymbols([{ name_path: 'answer', relative_path: 'src/main.ts', kind: 'Function', body_location: { start_line: 0, end_line: 0 } }], { root, snapshot, adapter })
  expect(result.symbols[0]?.name).toBe('answer')
  expect(result.provenance[0]?.source_path).toBe('src/main.ts')
  expect(result.provenance[0]?.content_hash).toBe(snapshot.files[0]?.hash)
})
