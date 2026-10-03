import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeReporter } from '../../src/loop/reporter.js'
import { reserveRoutingAttempt, recordRoutingAttemptUsage, routingAttemptSummary } from '../../src/routing/attempts.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-cost-accounting-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
const reserve = () => reserveRoutingAttempt({ root, storyId: 'S1', contractKey: 'a'.repeat(64), limit: 5, profile: 'worker', provider: 'codex', accountingScope: 'execution-attempt' })
it('joins review and repair costs without counting the routed worker twice', () => {
  const reservation = reserve()
  const reporter = makeReporter(root, { quiet: true })
  const worker = { callId: 'worker-1', routingAttemptId: reservation.id, role: 'worker', storyId: 'S1', inputTokens: 100, outputTokens: 20, totalCostUsd: 0.01 }
  recordRoutingAttemptUsage(root, reservation.id, worker)
  reporter.addTokens(worker)
  reporter.addTokens({ callId: 'review-1', storyId: 'S1', role: 'reviewer', inputTokens: 20, outputTokens: 5, totalCostUsd: 0.02 })
  reporter.addTokens({ storyId: 'S1', role: 'repair', inputTokens: 30, outputTokens: 10, totalCostUsd: 0.03 })
  expect(routingAttemptSummary(root, reservation)).toMatchObject({ calls: 3, inputTokens: 150, outputTokens: 35, totalCostUsd: 0.06, costComplete: true })
})
it('makes unknown or ambiguous reviewer costs ineligible for economic comparison', () => {
  const first = reserve(), second = reserve()
  for (const attempt of [first, second]) {
    recordRoutingAttemptUsage(root, attempt.id, { callId: attempt.id, role: 'worker', inputTokens: 100, outputTokens: 20, totalCostUsd: 0.01 })
    expect(routingAttemptSummary(root, attempt).costComplete).toBe(true)
  }
  const reporter = makeReporter(root, { quiet: true })
  reporter.addTokens({ storyId: 'S1', role: 'critic', inputTokens: 0, outputTokens: 0, measurementComplete: false })
  expect(routingAttemptSummary(root, first).costComplete).toBe(false)
  expect(routingAttemptSummary(root, second).costComplete).toBe(false)
})
