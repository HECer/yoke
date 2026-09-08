import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  ContextInputSchema, EditApplyInputSchema, EditPreviewInputSchema, ImpactInputSchema, SymbolInputSchema, TraceInputSchema,
  type CodeIntelligenceResponse, type ContextData, type ApplyData, type EditApplyInput, type EditPreviewInput, type ImpactData, type PreviewData, type Status, type SymbolData, type TraceData,
} from './contracts.js'
import { createGraftAdapter, createGraphifyAdapter, createSerenaAdapter, type BackendAdapter } from './adapters/index.js'
import { normalizeEdges, normalizeItems, normalizeSymbols, type TraceNode } from './evidence.js'
import { assertSafePath, assertSnapshotCurrent, createSnapshot, loadSnapshot, type Snapshot, type SnapshotPolicy, workspaceId } from './snapshots.js'
import { applyEditPlan } from './transactions.js'
import { createEditPlan, loadEditPlan, type EditPlan } from './edit-plans.js'

export interface BackendProcess { command?: string; args?: string[] }
export interface CodeIntelligenceCoordinatorOptions {
  mode?: 'off' | 'shadow' | 'active'
  policy?: SnapshotPolicy
  limits?: { tokenBudget?: number; timeoutMs?: number; maxBytes?: number; maxBackends?: number }
  graft?: BackendProcess
  graphify?: BackendProcess
  serena?: BackendProcess
  adapters?: Partial<Record<'graft' | 'graphify' | 'serena-lsp', BackendAdapter>>
}

function nowMs(): number { return Date.now() }
function compact(value: unknown, maxBytes: number): unknown {
  const encoded = JSON.stringify(value) ?? ''
  if (Buffer.byteLength(encoded) <= maxBytes) return value
  return { truncated: true, excerpt: encoded.slice(0, Math.max(0, maxBytes - 64)) }
}
function statusFor(missing: string[], hard = false): Status { return hard ? 'error' : missing.length ? 'partial' : 'success' }
function errorCode(message: string): any {
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
    this.root = root; this.workspace_id = workspaceId(root); this.options = options
    this.adapters = {
      graft: options.adapters?.graft ?? createGraftAdapter(root, options.graft),
      graphify: options.adapters?.graphify ?? createGraphifyAdapter(root, options.graphify),
      'serena-lsp': options.adapters?.['serena-lsp'] ?? createSerenaAdapter(root, options.serena),
    }
  }

  async close(): Promise<void> { await Promise.all(Object.values(this.adapters).map(adapter => adapter.close())) }

  async dispatch(name: string, input: unknown): Promise<CodeIntelligenceResponse<unknown>> {
    const requestId = randomUUID(); const started = nowMs(); const suppliedWorkspace = typeof input === 'object' && input !== null && typeof (input as any).workspace_id === 'string' ? (input as any).workspace_id : this.workspace_id
    let snapshot: Snapshot
    try { snapshot = this.snapshotFor(input) } catch (error) { return this.errorResponse(requestId, suppliedWorkspace, this.safeSnapshotId(), started, error as Error) }
    try {
      let result: { data: unknown; provenance: any[]; used: string[]; missing: string[]; warnings: string[]; hard?: boolean }
      switch (name) {
        case 'code_context': result = await this.context(ContextInputSchema.parse(input), snapshot); break
        case 'code_symbol': result = await this.symbol(SymbolInputSchema.parse(input), snapshot); break
        case 'code_trace': result = await this.trace(TraceInputSchema.parse(input), snapshot); break
        case 'code_impact': result = await this.impact(ImpactInputSchema.parse(input), snapshot); break
        case 'code_edit_preview': result = await this.preview(EditPreviewInputSchema.parse(input), snapshot); break
        case 'code_edit_apply': result = await this.apply(EditApplyInputSchema.parse(input), snapshot); break
        default: throw new Error(`unknown code-intelligence tool: ${name}`)
      }
      const bytes = Buffer.byteLength(JSON.stringify(result.data) ?? '')
      const maxBytes = this.options.limits?.maxBytes ?? 2_000_000
      return {
        schema_version: '0.1.0', request_id: requestId, workspace_id: this.workspace_id, snapshot_id: snapshot.snapshot_id,
        status: statusFor(result.missing, result.hard), data: compact(result.data, maxBytes), coverage: this.coverage(result.used, result.missing), provenance: result.provenance,
        warnings: result.warnings, metrics: { latency_ms: nowMs() - started, result_tokens: Math.ceil(bytes / 4), token_count_kind: 'estimated', returned_bytes: Math.min(bytes, maxBytes) }, artifact_uri: null, error: null,
      }
    } catch (error) { return this.errorResponse(requestId, this.workspace_id, snapshot.snapshot_id, started, error as Error) }
  }

  private snapshotFor(input: unknown): Snapshot {
    const candidate = input && typeof input === 'object' ? input as any : {}
    if (candidate.workspace_id && candidate.workspace_id !== this.workspace_id) throw new Error('workspace is not permitted')
    const snapshot = candidate.snapshot_id ? loadSnapshot(this.root, candidate.snapshot_id) : createSnapshot(this.root, this.options.policy, this.workspace_id)
    if (candidate.snapshot_id) assertSnapshotCurrent(this.root, snapshot, this.options.policy)
    return snapshot
  }

  private safeSnapshotId(): string {
    try { return createSnapshot(this.root, this.options.policy, this.workspace_id).snapshot_id } catch { return '0'.repeat(64) }
  }

  private coverage(used: string[], missing: string[]) {
    return {
      backends_requested: [...new Set([...used, ...missing])], backends_used: [...new Set(used)], backends_missing: [...new Set(missing)],
      structural: used.includes('graft') ? 'complete' as const : 'unavailable' as const,
      semantic: used.includes('serena-lsp') ? 'complete' as const : 'unavailable' as const,
      documents: used.includes('graphify') ? 'complete' as const : 'unavailable' as const,
    } as any
  }

  private async call(backend: 'graft' | 'graphify' | 'serena-lsp', tool: string, args: Record<string, unknown>, timeout: number, state: { used: string[]; missing: string[]; warnings: string[] }): Promise<unknown | null> {
    const seen = new Set([...state.used, ...state.missing]); const maxBackends = this.options.limits?.maxBackends ?? 3
    if (!seen.has(backend) && seen.size >= maxBackends) { state.missing.push(backend); state.warnings.push(`${backend}: backend budget exceeded`); return null }
    try { const value = await this.adapters[backend].call({ tool, arguments: args }, Math.min(timeout, this.options.limits?.timeoutMs ?? timeout)); if (!state.used.includes(backend)) state.used.push(backend); return value }
    catch (error) { if (!state.missing.includes(backend)) state.missing.push(backend); state.warnings.push(`${backend}: ${(error as Error).message}`); return null }
  }

  private evidenceOptions(snapshot: Snapshot, backend: 'graft' | 'graphify' | 'serena-lsp', maxChars = 12000) {
    return { root: this.root, snapshot, adapter: this.adapters[backend], maxChars }
  }

  private async context(input: z.infer<typeof ContextInputSchema>, snapshot: Snapshot) {
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const provenance: any[] = []; let items: any[] = []
    const raw = await this.call('graft', 'context', { query: input.query, limit: Math.max(1, Math.floor(input.token_budget / 300)), ...(input.paths[0] ? { in: input.paths[0] } : {}) }, input.timeout_ms, state)
    if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'graft'), 'code', 100); items.push(...normalized.items); provenance.push(...normalized.provenance) }
    if (input.include_docs) {
      const docs = await this.call('graphify', 'context', { question: input.query, depth: 3, token_budget: input.token_budget }, input.timeout_ms, state)
      if (docs !== null) { const normalized = normalizeItems(docs, this.evidenceOptions(snapshot, 'graphify'), 'document', 50); items.push(...normalized.items); provenance.push(...normalized.provenance) }
    }
    return { data: { items, next_cursor: null } satisfies ContextData, provenance, ...state, warnings: state.warnings }
  }

  private async symbol(input: z.infer<typeof SymbolInputSchema>, snapshot: Snapshot) {
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const provenance: any[] = []; let symbols: any[] = []; let references: any[] = []; let diagnostics: any[] = []
    const name = input.symbol_id ?? input.query!
    const reference = symbolArgs(name, input.path ?? '')
    const graft = await this.call('graft', 'context', { query: name, limit: 10, ...(input.path ? { in: input.path } : {}) }, input.timeout_ms, state)
    if (graft !== null) { const normalized = normalizeItems(graft, this.evidenceOptions(snapshot, 'graft'), 'symbol', 20); symbols.push(...normalized.items.map(item => ({ symbol_id: `graft:${item.item_id}`, name: item.excerpt.split(/\s|\(|\{/u)[0] ?? name, path: item.path, kind: 'unknown', signature: item.excerpt.slice(0, 500), evidence_ids: item.evidence_ids }))); provenance.push(...normalized.provenance) }
    const symbol = await this.call('serena-lsp', 'symbol', { name_path_pattern: reference.name_path, depth: 0, relative_path: reference.relative_path, include_body: false, max_matches: 20 }, input.timeout_ms, state)
    if (symbol !== null) { const normalized = normalizeSymbols(symbol, this.evidenceOptions(snapshot, 'serena-lsp')); symbols.push(...normalized.symbols); provenance.push(...normalized.provenance) }
    if (input.include.includes('references')) {
      const raw = await this.call('serena-lsp', 'references', reference, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'serena-lsp'), 'code', 100); references = normalized.items.map(item => ({ symbol_id: input.symbol_id ?? `symbol-${item.item_id.slice(5)}`, path: item.path, line: null, excerpt: item.excerpt, evidence_ids: item.evidence_ids })); provenance.push(...normalized.provenance) }
    }
    if (input.include.includes('implementations')) {
      const raw = await this.call('serena-lsp', 'implementations', reference, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeSymbols(raw, this.evidenceOptions(snapshot, 'serena-lsp')); symbols.push(...normalized.symbols); provenance.push(...normalized.provenance) }
    }
    if (input.include.includes('diagnostics')) {
      const raw = await this.call('serena-lsp', 'diagnostics', { relative_path: reference.relative_path }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'serena-lsp'), 'code', 100); diagnostics = normalized.items.map(item => ({ path: item.path, line: null, severity: 'unknown', message: item.excerpt, evidence_ids: item.evidence_ids })); provenance.push(...normalized.provenance) }
    }
    return { data: { symbols, references, diagnostics } satisfies SymbolData, provenance, ...state, warnings: state.warnings }
  }

  private async trace(input: z.infer<typeof TraceInputSchema>, snapshot: Snapshot) {
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const provenance: any[] = []; let nodes: TraceNode[] = []; let edges: any[] = []
    const raw = await this.call('graft', 'trace', { symbol: input.symbol_id, direction: input.direction, depth: input.max_depth }, input.timeout_ms, state)
    if (raw !== null) { const normalized = normalizeEdges(raw, this.evidenceOptions(snapshot, 'graft'), input.relations[0] ?? 'references'); nodes.push(...normalized.nodes); edges.push(...normalized.edges); provenance.push(...normalized.provenance) }
    if (input.require_resolved || input.relations.some(relation => relation === 'implements' || relation === 'extends')) {
      const rawSemantic = await this.call('serena-lsp', 'references', symbolArgs(input.symbol_id), input.timeout_ms, state)
      if (rawSemantic !== null) { const normalized = normalizeEdges(rawSemantic, this.evidenceOptions(snapshot, 'serena-lsp'), 'references'); nodes.push(...normalized.nodes); edges.push(...normalized.edges); provenance.push(...normalized.provenance) }
    }
    nodes = [...new Map(nodes.map(node => [node.id, node])).values()].slice(0, input.max_nodes); edges = edges.filter(edge => nodes.some(node => node.id === edge.from) && nodes.some(node => node.id === edge.to))
    return { data: { nodes, edges, frontier_remaining: Math.max(0, edges.length - nodes.length) } satisfies TraceData, provenance, ...state, warnings: state.warnings }
  }

  private async impact(input: z.infer<typeof ImpactInputSchema>, snapshot: Snapshot) {
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const provenance: any[] = []; const structural: any[] = []; const semantic: any[] = []; const documents: any[] = []; const unresolved: string[] = []
    let targets = input.targets
    if (!targets && input.plan_id) {
      const plan = loadEditPlan(this.root, input.plan_id)
      if (plan.workspace_id !== this.workspace_id) throw new Error('impact plan belongs to another workspace')
      targets = plan.changed_paths.map(path => ({ path }))
    }
    targets ??= []
    for (const target of targets) {
      const value = 'path' in target ? target.path : target.symbol_id
      const raw = await this.call('graft', 'context', { query: `impact of ${value}`, limit: 20, ...('path' in target ? { in: target.path } : {}) }, input.timeout_ms, state)
      if (raw !== null) { const normalized = normalizeItems(raw, this.evidenceOptions(snapshot, 'graft'), 'code', 50); structural.push(...normalized.items); provenance.push(...normalized.provenance) } else unresolved.push(value)
      if (input.require_semantic) {
        const rawSemantic = 'symbol_id' in target
          ? await this.call('serena-lsp', 'references', symbolArgs(target.symbol_id), input.timeout_ms, state)
          : await this.call('serena-lsp', 'overview', { relative_path: target.path, depth: 2 }, input.timeout_ms, state)
        if (rawSemantic !== null) { const normalized = normalizeItems(rawSemantic, this.evidenceOptions(snapshot, 'serena-lsp'), 'symbol', 50); semantic.push(...normalized.items); provenance.push(...normalized.provenance) } else unresolved.push('symbol_id' in target ? target.symbol_id : target.path)
      }
    }
    if (input.include_docs) {
      const docs = await this.call('graphify', 'context', { question: `architecture impact ${JSON.stringify(targets)}`, depth: input.max_depth, token_budget: 2000 }, input.timeout_ms, state)
      if (docs !== null) { const normalized = normalizeItems(docs, this.evidenceOptions(snapshot, 'graphify'), 'document', 50); documents.push(...normalized.items); provenance.push(...normalized.provenance) }
    }
    const suggested = [...new Set(snapshot.files.map(file => file.path).filter(path => /(^|\/)(test|tests|__tests__|spec)(\/|\.)/u.test(path)))].slice(0, 20)
    return { data: { semantic_findings: semantic, structural_candidates: structural, documents, suggested_test_paths: suggested, unresolved } satisfies ImpactData, provenance, ...state, warnings: state.warnings }
  }

  private async preview(input: EditPreviewInput, snapshot: Snapshot) {
    if (this.options.mode !== 'active') throw new Error('code edits require code-intelligence mode=active')
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const provenance: any[] = []; const sandbox = join(this.root, '.yoke', 'code-intelligence', 'worktrees', `preview-${randomUUID()}`)
    mkdirSync(sandbox, { recursive: true })
    for (const file of snapshot.files) { const source = join(this.root, file.path); const target = join(sandbox, file.path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target) }
    const adapter = createSerenaAdapter(sandbox, this.options.serena); const changed = new Set<string>()
    try {
      for (const operation of input.operations) {
        const reference = symbolArgs(operation.symbol_id)
        const args: Record<string, unknown> = 'new_name' in operation ? { ...reference, new_name: operation.new_name } : operation.kind === 'safe_delete' ? { name_path_pattern: reference.name_path, relative_path: reference.relative_path } : { ...reference, body: 'content' in operation ? operation.content : '' }
        const tool = operation.kind === 'safe_delete' ? 'safe_delete' : operation.kind
        try { await adapter.call({ tool, arguments: args }, input.timeout_ms); state.used.push('serena-lsp') } catch (error) { state.missing.push('serena-lsp'); state.warnings.push(`serena-lsp: ${(error as Error).message}`); break }
      }
    } finally { await adapter.close() }
    const diffs: string[] = []
    for (const file of snapshot.files) { const before = readFileSync(join(this.root, file.path)); const afterPath = join(sandbox, file.path); if (!existsSync(afterPath)) { changed.add(file.path); diffs.push(`--- a/${file.path}\n+++ /dev/null\n`); continue } const after = readFileSync(afterPath); if (!before.equals(after)) { changed.add(file.path); diffs.push(`--- a/${file.path}\n+++ b/${file.path}\n@@\n-${before.toString('utf8')}\n+${after.toString('utf8')}\n`) } }
    const diff = diffs.join('\n').slice(0, this.options.limits?.maxBytes ?? 2_000_000); const plan = createEditPlan(this.root, snapshot, sandbox, input.operations, state.missing.length ? 'incomplete' : 'passed', input.validation_profile, [...changed], diff)
    return { data: plan satisfies PreviewData, provenance, ...state, warnings: state.warnings }
  }

  private async apply(input: EditApplyInput, snapshot: Snapshot) {
    if (this.options.mode !== 'active') throw new Error('code edits require code-intelligence mode=active')
    const state = { used: [] as string[], missing: [] as string[], warnings: [] as string[] }; const plan = loadEditPlan(this.root, input.plan_id)
    if (plan.workspace_id !== this.workspace_id || plan.snapshot_id !== input.expected_snapshot_id) throw new Error('edit plan scope does not match workspace or expected snapshot')
    const expected = loadSnapshot(this.root, input.expected_snapshot_id); assertSnapshotCurrent(this.root, expected, this.options.policy)
    const result = applyEditPlan(this.root, plan, expected, input.idempotency_key); return { data: { plan_id: result.plan_id, transaction_id: result.transaction_id, changed_paths: result.changed_paths, new_snapshot_id: result.new_snapshot_id, validation: result.validation, committed: false, merged: false } satisfies ApplyData, provenance: [], ...state, warnings: state.warnings }
  }

  private errorResponse(requestId: string, workspace: string, snapshotId: string, started: number, error: Error): CodeIntelligenceResponse<null> {
    const code = errorCode(error.message); const blocked = ['WORKSPACE_DENIED', 'SNAPSHOT_STALE', 'APPROVAL_REQUIRED', 'PLAN_EXPIRED', 'CAPABILITY_UNAVAILABLE', 'SCOPE_VIOLATION', 'WRITE_CONFLICT'].includes(code)
    return { schema_version: '0.1.0', request_id: requestId, workspace_id: workspace, snapshot_id: snapshotId, status: blocked ? 'blocked' : 'error', data: null, coverage: { backends_requested: [], backends_used: [], backends_missing: [], structural: 'unavailable', semantic: 'unavailable', documents: 'unavailable' }, provenance: [], warnings: [], metrics: { latency_ms: nowMs() - started, result_tokens: 0, token_count_kind: 'exact', returned_bytes: 0 }, artifact_uri: null, error: { code, message: error.message } }
  }
}

export function createCodeIntelligenceCoordinator(root: string, options?: CodeIntelligenceCoordinatorOptions): CodeIntelligenceCoordinator { return new CodeIntelligenceCoordinator(root, options) }
