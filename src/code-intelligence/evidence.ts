import { createHash } from 'node:crypto'
import type { BackendAdapter } from './adapters/types.js'
import type { Diagnostic, Reference, Symbol } from './internal-types.js'
import type { Item, Edge, Provenance } from './internal-types.js'
import type { Snapshot, SnapshotPolicy } from './snapshots.js'
import { assertSafePath } from './snapshots.js'

export interface EvidenceOptions { root: string; snapshot: Snapshot; adapter: BackendAdapter; policy?: SnapshotPolicy; origin?: Provenance['origin']; maxChars?: number }
interface Normalization { provenance: Provenance[]; warnings: string[] }
const pathSets = new WeakMap<Snapshot, Set<string>>()
function pathsIn(snapshot: Snapshot): Set<string> {
  let paths = pathSets.get(snapshot)
  if (!paths) { paths = new Set(snapshot.files.map(file => file.path)); pathSets.set(snapshot, paths) }
  return paths
}

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
function locate(text: string, root: string, policy?: SnapshotPolicy): { path: string | null; line: number | null } {
  const match = /(?:^|[\s("'`=])((?:[A-Za-z0-9_.@-]+[\\/])*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+):L?(\d+)/u.exec(text)
  if (!match) return { path: null, line: null }
  try { return { path: assertSafePath(root, match[1]!, policy), line: Number(match[2]) } } catch { return { path: null, line: null } }
}

export function makeProvenance(options: EvidenceOptions, text: string, resolution: Provenance['resolution'] = 'unresolved'): Provenance {
  const location = locate(text, options.root, options.policy)
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

/** Reject identified out-of-scope records; nulling their path must not retain their content.
 * This validates evidence, not the filesystem/network behavior of a trusted backend. */
export function filterBackendEvidence(raw: unknown, options: Pick<EvidenceOptions, 'root' | 'snapshot' | 'policy'>): { value: unknown; warnings: string[] } {
  let dropped = 0
  const permitted = (path: string): boolean => {
    try { const clean = assertSafePath(options.root, path.replace(/:L?\d+(?:-L?\d+)?$/, ''), options.policy); return pathsIn(options.snapshot).has(clean) } catch { return false }
  }
  const visit = (value: unknown, depth: number, withinFile = false): unknown => {
    if (depth > 32) { dropped++; return undefined }
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1, withinFile)).filter(item => item !== undefined)
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['relative_path', 'source_path', 'source_file', 'path']) if (typeof record[key] === 'string' && record[key]) {
        if (!permitted(record[key])) { dropped++; return undefined }
        withinFile = true
      }
      const result: Record<string, unknown> = Object.create(null)
      for (const [key, child] of Object.entries(record)) {
        // Inside a validated file group Serena uses name paths such as
        // Class/method. Those are symbol names, not new filesystem scopes.
        const pathKey = /(?:^|[/\\])[^/\\]+\.[A-Za-z0-9]+$/.test(key) || /^\.env(?:\.|$)/.test(key) || (!withinFile && (key.includes('/') || key.includes('\\')))
        if (pathKey && !permitted(key)) { dropped++; continue }
        const safe = visit(child, depth + 1, withinFile || pathKey)
        if (safe !== undefined) result[key] = safe
      }
      return result
    }
    if (typeof value === 'string') {
      const paths = [...value.matchAll(/(?:\b(?:src|at)=|(?:^|[\s("'`]))((?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|[\\/])?(?:[A-Za-z0-9_.@-]+[\\/])*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+)(?=:L?\d|[\s\]]|$)/gu)].map(match => match[1]!)
      if (paths.some(path => !permitted(path))) { dropped++; return undefined }
    }
    return value
  }
  return { value: visit(raw, 0) ?? null, warnings: dropped ? [`${dropped} out-of-scope evidence entries were rejected.`] : [] }
}

/** Pinned Serena groups reference records by relative_path and LSP kind, collapsing singletons. */
export function semanticRecords(raw: unknown): Record<string, unknown>[] | null {
  const records: Record<string, unknown>[] = []
  let recognized = Array.isArray(raw) || Boolean(raw && typeof raw === 'object' && 'results' in raw)
  const visit = (value: unknown, inheritedPath = '', inheritedKind = '', depth = 0): void => {
    if (depth > 16 || records.length >= 2000) return
    if (Array.isArray(value)) { for (const child of value) visit(child, inheritedPath, inheritedKind, depth + 1); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.name_path === 'string') {
      recognized = true; records.push({ ...record, relative_path: record.relative_path ?? inheritedPath, kind: record.kind ?? inheritedKind }); return
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'results') visit(child, inheritedPath, inheritedKind, depth + 1)
      else if (/[/\\]|\.[A-Za-z0-9]+$/.test(key)) { recognized = true; visit(child, key, inheritedKind, depth + 1) }
      else if (/^(?:\d+|File|Module|Namespace|Package|Class|Method|Property|Field|Constructor|Enum|Interface|Function|Variable|Constant|String|Number|Boolean|Array|Object|Key|Null|EnumMember|Struct|Event|Operator|TypeParameter)$/i.test(key)) { recognized = true; visit(child, inheritedPath, key, depth + 1) }
    }
  }
  visit(raw)
  return recognized ? records : null
}

export function normalizeItems(raw: unknown, options: EvidenceOptions, kind: Item['kind'] = 'code', limit = 100): Normalization & { items: Item[] } {
  const filtered = filterBackendEvidence(raw, options)
  raw = filtered.value
  const graphLines = typeof raw === 'string' && /^NODE /m.test(raw) && /^EDGE /m.test(raw) ? raw.split('\n').filter(line => line.startsWith('EDGE ')).concat(raw.split('\n').filter(line => !line.startsWith('EDGE '))) : null
  const chunks = graphLines ?? candidates(raw) ?? (raw === null || raw === undefined || raw === '' ? [] : [raw])
  const provenance: Provenance[] = []; const items: Item[] = []; const warnings: string[] = [...filtered.warnings]; const maxChars = Math.min(12000, options.maxChars ?? 12000)
  if (chunks.length > limit) warnings.push('backend result list truncated')
  for (const candidate of chunks.slice(0, limit)) {
    const text = textOf(candidate); const excerpt = shorten(text, maxChars)
    if (excerpt !== text) warnings.push('backend result excerpt truncated')
    if (!excerpt) continue
    const p = makeProvenance(options, excerpt)
    if (candidate && typeof candidate === 'object' && 'relative_path' in candidate && typeof candidate.relative_path === 'string') {
      try {
        p.source_path = assertSafePath(options.root, candidate.relative_path, options.policy)
      } catch { warnings.push('Out-of-scope evidence record rejected.'); continue }
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
  const filtered = filterBackendEvidence(raw, options)
  const list = semanticRecords(filtered.value); const symbols: Symbol[] = []; const provenance: Provenance[] = []; const warnings: string[] = [...filtered.warnings]
  if (filtered.value && typeof filtered.value === 'object' && 'backend_shortened' in filtered.value) warnings.push('Reference context was omitted by the backend; retained results are shortened.')
  if (!list) {
    const normalized = normalizeItems(filtered.value, options, 'symbol')
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
    if (!options.adapter.semantic || !namePath || !item.path || !pathsIn(options.snapshot).has(item.path)) {
      provenance.push(p); warnings.push('unresolved semantic symbol record'); continue
    }
    p.resolution = 'resolved'; p.evidence_id = evidenceId(p, item.excerpt); provenance.push(p)
    symbols.push({ symbol_id: serenaSymbolId(namePath, item.path), name: typeof candidate.name === 'string' && candidate.name ? candidate.name : namePath.split('/').at(-1) || namePath,
      path: item.path, kind: typeof candidate.kind === 'string' || typeof candidate.kind === 'number' ? String(candidate.kind) : 'unknown', signature: typeof candidate.signature === 'string' ? shorten(candidate.signature, 500) : typeof candidate.content_around_reference === 'string' ? shorten(candidate.content_around_reference, 500) : null,
      line: typeof (candidate.body_location as any)?.start_line === 'number' ? (candidate.body_location as any).start_line + 1 : null,
      reference_line: typeof candidate.reference_line === 'number' ? candidate.reference_line + 1 : null, evidence_ids: [p.evidence_id] })
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
    targetPath = assertSafePath(options.root, target.relative_path, options.policy)
    if (!pathsIn(options.snapshot).has(targetPath)) throw new Error('target is absent from snapshot')
  } catch {
    return { nodes, edges: [], provenance: normalized.provenance, warnings: [...normalized.warnings, 'reference target is unresolved'] }
  }
  const targetNode = { id: target.symbol_id, label: target.name_path, path: targetPath, evidence_ids: [] as string[] }
  const edges = nodes.map(node => ({ from: node.id, to: targetNode.id, relation, evidence_ids: node.evidence_ids }))
  return { nodes: [targetNode, ...nodes], edges, provenance: normalized.provenance, warnings: normalized.warnings }
}

export function normalizeDiagnostics(raw: unknown, options: EvidenceOptions): Normalization & { diagnostics: Diagnostic[] } {
  const filtered = filterBackendEvidence(raw, options), diagnostics: Diagnostic[] = [], provenance: Provenance[] = []
  const visit = (value: unknown, path = '', severity = 'unknown', depth = 0): void => {
    if (depth > 16 || diagnostics.length >= 1000) return
    if (Array.isArray(value)) { value.forEach(child => visit(child, path, severity, depth + 1)); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, any>
    if (typeof record.message === 'string') {
      const normalized = normalizeItems([{ ...record, relative_path: record.relative_path ?? path }], options)
      if (!normalized.items[0]?.path || !normalized.provenance[0]) return
      const sev = record.severity ?? severity
      const level: Diagnostic['severity'] = Number(sev) === 1 || /error/i.test(String(sev)) ? 'error' : Number(sev) === 2 || /warn/i.test(String(sev)) ? 'warning' : Number(sev) === 3 || Number(sev) === 4 || /info|hint/i.test(String(sev)) ? 'info' : 'unknown'
      const line = record.range?.start?.line ?? record.line
      provenance.push(...normalized.provenance)
      diagnostics.push({ path: normalized.items[0].path, line: typeof line === 'number' ? line + 1 : null, severity: level, message: shorten(record.message, 4000), evidence_ids: normalized.items[0].evidence_ids })
      return
    }
    for (const [key, child] of Object.entries(record)) visit(child, pathsIn(options.snapshot).has(key) || (!path && /[/\\]|\.[A-Za-z0-9]+$/.test(key)) ? key : path, /^(error|warning|warn|information|info|hint|[1-4])$/i.test(key) ? key : severity, depth + 1)
  }
  visit(filtered.value)
  return { diagnostics, provenance, warnings: filtered.warnings }
}

export interface TraceNode { id: string; label: string; path: string | null; evidence_ids: string[] }
