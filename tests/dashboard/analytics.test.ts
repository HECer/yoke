import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateMeasurements, parsePeriod, projectAnalytics } from '../../src/dashboard/analytics.js'
import { appendEvent, type LoopEvent } from '../../src/observability/events.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const period = { from: Date.parse('2026-09-01Z'), to: Date.parse('2026-10-01Z'), bucket: 'day' as const }
const event = (id: string, extra: Partial<LoopEvent> = {}): LoopEvent => ({ schemaVersion: 1, id, runId: 'run', timestamp: '2026-09-06T10:00:00Z', type: 'tokens', storyId: 'task', data: { inputTokens: 100, outputTokens: 20, model: 'actual' }, ...extra })

it('deduplicates archive and recent records and never double-counts call breakdowns', () => {
  const call = event('one', { data: { inputTokens: 120, outputTokens: 30, calls: [
    { provider: 'codex', actualModel: 'fast', role: 'worker', inputTokens: 100, outputTokens: 20, durationMs: 60000, usageAvailable: true },
    { provider: 'codex', actualModel: 'strong', role: 'orchestrator', inputTokens: 20, outputTokens: 10, durationMs: 30000, usageAvailable: true, totalCostUsd: 0.01 },
  ] } })
  const result = aggregateMeasurements([call, call], period)
  expect(result.total).toMatchObject({ inputTokens: 120, outputTokens: 30, measuredCalls: 2, costState: 'partial', tokensPerCallMinute: 100 })
  expect(result.models.map(m => m.model)).toEqual(['fast', 'strong'])
  expect(result.total.tokensPerAccepted).toBeNull()
})

it('uses reporting timestamps, UTC weeks, and explicit acceptance rather than worker termination', () => {
  const result = aggregateMeasurements([
    event('before', { timestamp: '2026-08-31T23:59:59Z' }), event('included'),
    event('after', { timestamp: '2026-10-01T00:00:00Z' }),
    event('attempt', { type: 'attempt-ended', durationMs: 60000, outcome: 'worker-ended', data: { usageAvailable: true } }),
    event('accept', { type: 'accepted' }), event('duplicate-accept', { type: 'accepted' }),
  ], { ...period, bucket: 'week' })
  expect(result.total).toMatchObject({ inputTokens: 100, accepted: 1, attempts: 1, successfulAttempts: 0, tokensPerAccepted: 120, timePerAcceptedMs: 60000 })
  expect(result.buckets[0].label).toBe('2026-08-31')
})

it('preserves unknown measurements and missing model identity', () => {
  const result = aggregateMeasurements([event('unknown', { data: { provider: 'gemini', requestedModel: 'requested', usageAvailable: false } })], period)
  expect(result.total).toMatchObject({ measuredCalls: 0, unknownCalls: 1, costState: 'unknown', tokensPerCallMinute: null })
  expect(result.models[0].model).toBe('unknown')
})

it('analytics keeps unavailable usage out of measured numeric totals', () => {
  const result = aggregateMeasurements([event('unknown', { data: { provider: 'gemini', usageAvailable: false } })], period)
  expect(result.total.inputTokens).toBeNull()
  expect(result.total.outputTokens).toBeNull()
  expect(result.total.reportedCostUsd).toBeNull()
  expect(result.total.callDurationMs).toBeNull()
  expect(result.total.tokensPerElapsedMinute).toBeNull()
})

it('retains measurements across runs after the recent event directory is removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(root)
  for (const runId of ['first', 'second']) appendEvent(root, { runId, timestamp: '2026-09-06T10:00:00Z', type: 'tokens', data: { inputTokens: 100, outputTokens: 20 } })
  expect(projectAnalytics(root, period).total.inputTokens).toBe(200)
  rmSync(join(root, '.yoke', 'events'), { recursive: true })
  expect(projectAnalytics(root, period).total.inputTokens).toBe(200)
})

it('rejects invalid, reversed and oversized periods', () => {
  for (const query of ['from=garbage', 'from=2026-10-01&to=2026-09-01', 'from=2020-01-01&to=2026-01-01', 'bucket=hour']) expect(() => parsePeriod(new URLSearchParams(query))).toThrow()
})
