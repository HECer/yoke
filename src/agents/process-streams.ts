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
  const update = (lines: readonly string[]): void => {
    for (const line of lines) {
      const next = parseProviderTelemetry(agent, [line])
      if (next.reportedModels) reportedModels = next.reportedModels
      else if (next.tokens?.model) reportedModels = [next.tokens.model]
      // Provider result usage is cumulative: replace the latest measurement,
      // never add it to earlier results or to assistant-message snapshots.
      if (next.tokens || next.partialUsage) telemetry = next
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
      if (telemetry.tokens) {
        const { model: _model, ...tokens } = telemetry.tokens
        return { usageAvailable: telemetry.usageAvailable, tokens: { ...tokens, ...(reportedModels.length === 1 ? { model: reportedModels[0] } : {}) },
          ...(reportedModels.length > 1 ? { reportedModels } : {}) }
      }
      return { ...telemetry, ...(reportedModels.length ? { reportedModels } : {}) }
    },
  }
}
