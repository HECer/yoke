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
  const update = (lines: readonly string[]): void => {
    const next = parseProviderTelemetry(agent, [...lines])
    if (next.usageAvailable) telemetry = next
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
      return telemetry
    },
  }
}
