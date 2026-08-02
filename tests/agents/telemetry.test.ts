import { describe, expect, it } from 'vitest'
import { parseProviderTelemetry } from '../../src/agents/telemetry.js'

describe('provider telemetry', () => {
  it('parses Claude result usage and model', () => {
    expect(parseProviderTelemetry('claude', [
      '{"type":"system","subtype":"init","model":"claude-opus"}',
      '{"type":"result","usage":{"input_tokens":10,"output_tokens":4}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 10, outputTokens: 4, model: 'claude-opus' } })
  })

  it('parses Codex turn usage and model', () => {
    expect(parseProviderTelemetry('codex', [
      '{"type":"turn.completed","model":"gpt-5.6-sol","usage":{"input_tokens":12,"cached_input_tokens":7,"cache_write_input_tokens":2,"output_tokens":3,"reasoning_output_tokens":1}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 12, cachedInputTokens: 7, cacheWriteInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1, model: 'gpt-5.6-sol' } })
  })

  it('parses Gemini result stats', () => {
    expect(parseProviderTelemetry('gemini', [
      '{"type":"result","model":"gemini-2.5-pro","usage":{"input_tokens":8,"output_tokens":5}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 8, outputTokens: 5, model: 'gemini-2.5-pro' } })
  })

  it('normalizes Claude cache usage and reported dollar cost', () => {
    expect(parseProviderTelemetry('claude', [
      '{"type":"result","total_cost_usd":0.012,"usage":{"input_tokens":10,"cache_read_input_tokens":8,"cache_creation_input_tokens":4,"output_tokens":2}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 10, cachedInputTokens: 8, cacheWriteInputTokens: 4, outputTokens: 2, totalCostUsd: 0.012 } })
  })

  it('parses Gemini stream result stats and per-model identity', () => {
    expect(parseProviderTelemetry('gemini', [
      '{"type":"result","stats":{"models":{"gemini-2.5-flash":{"promptTokenCount":9,"cachedContentTokenCount":6,"candidatesTokenCount":4,"thoughtsTokenCount":2}}}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 9, cachedInputTokens: 6, outputTokens: 4, reasoningOutputTokens: 2, model: 'gemini-2.5-flash' } })
  })

  it('parses Gemini token stats when the current CLI nests them under tokens', () => {
    expect(parseProviderTelemetry('gemini', [
      '{"type":"result","stats":{"models":{"gemini-current":{"tokens":{"input":9,"cached":6,"output":4,"thoughts":2}}}}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 9, cachedInputTokens: 6, outputTokens: 4, reasoningOutputTokens: 2, model: 'gemini-current' } })
  })

  it('ignores valid JSON primitives that carry no usage', () => {
    expect(parseProviderTelemetry('codex', ['null', '42', '"text"'])).toEqual({ usageAvailable: false })
  })

  it('reports unavailable usage explicitly', () => {
    expect(parseProviderTelemetry('codex', ['not-json'])).toEqual({ usageAvailable: false })
  })
})
