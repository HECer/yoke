import type { Agent } from '../retrofit/config.js'
import type { ProviderTelemetry } from './types.js'
import { createPiTelemetry } from './pi-telemetry.js'

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

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

/** OpenCode-family usage belongs to individual completed steps. Each field needs
 * coverage of every step before it can be called a total. Shared by batch and
 * streaming readers so an omitted measurement cannot turn into a measured zero. */
export function createStepTelemetry() {
  let steps = 0
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  return {
    consume(event: Record<string, unknown>): void {
      const part = isRecord(event.part) ? event.part : undefined
      if (event.type !== 'step_finish' && part?.type !== 'step-finish') return
      steps++
      const tokens = isRecord(part?.tokens) ? part.tokens : {}
      const cache = isRecord(tokens.cache) ? tokens.cache : undefined
      const fields = {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cachedInputTokens: tokens.cached ?? tokens.cacheRead ?? cache?.read,
        cacheWriteInputTokens: tokens.cacheWrite ?? cache?.write,
        reasoningOutputTokens: tokens.reasoning,
        totalCostUsd: part?.cost ?? event.cost,
      }
      for (const [field, raw] of Object.entries(fields)) {
        const value = finite(raw)
        if (value === undefined) continue
        totals[field] = (totals[field] ?? 0) + value
        counts[field] = (counts[field] ?? 0) + 1
      }
    },
    finish(): ProviderTelemetry | undefined {
      if (!steps) return undefined
      const complete = counts.inputTokens === steps && counts.outputTokens === steps
      if (!complete) return { usageAvailable: false, ...(Object.keys(totals).length ? { partialUsage: { ...totals } } : {}) }
      const measured = Object.fromEntries(Object.entries(totals).filter(([field]) => counts[field] === steps))
      const partialUsage = Object.fromEntries(Object.entries(totals).filter(([field]) => counts[field] !== steps))
      return { usageAvailable: true, tokens: { ...measured, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens },
        ...(Object.keys(partialUsage).length ? { partialUsage } : {}) }
    },
  }
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.filter(isRecord).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text as string).join('')
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

  if (agent === 'qwen') return parseQwenResult(output)

  const fragments: string[] = []
  let structuredResult: unknown
  for (const line of output.split(/\r?\n/u)) {
    const parsed = parseJson(line)
    if (!parsed.ok || !isRecord(parsed.value)) continue
    const event = parsed.value
    if (agent === 'claude' && event.parent_tool_use_id != null) continue
    if (event.type === 'error' || event.type === 'turn.failed' ||
      (event.type === 'result' && (event.is_error === true || event.status === 'error' || event.error != null))) return null
    switch (agent) {
      case 'claude':
        if (event.type === 'result' && directMachineResult(event.structured_output) !== undefined) structuredResult = event.structured_output
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
      case 'opencode':
      case 'kilo': {
        const part = isRecord(event.part) ? event.part : undefined
        if (event.type === 'text' && typeof part?.text === 'string') fragments.push(part.text)
        break
      }
      case 'pi':
        if (event.type === 'message_end' && isRecord(event.message) && event.message.role === 'assistant') {
          if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') return null
          const text = textContent(event.message.content)
          if (text) fragments.push(text)
        }
        break
      case 'hermes':
        if (event.type === 'result' && directMachineResult(event.structured_output ?? event.structured_result) !== undefined) {
          structuredResult = event.structured_output ?? event.structured_result
        }
        if (event.type === 'text' && typeof event.text === 'string') fragments.push(event.text)
        if (event.type === 'result' && typeof event.text === 'string') fragments.push(event.text)
        if (event.type === 'result' && typeof event.result === 'string') fragments.push(event.result)
        break
    }
  }

  if (structuredResult !== undefined) return structuredResult
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

/** Qwen uses assistant content blocks and result envelopes, not Gemini messages. */
function parseQwenResult(output: string): unknown {
  let candidate: unknown = null
  for (const line of output.split(/\r?\n/u)) {
    const parsed = parseJson(line)
    if (!parsed.ok || !isRecord(parsed.value)) continue
    const event = parsed.value
    if (event.parent_tool_use_id != null) continue
    if (event.type === 'result') {
      if (event.is_error === true) { candidate = null; continue }
      const structured = directMachineResult(event.structured_result)
      const result = typeof event.result === 'string' ? parseJson(event.result) : { ok: false as const }
      candidate = structured ?? (result.ok ? directMachineResult(result.value) : undefined) ?? null
    } else if (event.type === 'assistant' && isRecord(event.message) && Array.isArray(event.message.content)) {
      const text = event.message.content.filter(isRecord).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
      const result = parseJson(text)
      if (result.ok) candidate = directMachineResult(result.value) ?? candidate
    }
  }
  return candidate
}

export function parseProviderTelemetry(agent: Agent, lines: string[]): ProviderTelemetry {
  if (agent === 'pi') {
    const accumulator = createPiTelemetry()
    for (const line of lines) {
      const parsed = parseJson(line)
      if (parsed.ok && isRecord(parsed.value)) accumulator.consume(parsed.value)
    }
    return accumulator.finish()
  }
  let inputTokens: number | undefined
  let cachedInputTokens: number | undefined
  let cacheWriteInputTokens: number | undefined
  let outputTokens: number | undefined
  let reasoningOutputTokens: number | undefined
  let totalCostUsd: number | undefined
  let model: string | undefined
  let reportedModels: string[] = []
  const steps = agent === 'opencode' || agent === 'kilo' ? createStepTelemetry() : undefined
  for (const line of lines) {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const event = parsed as Record<string, unknown>
    steps?.consume(event)
    if ((agent === 'qwen' || agent === 'claude') && event.parent_tool_use_id != null) continue
    const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : undefined
    const stats = event.stats && typeof event.stats === 'object' ? event.stats as Record<string, unknown> : undefined
    const usage = (event.usage && typeof event.usage === 'object'
      ? event.usage
      : message?.usage && typeof message.usage === 'object'
        ? message.usage
        : stats?.usage && typeof stats.usage === 'object'
          ? stats.usage
          : event.tokens && typeof event.tokens === 'object'
            ? event.tokens
            : stats) as Record<string, unknown> | undefined
    const models = isRecord(stats?.models) ? stats.models : undefined
    const modelEntries = models ? Object.entries(models) : []
    const firstModel = modelEntries.length === 1 ? modelEntries[0] : undefined
    const modelUsage = firstModel?.[1] && typeof firstModel[1] === 'object' ? firstModel[1] as Record<string, unknown> : undefined
    const nestedModelTokens = modelUsage?.tokens && typeof modelUsage.tokens === 'object' ? modelUsage.tokens as Record<string, unknown> : undefined
    // Streaming stats report aggregate input_tokens (including cached input).
    // Older JSON stats only provide model-local token objects. Sum a field
    // only when every model measured it; a missing measurement is not zero.
    let source = usage ?? nestedModelTokens ?? modelUsage
    if ((agent === 'gemini' || agent === 'qwen') && modelEntries.length > 0) {
      reportedModels = modelEntries.map(([name]) => name)
      model = firstModel?.[0]
      const fields = {
        input_tokens: ['input_tokens', 'inputTokens', 'promptTokenCount', 'input', 'prompt'],
        output_tokens: ['output_tokens', 'outputTokens', 'candidatesTokenCount', 'output', 'candidates'],
        cached_input_tokens: ['cached_input_tokens', 'cachedInputTokens', 'cachedContentTokenCount', 'cached'],
        reasoning_output_tokens: ['reasoning_output_tokens', 'reasoningOutputTokens', 'thoughtsTokenCount', 'thoughts'],
      }
      const totals: Record<string, number> = {}
      for (const [field, aliases] of Object.entries(fields)) {
        const aggregate = aliases.map(key => finite(usage?.[key])).find(value => value !== undefined)
        if (aggregate !== undefined) { totals[field] = aggregate; continue }
        const values = modelEntries.map(([, value]) => {
          const entry = isRecord(value) ? value : {}
          const tokens = isRecord(entry.tokens) ? entry.tokens : entry
          return aliases.map(key => finite(tokens[key])).find(value => value !== undefined)
        })
        if (values.every(value => value !== undefined)) totals[field] = values.reduce<number>((sum, value) => sum + value!, 0)
      }
      source = { ...totals, ...usage }
      const aggregateCached = finite(usage?.cached_input_tokens ?? usage?.cached)
      if (aggregateCached !== undefined) source.cached_input_tokens = aggregateCached
    }
    const inValue = finite(source?.input_tokens ?? source?.inputTokens ?? source?.prompt_tokens ?? source?.promptTokenCount ?? source?.input)
    const cachedValue = finite(source?.cached_input_tokens ?? source?.cache_read_input_tokens ?? source?.cachedInputTokens ?? source?.cacheRead ?? source?.cachedContentTokenCount ?? source?.cached ?? source?.cache_read)
    const cacheWriteValue = finite(source?.cache_write_input_tokens ?? source?.cache_creation_input_tokens ?? source?.cacheWriteInputTokens ?? source?.cacheWrite ?? source?.cache_write)
    const outValue = finite(source?.output_tokens ?? source?.outputTokens ?? source?.completion_tokens ?? source?.candidatesTokenCount ?? source?.output)
    const reasoningValue = finite(source?.reasoning_output_tokens ?? source?.reasoningOutputTokens ?? source?.thoughtsTokenCount ?? source?.thoughts)
    if (inValue !== undefined) inputTokens = inValue
    if (cachedValue !== undefined) cachedInputTokens = cachedValue
    if (cacheWriteValue !== undefined) cacheWriteInputTokens = cacheWriteValue
    if (outValue !== undefined) outputTokens = outValue
    if (reasoningValue !== undefined) reasoningOutputTokens = reasoningValue
    const usageCost = isRecord(usage?.cost) ? finite(usage.cost.total) : undefined
    const costValue = finite(event.total_cost_usd ?? event.totalCostUsd ?? stats?.total_cost_usd ?? usageCost)
    if (costValue !== undefined) totalCostUsd = costValue
    const eventModel = event.model ?? message?.model ?? firstModel?.[0]
    if (typeof eventModel === 'string' && eventModel && reportedModels.length <= 1) model = eventModel
  }
  const stepUsage = steps?.finish()
  if (stepUsage) return { ...stepUsage,
    ...(stepUsage.tokens && model ? { tokens: { ...stepUsage.tokens, model } } : {}),
    ...(!stepUsage.tokens && model ? { reportedModels: [model] } : {}),
  }
  if (inputTokens === undefined || outputTokens === undefined) {
    const partialUsage = {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
      ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
      ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    }
    return { usageAvailable: false,
      ...(Object.keys(partialUsage).length ? { partialUsage } : {}),
      ...(reportedModels.length ? { reportedModels } : model ? { reportedModels: [model] } : {}),
    }
  }
  const tokens = {
    inputTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
    outputTokens,
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(model ? { model } : {}),
  }
  return { usageAvailable: true, tokens, ...(reportedModels.length > 1 ? { reportedModels } : {}) }
}
