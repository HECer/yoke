import type { CodeIntelligenceResponse } from './contracts.js'
import { shorten } from './evidence.js'

export interface ResponseLimits { tokenBudget: number; maxBytes: number }
const TRUNCATED = 'BUDGET_EXCEEDED: result truncated; coverage is partial.'

/** The provider/tokenizer is unknown to this facade. Count one budget unit per
 * UTF-8 byte conservatively, including the response's own metrics. This is not
 * provider-measured token usage. JSON-RPC transport framing is outside this
 * structuredContent response and is not included. */
export function measureResponse<T>(response: CodeIntelligenceResponse<T>): CodeIntelligenceResponse<T> {
  response.metrics.token_count_kind = 'estimated'
  response.metrics.token_count_method = 'utf8_bytes_conservative'
  for (let i = 0; i < 10; i++) {
    const bytes = Buffer.byteLength(JSON.stringify(response), 'utf8')
    if (response.metrics.returned_bytes === bytes && response.metrics.result_tokens === bytes) return response
    response.metrics.returned_bytes = bytes; response.metrics.result_tokens = bytes
  }
  return response
}

export function responseByteLimit(limits: ResponseLimits): number {
  return Math.max(0, Math.floor(Math.min(limits.tokenBudget, limits.maxBytes)))
}

/** This fixed-size failure is the only exception when a caller's budget cannot
 * even represent the required error envelope. It never echoes backend content. */
export function budgetError(response: CodeIntelligenceResponse<unknown>): CodeIntelligenceResponse<null> {
  return measureResponse({
    schema_version: response.schema_version, request_id: shorten(response.request_id, 64), workspace_id: shorten(response.workspace_id, 128), snapshot_id: shorten(response.snapshot_id, 128),
    status: 'error', data: null,
    coverage: { backends_requested: [], backends_used: [], backends_missing: [], structural: 'unavailable', semantic: 'unavailable', documents: 'unavailable' },
    provenance: [], warnings: [], metrics: { latency_ms: response.metrics.latency_ms, result_tokens: 0, token_count_kind: 'estimated', returned_bytes: 0 }, artifact_uri: null,
    error: { code: 'BUDGET_EXCEEDED', message: 'Budget cannot represent the mandatory response envelope.' },
  })
}

function markPartial(response: CodeIntelligenceResponse<unknown>) {
  if (response.status === 'success') response.status = 'partial'
  for (const key of ['structural', 'semantic', 'documents'] as const) if (response.coverage[key] !== 'unavailable') response.coverage[key] = 'partial'
}

function usedEvidence(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) usedEvidence(entry, ids)
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (key === 'evidence_ids' && Array.isArray(entry)) {
      for (const id of entry) if (typeof id === 'string') ids.add(id)
    } else usedEvidence(entry, ids)
  }
  return ids
}

function pruneProvenance(response: CodeIntelligenceResponse<unknown>) {
  const ids = usedEvidence(response.data)
  response.provenance = response.provenance.filter(item => item.evidence_id && ids.has(item.evidence_id))
}

function shortenLargestText(value: unknown): boolean {
  const fields: Array<{ object: Record<string, unknown>; key: string; value: string }> = []
  function visit(node: unknown) {
    if (Array.isArray(node)) for (const item of node) visit(item)
    else if (node && typeof node === 'object') for (const [key, entry] of Object.entries(node)) {
      if (['excerpt', 'signature', 'message', 'label'].includes(key) && typeof entry === 'string' && entry.length > 64) fields.push({ object: node as Record<string, unknown>, key, value: entry })
      else if (entry && typeof entry === 'object') visit(entry)
    }
  }
  visit(value)
  const field = fields.sort((a, b) => Buffer.byteLength(b.value) - Buffer.byteLength(a.value))[0]
  if (!field) return false
  field.object[field.key] = shorten(field.value, Math.max(63, Math.floor(field.value.length / 2))) + '…'
  return true
}

function removeResultEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, any>
  // All facade result collections remain arrays; identifiers and operation
  // receipts stay intact. Never replace typed data with a prose excerpt.
  const keys = ['items', 'symbols', 'references', 'diagnostics', 'nodes', 'edges', 'semantic_findings', 'structural_candidates', 'documents', 'suggested_test_paths', 'unresolved', 'changed_paths']
  const candidates = keys.filter(key => Array.isArray(data[key]) && data[key].length > 0)
  candidates.sort((a, b) => Buffer.byteLength(JSON.stringify(data[b].at(-1))) - Buffer.byteLength(JSON.stringify(data[a].at(-1))))
  const key = candidates[0]
  if (!key) return false
  data[key].pop()
  if (key === 'nodes') {
    const ids = new Set(data.nodes.map((node: { id: string }) => node.id))
    data.edges = data.edges.filter((edge: { from: string; to: string }) => ids.has(edge.from) && ids.has(edge.to))
    data.frontier_remaining = (data.frontier_remaining ?? 0) + 1
    data.traversal_complete = false
  } else if (key === 'edges') {
    data.frontier_remaining = (data.frontier_remaining ?? 0) + 1
    data.traversal_complete = false
  }
  return true
}

/** Bound the complete structured response, not just result.data. Retained data
 * continues to satisfy its shape, and retained evidence links stay resolvable. */
export function fitResponse<T>(response: CodeIntelligenceResponse<T>, limits: ResponseLimits): CodeIntelligenceResponse<T | null> {
  const limit = responseByteLimit(limits)
  if (measureResponse(response).metrics.returned_bytes <= limit) return response
  markPartial(response)
  response.warnings = [TRUNCATED, ...response.warnings.filter(item => item !== TRUNCATED).map(item => shorten(item, 256))]
  pruneProvenance(response)
  while (measureResponse(response).metrics.returned_bytes > limit) {
    if (shortenLargestText(response.data)) continue
    if (removeResultEntry(response.data)) { pruneProvenance(response); continue }
    if (response.warnings.length > 1) { response.warnings = [TRUNCATED, 'Additional warnings omitted.']; if (measureResponse(response).metrics.returned_bytes <= limit) break; response.warnings = [TRUNCATED]; continue }
    // A long diagnostic is allowed to shrink, but error codes and rejection
    // status survive; an exhausted error body becomes the bounded budget error.
    if (response.error && response.error.message.length > 64) { response.error.message = shorten(response.error.message, 63) + '…'; continue }
    return budgetError(response)
  }
  return response
}
