import { describe, expect, it } from 'vitest'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

describe('stream telemetry accumulation', () => {
  it('retains init model across arbitrary stream chunks without summing cumulative usage', () => {
    const telemetry = createTelemetryAccumulator('gemini')
    telemetry.append('{"type":"init","model":"flash"}\n')
    telemetry.append('{"type":"message","role":"assistant","content":"hello"}\n')
    telemetry.append('{"type":"result","stats":{"input_tokens":10,"output_')
    telemetry.append('tokens":2}}\n')
    telemetry.append('{"type":"result","stats":{"input_tokens":20,"output_tokens":4}}\n')
    expect(telemetry.finish()).toEqual({ usageAvailable: true, tokens: { inputTokens: 20, outputTokens: 4, model: 'flash' } })
  })
  it('preserves partial measurements instead of discarding them', () => {
    const telemetry = createTelemetryAccumulator('gemini')
    telemetry.append('{"type":"init","model":"flash"}\n')
    telemetry.append('{"type":"result","stats":{"input_tokens":9}}')
    expect(telemetry.finish()).toEqual({ usageAvailable: false, reportedModels: ['flash'], partialUsage: { inputTokens: 9 } })
  })
  it('sums per-step OpenCode-family usage across streamed chunks', () => {
    const telemetry = createTelemetryAccumulator('opencode')
    telemetry.append('{"type":"step_finish","part":{"tokens":{"input":10,"output":2,"cache":{"read":3},"reasoning":1},"cost":0.2}}\n')
    telemetry.append('{"type":"step_finish","part":{"tokens":{"input":20,"output":4,"cache":{"read":5},"reasoning":2},"cost":0.3}}\n')
    expect(telemetry.finish()).toEqual({ usageAvailable: true, tokens: {
      inputTokens: 30, outputTokens: 6, cachedInputTokens: 8, reasoningOutputTokens: 3, totalCostUsd: 0.5,
    } })
  })
})
