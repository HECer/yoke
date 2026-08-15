import type { Agent } from '../retrofit/config.js'
import type { ProviderTelemetry } from './types.js'

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function parseJson(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function directMachineResult(value: unknown): unknown | undefined {
  return isRecord(value) && value.schemaVersion === 1 ? value : undefined
}

export function parseProviderResult(agent: Agent, output: string): unknown {
  const whole = parseJson(output)
  if (whole.ok) {
    const direct = directMachineResult(whole.value)
    if (direct !== undefined) return direct
  }

  const fragments: string[] = []
  for (const line of output.split(/\r?\n/u)) {
    const parsed = parseJson(line)
    if (!parsed.ok || !isRecord(parsed.value)) continue
    const event = parsed.value
    switch (agent) {
      case 'claude':
        if (event.type === 'result' && typeof event.result === 'string') fragments.push(event.result)
        break
      case 'codex': {
        const item = isRecord(event.item) ? event.item : undefined
        if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') fragments.push(item.text)
        break
      }
      case 'gemini':
        if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') fragments.push(event.content)
        break
    }
  }

  const joined = parseJson(fragments.join(''))
  if (joined.ok) {
    const direct = directMachineResult(joined.value)
    if (direct !== undefined) return direct
  }
  for (const fragment of fragments.reverse()) {
    const parsed = parseJson(fragment)
    if (!parsed.ok) continue
    const direct = directMachineResult(parsed.value)
    if (direct !== undefined) return direct
  }
  return null
}

export function parseProviderTelemetry(agent: Agent, lines: string[]): ProviderTelemetry {
  let inputTokens: number | undefined
  let cachedInputTokens: number | undefined
  let cacheWriteInputTokens: number | undefined
  let outputTokens: number | undefined
  let reasoningOutputTokens: number | undefined
  let totalCostUsd: number | undefined
  let model: string | undefined
  for (const line of lines) {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const event = parsed as Record<string, unknown>
    const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : undefined
    const stats = event.stats && typeof event.stats === 'object' ? event.stats as Record<string, unknown> : undefined
    const usage = (event.usage && typeof event.usage === 'object'
      ? event.usage
      : message?.usage && typeof message.usage === 'object'
        ? message.usage
        : stats?.usage && typeof stats.usage === 'object'
          ? stats.usage
          : stats) as Record<string, unknown> | undefined
    const models = stats?.models && typeof stats.models === 'object' ? stats.models as Record<string, unknown> : undefined
    const firstModel = models ? Object.entries(models)[0] : undefined
    const modelUsage = firstModel?.[1] && typeof firstModel[1] === 'object' ? firstModel[1] as Record<string, unknown> : undefined
    const nestedModelTokens = modelUsage?.tokens && typeof modelUsage.tokens === 'object' ? modelUsage.tokens as Record<string, unknown> : undefined
    const source = nestedModelTokens ?? modelUsage ?? usage
    const inValue = finite(source?.input_tokens ?? source?.inputTokens ?? source?.prompt_tokens ?? source?.promptTokenCount ?? source?.input)
    const cachedValue = finite(source?.cached_input_tokens ?? source?.cache_read_input_tokens ?? source?.cachedInputTokens ?? source?.cachedContentTokenCount ?? source?.cached)
    const cacheWriteValue = finite(source?.cache_write_input_tokens ?? source?.cache_creation_input_tokens ?? source?.cacheWriteInputTokens ?? source?.cacheWrite)
    const outValue = finite(source?.output_tokens ?? source?.outputTokens ?? source?.completion_tokens ?? source?.candidatesTokenCount ?? source?.output)
    const reasoningValue = finite(source?.reasoning_output_tokens ?? source?.reasoningOutputTokens ?? source?.thoughtsTokenCount ?? source?.thoughts)
    if (inValue !== undefined) inputTokens = inValue
    if (cachedValue !== undefined) cachedInputTokens = cachedValue
    if (cacheWriteValue !== undefined) cacheWriteInputTokens = cacheWriteValue
    if (outValue !== undefined) outputTokens = outValue
    if (reasoningValue !== undefined) reasoningOutputTokens = reasoningValue
    const costValue = finite(event.total_cost_usd ?? event.totalCostUsd ?? stats?.total_cost_usd)
    if (costValue !== undefined) totalCostUsd = costValue
    const eventModel = event.model ?? message?.model ?? firstModel?.[0]
    if (typeof eventModel === 'string' && eventModel) model = eventModel
  }
  if (inputTokens === undefined && outputTokens === undefined) return { usageAvailable: false }
  const tokens = {
    inputTokens: inputTokens ?? 0,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
    outputTokens: outputTokens ?? 0,
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(model ? { model } : {}),
  }
  return { usageAvailable: true, tokens }
}
