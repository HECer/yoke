import { createHash } from 'node:crypto'
import type { BackendAdapter } from './adapters/types.js'
import type { Diagnostic, Reference, Symbol } from './internal-types.js'
import type { Item, Edge, Provenance } from './internal-types.js'
import type { Snapshot } from './snapshots.js'
import { assertSafePath } from './snapshots.js'

export interface EvidenceOptions { root: string; snapshot: Snapshot; adapter: BackendAdapter; origin?: Provenance['origin']; maxChars?: number }
interface Normalization { provenance: Provenance[]; warnings: string[] }

/** Truncate only between Unicode code points, including at normalizer limits. */
export function shorten(value: string, maxChars: number): string {
  const clipped = value.slice(0, Math.max(0, maxChars))
  return /[\uD800-\uDBFF]$/u.test(clipped) ? clipped.slice(0, -1) : clipped
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function textOf(raw: unknown): string {
  if (typeof raw === 'string') return raw
  try { return JSON.stringify(raw) ?? '' } catch { return String(raw) }
}
function locate(text: string, root: string): { path: string | null; line: number | null } {
  const match = /(?:^|[\s("'`])((?:[A-Za-z0-9_.@-]+[\\/])*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+):L?(\d+)/u.exec(text)
  if (!match) return { path: null, line: null }
  try { return { path: assertSafePath(root, match[1]!), line: Number(match[2]) } } catch { return { path: null, line: null } }
}

export function makeProvenance(options: EvidenceOptions, text: string, resolution: Provenance['resolution'] = 'unresolved'): Provenance {
  const location = locate(text, options.root)
  return {
    backend: options.adapter.name, version: options.adapter.version, source_path: location.path, content_hash: null,
    // A current workspace snapshot does not prove that a backend index read it.
    // None of the supported backend wire contracts supplies a validated index
    // snapshot binding. Do not trust raw `freshness` or attach a newer file hash.
    byte_range: null, origin: options.origin ?? (options.adapter.semantic ? 'lsp' : 'parser'), resolution, freshness: 'unknown',
  }
}

export function evidenceId(provenance: Provenance, excerpt: string): string {
  const { evidence_id: _id, ...fields } = provenance
  return `evidence-${hash(JSON.stringify({ provenance: fields, excerpt })).slice(0, 24)}`
}

function candidates(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results)) return (raw as { results: unknown[] }).results
  return null
}

export function normalizeItems(raw: unknown, options: EvidenceOptions, kind: Item['kind'] = 'code', limit = 100): Normalization & { items: Item[] } {
  const chunks = candidates(raw) ?? (raw === null || raw === undefined || raw === '' ? [] : [raw])
  const provenance: Provenance[] = []; const items: Item[] = []; const warnings: string[] = []; const maxChars = Math.min(12000, options.maxChars ?? 12000)
  if (chunks.length > limit) warnings.push('backend result list truncated')
  for (const candidate of chunks.slice(0, limit)) {
    const text = textOf(candidate); const excerpt = shorten(text, maxChars)
    if (excerpt !== text) warnings.push('backend result excerpt truncated')
    if (!excerpt) continue
    const p = makeProvenance(options, excerpt)
    if (candidate && typeof candidate === 'object' && 'relative_path' in candidate && typeof candidate.relative_path === 'string') {
      try {
        p.source_path = assertSafePath(options.root, candidate.relative_path)
      } catch { p.source_path = null; p.content_hash = null; p.resolution = 'unresolved' }
    }
    const id = evidenceId(p, excerpt); p.evidence_id = id; provenance.push(p)
    items.push({ item_id: `item-${hash(excerpt).slice(0, 24)}`, kind, path: p.source_path, excerpt, evidence_ids: [id], rank: items.length })
  }
  return { items, provenance, warnings: [...new Set(warnings)] }
}

export function serenaSymbolId(namePath: string, relativePath: string): string {
  return `serena:${encodeURIComponent(JSON.stringify({ name_path: namePath, relative_path: relativePath }))}`
}

export function normalizeSymbols(raw: unknown, options: EvidenceOptions): Normalization & { symbols: Symbol[]; references: Reference[]; diagnostics: Diagnostic[] } {
  const list = candidates(raw); const symbols: Symbol[] = []; const provenance: Provenance[] = []; const warnings: string[] = []
  if (!list) {
    const normalized = normalizeItems(raw, options, 'symbol')
    return { symbols, references: [], diagnostics: [], provenance: normalized.provenance, warnings: [...normalized.warnings, 'unrecognized semantic symbol response'] }
  }
  if (list.length > 100) warnings.push('semantic symbol result list truncated')
  for (const value of list.slice(0, 100)) {
    const normalized = normalizeItems([value], options, 'symbol', 1)
    warnings.push(...normalized.warnings)
    const item = normalized.items[0]; const p = normalized.provenance[0]
    if (!item || !p) continue
    const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const namePath = typeof candidate.name_path === 'string' ? candidate.name_path.trim() : ''
    if (!options.adapter.semantic || !namePath || !item.path || !options.snapshot.files.some(file => file.path === item.path)) {
      provenance.push(p); warnings.push('unresolved semantic symbol record'); continue
    }
    p.resolution = 'resolved'; p.evidence_id = evidenceId(p, item.excerpt); provenance.push(p)
    symbols.push({ symbol_id: serenaSymbolId(namePath, item.path), name: typeof candidate.name === 'string' && candidate.name ? candidate.name : namePath.split('/').at(-1) || namePath,
      path: item.path, kind: typeof candidate.kind === 'string' ? candidate.kind : 'unknown', signature: shorten(item.excerpt, 500), evidence_ids: [p.evidence_id] })
  }
  return { symbols, references: [], diagnostics: [], provenance, warnings: [...new Set(warnings)] }
}

/** Graft prose/search hits are candidates, not an ordered graph path. */
export function normalizeEdges(raw: unknown, options: EvidenceOptions, _relation: Edge['relation']): Normalization & { nodes: TraceNode[]; edges: Edge[] } {
  const normalized = normalizeItems(raw, options, 'code')
  const nodes = normalized.items.map(item => ({ id: item.item_id, label: shorten(item.excerpt, 160), path: item.path, evidence_ids: item.evidence_ids }))
  return { nodes, edges: [], provenance: normalized.provenance, warnings: [...normalized.warnings, 'structural trace response has no validated edge contract'] }
}

export function normalizeReferenceEdges(raw: unknown, options: EvidenceOptions, target: { symbol_id: string; name_path: string; relative_path: string }, relation: 'references' | 'implements' = 'references'): Normalization & { nodes: TraceNode[]; edges: Edge[] } {
  const normalized = normalizeSymbols(raw, options)
  const nodes: TraceNode[] = normalized.symbols.map(symbol => ({ id: symbol.symbol_id, label: symbol.name, path: symbol.path, evidence_ids: symbol.evidence_ids }))
  let targetPath: string
  try {
    targetPath = assertSafePath(options.root, target.relative_path)
    if (!options.snapshot.files.some(file => file.path === targetPath)) throw new Error('target is absent from snapshot')
  } catch {
    return { nodes, edges: [], provenance: normalized.provenance, warnings: [...normalized.warnings, 'reference target is unresolved'] }
  }
  const targetNode = { id: target.symbol_id, label: target.name_path, path: targetPath, evidence_ids: [] as string[] }
  const edges = nodes.map(node => ({ from: node.id, to: targetNode.id, relation, evidence_ids: node.evidence_ids }))
  return { nodes: [targetNode, ...nodes], edges, provenance: normalized.provenance, warnings: normalized.warnings }
}

export interface TraceNode { id: string; label: string; path: string | null; evidence_ids: string[] }
