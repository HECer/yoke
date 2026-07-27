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
      '{"type":"turn.completed","model":"gpt-5.6-sol","usage":{"input_tokens":12,"output_tokens":3}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 12, outputTokens: 3, model: 'gpt-5.6-sol' } })
  })

  it('parses Gemini result stats', () => {
    expect(parseProviderTelemetry('gemini', [
      '{"type":"result","model":"gemini-2.5-pro","usage":{"input_tokens":8,"output_tokens":5}}',
    ])).toEqual({ usageAvailable: true, tokens: { inputTokens: 8, outputTokens: 5, model: 'gemini-2.5-pro' } })
  })

  it('reports unavailable usage explicitly', () => {
    expect(parseProviderTelemetry('codex', ['not-json'])).toEqual({ usageAvailable: false })
  })
})
