import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ContextInputSchema, ImpactInputSchema, SymbolInputSchema, TraceInputSchema, EvidenceInputSchema, INPUT_SCHEMAS, EDITS_UNAVAILABLE,
  type CodeIntelligenceResponse, type ContextData, type ImpactData, type SymbolData, type TraceData,
} from './contracts.js'
import { createGraftAdapter, createGraphifyAdapter, createSerenaAdapter, type BackendAdapter } from './adapters/index.js'
import { filterBackendEvidence, normalizeDiagnostics, normalizeEdges, normalizeItems, normalizeSymbols, normalizeReferenceEdges, serenaSymbolId, shorten, type TraceNode } from './evidence.js'
import { budgetError, fitResponse, measureResponse, responseByteLimit, type ResponseLimits } from './budgets.js'
import { assertSafePath, assertSnapshotCurrent, createSnapshot, loadSnapshot, type Snapshot, type SnapshotPolicy, workspaceId } from './snapshots.js'
import { readEvidence, retainEvidence, utf8End } from './artifacts.js'

export interface BackendProcess { command?: string; args?: string[] }
export interface CodeIntelligenceCoordinatorOptions {
  workspaceId?: string
  mode?: 'off' | 'shadow' | 'active'
  policy?: SnapshotPolicy
  limits?: { outputBytes?: number; tokenBudget?: number; timeoutMs?: number; maxBytes?: number; maxBackends?: number }
  graft?: BackendProcess
  graphify?: BackendProcess
  serena?: BackendProcess
  adapters?: Partial<Record<'graft' | 'graphify' | 'serena-lsp', BackendAdapter>>
}

function nowMs(): number { return Date.now() }
function errorCode(message: string): any {
  if (message === EDITS_UNAVAILABLE) return 'CAPABILITY_UNAVAILABLE'
  if (/deadline|timed out/iu.test(message)) return 'BACKEND_TIMEOUT'
  if (/budget/iu.test(message)) return 'BUDGET_EXCEEDED'
  if (/outside|workspace|symbolic/u.test(message)) return 'WORKSPACE_DENIED'
  if (/stale/u.test(message)) return 'SNAPSHOT_STALE'
  if (/approval/u.test(message)) return 'APPROVAL_REQUIRED'
  if (/expired/u.test(message)) return 'PLAN_EXPIRED'
  if (/idempotency/u.test(message)) return 'IDEMPOTENCY_CONFLICT'
  if (/transaction|lock|conflict/u.test(message)) return 'WRITE_CONFLICT'
  if (/active|unavailable|MCP/u.test(message)) return 'CAPABILITY_UNAVAILABLE'
  if (/scope|does not match/u.test(message)) return 'SCOPE_VIOLATION'
  return 'INVALID_ARGUMENT'
}

interface RequestState {
  used: string[]; missing: string[]; warnings: string[]
  deadline: number; limits: ResponseLimits
  calls: number; snapshot?: Snapshot; evidence: Array<{ backend: string; tool: string; data: unknown }>
}

const SYNCHRONOUS_DEADLINE = 'Request deadline exceeded during synchronous processing; retained evidence describes completed reads.'
function symbolArgs(symbol: string, fallbackPath = ''): { name_path: string; relative_path: string } {
  if (symbol.startsWith('serena:')) {
    try { const value = JSON.parse(decodeURIComponent(symbol.slice('serena:'.length))) as { name_path?: string; relative_path?: string }; if (value.name_path) return { name_path: value.name_path, relative_path: value.relative_path ?? fallbackPath } } catch { /* accept user-provided names below */ }
  }
  return { name_path: symbol, relative_path: fallbackPath }
}

export class CodeIntelligenceCoordinator {
  readonly root: string
  readonly workspace_id: string
  private readonly options: CodeIntelligenceCoordinatorOptions
  private readonly adapters: Record<'graft' | 'graphify' | 'serena-lsp', BackendAdapter>

  constructor(root: string, options: CodeIntelligenceCoordinatorOptions = {}) {
    this.root = root; this.workspace_id = options.workspaceId ?? workspaceId(root); this.options = options
    this.adapters = {
      graft: options.adapters?.graft ?? createGraftAdapter(root, options.graft),
      graphify: options.adapters?.graphify ?? createGraphifyAdapter(root, options.graphify),
      'serena-lsp': options.adapters?.['serena-lsp'] ?? createSerenaAdapter(root, options.serena),
    }
  }

  async close(): Promise<void> { await Promise.all(Object.values(this.adapters).map(adapter => adapter.close())) }

  async dispatch(name: string, input: unknown): Promise<CodeIntelligenceResponse<unknown>> {
    const requestId = randomUUID(); const started = nowMs()
    let snapshot: Snapshot | undefined
    let limits: ResponseLimits = { outputBytes: this.options.limits?.outputBytes ?? this.options.limits?.tokenBudget ?? 9600, maxBytes: this.options.limits?.maxBytes ?? 2_000_000 }
    try {
      if (this.options.mode === 'off') throw new Error('Code Intelligence is unavailable while mode=off')
      if (name === 'code_edit_preview' || name === 'code_edit_apply') throw new Error(EDITS_UNAVAILABLE)
      const schema = INPUT_SCHEMAS[name as keyof typeof INPUT_SCHEMAS]
      if (!schema) throw new Error(`unknown code-intelligence tool: ${shorten(name, 64)}`)
      const parsed = schema.parse(input)
      if ('token_budget' in parsed && parsed.token_budget !== undefined) limits.outputBytes = Math.min(responseByteLimit(limits), parsed.token_budget)
      if ('max_output_bytes' in parsed && parsed.max_output_bytes !== undefined) limits.outputBytes = Math.min(responseByteLimit(limits), parsed.max_output_bytes)
      const timeout = Math.min(this.options.limits?.timeoutMs ?? 10000, 'timeout_ms' in parsed ? parsed.timeout_ms : 10000)
      const state: RequestState = { used: [], missing: [], warnings: [], deadline: started + timeout, limits, calls: 0, evidence: [] }
      if (this.options.limits?.tokenBudget !== undefined || ('token_budget' in parsed && parsed.token_budget !== undefined)) state.warnings.push('Legacy tokenBudget/token_budget is a byte cap. Use outputBytes/max_output_bytes; token metrics are estimates, not billing.')
      const minimum = budgetError(this.errorResponse(requestId, this.workspace_id, '0'.repeat(64), started, new Error('budget')))
      if (minimum.metrics.returned_bytes > responseByteLimit(limits)) return minimum
      if (name === 'code_evidence') return this.evidencePage(parsed as z.infer<typeof EvidenceInputSchema>, requestId, started, limits)
      snapshot = this.snapshotFor(parsed); state.snapshot = snapshot
      let result: { data: unknown; provenance: any[]; used: string[]; missing: string[]; warnings: string[]; hard?: boolean }
      switch (name) {
        case 'code_context': result = await this.context(parsed as z.infer<typeof ContextInputSchema>, snapshot, state); break
        case 'code_symbol': result = await this.symbol(parsed as z.infer<typeof SymbolInputSchema>, snapshot, state); break
        case 'code_trace': result = await this.trace(parsed as z.infer<typeof TraceInputSchema>, snapshot, state); break
        case 'code_impact': result = await this.impact(parsed as z.infer<typeof ImpactInputSchema>, snapshot, state); break
        default: throw new Error(`unknown code-intelligence tool: ${name}`)
      }
      result.warnings.push('Backend freshness and exhaustive coverage are unverified; candidates may require source checks.')
      const artifact = state.evidence.length ? retainEvidence(this.root, snapshot, { tool: name, arguments: parsed, data: result.data, provenance: result.provenance, backends: state.evidence, warnings: result.warnings }) : null
      let response = fitResponse({
        schema_version: '0.1.0', request_id: requestId, workspace_id: this.workspace_id, snapshot_id: snapshot.snapshot_id,
        status: result.hard ? 'error' : 'partial', data: result.data, coverage: this.coverage(result.used, result.missing), provenance: result.provenance,
        warnings: [...new Set(result.warnings)], metrics: { latency_ms: nowMs() - started, result_tokens: 0, token_count_kind: 'estimated', returned_bytes: 0 }, artifact_uri: artifact?.uri ?? null, evidence_cursor: artifact?.cursor ?? null, error: null,
      }, limits)
      response.metrics.latency_ms = nowMs() - started
      response = fitResponse(response, limits)
      // A filesystem operation or normalization cannot be preempted mid-call.
      // Check after reduction too; retained evidence survives response reduction.
      if (nowMs() >= state.deadline && response.status !== 'error' && response.status !== 'blocked') {
        response.status = 'partial'
        response.warnings.push(SYNCHRONOUS_DEADLINE)
        response.metrics.latency_ms = nowMs() - started
        response = fitResponse(response, limits)
      }
      return response
    } catch (error) { return fitResponse(this.errorResponse(requestId, this.workspace_id, snapshot?.snapshot_id ?? '0'.repeat(64), started, error as Error), limits) }
  }

  private evidencePage(input: z.infer<typeof EvidenceInputSchema>, requestId: string, started: number, limits: ResponseLimits): CodeIntelligenceResponse<unknown> {
    if (input.workspace_id !== this.workspace_id) throw new Error('workspace is not permitted')
    const saved = readEvidence(this.root, this.workspace_id, input.cursor, this.options.policy)
    const base = { ...this.errorResponse(requestId, this.workspace_id, saved.snapshotId, started, new Error('budget')), error: null, status: 'partial' as const, warnings: ['Retained evidence describes its original snapshot; it is not a new backend query.'] }
    const make = (end: number) => measureResponse({ ...base, data: { artifact_id: saved.id, offset_bytes: saved.offset, text: saved.bytes.subarray(saved.offset, end).toString('utf8'), next_cursor: end < saved.bytes.length ? `${saved.id}:${end}` : null } })
    let low = saved.offset, high = Math.min(saved.bytes.length, saved.offset + responseByteLimit(limits))
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (make(utf8End(saved.bytes, middle)).metrics.returned_bytes <= responseByteLimit(limits) - 16) low = middle; else high = middle - 1 }
    const end = utf8End(saved.bytes, low)
    if (end === saved.offset && end < saved.bytes.length) return budgetError(base)
    const response = make(end); response.metrics.latency_ms = nowMs() - started
    return measureResponse(response)
  }

  private snapshotFor(input: unknown): Snapshot {
    const candidate = input && typeof input === 'object' ? input as any : {}
    if (candidate.workspace_id && candidate.workspace_id !== this.workspace_id) throw new Error('workspace is not permitted')
    const snapshot = candidate.snapshot_id ? loadSnapshot(this.root, candidate.snapshot_id) : createSnapshot(this.root, this.options.policy, this.workspace_id)
    if (snapshot.workspace_id !== this.workspace_id) throw new Error('snapshot workspace identifier differs from the configured workspace; create a new snapshot')
    if (candidate.snapshot_id) assertSnapshotCurrent(this.root, snapshot, this.options.policy)
    return snapshot
  }

  private coverage(used: string[], missing: string[]) {
    return {
      backends_requested: [...new Set([...used, ...missing])], backends_used: [...new Set(used)], backends_missing: [...new Set(missing)],
      structural: used.includes('graft') ? 'partial' as const : 'unavailable' as const,
      semantic: used.includes('serena-lsp') ? 'partial' as const : 'unavailable' as const,
      documents: used.includes('graphify') ? 'partial' as const : 'unavailable' as const,
    } as any
  }

  private async call(backend: 'graft' | 'graphify' | 'serena-lsp', tool: string, args: Record<string, unknown>, timeout: number, state: RequestState, adapter = this.adapters[backend]): Promise<unknown | null> {
    const seen = new Set([...state.used, ...state.missing]); const maxBackends = this.options.limits?.maxBackends ?? 3
    if (!seen.has(backend) && seen.size >= maxBackends) { state.missing.push(backend); state.warnings.push(`${backend}: backend budget exceeded`); return null }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (state.calls >= 8) throw new Error('backend call budget exceeded; narrow the query')
      if (this.options.adapters?.[backend] !== adapter && this.options.policy?.allowNetwork !== true) throw new Error('External backend unavailable: network denial cannot be enforced by this facade. Configure a trusted or externally isolated backend, then explicitly set policy.allowNetwork=true to permit execution.')
      const remaining = Math.min(timeout, state.deadline - nowMs())
      if (remaining <= 0) throw new Error('request deadline exceeded; backend was not started')
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('request deadline exceeded')); void adapter.close().catch(() => {}) }, remaining)
      })
      state.calls++
      const value = await Promise.race([adapter.call({ tool, arguments: args }, remaining), expired])
      if (nowMs() >= state.deadline) throw new Error('request deadline exceeded; late backend result discarded')
      if (!state.used.includes(backend)) state.used.push(backend)
      const safe = filterBackendEvidence(value, { root: this.root, snapshot: state.snapshot!, policy: this.options.policy })
      state.warnings.push(...safe.warnings)
      if (Buffer.byteLength(JSON.stringify(safe.value)) > 2_000_000) throw new Error('backend evidence byte budget exceeded')
      state.evidence.push({ backend, tool, data: safe.value })
      return safe.value
    } catch (error) { if (!state.missing.includes(backend)) state.missing.push(backend); state.warnings.push(`${backend}: ${shorten((error as Error).message, 256)}`); return null }
    finally { if (timer) clearTimeout(timer) }
  }

  private evidenceOptions(snapshot: Snapshot, backend: 'graft' | 'graphify' | 'serena-lsp', maxChars = 12000) {
    return { root: this.root, snapshot, adapter: this.adapters[backend], policy: this.options.policy, maxChars }
  }

  private async context(input: z.infer<typeof ContextInputSchema>, snapshot: Snapshot, state: RequestState) {
    const provenance: any[] = []; let items: any[] = []
    const paths = [...new Set(input.paths.map(path => assertSafePath(this.root, path, this.options.policy)))]
    for (const path of paths.length ? paths : ['']) {
      const raw = await this.call('graft', 'context', { query: input.query, limit: Math.max(1, Math.floor(responseByteLimit(state.limits) / 300)), ...(path ? { in: path } : {}) }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'graft'), 'code', 100); items.push(...normalized.items); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
      if (state.calls >= 8) { state.warnings.push('Backend call budget exhausted; remaining path scopes were not queried.'); break }
    }
    if (input.include_docs) {
      const docs = await this.call('graphify', 'context', { question: input.query, depth: input.mode === 'locate' ? 1 : 3, token_budget: Math.ceil(responseByteLimit(state.limits) / 4) }, input.timeout_ms, state)
      if (docs !== null) { const normalized = normalizeItems(docs, this.evidenceOptions(snapshot, 'graphify'), 'document', 50); items.push(...normalized.items); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    return { data: { items, next_cursor: null } satisfies ContextData, provenance, ...state, warnings: state.warnings }
  }

  private async symbol(input: z.infer<typeof SymbolInputSchema>, snapshot: Snapshot, state: RequestState) {
    const provenance: any[] = []; let symbols: any[] = []; let references: any[] = []; let diagnostics: any[] = []
    const name = input.symbol_id ?? input.query!
    const reference = symbolArgs(name, input.path ?? '')
    if (reference.relative_path) reference.relative_path = assertSafePath(this.root, reference.relative_path, this.options.policy)
    if (input.include.includes('definition') || !reference.relative_path) {
      const symbol = await this.call('serena-lsp', 'symbol', { name_path_pattern: reference.name_path, depth: 0, relative_path: reference.relative_path, include_body: false, max_matches: 20 }, input.timeout_ms, state)
      if (symbol !== null) {
        const normalized = normalizeSymbols(symbol, this.evidenceOptions(snapshot, 'serena-lsp')); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings)
        if (normalized.symbols.length === 1 && !reference.relative_path) Object.assign(reference, symbolArgs(normalized.symbols[0]!.symbol_id))
        if (input.include.includes('definition')) symbols.push(...normalized.symbols)
      }
    }
    if (!reference.relative_path && input.include.some(item => item !== 'definition')) { state.warnings.push('Semantic target is unresolved or ambiguous; use a path-bound symbol_id.'); return { data: { symbols, references, diagnostics }, provenance, ...state } }
    if (input.include.includes('references')) {
      const raw = await this.call('serena-lsp', 'references', reference, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeSymbols(raw, this.evidenceOptions(snapshot, 'serena-lsp')); references = normalized.symbols.map(symbol => ({ symbol_id: symbol.symbol_id, path: symbol.path, line: symbol.reference_line ?? null, excerpt: shorten(symbol.signature ?? symbol.name, 4000), evidence_ids: symbol.evidence_ids })); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    if (input.include.includes('implementations')) {
      const raw = await this.call('serena-lsp', 'implementations', reference, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeSymbols(raw, this.evidenceOptions(snapshot, 'serena-lsp')); symbols.push(...normalized.symbols); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    if (input.include.includes('diagnostics')) {
      const raw = await this.call('serena-lsp', 'diagnostics', { relative_path: reference.relative_path }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeDiagnostics(raw, this.evidenceOptions(snapshot, 'serena-lsp')); diagnostics = normalized.diagnostics; provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    return { data: { symbols, references, diagnostics } satisfies SymbolData, provenance, ...state, warnings: state.warnings }
  }

  private async trace(input: z.infer<typeof TraceInputSchema>, snapshot: Snapshot, state: RequestState) {
    const provenance: any[] = []; let nodes: TraceNode[] = []; let edges: any[] = []
    const reference = symbolArgs(input.symbol_id)
    if (reference.relative_path) reference.relative_path = assertSafePath(this.root, reference.relative_path, this.options.policy)
    if (input.relations.includes('calls') && !input.require_resolved) {
      const raw = await this.call('graft', 'trace', { symbol: reference.name_path, direction: input.direction, depth: input.max_depth }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeEdges(raw, this.evidenceOptions(snapshot, 'graft'), 'calls'); nodes.push(...normalized.nodes); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    const supported = input.direction === 'in' ? input.relations.filter((relation): relation is 'references' | 'implements' => relation === 'references' || relation === 'implements') : []
    if (supported.length && !reference.relative_path) {
      const raw = await this.call('serena-lsp', 'symbol', { name_path_pattern: reference.name_path, relative_path: '', depth: 0, include_body: false, max_matches: 2 }, input.timeout_ms, state)
      if (raw !== null) {
        const normalized = normalizeSymbols(raw, this.evidenceOptions(snapshot, 'serena-lsp')); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings)
        if (normalized.symbols.length === 1) Object.assign(reference, symbolArgs(normalized.symbols[0]!.symbol_id))
        else state.warnings.push('reference target is unresolved or ambiguous; use a path-bound symbol_id')
      }
    }
    if (supported.length && reference.relative_path) {
      let validTarget = false
      try { validTarget = snapshot.files.some(file => file.path === assertSafePath(this.root, reference.relative_path, this.options.policy)) } catch { /* unresolved target is reported below */ }
      if (!validTarget) state.warnings.push('reference target is absent from the permitted snapshot')
      else for (const relation of supported) {
        const raw = await this.call('serena-lsp', relation === 'implements' ? 'implementations' : 'references', reference, input.timeout_ms, state)
        if (raw === null) continue
        const target = { ...reference, symbol_id: serenaSymbolId(reference.name_path, reference.relative_path) }
        const normalized = normalizeReferenceEdges(raw, this.evidenceOptions(snapshot, 'serena-lsp'), target, relation)
        nodes.unshift(...normalized.nodes); edges.push(...normalized.edges); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings)
      }
      if (input.max_depth > 1) state.warnings.push('Semantic trace contains one-hop results; deeper traversal is unverified.')
    }
    const unsupported = input.relations.filter(relation => !supported.includes(relation as 'references' | 'implements'))
    if (unsupported.length) state.warnings.push(`No validated ${input.direction} edge contract for: ${unsupported.join(', ')}`)
    const allNodes = [...new Map(nodes.map(node => [node.id, node])).values()]
    nodes = allNodes.slice(0, input.max_nodes)
    const ids = new Set(nodes.map(node => node.id))
    edges = [...new Map(edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => [`${edge.from}\0${edge.to}\0${edge.relation}`, edge])).values()]
    const omitted = allNodes.length - nodes.length
    if (omitted) state.warnings.push(`${omitted} trace nodes omitted by max_nodes; traversal is incomplete.`)
    return { data: { nodes, edges, frontier_remaining: omitted, traversal_complete: false } satisfies TraceData, provenance, ...state, warnings: state.warnings }
  }

  private async impact(input: z.infer<typeof ImpactInputSchema>, snapshot: Snapshot, state: RequestState) {
    const provenance: any[] = [], structural: any[] = [], semantic: any[] = [], documents: any[] = [], unresolved: string[] = []
    const targets = [...new Map((input.targets ?? []).map(target => [JSON.stringify(target), target])).values()]
    // Validate all scopes before the first backend can see a request.
    for (const target of targets) {
      const path = 'path' in target ? target.path : symbolArgs(target.symbol_id).relative_path
      if (path) assertSafePath(this.root, path, this.options.policy)
    }
    for (const target of targets) {
      const value = 'path' in target ? target.path : target.symbol_id
      let useful = false
      if (input.require_semantic) {
        const reference = 'symbol_id' in target ? symbolArgs(target.symbol_id) : null
        if (reference && !reference.relative_path) { unresolved.push(value); state.warnings.push('Impact references need a path-bound symbol_id.'); continue }
        const raw = reference
          ? await this.call('serena-lsp', 'references', reference, input.timeout_ms, state)
          : await this.call('serena-lsp', 'overview', { relative_path: (target as { path: string }).path, depth: 2 }, input.timeout_ms, state)
        if (raw !== null) {
          const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'serena-lsp'), 'symbol', 50)
          semantic.push(...normalized.items); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings); useful = normalized.items.length > 0
          if (!reference) state.warnings.push('File semantic evidence is a symbol overview, not an exhaustive impact analysis.')
        }
      }
      if (!useful) {
        const raw = await this.call('graft', 'context', { query: `impact of ${value}`, limit: 20, ...('path' in target ? { in: target.path } : {}) }, input.timeout_ms, state)
        if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'graft'), 'code', 50); structural.push(...normalized.items); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings); useful = normalized.items.length > 0 }
      }
      if (!useful) unresolved.push(value)
      if (state.calls >= 8) { state.warnings.push('Backend call budget exhausted; remaining targets were not queried.'); break }
    }
    if (input.include_docs) {
      const raw = await this.call('graphify', 'context', { question: `architecture impact ${JSON.stringify(targets)}`, depth: input.max_depth, token_budget: Math.ceil(responseByteLimit(state.limits) / 4) }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'graphify'), 'document', 50); documents.push(...normalized.items); provenance.push(...normalized.provenance); state.warnings.push(...normalized.warnings) }
    }
    return { data: { semantic_findings: semantic, structural_candidates: structural, documents, suggested_test_paths: [], unresolved } satisfies ImpactData, provenance, ...state }
  }

  private errorResponse(requestId: string, workspace: string, snapshotId: string, started: number, error: Error): CodeIntelligenceResponse<null> {
    const code = errorCode(error.message); const blocked = ['WORKSPACE_DENIED', 'SNAPSHOT_STALE', 'APPROVAL_REQUIRED', 'PLAN_EXPIRED', 'CAPABILITY_UNAVAILABLE', 'SCOPE_VIOLATION', 'WRITE_CONFLICT'].includes(code)
    return measureResponse({ schema_version: '0.1.0', request_id: requestId, workspace_id: workspace, snapshot_id: snapshotId, status: blocked ? 'blocked' : 'error', data: null, coverage: { backends_requested: [], backends_used: [], backends_missing: [], structural: 'unavailable', semantic: 'unavailable', documents: 'unavailable' }, provenance: [], warnings: [], metrics: { latency_ms: nowMs() - started, result_tokens: 0, token_count_kind: 'estimated', returned_bytes: 0 }, artifact_uri: null, error: { code, message: shorten(error.message, 256) } })
  }
}

export function createCodeIntelligenceCoordinator(root: string, options?: CodeIntelligenceCoordinatorOptions): CodeIntelligenceCoordinator { return new CodeIntelligenceCoordinator(root, options) }
