import { expect, it } from 'vitest'
import { parseProviderTelemetry, parseProviderResult } from '../../src/agents/telemetry.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'
import { inspectProviderEvent } from '../../src/agents/supervision.js'

const message = (input: number, output: number, model = 'model-a') => ({
  role: 'assistant', model, content: [], usage: { input, output, cacheRead: 2, cacheWrite: 1, cost: { total: 0.1 } },
})
it('sums finalized Pi turns once, ignoring snapshots and agent-end replays', () => {
  const a = message(10, 3), b = message(20, 4, 'model-b')
  const lines = [
    { type: 'message_update', message: a }, { type: 'message_end', message: a },
    { type: 'turn_end', message: a }, { type: 'message_end', message: b },
    { type: 'agent_end', messages: [a, b] },
  ].map(event => JSON.stringify(event))
  const expected = { usageAvailable: true, reportedModels: ['model-a', 'model-b'], tokens: {
    inputTokens: 30, outputTokens: 7, cachedInputTokens: 4, cacheWriteInputTokens: 2, totalCostUsd: 0.2,
  } }
  expect(parseProviderTelemetry('pi', lines)).toEqual(expected)
  const stream = createTelemetryAccumulator('pi')
  const text = lines.join('\n')
  for (let i = 0; i < text.length; i += 7) stream.append(text.slice(i, i + 7))
  expect(stream.finish()).toEqual(expected)
  expect(stream.finish()).toEqual(expected)
})
it('marks missing Pi turn usage incomplete instead of reporting a full total', () => {
  expect(parseProviderTelemetry('pi', [
    JSON.stringify({ type: 'message_end', message: message(10, 3) }),
    JSON.stringify({ type: 'message_end', message: { role: 'assistant', model: 'model-a' } }),
  ])).toEqual({ usageAvailable: false, reportedModels: ['model-a'], partialUsage: {
    inputTokens: 10, outputTokens: 3, cachedInputTokens: 2, cacheWriteInputTokens: 1, totalCostUsd: 0.1,
  } })
})
it('does not accept a structured verdict from an errored Pi message', () => {
  expect(parseProviderResult('pi', JSON.stringify({ type: 'message_end', message: {
    role: 'assistant', stopReason: 'error', content: [{ type: 'text', text: '{"schemaVersion":1,"ok":true}' }],
  } }))).toBeNull()
})
it('recognizes successful Pi tools but not partial or failed tools as progress', () => {
  expect(inspectProviderEvent(JSON.stringify({ type: 'tool_execution_end', isError: false })).progress).toBe(true)
  for (const event of [{ type: 'tool_execution_end', isError: true }, { type: 'tool_execution_update' }]) {
    expect(inspectProviderEvent(JSON.stringify(event)).progress).not.toBe(true)
  }
})
it('counts OpenCode-family completed tools as progress, not running or failed tools', () => {
  for (const status of ['completed', 'running', 'error']) {
    expect(inspectProviderEvent(JSON.stringify({ type: 'tool_use', part: { type: 'tool', state: { status } } })).progress).toBe(status === 'completed')
  }
})
