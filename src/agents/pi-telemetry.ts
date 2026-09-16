import type { ProviderTelemetry } from './types.js'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Pi usage is per assistant message, not cumulative across a run. */
export function createPiTelemetry() {
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const models = new Set<string>()
  let turns = 0
  let legacyUsage: Record<string, unknown> | undefined
  const add = (usage: Record<string, unknown> | undefined) => {
    turns++
    const fields = {
      inputTokens: usage?.input, outputTokens: usage?.output,
      cachedInputTokens: usage?.cacheRead, cacheWriteInputTokens: usage?.cacheWrite,
      reasoningOutputTokens: usage?.reasoning,
      totalCostUsd: record(usage?.cost) ? usage.cost.total : undefined,
    }
    for (const [key, value] of Object.entries(fields)) if (finite(value)) {
      totals[key] = (totals[key] ?? 0) + value
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return {
    consume(event: Record<string, unknown>) {
      // Compatibility with earlier top-level snapshots; never override a final usage.
      if (event.type === 'message_update' && record(event.usage)) legacyUsage = event.usage
      if (event.type !== 'message_end' || !record(event.message) || event.message.role !== 'assistant') return
      if (typeof event.message.model === 'string' && event.message.model) models.add(event.message.model)
      add(record(event.message.usage) ? event.message.usage : legacyUsage)
      legacyUsage = undefined
    },
    finish(): ProviderTelemetry {
      const reportedModels = [...models]
      const complete = turns > 0 && counts.inputTokens === turns && counts.outputTokens === turns
      if (complete) {
        // Optional totals must also cover every turn; omitted is not measured zero.
        const measured = Object.fromEntries(Object.entries(totals).filter(([key]) => counts[key] === turns))
        return { usageAvailable: true, tokens: {
          ...measured, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
          ...(reportedModels.length === 1 ? { model: reportedModels[0] } : {}),
        }, ...(reportedModels.length > 1 ? { reportedModels } : {}) }
      }
      return { usageAvailable: false,
        ...(Object.keys(totals).length ? { partialUsage: { ...totals } } : {}),
        ...(reportedModels.length ? { reportedModels } : {}),
      }
    },
  }
}
