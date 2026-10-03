import { describe, expect, it } from 'vitest'
import { parseProviderTelemetry } from '../../src/agents/telemetry.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

const step = (tokens?: object, cost?: number) => JSON.stringify({ type: 'step_finish', part: { ...(tokens ? { tokens } : {}), ...(cost !== undefined ? { cost } : {}) } })

describe.each(['opencode', 'kilo'] as const)('%s step measurement coverage', agent => {
  const parseBoth = (lines: string[]) => {
    const streaming = createTelemetryAccumulator(agent)
    const content = lines.join('\n')
    for (let i = 0; i < content.length; i += 7) streaming.append(content.slice(i, i + 7))
    const batch = parseProviderTelemetry(agent, lines)
    expect(streaming.finish()).toEqual(batch)
    return batch
  }

  it('retains known partial values without treating a missing field as zero', () => {
    expect(parseBoth([step({ input: 10, output: 2 }, 0.01), step({ input: 20 })])).toEqual({
      usageAvailable: false,
      partialUsage: { inputTokens: 30, outputTokens: 2, totalCostUsd: 0.01 },
    })
  })

  it('counts a completed step with completely missing usage', () => {
    expect(parseBoth([step({ input: 10, output: 2 }, 0.01), step()])).toEqual({
      usageAvailable: false,
      partialUsage: { inputTokens: 10, outputTokens: 2, totalCostUsd: 0.01 },
    })
  })

  it('keeps complete token totals and distinguishes partial optional fields', () => {
    expect(parseBoth([
      step({ input: 10, output: 2, cache: { read: 4 } }, 0.01),
      step({ input: 20, output: 3 }),
    ])).toEqual({
      usageAvailable: true,
      tokens: { inputTokens: 30, outputTokens: 5 },
      partialUsage: { cachedInputTokens: 4, totalCostUsd: 0.01 },
    })
  })

  it('accepts explicitly measured zeros and never invents absent optional metrics', () => {
    expect(parseBoth([step({ input: 0, output: 0 }, 0), step({ input: 0, output: 0 }, 0)])).toEqual({
      usageAvailable: true, tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
    })
  })
})

it('retains Pi partial optional fields with complete core usage in batch and streaming paths', () => {
  const lines = [
    { type: 'message_end', message: { role: 'assistant', model: 'pi-model', usage: { input: 10, output: 2, cacheRead: 4, cost: { total: 0.01 } } } },
    { type: 'message_end', message: { role: 'assistant', model: 'pi-model', usage: { input: 20, output: 3 } } },
  ].map(event => JSON.stringify(event))
  const accumulator = createTelemetryAccumulator('pi')
  accumulator.append(lines.join('\n'))
  const batch = parseProviderTelemetry('pi', lines)
  expect(accumulator.finish()).toEqual(batch)
  expect(batch).toEqual({ usageAvailable: true, tokens: { inputTokens: 30, outputTokens: 5, model: 'pi-model' },
    partialUsage: { cachedInputTokens: 4, totalCostUsd: 0.01 } })
})
