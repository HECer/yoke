import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { parseProviderTelemetry } from '../../src/agents/telemetry.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

const assistant = (id: string, input: number, cache = 0) => ({ type: 'assistant', message: { id, model: 'claude-test', usage: { input_tokens: input, output_tokens: 1, cache_read_input_tokens: cache } } })
const batch = (events: unknown[]) => parseProviderTelemetry('claude', events.map(event => JSON.stringify(event)))

describe('Claude invocation accounting', () => {
  it('sums unique input snapshots but does not promote placeholder output to a total', () => {
    assert.deepEqual(batch([assistant('a', 10, 4), assistant('b', 20, 6)]), {
      usageAvailable: false, partialUsage: { inputTokens: 30, cachedInputTokens: 10 }, reportedModels: ['claude-test'],
    })
  })
  it('deduplicates parallel tool blocks by message identity', () => {
    assert.equal(batch([assistant('a', 10), assistant('a', 10), assistant('b', 20)]).partialUsage?.inputTokens, 30)
  })
  it('updates a repeated snapshot without charging its old value twice', () => {
    assert.equal(batch([assistant('a', 10), assistant('a', 12)]).partialUsage?.inputTokens, 12)
  })
  it('keeps anonymous snapshots as a lower bound instead of blindly summing them', () => {
    const event = { type: 'assistant', message: { usage: { input_tokens: 8, output_tokens: 1 } } }
    assert.deepEqual(batch([event, event]), { usageAvailable: false, partialUsage: { inputTokens: 8 } })
  })
  it('uses final cumulative totals once, without adding assistant snapshots', () => {
    assert.deepEqual(batch([assistant('a', 10), assistant('b', 20), { type: 'result', total_cost_usd: 0.1, usage: { input_tokens: 30, output_tokens: 50 } }]), {
      usageAvailable: true, tokens: { inputTokens: 30, outputTokens: 50, totalCostUsd: 0.1, model: 'claude-test' },
    })
  })
  it('does not fill omitted final cache fields with a stale message snapshot', () => {
    const result = batch([assistant('a', 10, 100), { type: 'result', usage: { input_tokens: 10, output_tokens: 5 } }])
    assert.equal(result.tokens?.cachedInputTokens, undefined)
  })
  it('uses modelUsage for the full invocation including nested agents', () => {
    const result = batch([{ ...assistant('nested', 100), parent_tool_use_id: 'tool' }, { type: 'result', usage: { input_tokens: 10, output_tokens: 2 }, total_cost_usd: 0.25, modelUsage: {
      small: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 3, costUSD: 0.05 },
      large: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 30, costUSD: 0.2 },
    } }])
    assert.deepEqual(result, { usageAvailable: true, tokens: { inputTokens: 110, outputTokens: 22, cachedInputTokens: 33, totalCostUsd: 0.25 }, reportedModels: ['small', 'large'] })
  })
  it('does not treat known main-loop usage as a full tree total after child events', () => {
    const result = batch([{ ...assistant('nested', 100), parent_tool_use_id: 'tool' }, { type: 'result', usage: { input_tokens: 10, output_tokens: 2 } }])
    assert.deepEqual(result, { usageAvailable: false, partialUsage: { inputTokens: 10, outputTokens: 2 } })
  })
  it('preserves partial optional model measurements without inventing missing zeroes', () => {
    assert.deepEqual(batch([{ type: 'result', modelUsage: { a: { inputTokens: 5, outputTokens: 2, cacheReadInputTokens: 3 }, b: { inputTokens: 7, outputTokens: 4 } } }]), {
      usageAvailable: true, tokens: { inputTokens: 12, outputTokens: 6 }, partialUsage: { cachedInputTokens: 3 }, reportedModels: ['a', 'b'],
    })
  })
  it('does not silently drop an unmeasured model from coverage', () => {
    const result = batch([{ type: 'result', modelUsage: { a: { inputTokens: 5, outputTokens: 2 }, b: null } }])
    assert.equal(result.usageAvailable, false)
    assert.equal(result.partialUsage?.inputTokens, 5)
  })
  it('returns identical batch and fragmented-stream measurements', () => {
    const events = [assistant('a', 10), assistant('b', 20), { type: 'result', usage: { input_tokens: 30, output_tokens: 40 } }]
    const text = events.map(event => JSON.stringify(event)).join('\n')
    const stream = createTelemetryAccumulator('claude')
    for (let i = 0; i < text.length; i += 3) stream.append(text.slice(i, i + 3))
    assert.deepEqual(stream.finish(), batch(events))
    assert.deepEqual(stream.finish(), batch(events))
  })
  it('bounds message identity tracking without declaring unobserved usage complete', () => {
    const result = batch(Array.from({ length: 10_010 }, (_, index) => assistant(String(index), 1)))
    assert.equal(result.usageAvailable, false)
    assert.ok((result.partialUsage?.inputTokens ?? 0) <= 10_010)
    assert.ok((result.partialUsage?.inputTokens ?? 0) >= 10_000)
  })
  it('does not create empty measurements for a result without usage', () => {
    assert.deepEqual(batch([{ type: 'result', result: 'done' }]), { usageAvailable: false })
  })
  it('retains known model identity when final usage is unavailable', () => {
    assert.deepEqual(batch([{ type: 'system', subtype: 'init', model: 'known-model' }, { type: 'result' }]), { usageAvailable: false, reportedModels: ['known-model'] })
  })
  it('does not attribute a mixed-model invocation to its last model alone', () => {
    const second = assistant('b', 20); second.message.model = 'other-model'
    const result = batch([assistant('a', 10), second, { type: 'result', usage: { input_tokens: 30, output_tokens: 4 } }])
    assert.equal(result.tokens?.model, undefined)
    assert.deepEqual(result.reportedModels, ['claude-test', 'other-model'])
  })

})
