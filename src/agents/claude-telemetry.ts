import type { ProviderTelemetry } from './types.js'

type Usage = NonNullable<ProviderTelemetry['partialUsage']>
type NumericField = Exclude<keyof Usage, 'model'>
const fields: NumericField[] = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'totalCostUsd']
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

function normalized(value: unknown, modelUsage = false): Usage {
  if (!record(value)) return {}
  const raw: Record<NumericField, unknown> = modelUsage ? {
    inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    cachedInputTokens: value.cacheReadInputTokens, cacheWriteInputTokens: value.cacheCreationInputTokens,
    reasoningOutputTokens: value.reasoningOutputTokens, totalCostUsd: value.costUSD,
  } : {
    inputTokens: value.input_tokens, outputTokens: value.output_tokens,
    cachedInputTokens: value.cache_read_input_tokens, cacheWriteInputTokens: value.cache_creation_input_tokens,
    reasoningOutputTokens: value.reasoning_output_tokens, totalCostUsd: undefined,
  }
  const usage: Usage = {}
  for (const field of fields) { const measured = number(raw[field]); if (measured !== undefined) usage[field] = measured }
  return usage
}

function resultUsage(event: Record<string, unknown>, nested: boolean): ProviderTelemetry {
  let usage = normalized(event.usage)
  let partial: Usage = {}
  const models = record(event.modelUsage) ? Object.entries(event.modelUsage) : []
  if (models.length) {
    usage = {}
    const samples = models.map(([, value]) => normalized(value, true))
    for (const field of fields) {
      const known = samples.map(sample => sample[field]).filter((value): value is number => value !== undefined)
      const sum = known.reduce((total, value) => total + value, 0)
      if (known.length && Number.isFinite(sum)) {
        if (known.length === samples.length) usage[field] = sum
        else partial[field] = sum
      }
    }
  }
  const cost = number(event.total_cost_usd)
  if (cost !== undefined) { usage.totalCostUsd = cost; delete partial.totalCostUsd }
  const reportedModels = models.map(([model]) => model).filter(Boolean)
  if (reportedModels.length === 1) usage.model = reportedModels[0]
  const complete = usage.inputTokens !== undefined && usage.outputTokens !== undefined && (!nested || models.length > 0)
  if (!complete) {
    const measured = { ...usage, ...partial }
    return { usageAvailable: false, ...(Object.keys(measured).length ? { partialUsage: measured } : {}), ...(reportedModels.length ? { reportedModels } : {}) }
  }
  return { usageAvailable: true, tokens: { ...usage, inputTokens: usage.inputTokens!, outputTokens: usage.outputTokens! },
    ...(Object.keys(partial).length ? { partialUsage: partial } : {}), ...(reportedModels.length > 1 ? { reportedModels } : {}) }
}

/** Claude assistant usage is per message ID, not a cumulative invocation total.
 * Input/cache snapshots are useful lower bounds on interruption. Assistant
 * output_tokens can be placeholders; only result usage supplies output totals.
 * Result modelUsage includes nested agents; result usage alone does not.
 */
export function createClaudeTelemetry() {
  const messages = new Map<string, Usage>()
  const anonymous: Usage = {}
  const accounted = new Map<string, Usage>()
  let accountedAnonymous: Usage = {}
  let checkpoint: Usage = {}
  let session: string | undefined
  const MAX_MESSAGES = 10_000
  let latest: ProviderTelemetry | undefined
  const observedModels = new Set<string>()
  let nested = false
  return {
    consume(event: Record<string, unknown>): void {
      if (event.parent_tool_use_id != null) { nested = true; return }
      if (typeof event.session_id === 'string' && event.session_id) {
        if (session !== undefined && session !== event.session_id) {
          messages.clear(); accounted.clear(); observedModels.clear()
          for (const field of fields) delete anonymous[field]
          checkpoint = {}; accountedAnonymous = {}; latest = undefined; nested = false
        }
        session = event.session_id
      }
      const message = record(event.message) ? event.message : undefined
      const named = event.model ?? message?.model
      if (typeof named === 'string' && named && named.length <= 1024 && observedModels.size < 64) observedModels.add(named)
      if (event.type === 'result') {
        const next = resultUsage(event, nested)
        for (const model of next.reportedModels ?? (next.tokens?.model ? [next.tokens.model] : [])) {
          if (model.length <= 1024 && observedModels.size < 64) observedModels.add(model)
        }
        const measured = { ...next.tokens, ...next.partialUsage }
        // Session crashes can zero the envelope despite already consumed work.
        // A crash is never evidence of dispatch-free zero usage.
        const crash = event.subtype === 'error_during_execution'
        if (crash && !fields.some(field => (measured[field] ?? 0) > 0)) {
          latest = undefined
          return
        }
        if (crash) {
          const known = this.finish()
          const lowerBound = { ...known.tokens, ...known.partialUsage }
          // Compare only lower bounds within this invocation/session, never
          // across a reset or as a replacement for ordinary result scopes.
          for (const field of fields) if (lowerBound[field] !== undefined) measured[field] = Math.max(measured[field] ?? 0, lowerBound[field]!)
        }
        if (Object.keys(measured).length) {
          checkpoint = measured
          accounted.clear()
          for (const [id, usage] of messages) accounted.set(id, { ...usage })
          accountedAnonymous = { ...anonymous }
        }
        latest = crash ? { usageAvailable: false, ...(Object.keys(measured).length ? { partialUsage: measured } : {}) } : next
        // A result with no measurements cannot erase earlier lower bounds.
        if (!Object.keys(measured).length) latest = undefined
        return
      }
      if (event.type !== 'assistant' || !message) return
      latest = undefined
      const usage = normalized(message.usage)
      delete usage.outputTokens
      const id = typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 256 ? message.id : undefined
      // Without an identity, summing can double-count tool blocks. Keep only a
      // lower bound. Bound deduplication memory even for malformed providers.
      const previous = id && (messages.has(id) || messages.size < MAX_MESSAGES) ? (messages.get(id) ?? {}) : anonymous
      for (const field of fields) {
        if (usage[field] !== undefined) previous[field] = Math.max(previous[field] ?? 0, usage[field]!)
      }
      if (id && previous !== anonymous) messages.set(id, previous)
    },
    finish(): ProviderTelemetry {
      const reportedModels = [...observedModels]
      if (latest) {
        if (latest.tokens?.model || latest.reportedModels?.length || !reportedModels.length) return latest
        if (latest.tokens && reportedModels.length === 1) return { ...latest, tokens: { ...latest.tokens, model: reportedModels[0] } }
        return { ...latest, reportedModels }
      }
      const partialUsage: Usage = { ...checkpoint }
      delete partialUsage.model
      const delta: Usage = {}
      for (const [id, usage] of messages) {
        const baseline = accounted.get(id)
        for (const field of fields) if (usage[field] !== undefined) delta[field] = (delta[field] ?? 0) + Math.max(0, usage[field]! - (baseline?.[field] ?? 0))
      }
      // An anonymous snapshot may duplicate an identified one; do not add it.
      for (const field of fields) if (anonymous[field] !== undefined) delta[field] = Math.max(delta[field] ?? 0, anonymous[field]! - (accountedAnonymous[field] ?? 0))
      for (const field of fields) if (delta[field] !== undefined) partialUsage[field] = (partialUsage[field] ?? 0) + delta[field]!
      for (const field of fields) if (partialUsage[field] !== undefined && !Number.isFinite(partialUsage[field])) delete partialUsage[field]
      return { usageAvailable: false, ...(Object.keys(partialUsage).length ? { partialUsage } : {}), ...(reportedModels.length ? { reportedModels } : {}) }
    },
  }
}
