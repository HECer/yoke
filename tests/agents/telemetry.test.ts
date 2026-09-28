import { describe, expect, it } from 'vitest'
import { parseProviderResult, parseProviderTelemetry } from '../../src/agents/telemetry.js'

describe('provider telemetry', () => {
  it.each(['claude', 'codex', 'gemini', 'opencode', 'kilo', 'hermes'] as const)('rejects %s verdicts followed by terminal errors', agent => {
    const verdict = '{"schemaVersion":1,"ok":true}'
    const envelopes = {
      claude: { type: 'result', result: verdict },
      codex: { type: 'item.completed', item: { type: 'agent_message', text: verdict } },
      gemini: { type: 'message', role: 'assistant', content: verdict },
      opencode: { type: 'text', part: { text: verdict } },
      kilo: { type: 'text', part: { text: verdict } },
      hermes: { type: 'text', text: verdict },
    }
    expect(parseProviderResult(agent, [envelopes[agent], { type: 'error', error: 'failed' }].map(event => JSON.stringify(event)).join('\n'))).toBeNull()
  })
  it('does not use Claude child-agent usage or structured verdicts as parent results', () => {
    const child = { type: 'result', parent_tool_use_id: 'child', structured_output: { schemaVersion: 1, ok: true }, usage: { input_tokens: 99, output_tokens: 9 } }
    expect(parseProviderResult('claude', JSON.stringify(child))).toBeNull()
    expect(parseProviderTelemetry('claude', [JSON.stringify(child)])).toEqual({ usageAvailable: false })
  })
  it('prefers normalized aggregate aliases over per-model fallback totals', () => {
    expect(parseProviderTelemetry('gemini', [JSON.stringify({ type: 'result', stats: { usage: { inputTokens: 100, outputTokens: 20 }, models: { flash: { input: 10, output: 2 }, pro: { input: 10, output: 2 } } } })]))
      .toEqual({ usageAvailable: true, reportedModels: ['flash', 'pro'], tokens: { inputTokens: 100, outputTokens: 20 } })
  })
  it('reads Claude native structured output from its result event', () => {
    const result = { schemaVersion: 1, ok: true }
    expect(parseProviderResult('claude', JSON.stringify({ type: 'result', structured_output: result }))).toEqual(result)
  })
  it('prefers Gemini measured aggregate totals over per-model breakdowns', () => {
    expect(parseProviderTelemetry('gemini', [JSON.stringify({ type: 'result', stats: { input_tokens: 30, output_tokens: 5, cached: 12, input: 18, models: { flash: { input_tokens: 10, output_tokens: 2 }, pro: { input_tokens: 20, output_tokens: 3 } } } })]))
      .toEqual({ usageAvailable: true, reportedModels: ['flash', 'pro'], tokens: { inputTokens: 30, outputTokens: 5, cachedInputTokens: 12 } })
  })
  it('aggregates Gemini models without choosing the first identity', () => {
    expect(parseProviderTelemetry('gemini', [JSON.stringify({ type: 'result', stats: { models: {
      flash: { input_tokens: 10, output_tokens: 2, cached: 4 },
      pro: { input_tokens: 20, output_tokens: 3, cached: 8 },
    } } })])).toEqual({ usageAvailable: true, reportedModels: ['flash', 'pro'], tokens: { inputTokens: 30, outputTokens: 5, cachedInputTokens: 12 } })
  })

  it('does not invent unreported token totals', () => {
    expect(parseProviderTelemetry('gemini', ['{"type":"init","model":"flash"}', '{"type":"result","stats":{"input_tokens":9}}']))
      .toEqual({ usageAvailable: false, reportedModels: ['flash'], partialUsage: { inputTokens: 9 } })
  })
  it('does not drop an unmeasured Gemini model from totals', () => {
    expect(parseProviderTelemetry('gemini', ['{"type":"result","stats":{"models":{"flash":{"input_tokens":9,"output_tokens":2},"pro":null}}}']))
      .toEqual({ usageAvailable: false, reportedModels: ['flash', 'pro'] })
  })
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

  it('parses OpenCode text events and step-finish token usage', () => {
    const output = [
      JSON.stringify({ type: 'text', part: { type: 'text', text: '{"schemaVersion":1,"value":"ok"}' } }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 3, write: 1 } }, cost: 0.004 } }),
    ]
    expect(parseProviderResult('opencode', output.join('\n'))).toEqual({ schemaVersion: 1, value: 'ok' })
    expect(parseProviderTelemetry('opencode', output)).toMatchObject({
      usageAvailable: true,
      tokens: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 2, cachedInputTokens: 3, cacheWriteInputTokens: 1, totalCostUsd: 0.004 },
    })
  })

  it('parses Kilo JSON events using the shared OpenCode event contract', () => {
    const output = [
      JSON.stringify({ type: 'text', part: { text: '{"schemaVersion":1,"value":"kilo"}' } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 4, cache: { read: 0, write: 0 } }, cost: 0 } }),
    ]
    expect(parseProviderResult('kilo', output.join('\n'))).toEqual({ schemaVersion: 1, value: 'kilo' })
    expect(parseProviderTelemetry('kilo', output)).toMatchObject({ usageAvailable: true, tokens: { inputTokens: 5, outputTokens: 4 } })
  })

  it('parses Pi message-end JSON and message-update usage', () => {
    const output = [
      JSON.stringify({ type: 'message_update', usage: { input: 13, output: 9, cacheRead: 4, cacheWrite: 2, cost: { total: 0.009 } }, assistantMessageEvent: { type: 'text_delta', delta: 'ignored' } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '{"schemaVersion":1,"value":"pi"}' }], model: 'gpt-5.6' } }),
    ]
    expect(parseProviderResult('pi', output.join('\n'))).toEqual({ schemaVersion: 1, value: 'pi' })
    expect(parseProviderTelemetry('pi', output)).toMatchObject({
      usageAvailable: true,
      tokens: { inputTokens: 13, outputTokens: 9, cachedInputTokens: 4, cacheWriteInputTokens: 2, totalCostUsd: 0.009, model: 'gpt-5.6' },
    })
  })

  it('parses Hermes stream-json text and result token usage', () => {
    const output = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'nous/hermes-3-405b' }),
      JSON.stringify({ type: 'text', text: '{"schemaVersion":1,"value":"hermes"}' }),
      JSON.stringify({
        type: 'result',
        tokens: { input: 25, output: 14, cache_read: 8, cache_write: 3 },
        total_cost_usd: 0.005,
      }),
    ]
    expect(parseProviderResult('hermes', output.join('\n'))).toEqual({ schemaVersion: 1, value: 'hermes' })
    expect(parseProviderTelemetry('hermes', output)).toMatchObject({
      usageAvailable: true,
      tokens: { inputTokens: 25, outputTokens: 14, cachedInputTokens: 8, cacheWriteInputTokens: 3, totalCostUsd: 0.005, model: 'nous/hermes-3-405b' },
    })
  })
})
