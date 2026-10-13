import type { Agent } from '../retrofit/config.js'
import { createStepTelemetry, parseProviderTelemetry } from './telemetry.js'
import type { ProviderTelemetry } from './types.js'
import { createPiTelemetry } from './pi-telemetry.js'
import { createClaudeTelemetry } from './claude-telemetry.js'
import { createLineFramer } from './stream-buffer.js'
export { createBoundedOutput, type BoundedOutput } from './stream-buffer.js'

export interface TelemetryAccumulator {
  append(text: string): void
  finish(): ProviderTelemetry
}

export function createTelemetryAccumulator(agent: Agent, maxLineBytes?: number): TelemetryAccumulator {
  const pi = agent === 'pi' ? createPiTelemetry() : undefined
  const claude = agent === 'claude' ? createClaudeTelemetry() : undefined
  const steps = agent === 'opencode' || agent === 'kilo' ? createStepTelemetry() : undefined
  let telemetry: ProviderTelemetry = { usageAvailable: false }
  let reportedModels: string[] = []
  let coverageLost = false
  const framer = createLineFramer(line => {
    let event: Record<string, unknown> | undefined
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) event = value as Record<string, unknown>
    } catch { /* non-JSON diagnostics carry no usage */ }
    if (!event) return
    if (pi) { pi.consume(event); return }
    steps?.consume(event)
    if (claude) {
      claude.consume(event)
      if (event.type === 'result' && event.parent_tool_use_id == null
        && event.modelUsage && typeof event.modelUsage === 'object' && !Array.isArray(event.modelUsage)
        && Object.keys(event.modelUsage).length > 0 && claude.finish().usageAvailable) coverageLost = false
      return
    }
    const next = parseProviderTelemetry(agent, [line])
    if (next.reportedModels) reportedModels = next.reportedModels
    else if (next.tokens?.model) reportedModels = [next.tokens.model]
    // Result snapshots replace earlier measurements; never add cumulative usage.
    if (next.tokens || next.partialUsage) telemetry = next
    const cumulative = agent === 'codex' ? event.type === 'turn.completed'
      : (agent === 'gemini' || agent === 'qwen' || agent === 'hermes') && event.type === 'result' && event.parent_tool_use_id == null
    if (cumulative && next.usageAvailable) coverageLost = false
  }, () => { coverageLost = true }, maxLineBytes)
  return {
    append(text): void { framer.append(text) },
    finish(): ProviderTelemetry {
      framer.finish()
      let result = pi?.finish() ?? claude?.finish() ?? steps?.finish() ?? telemetry
      if (!pi && !claude) {
        if (result.tokens) {
          const { model: _model, ...tokens } = result.tokens
          result = { ...result, tokens: { ...tokens, ...(reportedModels.length === 1 ? { model: reportedModels[0] } : {}) },
            ...(reportedModels.length > 1 ? { reportedModels } : {}) }
        } else result = { ...result, ...(reportedModels.length ? { reportedModels } : {}) }
      }
      if (!coverageLost) return result
      const { model, ...tokens } = result.tokens ?? {}
      const partialUsage = { ...tokens, ...result.partialUsage }
      return { usageAvailable: false, ...(Object.keys(partialUsage).length ? { partialUsage } : {}),
        ...(result.reportedModels?.length ? { reportedModels: result.reportedModels } : model ? { reportedModels: [model] } : {}) }
    },
  }
}
