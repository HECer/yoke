import type { ProviderTelemetry } from '../agents/contracts.js'
import type { TokenUsage } from '../loop/reporter.js'
import type { Agent } from '../retrofit/config.js'

/** Preserve known lower bounds; missing telemetry must never become a free call. */
export function providerTelemetryUsage(telemetry: ProviderTelemetry, provider?: Agent): TokenUsage | undefined {
  if (!telemetry.tokens && !telemetry.partialUsage) return undefined
  const known = { ...telemetry.partialUsage, ...telemetry.tokens }
  if (!Object.values(known).some(value => typeof value === 'number')) return undefined
  const model = known.model ?? (telemetry.reportedModels?.length === 1 ? telemetry.reportedModels[0] : undefined)
  const input = telemetry.tokens?.inputTokens, cached = telemetry.tokens?.cachedInputTokens
  // Claude input_tokens already excludes cache reads/writes. Codex and Gemini
  // report inclusive input. Unknown provider semantics must stay unknown.
  const freshInputTokens = !telemetry.usageAvailable || typeof input !== 'number' || !Number.isFinite(input) || input < 0 ? undefined
    : provider === 'claude' ? input
    : (provider === 'codex' || provider === 'gemini') && typeof cached === 'number' && Number.isFinite(cached) && cached >= 0 && cached <= input ? input - cached : undefined
  return {
    ...known,
    ...(freshInputTokens !== undefined ? { freshInputTokens } : {}),
    ...(model ? { model } : {}),
    inputTokens: known.inputTokens ?? 0,
    outputTokens: known.outputTokens ?? 0,
    measurementComplete: telemetry.usageAvailable,
    costMeasurementComplete: typeof telemetry.tokens?.totalCostUsd === 'number',
    usageMissingFields: ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalCostUsd'].filter(field => typeof known[field as keyof typeof known] !== 'number'),
    usagePartialFields: Object.keys(telemetry.partialUsage ?? {}).filter(field => typeof telemetry.tokens?.[field as keyof NonNullable<ProviderTelemetry['tokens']>] !== 'number' && typeof known[field as keyof typeof known] === 'number'),
  }
}
