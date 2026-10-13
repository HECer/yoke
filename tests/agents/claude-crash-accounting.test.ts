import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { parseProviderTelemetry } from '../../src/agents/telemetry.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

const assistant = (id = 'known') => ({ type: 'assistant', message: { id, model: 'fixture-model', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 1 } } })
const snapshot = { type: 'result', subtype: 'success', total_cost_usd: 0.1, modelUsage: { 'fixture-model': { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 20, costUSD: 0.1 } } }
const crash = { type: 'result', subtype: 'error_during_execution', is_error: true, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, modelUsage: {}, total_cost_usd: 0 }
const cases = [
  { name: 'known input then zeroed crash', events: [assistant(), crash], expected: { inputTokens: 100, cachedInputTokens: 20 } },
  { name: 'positive result then zeroed crash', events: [snapshot, crash], expected: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 20, totalCostUsd: 0.1 } },
  { name: 'known input then missing final usage', events: [assistant(), { type: 'result', subtype: 'error_during_execution', is_error: true }], expected: { inputTokens: 100, cachedInputTokens: 20 } },
]

describe('Claude crash lower bounds', () => {
  for (const mode of ['batch', 'fragmented'] as const) {
    const parse = (events: unknown[]) => {
      const lines = events.map(event => JSON.stringify(event))
      if (mode === 'batch') return parseProviderTelemetry('claude', lines)
      const stream = createTelemetryAccumulator('claude')
      const text = lines.join('\n')
      for (let i = 0; i < text.length; i += 3) stream.append(text.slice(i, i + 3))
      const result = stream.finish()
      assert.deepEqual(stream.finish(), result)
      return result
    }
    for (const fixture of cases) it(`${mode}: ${fixture.name}`, () => {
      const result = parse(fixture.events)
      assert.equal(result.usageAvailable, false)
      assert.equal(result.tokens, undefined)
      assert.deepEqual(result.partialUsage, fixture.expected)
      assert.deepEqual(result.reportedModels, ['fixture-model'])
    })
    it(`${mode}: retains a trustworthy result when later input is interrupted`, () => {
      const result = parse([snapshot, assistant('later'), crash])
      assert.equal(result.usageAvailable, false)
      assert.equal(result.partialUsage?.inputTokens, 200)
      assert.equal(result.partialUsage?.cachedInputTokens, 40)
      assert.equal(result.partialUsage?.outputTokens, 10)
      assert.equal(result.partialUsage?.totalCostUsd, 0.1)
    })
    it(`${mode}: preserves input when a crash reports only positive output`, () => {
      const result = parse([assistant(), { ...crash, usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0 } }])
      assert.equal(result.usageAvailable, false)
      assert.equal(result.partialUsage?.inputTokens, 100)
      assert.equal(result.partialUsage?.cachedInputTokens, 20)
      assert.equal(result.partialUsage?.outputTokens, 1)
    })
    it(`${mode}: retains a positive measured error result`, () => {
      const result = parse([{ ...snapshot, subtype: 'error_max_turns', is_error: true }])
      assert.equal(result.usageAvailable, true)
      assert.equal(result.tokens?.inputTokens, 100)
    })
    it(`${mode}: accepts an actual successful zero measurement`, () => {
      const result = parse([{ ...crash, subtype: 'success', is_error: false }])
      assert.equal(result.usageAvailable, true)
      assert.equal(result.tokens?.inputTokens, 0)
    })
    it(`${mode}: an unmeasured crash alone is unknown`, () => {
      const result = parse([crash])
      assert.equal(result.usageAvailable, false)
      assert.equal(result.partialUsage, undefined)
    })
    it(`${mode}: does not carry lower bounds across session identity changes`, () => {
      const result = parse([{ ...snapshot, session_id: 'old' }, { ...crash, session_id: 'new' }])
      assert.equal(result.usageAvailable, false)
      assert.equal(result.partialUsage, undefined)
    })
  }
})
