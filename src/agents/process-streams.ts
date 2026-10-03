import type { Agent } from '../retrofit/config.js'
import { createStepTelemetry, parseProviderTelemetry } from './telemetry.js'
import type { ProviderTelemetry } from './types.js'
import { createPiTelemetry } from './pi-telemetry.js'

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
  const pi = agent === 'pi' ? createPiTelemetry() : undefined
  let trailing = ''
  let telemetry: ProviderTelemetry = { usageAvailable: false }
  let reportedModels: string[] = []
  const steps = agent === 'opencode' || agent === 'kilo' ? createStepTelemetry() : undefined
  const update = (lines: readonly string[]): void => {
    for (const line of lines) {
      if (steps) {
        try {
          const event: unknown = JSON.parse(line)
          if (event && typeof event === 'object' && !Array.isArray(event)) steps.consume(event as Record<string, unknown>)
        } catch { /* non-JSON diagnostics carry no usage */ }
      }
      if (pi) {
        try {
          const event: unknown = JSON.parse(line)
          if (event && typeof event === 'object' && !Array.isArray(event)) pi.consume(event as Record<string, unknown>)
        } catch { /* non-JSON diagnostics carry no usage */ }
        continue
      }
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
      if (pi) return pi.finish()
      telemetry = steps?.finish() ?? telemetry
      if (telemetry.tokens) {
        const { model: _model, ...tokens } = telemetry.tokens
        return { ...telemetry, tokens: { ...tokens, ...(reportedModels.length === 1 ? { model: reportedModels[0] } : {}) },
          ...(reportedModels.length > 1 ? { reportedModels } : {}) }
      }
      return { ...telemetry, ...(reportedModels.length ? { reportedModels } : {}) }
    },
  }
}
