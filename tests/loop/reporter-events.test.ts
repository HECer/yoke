import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeReporter, readStatus } from '../../src/loop/reporter.js'
import { readEvents } from '../../src/observability/events.js'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-events-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('records failed attempts and measured phase durations with missing usage explicit', () => {
  let time = 1000
  const reporter = makeReporter(root, { quiet: true }, () => new Date(time))
  reporter.storyStart({ id: 'a', title: 'A' }, 1, { passed: 0, total: 1 })
  time += 500
  reporter.phase('verifying')
  time += 300
  reporter.blocked('test failed')
  const events = readEvents(root)
  expect(events.filter(e => e.type === 'phase-ended').map(e => [e.phase, e.durationMs])).toEqual([['implementing', 500], ['verifying', 300]])
  expect(events.find(e => e.type === 'attempt-ended')).toMatchObject({ storyId: 'a', outcome: 'blocked', durationMs: 800, data: { usageAvailable: false } })
})
it('keeps prior duration evidence after one unusually quick completion', () => {
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/story-durations.json'), JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ storyId: String(i), ms: 1000 }))))
  let time = 1000
  const reporter = makeReporter(root, { quiet: true }, () => new Date(time))
  reporter.storyStart({ id: 'a', title: 'A' }, 1, { passed: 0, total: 3 })
  time += 10
  reporter.storyDone({ id: 'a', title: 'A' }, { passed: 1, total: 3 })
  expect(readStatus(root)?.eta).toMatchObject({ avgStoryMs: 1000, sampleCount: 11, confidence: 'medium' })
  expect(readEvents(root).find(event => event.type === 'attempt-ended')?.data).toMatchObject({ prediction: { expectedMs: 1000, sampleCount: 10 }, errorMs: -990 })
})
it('records measured token calls immediately and exposes incomplete cost totals', () => {
  const reporter = makeReporter(root, { quiet: true })
  reporter.storyStart({ id: 'a', title: 'A' }, 1, { passed: 0, total: 1 })
  reporter.addTokens({ inputTokens: 10, outputTokens: 2, totalCostUsd: 0.1 })
  reporter.addTokens({ inputTokens: 5, outputTokens: 1 })
  reporter.paused({ passed: 0, total: 1 })
  expect(readEvents(root).filter(e => e.type === 'tokens')).toHaveLength(2)
  expect(readStatus(root)?.measurement).toMatchObject({ measuredCalls: 2, costAvailable: 'partial' })
})
it('tracks parallel worker phases independently and closes paused attempts', () => {
  let time = 1000
  const reporter = makeReporter(root, { quiet: true }, () => new Date(time))
  reporter.parallel!({ dispatcherId: 'd', maxConcurrency: 2, activeWorkers: 2, queuedCandidates: 0, integrated: 0, reopened: 0, workers: [{ story: 'a', storyTitle: 'A', provider: 'codex', phase: 'implementing' }, { story: 'b', storyTitle: 'B', provider: 'gemini', phase: 'implementing' }] })
  time += 100
  reporter.parallelWorker!({ story: 'a', storyTitle: 'A', provider: 'codex', phase: 'verifying' })
  time += 200
  reporter.paused({ passed: 0, total: 2 })
  const events = readEvents(root)
  expect(events.filter(e => e.type === 'attempt-ended')).toHaveLength(2)
  expect(events.filter(e => e.type === 'phase-ended' && e.storyId === 'a').map(e => e.durationMs)).toEqual([100, 200])
  expect(events.find(e => e.type === 'phase-ended' && e.storyId === 'b')?.durationMs).toBe(300)
})
it('keeps aggregate usage incomplete after a partial contribution', () => {
  const reporter = makeReporter(root, { quiet: true })
  reporter.addTokens({ inputTokens: 3, outputTokens: 1, measurementComplete: false })
  reporter.addTokens({ inputTokens: 5, outputTokens: 2, measurementComplete: true })
  reporter.complete({ passed: 1, total: 1 })
  expect(readStatus(root)?.tokens?.measurementComplete).toBe(false)
})
