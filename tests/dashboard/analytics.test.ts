import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateMeasurements, parsePeriod, projectAnalytics, projectHistory, workspaceAnalytics } from '../../src/dashboard/analytics.js'
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

it('does not count numeric token fields when usage is explicitly unavailable', () => {
  const result = aggregateMeasurements([event('partial', { data: { provider: 'gemini', inputTokens: 10, outputTokens: 5, usageAvailable: false } })], period)
  expect(result.total.inputTokens).toBeNull()
  expect(result.total.outputTokens).toBeNull()
  expect(result.total.measuredCalls).toBe(0)
  expect(result.total.unknownCalls).toBe(1)
})

it('filters the bounded event history by period before applying the requested limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(root)
  appendEvent(root, { runId: 'target', type: 'status', timestamp: '2026-09-06T10:00:00Z' })
  for (let index = 0; index < 100; index++) appendEvent(root, { runId: `later-${index}`, type: 'status', timestamp: `2026-10-01T${String(index % 24).padStart(2, '0')}:00:00Z` })
  const result = projectHistory(root, period, 1)
  expect(result.events.map(item => item.runId)).toEqual(['target'])
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

it('history exposes bucketed token, call, outcome, time and cost coverage projections', () => {
  const first = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(first)
  const second = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(second)
  appendEvent(first, { runId: 'first-run', timestamp: '2026-09-06T10:00:00Z', type: 'tokens', data: { inputTokens: 100, outputTokens: 20, provider: 'codex', model: 'gpt', role: 'worker', usageAvailable: true, totalCostUsd: 0.01 }, durationMs: 60000 })
  appendEvent(first, { runId: 'first-run', timestamp: '2026-09-06T10:01:00Z', type: 'attempt-ended', durationMs: 120000, outcome: 'passed', data: { usageAvailable: true } })
  appendEvent(first, { runId: 'first-run', timestamp: '2026-09-06T10:02:00Z', type: 'accepted' })
  appendEvent(second, { runId: 'second-run', timestamp: '2026-09-07T10:00:00Z', type: 'tokens', data: { inputTokens: 10, outputTokens: 5, usageAvailable: false } })
  const project = projectAnalytics(first, period)
  expect(project.total).toMatchObject({ inputTokens: 100, outputTokens: 20, measuredCalls: 1, unknownCalls: 0 })
  expect(project.total.tokens).toMatchObject({ input: 100, output: 20, total: 120 })
  expect(project.total.calls).toMatchObject({ measured: 1, unknown: 0, total: 1 })
  expect(project.total.outcomes).toMatchObject({ attempts: 1, successfulAttempts: 1, accepted: 1 })
  expect(project.total.time).toMatchObject({ callDurationMs: 60000, attemptDurationMs: 120000, elapsedMs: 120000 })
  expect(project.total.cost).toMatchObject({ reportedUsd: 0.01, state: 'measured' })
  expect(project.buckets.map(bucket => bucket.label)).toEqual(['2026-09-06'])
  const workspace = workspaceAnalytics([
    { id: 'first', root: first, name: 'First' },
    { id: 'second', root: second, name: 'Second' },
  ], period)
  expect(workspace.total.tokens.total).toBe(120)
  expect(workspace.total.calls.total).toBe(2)
  expect(workspace.total.cost.state).toBe('partial')
  expect(workspace.buckets.map(bucket => bucket.label)).toEqual(['2026-09-06', '2026-09-07'])
})

it('ranking projections order projects and dimensions with deterministic ties', () => {
  const alpha = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(alpha)
  const beta = mkdtempSync(join(tmpdir(), 'yoke-history-')); roots.push(beta)
  appendEvent(alpha, { runId: 'alpha-run', timestamp: '2026-09-06T10:00:00Z', type: 'tokens', data: { inputTokens: 20, outputTokens: 0, provider: 'same', model: 'same', role: 'worker', usageAvailable: true, totalCostUsd: 0.02 } })
  appendEvent(alpha, { runId: 'alpha-run', timestamp: '2026-09-06T10:01:00Z', type: 'accepted' })
  appendEvent(beta, { runId: 'beta-run', timestamp: '2026-09-06T10:00:00Z', type: 'tokens', data: { inputTokens: 20, outputTokens: 0, provider: 'same', model: 'same', role: 'worker', usageAvailable: true, totalCostUsd: 0.01 } })
  const result = workspaceAnalytics([
    { id: 'b', root: beta, name: 'Beta', attention: 1 },
    { id: 'a', root: alpha, name: 'Alpha', attention: 1 },
  ], period)
  expect(result.rankings.projects.attention.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  expect(result.rankings.projects.tokens.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  expect(result.rankings.projects.cost.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  expect(result.rankings.projects.acceptance.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  expect(result.rankings.projects.name.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  expect(result.rankings.providers.tokens.map(row => row.name)).toEqual(['same'])
  expect(result.rankings.models.name.map(row => row.name)).toEqual(['same'])
  expect(result.rankings.runs.name.map(row => row.name)).toEqual(['alpha-run', 'beta-run'])
})
