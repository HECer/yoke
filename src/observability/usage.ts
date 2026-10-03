import type { ProviderTelemetry } from '../agents/contracts.js'
import type { TokenUsage } from '../loop/reporter.js'

/** Preserve known lower bounds; missing telemetry must never become a free call. */
export function providerTelemetryUsage(telemetry: ProviderTelemetry): TokenUsage | undefined {
  if (!telemetry.tokens && !telemetry.partialUsage) return undefined
  const known = { ...telemetry.partialUsage, ...telemetry.tokens }
  if (!Object.values(known).some(value => typeof value === 'number')) return undefined
  const model = known.model ?? (telemetry.reportedModels?.length === 1 ? telemetry.reportedModels[0] : undefined)
  return {
    ...known,
    ...(model ? { model } : {}),
    inputTokens: known.inputTokens ?? 0,
    outputTokens: known.outputTokens ?? 0,
    measurementComplete: telemetry.usageAvailable,
    costMeasurementComplete: typeof telemetry.tokens?.totalCostUsd === 'number',
  }
}
