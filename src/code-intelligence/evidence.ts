import { createHash } from 'node:crypto'
import type { BackendAdapter } from './adapters/types.js'
import type { Diagnostic, Reference, Symbol } from './internal-types.js'
import type { Item, Edge, Provenance } from './internal-types.js'
import type { Snapshot } from './snapshots.js'
import { assertSafePath } from './snapshots.js'

export interface EvidenceOptions { root: string; snapshot: Snapshot; adapter: BackendAdapter; origin?: Provenance['origin']; maxChars?: number }

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function textOf(raw: unknown): string {
  if (typeof raw === 'string') return raw
  try { return JSON.stringify(raw) ?? '' } catch { return String(raw) }
}
function locate(text: string, root: string): { path: string | null; line: number | null } {
  const match = /(?:^|[\s("'`])((?:[A-Za-z0-9_.@-]+[\\/])*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+):(\d+)/u.exec(text)
  if (!match) return { path: null, line: null }
  try { return { path: assertSafePath(root, match[1]!), line: Number(match[2]) } } catch { return { path: null, line: null } }
}

export function makeProvenance(options: EvidenceOptions, text: string, resolution: Provenance['resolution'] = 'resolved'): Provenance {
  const location = locate(text, options.root)
  const file = location.path ? options.snapshot.files.find(item => item.path === location.path) : undefined
  return {
    backend: options.adapter.name, version: options.adapter.version, source_path: location.path, content_hash: file?.hash ?? null,
    byte_range: null, origin: options.origin ?? (options.adapter.semantic ? 'lsp' : 'parser'), resolution, freshness: 'current',
  }
}

export function evidenceId(provenance: Provenance, excerpt: string): string {
  return `evidence-${hash(JSON.stringify({ provenance, excerpt })).slice(0, 24)}`
}

export function normalizeItems(raw: unknown, options: EvidenceOptions, kind: Item['kind'] = 'code', limit = 100): { items: Item[]; provenance: Provenance[] } {
  const full = textOf(raw)
  const chunks = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).results) ? (raw as any).results : [raw])
  const provenance: Provenance[] = []; const items: Item[] = []; const maxChars = options.maxChars ?? 12000
  for (const candidate of chunks.slice(0, limit)) {
    const excerpt = textOf(candidate).slice(0, maxChars)
    if (!excerpt) continue
    const p = makeProvenance(options, excerpt, excerpt.toLowerCase().includes('ambiguous') ? 'ambiguous' : 'resolved')
    const id = evidenceId(p, excerpt); provenance.push(p)
    items.push({ item_id: `item-${hash(excerpt).slice(0, 24)}`, kind, path: p.source_path, excerpt, evidence_ids: [id], rank: items.length })
  }
  if (items.length === 0 && full) {
    const excerpt = full.slice(0, maxChars); const p = makeProvenance(options, excerpt, 'unresolved'); const id = evidenceId(p, excerpt); provenance.push(p)
    items.push({ item_id: `item-${hash(excerpt).slice(0, 24)}`, kind, path: p.source_path, excerpt, evidence_ids: [id], rank: 0 })
  }
  return { items, provenance }
}

export function normalizeSymbols(raw: unknown, options: EvidenceOptions): { symbols: Symbol[]; references: Reference[]; diagnostics: Diagnostic[]; provenance: Provenance[] } {
  const normalized = normalizeItems(raw, options, 'symbol');
  const candidates = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).results) ? (raw as any).results : [])
  const symbols: Symbol[] = normalized.items.map((item, index) => {
    const candidate = candidates[index] && typeof candidates[index] === 'object' ? candidates[index] as any : {}
    const namePath = String(candidate.name_path ?? candidate.namePath ?? candidate.name ?? item.excerpt.split(/\s|\(|\{/u)[0] ?? 'unknown')
    const path = typeof candidate.relative_path === 'string' ? candidate.relative_path : item.path
    const stableId = `serena:${encodeURIComponent(JSON.stringify({ name_path: namePath, relative_path: path ?? '' }))}`
    return { symbol_id: stableId, name: String(candidate.name ?? namePath.split('/').at(-1) ?? namePath), path, kind: String(candidate.kind ?? 'unknown'), signature: item.excerpt.slice(0, 500), evidence_ids: item.evidence_ids }
  })
  return { symbols, references: [], diagnostics: [], provenance: normalized.provenance }
}

export function normalizeEdges(raw: unknown, options: EvidenceOptions, relation: Edge['relation']): { nodes: TraceNode[]; edges: Edge[]; provenance: Provenance[] } {
  const normalized = normalizeItems(raw, options, 'code');
  const nodes = normalized.items.map(item => ({ id: item.item_id, label: item.excerpt.slice(0, 160), path: item.path, evidence_ids: item.evidence_ids }))
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id, relation, evidence_ids: node.evidence_ids }))
  return { nodes, edges, provenance: normalized.provenance }
}

export interface TraceNode { id: string; label: string; path: string | null; evidence_ids: string[] }
