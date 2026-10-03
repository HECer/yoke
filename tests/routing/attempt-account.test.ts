import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readRoutingAttempts, reserveRoutingAttempt, recordRoutingAttemptUsage, routingAttemptSummary, recordActiveRoutingUsage, finishRoutingAttempt } from '../../src/routing/attempts.js'
import { chooseCapability, routingAssessmentKey } from '../../src/routing/capability.js'
import { makeAdaptiveRunner } from '../../src/routing/router.js'
import { readRoutingObservations, recordRoutingObservation } from '../../src/routing/registry.js'
import { runLoop } from '../../src/loop/loop.js'
import { savePrd } from '../../src/loop/prd.js'
import type { Story } from '../../src/loop/prd.js'

let root: string
const assessment = { taskClass: 'mechanical', difficulty: 'low', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Known rename', approach: 'Rename then verify' } as const
const story: Story = { id: 'A', title: 'Rename symbol', priority: 1, acceptance: ['references updated'], passes: false, assessment }
const workers = [{ id: 'cheap', agent: 'codex', model: 'cheap', tier: 'light', costTier: 'low', capabilities: ['mechanical'] }] as const
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-attempt-account-')); vi.stubEnv('YOKE_REGISTRY_DIR', join(root, 'registry')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })
const reserve = () => reserveRoutingAttempt({ root, contractKey: routingAssessmentKey(root, story), storyId: story.id, limit: 2, profile: 'cheap', provider: 'codex', accountingScope: 'execution-attempt' })
const mutableWorkers = () => workers.map(worker => ({ ...worker, capabilities: [...worker.capabilities] }))

it('enforces two implementation calls even when the optional registry cannot be written', () => {
  const unavailable = join(root, 'not-a-directory'); writeFileSync(unavailable, '')
  vi.stubEnv('YOKE_REGISTRY_DIR', unavailable)
  const prdPath = join(root, 'prd.yaml'); savePrd(prdPath, [story])
  let calls = 0
  const runner = makeAdaptiveRunner({ parent: 'codex', projectRoot: root, workers: mutableWorkers(), strategy: 'capability', maxCandidates: 3, maxAttempts: 2,
    makeWorker: () => () => { calls++; return { success: true, summary: 'implemented' } },
  })
  const result = runLoop({ targetDir: root, prdPath, maxIterations: 1, runner,
    git: { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} },
    verify: () => ({ passed: false, summary: 'red references' }),
  })
  expect(result.status).toBe('blocked')
  expect(calls).toBe(2)
  expect(readRoutingAttempts(root, story.id, routingAssessmentKey(root, story))).toHaveLength(2)
})

it('reserves durable slots before outcomes and cannot replace an existing reservation', () => {
  const first = reserve(), second = reserve()
  expect(first.id).not.toBe(second.id)
  expect(() => reserve()).toThrow(/budget exhausted/u)
  rmSync(join(root, 'registry'), { recursive: true, force: true })
  const choice = chooseCapability({ root, story, assessment, parent: 'codex', workers: mutableWorkers(), maxAttempts: 2 })
  expect(choice.exhausted).toBe(true)
  expect(choice.failures).toBe(0) // an interrupted call is not evidence of weak reasoning
})

it('blocks before provider work when authoritative state cannot be persisted', () => {
  writeFileSync(join(root, '.yoke'), 'not a directory')
  const makeWorker = vi.fn(() => vi.fn(() => ({ success: true, summary: 'implemented' })))
  const result = makeAdaptiveRunner({ parent: 'codex', projectRoot: root, workers: mutableWorkers(), strategy: 'capability', maxCandidates: 3, makeWorker })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(makeWorker.mock.results.flatMap(value => value.value?.mock?.calls ?? [])).toHaveLength(0)
})

it('does not regain retries when the optional last-1000 observation window evicts the task', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
  const create = () => makeAdaptiveRunner({ parent: 'codex', workers: mutableWorkers(), strategy: 'capability', maxCandidates: 1, maxAttempts: 2,
    makeWorker: () => () => ({ success: true, summary: 'implemented' }) })
  for (let attempt = 0; attempt < 2; attempt++) create()({ targetDir: root, story }).routing?.recordOutcome(false)
  const previous = readRoutingObservations()[0]
  expect(previous).toBeDefined()
  const { schemaVersion: _schema, eventId: _event, recordedAt: _recorded, ...observation } = previous
  // Equal-millisecond filenames have UUID tie ordering; make eviction explicit.
  vi.setSystemTime(Date.now() + 1000)
  for (let unrelated = 0; unrelated < 1001; unrelated++) recordRoutingObservation({ ...observation, storyHash: `unrelated-${unrelated}`, assessmentKey: `unrelated-${unrelated}` })
  expect(readRoutingObservations()).toHaveLength(1000)
  expect(readRoutingObservations().some(event => event.assessmentKey === routingAssessmentKey(root, story))).toBe(false)
  const choice = chooseCapability({ root, story, assessment, parent: 'codex', workers: mutableWorkers(), maxAttempts: 2 })
  expect(choice.exhausted).toBe(true)
  expect(choice.failures).toBe(2)
  const result = create()({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(readRoutingAttempts(root, story.id, routingAssessmentKey(root, story))).toHaveLength(2)
})

it('deduplicates per-call usage and never attributes a competing candidate by guesswork', () => {
  const first = reserve()
  const usage = { callId: 'worker-call', inputTokens: 10, outputTokens: 2, totalCostUsd: 0.1, role: 'worker' }
  recordRoutingAttemptUsage(root, first.id, usage)
  recordRoutingAttemptUsage(root, first.id, usage)
  expect(routingAttemptSummary(root, first)).toMatchObject({ calls: 1, inputTokens: 10, totalCostUsd: 0.1, costComplete: true })
  const second = reserve()
  expect(recordActiveRoutingUsage(root, story.id, { ...usage, callId: 'ambiguous-review', role: 'reviewer' })).toBe(false)
  expect(routingAttemptSummary(root, first).costComplete).toBe(false)
  expect(routingAttemptSummary(root, second).costComplete).toBe(false)
  finishRoutingAttempt(root, first, { verificationSuccess: false })
  expect(recordActiveRoutingUsage(root, story.id, { ...usage, callId: 'unambiguous-review', role: 'reviewer' })).toBe(true)
  expect(routingAttemptSummary(root, second).calls).toBe(1)
})

it('retains known partial numbers while refusing to call their aggregate complete', () => {
  const reservation = reserve()
  recordRoutingAttemptUsage(root, reservation.id, { callId: 'partial', inputTokens: 40, outputTokens: 0, totalCostUsd: 0.03,
    measurementComplete: false, costMeasurementComplete: false })
  expect(routingAttemptSummary(root, reservation)).toMatchObject({ inputTokens: 40, totalCostUsd: 0.03, usageComplete: false, costComplete: false })
})
