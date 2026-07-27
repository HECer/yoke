import type { Agent } from '../retrofit/config.js'
import type { ProviderTelemetry } from './types.js'

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function parseProviderTelemetry(agent: Agent, lines: string[]): ProviderTelemetry {
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let model: string | undefined
  for (const line of lines) {
    let event: Record<string, unknown>
    try { event = JSON.parse(line) as Record<string, unknown> } catch { continue }
    const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : undefined
    const usage = (event.usage && typeof event.usage === 'object' ? event.usage : message?.usage) as Record<string, unknown> | undefined
    const inValue = finite(usage?.input_tokens ?? usage?.inputTokens ?? usage?.prompt_tokens)
    const outValue = finite(usage?.output_tokens ?? usage?.outputTokens ?? usage?.completion_tokens)
    if (inValue !== undefined) inputTokens = inValue
    if (outValue !== undefined) outputTokens = outValue
    const eventModel = event.model ?? message?.model
    if (typeof eventModel === 'string' && eventModel) model = eventModel
  }
  if (inputTokens === undefined && outputTokens === undefined) return { usageAvailable: false }
  const tokens = { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0, ...(model ? { model } : {}) }
  return { usageAvailable: true, tokens }
}
