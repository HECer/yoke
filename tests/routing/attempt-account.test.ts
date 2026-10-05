import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { readRoutingAttempts, reserveRoutingAttempt, recordRoutingAttemptUsage, routingAttemptSummary, recordActiveRoutingUsage, finishRoutingAttempt } from '../../src/routing/attempts.js'
import { chooseCapability, routingAssessmentKey } from '../../src/routing/capability.js'
import { makeAdaptiveRunner } from '../../src/routing/router.js'
import { readRoutingObservations, recordRoutingObservation } from '../../src/routing/registry.js'
import { runLoop } from '../../src/loop/loop.js'
import { savePrd } from '../../src/loop/prd.js'
import type { Story } from '../../src/loop/prd.js'
import { failureObservation } from '../../src/observability/failure.js'

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

it('retains proven pre-model failures while preserving semantic admission on resume', () => {
  const first = reserve()
  recordRoutingAttemptUsage(root, first.id, { callId: 'preflight', role: 'worker', inputTokens: 0, outputTokens: 0, totalCostUsd: 0 })
  finishRoutingAttempt(root, first, { verificationSuccess: false, failureKind: 'infrastructure', failure: failureObservation('spawn', 'not-started') })
  const second = reserve()
  expect(second.semanticOrdinal).toBe(1)
  finishRoutingAttempt(root, second, { verificationSuccess: false })
  expect(reserve().semanticOrdinal).toBe(2)
  expect(readRoutingAttempts(root, story.id, routingAssessmentKey(root, story))).toHaveLength(3)
  expect(() => reserve()).toThrow(/budget exhausted/u)
})

it.each(['missing', 'paid', 'post-model'] as const)('charges %s infrastructure evidence conservatively', evidence => {
  const first = reserve()
  if (evidence !== 'missing') recordRoutingAttemptUsage(root, first.id, { callId: 'worker', role: 'worker', inputTokens: evidence === 'paid' ? 10 : 0, outputTokens: 0, totalCostUsd: 0 })
  finishRoutingAttempt(root, first, { verificationSuccess: false, failureKind: 'infrastructure', failure: failureObservation('spawn', evidence === 'post-model' ? 'started' : 'not-started') })
  expect(reserve().semanticOrdinal).toBe(2)
  expect(() => reserve()).toThrow(/budget exhausted/u)
})

it.each(['missing', 'partial'] as const)('charges pre-model failures with %s worker cost evidence', costEvidence => {
  const first = reserve()
  recordRoutingAttemptUsage(root, first.id, { callId: 'preflight', role: 'worker', inputTokens: 0, outputTokens: 0,
    ...(costEvidence === 'partial' ? { totalCostUsd: 0, costMeasurementComplete: false } : {}) })
  finishRoutingAttempt(root, first, { verificationSuccess: false, failureKind: 'infrastructure', failure: failureObservation('spawn', 'not-started') })
  expect(readRoutingAttempts(root, story.id, first.contractKey)[0].outcome?.semanticCharge).toBe(true)
  expect(reserve().semanticOrdinal).toBe(2)
  expect(() => reserve()).toThrow(/budget exhausted/u)
})

it('bounds durable infrastructure restarts independently of semantic candidates', () => {
  for (let retry = 0; retry < 4; retry++) {
    const attempt = reserve()
    recordRoutingAttemptUsage(root, attempt.id, { callId: `preflight-${retry}`, role: 'worker', inputTokens: 0, outputTokens: 0, totalCostUsd: 0 })
    finishRoutingAttempt(root, attempt, { verificationSuccess: false, failureKind: 'infrastructure', failure: failureObservation('spawn', 'not-started') })
  }
  expect(() => reserve()).toThrow(/infrastructure restart budget exhausted/u)
})

it('retains reported token subsets and explicit missing subset fields in the ledger', () => {
  const attempt = reserve()
  recordRoutingAttemptUsage(root, attempt.id, { callId: 'subsets', role: 'worker', inputTokens: 100, outputTokens: 20,
    cachedInputTokens: 60, cacheWriteInputTokens: 4, reasoningOutputTokens: 8, usageMissingFields: ['freshInputTokens'] })
  expect(routingAttemptSummary(root, attempt)).toMatchObject({ cachedInputTokens: 60, cacheWriteInputTokens: 4,
    reasoningOutputTokens: 8, usageMissingFields: ['freshInputTokens'] })
})

it.each([undefined, 12])('reports fresh ledger totals only with complete per-call evidence: second=%s', secondFresh => {
  const attempt = reserve()
  recordRoutingAttemptUsage(root, attempt.id, { callId: 'first', role: 'worker', inputTokens: 10, outputTokens: 1, freshInputTokens: 6 })
  recordRoutingAttemptUsage(root, attempt.id, { callId: 'second', role: 'worker', inputTokens: 20, outputTokens: 2,
    ...(secondFresh !== undefined ? { freshInputTokens: secondFresh } : {}) })
  const summary = routingAttemptSummary(root, attempt)
  expect(summary.freshInputTokens).toBe(secondFresh === undefined ? undefined : 18)
  if (secondFresh === undefined) expect(summary.usageMissingFields).toContain('freshInputTokens')
  expect(summary.inputTokens).toBe(30)
})

it('rejects a corrupt durable outcome that releases a semantic slot without structured proof', () => {
  const attempt = reserve()
  finishRoutingAttempt(root, attempt, { verificationSuccess: false })
  const [task, contract, ordinal] = attempt.id.split('.')
  const path = join(root, '.yoke', 'routing-attempts', task, contract, `outcome-${ordinal}.json`)
  const outcome = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...outcome, semanticCharge: false }))
  expect(() => reserve()).toThrow()
})

it('resumes the same profile after proven preflight failure without weakening the budget', () => {
  let calls = 0
  const create = () => makeAdaptiveRunner({ parent: 'codex', projectRoot: root, workers: mutableWorkers(), strategy: 'capability', maxCandidates: 1, maxAttempts: 1,
    makeWorker: () => () => ++calls === 1
      ? { success: false, infrastructureFailure: true, failure: failureObservation('spawn', 'not-started'), summary: 'preflight failed', tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 } }
      : { success: true, summary: 'implemented', tokens: { inputTokens: 10, outputTokens: 2, totalCostUsd: 0.01 } } })
  expect(create()({ targetDir: root, story }).infrastructureFailure).toBe(true)
  expect(create()({ targetDir: root, story }).success).toBe(true)
  expect(calls).toBe(2)
})

it('does not infer infrastructure from product diagnostic text', () => {
  const result = makeAdaptiveRunner({ parent: 'codex', projectRoot: root, workers: mutableWorkers(), strategy: 'capability', maxCandidates: 1,
    makeWorker: () => () => ({ success: false, summary: 'assertion: ENOENT handling is incorrect', tokens: { inputTokens: 10, outputTokens: 2 } }) })({ targetDir: root, story })
  expect(result.infrastructureFailure).not.toBe(true)
  expect(result.routing?.blocked).not.toBe(true)
})

it('preserves typed preflight attribution for an explicitly routed profile', () => {
  const result = makeAdaptiveRunner({ parent: 'codex', projectRoot: root, workers: mutableWorkers(), strategy: 'cost', maxCandidates: 1, maxAttempts: 1,
    rules: [{ storyId: story.id, worker: 'cheap' }],
    makeWorker: () => () => ({ success: false, summary: 'preflight failed', failure: failureObservation('preflight', 'not-started'),
      tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 } }) })({ targetDir: root, story })
  expect(result.infrastructureFailure).toBe(true)
  expect(result.routing?.blocked).toBe(true)
  expect(readRoutingAttempts(root, story.id, routingAssessmentKey(root, story))[0].outcome?.semanticCharge).toBe(false)
})

it('admits semantic slots atomically across competing processes after a preflight failure', async () => {
  const first = reserve()
  recordRoutingAttemptUsage(root, first.id, { callId: 'preflight', role: 'worker', inputTokens: 0, outputTokens: 0, totalCostUsd: 0 })
  finishRoutingAttempt(root, first, { verificationSuccess: false, failureKind: 'infrastructure', failure: failureObservation('spawn', 'not-started') })
  const moduleUrl = new URL('../../src/routing/attempts.ts', import.meta.url).href
  const script = `import { reserveRoutingAttempt } from ${JSON.stringify(moduleUrl)};
    try { console.log(JSON.stringify({ admitted: reserveRoutingAttempt(JSON.parse(process.argv[1])) })); }
    catch (error) { console.log(JSON.stringify({ error: error.message })); }`
  const input = JSON.stringify({ root, contractKey: first.contractKey, storyId: story.id, limit: 2, profile: 'cheap', provider: 'codex' })
  const results = await Promise.all(Array.from({ length: 4 }, () => new Promise<{ admitted?: { semanticOrdinal: number }; error?: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script, input], { windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) { reject(new Error(stderr)); return }
      try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
    })
  })))
  expect(results.flatMap(result => result.admitted ? [result.admitted.semanticOrdinal] : []).sort()).toEqual([1, 2])
  expect(results.filter(result => result.error).every(result => /budget exhausted/u.test(result.error!))).toBe(true)
  expect(readRoutingAttempts(root, story.id, first.contractKey)).toHaveLength(3)
}, 20_000)
