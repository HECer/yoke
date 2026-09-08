import type { Agent } from '../retrofit/config.js'
import { parseProviderTelemetry } from './telemetry.js'
import type { ProviderTelemetry } from './types.js'

export interface BoundedOutput {
  append(text: string): void
  readonly text: string
  readonly truncated: boolean
}

export function createBoundedOutput(limitBytes: number): BoundedOutput {
  let text = ''
  let truncated = false
  return {
    append(next): void {
      const combined = `${text}${next}`
      if (Buffer.byteLength(combined) <= limitBytes) {
        text = combined
        return
      }
      text = Buffer.from(combined).subarray(-limitBytes).toString('utf8')
      truncated = true
    },
    get text(): string { return text },
    get truncated(): boolean { return truncated },
  }
}

export interface TelemetryAccumulator {
  append(text: string): void
  finish(): ProviderTelemetry
}

export function createTelemetryAccumulator(agent: Agent): TelemetryAccumulator {
  let trailing = ''
  let telemetry: ProviderTelemetry = { usageAvailable: false }
  let reportedModels: string[] = []
  const stepTotals = agent === 'opencode' || agent === 'kilo'
    ? { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, cost: 0, hasInput: false, hasOutput: false, hasCached: false, hasCacheWrite: false, hasReasoning: false, hasCost: false }
    : undefined
  const update = (lines: readonly string[]): void => {
    for (const line of lines) {
      const next = parseProviderTelemetry(agent, [line])
      if (next.reportedModels) reportedModels = next.reportedModels
      else if (next.tokens?.model) reportedModels = [next.tokens.model]
      // Provider result usage is cumulative: replace the latest measurement,
      // never add it to earlier results or to assistant-message snapshots.
      if (next.tokens || next.partialUsage) telemetry = next
      if (stepTotals && isStepFinish(line)) {
        const usage = next.tokens ?? next.partialUsage
        if (usage) {
          if (usage.inputTokens !== undefined) { stepTotals.input += usage.inputTokens; stepTotals.hasInput = true }
          if (usage.outputTokens !== undefined) { stepTotals.output += usage.outputTokens; stepTotals.hasOutput = true }
          if (usage.cachedInputTokens !== undefined) { stepTotals.cached += usage.cachedInputTokens; stepTotals.hasCached = true }
          if (usage.cacheWriteInputTokens !== undefined) { stepTotals.cacheWrite += usage.cacheWriteInputTokens; stepTotals.hasCacheWrite = true }
          if (usage.reasoningOutputTokens !== undefined) { stepTotals.reasoning += usage.reasoningOutputTokens; stepTotals.hasReasoning = true }
          if (usage.totalCostUsd !== undefined) { stepTotals.cost += usage.totalCostUsd; stepTotals.hasCost = true }
        }
      }
    }
  }
  return {
    append(text): void {
      const parts = `${trailing}${text}`.split(/\r?\n/u)
      trailing = parts.pop() ?? ''
      update(parts)
    },
    finish(): ProviderTelemetry {
      if (trailing) update([trailing])
      trailing = ''
      if (stepTotals && (stepTotals.hasInput || stepTotals.hasOutput)) {
        const latest = telemetry.tokens
        const inputTokens = stepTotals.hasInput ? stepTotals.input : latest?.inputTokens
        const outputTokens = stepTotals.hasOutput ? stepTotals.output : latest?.outputTokens
        const partialUsage = {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(stepTotals.hasCached ? { cachedInputTokens: stepTotals.cached } : latest?.cachedInputTokens !== undefined ? { cachedInputTokens: latest.cachedInputTokens } : {}),
          ...(stepTotals.hasCacheWrite ? { cacheWriteInputTokens: stepTotals.cacheWrite } : latest?.cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens: latest.cacheWriteInputTokens } : {}),
          ...(stepTotals.hasReasoning ? { reasoningOutputTokens: stepTotals.reasoning } : latest?.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: latest.reasoningOutputTokens } : {}),
          ...(stepTotals.hasCost ? { totalCostUsd: stepTotals.cost } : latest?.totalCostUsd !== undefined ? { totalCostUsd: latest.totalCostUsd } : {}),
          ...(latest?.model ? { model: latest.model } : {}),
        }
        if (inputTokens !== undefined && outputTokens !== undefined) {
          telemetry = { usageAvailable: true, tokens: { ...partialUsage, inputTokens, outputTokens } }
        } else {
          telemetry = { usageAvailable: false, partialUsage }
        }
      }
      if (telemetry.tokens) {
        const { model: _model, ...tokens } = telemetry.tokens
        return { usageAvailable: telemetry.usageAvailable, tokens: { ...tokens, ...(reportedModels.length === 1 ? { model: reportedModels[0] } : {}) },
          ...(reportedModels.length > 1 ? { reportedModels } : {}) }
      }
      return { ...telemetry, ...(reportedModels.length ? { reportedModels } : {}) }
    },
  }
}

function isStepFinish(line: string): boolean {
  try {
    const value = JSON.parse(line) as Record<string, unknown>
    const part = value.part && typeof value.part === 'object' ? value.part as Record<string, unknown> : undefined
    return value.type === 'step_finish' || part?.type === 'step-finish'
  } catch {
    return false
  }
}
