import { z } from 'zod'

export const CodeIntelligenceModeSchema = z.enum(['off', 'shadow', 'active'])
export type CodeIntelligenceMode = z.infer<typeof CodeIntelligenceModeSchema>

export const BackendNameSchema = z.enum(['graft', 'graphify', 'serena-lsp', 'serena-jetbrains', 'yoke'])
export type BackendName = z.infer<typeof BackendNameSchema>
export const StatusSchema = z.enum(['success', 'partial', 'blocked', 'error'])
export type Status = z.infer<typeof StatusSchema>
export const ResolutionSchema = z.enum(['resolved', 'unresolved', 'ambiguous', 'not_applicable'])
export const FreshnessSchema = z.enum(['current', 'stale', 'unknown'])

export const ProvenanceSchema = z.object({
  backend: BackendNameSchema,
  version: z.string().min(1),
  source_path: z.string().nullable(),
  content_hash: z.string().nullable(),
  byte_range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).nullable(),
  origin: z.enum(['parser', 'resolver', 'lsp', 'ide', 'llm', 'manual']),
  resolution: ResolutionSchema,
  freshness: FreshnessSchema,
})
export type Provenance = z.infer<typeof ProvenanceSchema>

export const CoverageSchema = z.object({
  backends_requested: z.array(BackendNameSchema),
  backends_used: z.array(BackendNameSchema),
  backends_missing: z.array(BackendNameSchema),
  structural: z.enum(['complete', 'partial', 'unavailable']),
  semantic: z.enum(['complete', 'partial', 'unavailable']),
  documents: z.enum(['complete', 'partial', 'unavailable']),
})
export type Coverage = z.infer<typeof CoverageSchema>

export const MetricsSchema = z.object({
  latency_ms: z.number().nonnegative(),
  result_tokens: z.number().int().nonnegative(),
  token_count_kind: z.enum(['exact', 'estimated']),
  returned_bytes: z.number().int().nonnegative(),
})
export type Metrics = z.infer<typeof MetricsSchema>

export const ErrorSchema = z.object({
  code: z.enum([
    'INVALID_ARGUMENT', 'WORKSPACE_DENIED', 'CAPABILITY_UNAVAILABLE', 'SNAPSHOT_STALE',
    'AMBIGUOUS_SYMBOL', 'BACKEND_TIMEOUT', 'BACKEND_UNAVAILABLE', 'BUDGET_EXCEEDED',
    'APPROVAL_REQUIRED', 'PLAN_EXPIRED', 'SCOPE_VIOLATION', 'VALIDATION_FAILED',
    'WRITE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INTERNAL_ERROR',
  ]),
  message: z.string().min(1),
  backend: BackendNameSchema.optional(),
})
export type CodeIntelligenceError = z.infer<typeof ErrorSchema>

export const ItemSchema = z.object({
  item_id: z.string().min(1),
  kind: z.enum(['symbol', 'code', 'document', 'memory', 'summary']),
  path: z.string().nullable(),
  excerpt: z.string().max(12000),
  evidence_ids: z.array(z.string().min(1)),
  rank: z.number().nonnegative(),
})
export const SymbolSchema = z.object({
  symbol_id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().nullable(),
  kind: z.string().min(1),
  signature: z.string().nullable(),
  evidence_ids: z.array(z.string().min(1)),
})
export const ReferenceSchema = z.object({
  symbol_id: z.string().min(1),
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  excerpt: z.string().max(4000),
  evidence_ids: z.array(z.string().min(1)),
})
export const DiagnosticSchema = z.object({
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  severity: z.enum(['error', 'warning', 'info', 'unknown']),
  message: z.string().max(4000),
  evidence_ids: z.array(z.string().min(1)),
})

export const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(['calls', 'references', 'imports', 'implements', 'extends', 'docs', 'rationale_for', 'related_to']),
  evidence_ids: z.array(z.string().min(1)),
})

export const ResponseBaseSchema = z.object({
  schema_version: z.literal('0.1.0'),
  request_id: z.string().min(1),
  workspace_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  status: StatusSchema,
  coverage: CoverageSchema,
  provenance: z.array(ProvenanceSchema),
  warnings: z.array(z.string()),
  metrics: MetricsSchema,
  artifact_uri: z.string().nullable(),
  error: ErrorSchema.nullable(),
})
export type ResponseBase = z.infer<typeof ResponseBaseSchema>

const BudgetSchema = z.object({
  token_budget: z.number().int().min(128).max(16000).default(2400),
  timeout_ms: z.number().int().min(100).max(60000).default(5000),
})

export const ContextInputSchema = z.object({
  workspace_id: z.string().min(1), query: z.string().min(1).max(20000), snapshot_id: z.string().min(1).optional(),
  mode: z.enum(['orient', 'locate', 'explain']).default('orient'), paths: z.array(z.string().min(1)).max(32).default([]),
  include_docs: z.boolean().default(false), ...BudgetSchema.shape,
})
export const SymbolInputSchema = z.object({
  workspace_id: z.string().min(1), snapshot_id: z.string().min(1), symbol_id: z.string().min(1).optional(),
  query: z.string().min(1).optional(), path: z.string().min(1).optional(),
  include: z.array(z.enum(['definition', 'references', 'implementations', 'diagnostics'])).default(['definition']), ...BudgetSchema.shape,
}).refine(v => Boolean(v.symbol_id) !== Boolean(v.query), 'exactly one of symbol_id or query is required')
export const TraceInputSchema = z.object({
  workspace_id: z.string().min(1), snapshot_id: z.string().min(1), symbol_id: z.string().min(1),
  direction: z.enum(['in', 'out']), relations: z.array(z.enum(['calls', 'references', 'imports', 'implements', 'extends'])).min(1),
  max_depth: z.number().int().min(1).max(6).default(2), max_nodes: z.number().int().min(1).max(2000).default(200),
  require_resolved: z.boolean().default(false), timeout_ms: z.number().int().min(100).max(60000).default(5000),
})
const TargetSchema = z.union([z.object({ path: z.string().min(1) }), z.object({ symbol_id: z.string().min(1) })])
export const ImpactInputSchema = z.object({
  workspace_id: z.string().min(1), snapshot_id: z.string().min(1), targets: z.array(TargetSchema).max(50).optional(),
  plan_id: z.string().min(1).optional(), include_docs: z.boolean().default(true), require_semantic: z.boolean().default(true),
  max_depth: z.number().int().min(1).max(6).default(3), timeout_ms: z.number().int().min(100).max(60000).default(10000),
}).refine(v => Boolean(v.targets) !== Boolean(v.plan_id), 'exactly one of targets or plan_id is required')

const OperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rename'), symbol_id: z.string().min(1), new_name: z.string().regex(/^[A-Za-z_$][\w$]*$/) }),
  z.object({ kind: z.literal('replace_symbol_body'), symbol_id: z.string().min(1), content: z.string().max(500000) }),
  z.object({ kind: z.literal('insert_before_symbol'), symbol_id: z.string().min(1), content: z.string().max(500000) }),
  z.object({ kind: z.literal('insert_after_symbol'), symbol_id: z.string().min(1), content: z.string().max(500000) }),
  z.object({ kind: z.literal('safe_delete'), symbol_id: z.string().min(1) }),
])
export const EditPreviewInputSchema = z.object({
  workspace_id: z.string().min(1), snapshot_id: z.string().min(1), operations: z.array(OperationSchema).min(1).max(20),
  validation_profile: z.enum(['default', 'extended']), timeout_ms: z.number().int().min(100).max(600000).default(120000),
})
export const EditApplyInputSchema = z.object({
  workspace_id: z.string().min(1), plan_id: z.string().min(1), expected_snapshot_id: z.string().min(1),
  idempotency_key: z.string().min(8).max(128),
})

export type ContextInput = z.infer<typeof ContextInputSchema>
export type SymbolInput = z.infer<typeof SymbolInputSchema>
export type TraceInput = z.infer<typeof TraceInputSchema>
export type ImpactInput = z.infer<typeof ImpactInputSchema>
export type EditPreviewInput = z.infer<typeof EditPreviewInputSchema>
export type EditApplyInput = z.infer<typeof EditApplyInputSchema>
export type Operation = z.infer<typeof OperationSchema>

export interface CodeIntelligenceResponse<T> extends ResponseBase { data: T }
export interface ContextData { items: z.infer<typeof ItemSchema>[]; next_cursor: string | null }
export interface SymbolData { symbols: z.infer<typeof SymbolSchema>[]; references: z.infer<typeof ReferenceSchema>[]; diagnostics: z.infer<typeof DiagnosticSchema>[] }
export interface TraceData { nodes: Array<{ id: string; label: string; path: string | null; evidence_ids: string[] }>; edges: z.infer<typeof EdgeSchema>[]; frontier_remaining: number }
export interface ImpactData { semantic_findings: z.infer<typeof ItemSchema>[]; structural_candidates: z.infer<typeof ItemSchema>[]; documents: z.infer<typeof ItemSchema>[]; suggested_test_paths: string[]; unresolved: string[] }
export interface PreviewData { plan_id: string; plan_hash: string; diff_uri: string; changed_paths: string[]; validation: 'passed' | 'failed' | 'incomplete'; approval_required: true; expires_at: string }
export interface ApplyData { plan_id: string; transaction_id: string; changed_paths: string[]; new_snapshot_id: string; validation: 'passed' | 'failed' | 'incomplete'; committed: false; merged: false }

export const TOOL_NAMES = ['code_context', 'code_symbol', 'code_trace', 'code_impact', 'code_edit_preview', 'code_edit_apply'] as const
export type ToolName = typeof TOOL_NAMES[number]

export const TOOL_DEFINITIONS = TOOL_NAMES.map(name => ({
  name,
  description: `Yoke-controlled ${name.replace('code_', '').replace('_', ' ')} with snapshot-bound evidence.`,
  inputSchema: { type: 'object', additionalProperties: false },
  annotations: { openWorldHint: false, destructiveHint: name === 'code_edit_apply', readOnlyHint: name !== 'code_edit_preview' && name !== 'code_edit_apply', idempotentHint: name !== 'code_edit_apply' },
}))
