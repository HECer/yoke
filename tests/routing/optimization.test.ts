import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assessmentSignature, optimizeCapability } from '../../src/routing/optimization.js'
import { projectHash, type RoutingObservation } from '../../src/routing/registry.js'
import { chooseCapability } from '../../src/routing/capability.js'
import type { RoutingWorker } from '../../src/retrofit/config.js'

const assessment = { taskClass: 'mechanical', difficulty: 'low', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Bounded rename', approach: 'Rename and verify' } as const
const workers: RoutingWorker[] = [
  { id: 'small', agent: 'codex', model: 'small-alias', tier: 'light', costTier: 'low', capabilities: ['mechanical'] },
  { id: 'strong', agent: 'codex', model: 'strong-alias', tier: 'strong', costTier: 'high', capabilities: ['mechanical'] },
]
const settings = { version: 1, objective: 'balanced', minSamples: 10 } as const
type Episode = NonNullable<RoutingObservation['economicEpisode']>

// Synthetic observations exercise policy; these are not provider benchmarks.
function observation(worker: RoutingWorker, index: number, changes: Partial<Episode> = {}): RoutingObservation {
  return {
    schemaVersion: 1, eventId: `${worker.id}-${index}`, recordedAt: new Date(1_800_000_000_000 + index * 1000).toISOString(),
    projectHash: 'project', storyHash: `story-${index}`, strategy: 'capability', selected: worker.id, provider: worker.agent,
    requestedModel: worker.model, actualModel: `${worker.id}-snapshot`, orchestratorProvider: 'codex',
    orchestratorDurationMs: 0, workerDurationMs: 5, processSuccess: true, verificationSuccess: true,
    inputTokens: 2, outputTokens: 1, totalCostUsd: 0.001, role: 'implementation',
    economicEpisode: {
      id: `${worker.id}-${index}`, initial: { version: 1, id: `${worker.id}-${index}.1`, contractKey: 'a'.repeat(64), storyId: `story-${index}`,
        ordinal: 1, limit: 5, startedAt: new Date(1_800_000_000_000 + index * 1000).toISOString(),
        profile: worker.id, provider: worker.agent, requestedModel: worker.model, accountingScope: 'execution-attempt', executionPolicyKey: 'same-gates' },
      actualInitialModel: `${worker.id}-snapshot`, complete: true, success: true, infrastructureFailure: false,
      attempts: 1, costComplete: true, totalCostUsd: worker.id === 'small' ? 0.2 : 0.1,
      durationMs: worker.id === 'small' ? 200 : 100, assessmentSignature: assessmentSignature(assessment), ...changes,
    },
  }
}
const rows = (worker: RoutingWorker, changes: Partial<Episode> = {}) => Array.from({ length: 10 }, (_, index) => observation(worker, index, changes))
const choose = (observations = [...rows(workers[0]), ...rows(workers[1])], overrides: Partial<Parameters<typeof optimizeCapability>[0]> = {}) =>
  optimizeCapability({ workers, observations, assessment, settings, executionPolicyKey: 'same-gates', role: 'implementation', ...overrides })

describe('conservative measured capability economics', () => {
  it('preserves existing selection when optimization is absent', () => {
    expect(choose(undefined, { settings: undefined })).toEqual({ worker: workers[0], reason: '' })
  })

  it('does not spend cold-start confidence or invent probabilities', () => {
    const result = choose([...rows(workers[0]).slice(1), ...rows(workers[1])])
    expect(result.worker).toBe(workers[0])
    expect(result.reason).toContain('need 10 recent complete comparable execution sequences')
    expect(result.reason).not.toMatch(/\bp\s*=|confidence=|probability/iu)
    expect(choose(undefined, { executionPolicyKey: undefined }).worker).toBe(workers[0])
  })

  it('can select a stronger declared-cost tier when its complete sequences cost less and finish sooner', () => {
    const result = choose()
    expect(result.worker).toBe(workers[1])
    expect(result.reason).toContain('10/10 accepted')
    expect(result.reason).toContain('$0.1000')
    expect(result.reason).toContain('not a calibrated forecast')
  })

  it('uses the requested objective without inventing weights for balanced tradeoffs', () => {
    const observations = [...rows(workers[0]), ...rows(workers[1], { durationMs: 300 })]
    expect(choose(observations).worker).toBe(workers[0])
    expect(choose(observations, { settings: { ...settings, objective: 'cost' } }).worker).toBe(workers[1])
    expect(choose(observations, { settings: { ...settings, objective: 'speed' } }).worker).toBe(workers[0])
  })

  it('does not exchange lower observed completion for lower dollars or time', () => {
    const strong = rows(workers[1]); strong[0].economicEpisode!.success = false
    expect(choose([...rows(workers[0]), ...strong]).worker).toBe(workers[0])
  })

  it('charges completed failures and escalations to the initial profile instead of reading cheap worker-only costs', () => {
    const small = rows(workers[0], { attempts: 3, totalCostUsd: 2 })
    const strong = rows(workers[1], { totalCostUsd: 1 })
    small[0].economicEpisode!.success = false
    strong[0].economicEpisode!.success = false
    const result = choose([...small, ...strong], { settings: { ...settings, objective: 'cost' } })
    expect(result.worker).toBe(workers[1])
    expect(result.reason).toContain('9/10 accepted')
    expect(result.reason).toContain('$1.1111') // all $10 divided by nine accepted sequences
  })

  it.each([
    ['partial costs', { costComplete: false }],
    ['open attempt', { complete: false }],
    ['unknown concrete model', { actualInitialModel: undefined }],
    ['infrastructure failure', { infrastructureFailure: true }],
  ] as const)('keeps an incomplete recent window cold: %s', (_name, changes) => {
    const strong = rows(workers[1]); Object.assign(strong[9].economicEpisode!, changes)
    expect(choose([...rows(workers[0]), ...strong]).worker).toBe(workers[0])
  })

  it('does not silently drop worker-only or differently verified sequences', () => {
    for (const change of [{ accountingScope: 'worker' as const }, { executionPolicyKey: 'weaker-gates' }]) {
      const strong = rows(workers[1]); Object.assign(strong[9].economicEpisode!.initial, change)
      expect(choose([...rows(workers[0]), ...strong]).worker).toBe(workers[0])
    }
  })

  it('does not inherit enough samples across a changed concrete model or task-risk assessment', () => {
    const changedModel = rows(workers[1]); changedModel[9].economicEpisode!.actualInitialModel = 'new-snapshot'
    expect(choose([...rows(workers[0]), ...changedModel]).worker).toBe(workers[0])
    const changedRisk = rows(workers[1]); changedRisk[9].economicEpisode!.assessmentSignature = assessmentSignature({ ...assessment, risk: 'high' })
    expect(choose([...rows(workers[0]), ...changedRisk]).worker).toBe(workers[0])
  })

  it('counts one completion sequence once despite multiple retry observations', () => {
    const strong = rows(workers[1]).slice(1)
    strong.push({ ...strong[0], eventId: 'same-sequence-again' })
    expect(choose([...rows(workers[0]), ...strong]).worker).toBe(workers[0])
    const open = observation(workers[1], 0, { complete: false, costComplete: false })
    expect(choose([...rows(workers[0]), open, ...rows(workers[1])]).worker).toBe(workers[1])
  })

  it('does not interpret approval frequency as independent reviewer quality', () => {
    const result = choose(undefined, { role: 'reviewer' })
    expect(result.worker).toBe(workers[0])
    expect(result.reason).toContain('independent role-quality evidence is unavailable')
  })

  it('keeps a recent infrastructure episode in the comparison window through the real capability selector', () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-economic-policy-'))
    const previousRegistry = process.env.YOKE_REGISTRY_DIR
    try {
      process.env.YOKE_REGISTRY_DIR = join(root, 'registry')
      mkdirSync(join(root, 'registry', 'events'), { recursive: true })
      const recentFailure = observation(workers[1], 10, { infrastructureFailure: true, success: false })
      recentFailure.failureKind = 'infrastructure'
      recentFailure.verificationSuccess = false
      const events = [...rows(workers[0]), ...rows(workers[1]), recentFailure]
      events.forEach((event, index) => writeFileSync(join(root, 'registry', 'events', `${String(index).padStart(3, '0')}.json`), JSON.stringify({
        ...event, projectHash: projectHash(root), recordedAt: new Date().toISOString(), taskClass: assessment.taskClass, requiredTier: 'light',
      })))
      const story = { id: 'S1', title: 'Rename', priority: 1, acceptance: ['rename verified'], passes: false, assessment }
      const choice = chooseCapability({ root, story, assessment, workers, parent: 'codex', optimization: settings, executionPolicyKey: 'same-gates' })
      expect(choice.worker?.id).toBe('small')
      const risky = { ...assessment, risk: 'high' as const }
      const highRisk = chooseCapability({ root, story: { ...story, assessment: risky }, assessment: risky,
        workers: [{ ...workers[0] }, { ...workers[1], tier: 'frontier' }], parent: 'codex', optimization: settings, executionPolicyKey: 'same-gates' })
      expect(highRisk.worker?.id).toBe('strong')
      expect(highRisk.requiredTier).toBe('frontier')
    } finally {
      if (previousRegistry === undefined) delete process.env.YOKE_REGISTRY_DIR
      else process.env.YOKE_REGISTRY_DIR = previousRegistry
      rmSync(root, { recursive: true, force: true })
    }
  })
})
