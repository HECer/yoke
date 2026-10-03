import { expect, it } from 'vitest'
import { aggregateMeasurements } from '../../src/dashboard/analytics.js'
import type { LoopEvent } from '../../src/observability/events.js'

it('retains a measured worker when the containing routing bundle has an unknown planner', () => {
  const event: LoopEvent = {
    schemaVersion: 1, id: 'partial', runId: 'run', timestamp: '2026-10-03T12:00:00Z', type: 'tokens',
    data: { inputTokens: 120, outputTokens: 30, usageAvailable: false, measurementComplete: false, costMeasurementComplete: false, calls: [
      { provider: 'codex', actualModel: 'planner', role: 'orchestrator', inputTokens: 0, outputTokens: 0, usageAvailable: false, durationMs: 1 },
      { provider: 'codex', actualModel: 'worker', role: 'worker', inputTokens: 120, outputTokens: 30, usageAvailable: true, totalCostUsd: 0.1, durationMs: 2 },
    ] },
  }
  const result = aggregateMeasurements([event], { from: Date.parse('2026-10-03Z'), to: Date.parse('2026-10-04Z'), bucket: 'day' })
  expect(result.total).toMatchObject({ inputTokens: 120, outputTokens: 30, measuredCalls: 1, unknownCalls: 1, reportedCostUsd: 0.1, costState: 'partial' })
  expect(result.models.find(row => row.model === 'worker')).toMatchObject({ inputTokens: 120, outputTokens: 30, measuredCalls: 1, unknownCalls: 0, incompleteCosts: 0, costState: 'measured' })
  expect(result.models.find(row => row.model === 'planner')).toMatchObject({ inputTokens: null, outputTokens: null, measuredCalls: 0, unknownCalls: 1, costState: 'unknown' })
})
