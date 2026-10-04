import { expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvent, type LoopEvent } from '../../src/observability/events.js'
import { providerTelemetryUsage } from '../../src/observability/usage.js'
import { readMeasurements } from '../../src/observability/history.js'
import { localUsageReport, summarizeUsageEvents } from '../../src/observability/local-report.js'

const api = { localUsageReport, summarizeUsageEvents }
const event = (id: string, data: Record<string, unknown>, extra: Partial<LoopEvent> = {}): LoopEvent => ({ schemaVersion: 1, id, runId: 'run', timestamp: '2026-10-04T12:00:02Z', type: 'tokens', attemptId: 'attempt', data, ...extra })

it('reports identified calls once with field coverage, unknown costs and unavailable host roles', () => {
  expect(api.summarizeUsageEvents).toBeTypeOf('function')
  const call = { callId: 'worker', role: 'worker', inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, reasoningOutputTokens: 10 }
  const report = api.summarizeUsageEvents([
    event('aggregate', { inputTokens: 100, outputTokens: 20, calls: [call] }),
    event('direct', call, { durationMs: 500 }),
    event('missing', { callId: 'missing', role: 'reviewer', usageAvailable: false }),
  ])
  expect(report.total.inputTokens).toBe(100)
  expect(report.total.outputTokens).toBe(20)
  expect(report.total.totalTokens).toBe(120)
  expect(report.total.totalCostUsd).toBeNull()
  expect(report.calls).toHaveLength(2)
  expect(report.time.workerProcessDurationMs).toBe(500)
  expect(report.calls.find((c: any) => c.callId === 'worker')).toMatchObject({ role: 'worker', attemptId: 'attempt', source: 'local-event', coverage: 'measured', cachedInputTokens: 80 })
  expect(report.calls.find((c: any) => c.callId === 'missing')).toMatchObject({ inputTokens: null, outputTokens: null, coverage: 'unknown' })
  expect(report.hostCoverage).toEqual({ guardian: 'unknown', approval: 'unknown' })
})

it('preserves absent core and partial optional fields through the compatible usage contract', () => {
  const usage = providerTelemetryUsage({ usageAvailable: false, partialUsage: { inputTokens: 7 } })
  expect(usage).toMatchObject({ usageMissingFields: expect.arrayContaining(['outputTokens']), usagePartialFields: ['inputTokens'] })
  const report = api.summarizeUsageEvents([event('partial', { ...usage })])
  expect(report.calls[0]).toMatchObject({ inputTokens: 7, outputTokens: null, fieldCoverage: { inputTokens: 'partial', outputTokens: 'unknown' } })
  expect(report.total.totalTokens).toBeNull()
})

it('archives usage sources and explicit classification for retained report evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-report-history-'))
  try {
    appendEvent(root, { runId: 'run', timestamp: '2026-10-04T12:00:02Z', type: 'tokens', data: { usageSource: 'provider', usageMissingFields: ['outputTokens'], usagePartialFields: ['inputTokens'], failureCategory: 'observer' } })
    expect(readMeasurements(root, Date.parse('2026-10-04'), Date.parse('2026-10-05')).events[0].data).toMatchObject({ usageSource: 'provider', usageMissingFields: ['outputTokens'], usagePartialFields: ['inputTokens'], failureCategory: 'observer' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('retains partial lower bounds and marks overlapping parent and child views as excluded', () => {
  expect(api.summarizeUsageEvents).toBeTypeOf('function')
  const report = api.summarizeUsageEvents([
    event('parent', { callId: 'parent', role: 'worker', inputTokens: 100, outputTokens: 20 }),
    event('child', { callId: 'child', parentCallId: 'parent', role: 'guardian', inputTokens: 40, outputTokens: 5 }),
    event('partial', { callId: 'partial', inputTokens: 7, usageAvailable: false }),
  ])
  expect(report.total.inputTokens).toBe(107)
  expect(report.total.coverage).toBe('partial')
  expect(report.calls.find((c: any) => c.callId === 'child')).toMatchObject({ counted: false, exclusion: 'parent-view-overlap' })
  expect(report.hostCoverage.guardian).toBe('measured')
})

it('separates process durations, phase interval sum and union, and explicit failure categories', () => {
  expect(api.summarizeUsageEvents).toBeTypeOf('function')
  const report = api.summarizeUsageEvents([
    event('call', { callId: 'call', role: 'worker', inputTokens: 0, outputTokens: 0 }, { durationMs: 500 }),
    event('phase1', {}, { type: 'phase-ended', phase: 'implementing', durationMs: 2000 }),
    event('phase2', {}, { type: 'phase-ended', phase: 'implementing', durationMs: 2000, timestamp: '2026-10-04T12:00:03Z' }),
    ...['observer', 'infrastructure', 'product'].map(category => event(category, { failureCategory: category }, { type: 'attempt-ended', outcome: 'failed' })),
    event('unclassified', {}, { type: 'attempt-ended', outcome: 'failed' }),
  ])
  expect(report.time).toMatchObject({ workerProcessDurationMs: 500, phaseDurationSumMs: 4000, phaseDurationUnionMs: 3000 })
  expect(report.failures).toEqual({ observer: 1, infrastructure: 1, product: 1, unknown: 1 })
})

it('reads archived and recent local events once without mutating the store', () => {
  expect(api.localUsageReport).toBeTypeOf('function')
  const root = mkdtempSync(join(tmpdir(), 'yoke-local-report-'))
  try {
    appendEvent(root, { runId: 'run', timestamp: '2026-10-04T12:00:02Z', type: 'tokens', role: 'approval', data: { inputTokens: 3, outputTokens: 1, usageSource: 'provider', failureCategory: 'observer' } })
    const dir = join(root, '.yoke/events')
    const before = readdirSync(dir).map(name => readFileSync(join(dir, name), 'utf8'))
    const report = api.localUsageReport(root, { from: Date.parse('2026-10-04'), to: Date.parse('2026-10-05') })
    expect(report.total.totalTokens).toBe(4)
    expect(report.calls[0].source).toBe('provider')
    expect(report.hostCoverage.approval).toBe('measured')
    expect(readdirSync(dir).map(name => readFileSync(join(dir, name), 'utf8'))).toEqual(before)
    expect(() => api.localUsageReport(root, { from: 2, to: 1 })).toThrow('valid period')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
