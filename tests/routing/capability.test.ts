import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assessmentKey, parseAssessment, requiredTier, type TaskAssessment } from '../../src/routing/assessment.js'
import { chooseCapability, readAssessment, saveAssessment, roleSelection } from '../../src/routing/capability.js'
import { projectHash, recordRoutingObservation } from '../../src/routing/registry.js'
import { makeAdaptiveRunner, makeAsyncAdaptiveRunner } from '../../src/routing/router.js'
import { defaultRoutingWorkers } from '../../src/setup/command.js'
import type { Story } from '../../src/loop/prd.js'
import { runStoryWorker } from '../../src/loop/worker.js'
import { runLoop } from '../../src/loop/loop.js'
import { savePrd } from '../../src/loop/prd.js'

let root: string
const assessment: TaskAssessment = { taskClass: 'mechanical', difficulty: 'low', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Known rename with executable checks', approach: 'Rename the symbol and run its tests' }
const story: Story = { id: 'A', title: 'Rename symbol', priority: 1, acceptance: ['references updated'], passes: false }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-capability-')); vi.stubEnv('YOKE_REGISTRY_DIR', join(root, 'registry')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })
const workers = defaultRoutingWorkers(['codex'])
function options() {
  return { parent: 'codex' as const, parentSelection: { model: 'gpt-6-astra', reasoningEffort: 'high' }, projectRoot: root, workers, strategy: 'capability' as const, maxCandidates: 3 }
}

it('requires stronger profiles for risk, uncertainty and weak acceptance despite a small scope', () => {
  expect(requiredTier(assessment)).toBe('light')
  expect(requiredTier({ ...assessment, risk: 'high' })).toBe('frontier')
  expect(requiredTier({ ...assessment, uncertainty: 'high' })).toBe('frontier')
  expect(requiredTier({ ...assessment, testability: 'low' })).toBe('strong')
  expect(requiredTier(assessment, 'reviewer')).toBe('standard')
})

it('validates structured assessments inside provider envelopes and rejects incomplete guesses', () => {
  expect(parseAssessment(JSON.stringify({ result: 'YOKE_ASSESS ' + JSON.stringify(assessment) }))).toEqual(assessment)
  expect(parseAssessment('YOKE_ASSESS {"difficulty":"low"}')).toBeUndefined()
})

it('plans once with the start model and reuses the assessment across runners and worktrees', () => {
  const captureRoute = vi.fn(() => ({ success: true, summary: 'plan', output: 'YOKE_ASSESS ' + JSON.stringify(assessment), tokens: { inputTokens: 10, outputTokens: 3 } }))
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'done', tokens: { inputTokens: 2, outputTokens: 1 } }))
  makeAdaptiveRunner({ ...options(), captureRoute, makeWorker })({ targetDir: root, story })
  makeAdaptiveRunner({ ...options(), captureRoute, makeWorker })({ targetDir: join(root, 'worktree'), story })
  expect(captureRoute).toHaveBeenCalledTimes(1)
  expect(captureRoute.mock.calls[0][3]).toMatchObject({ model: 'gpt-6-astra', reasoningEffort: 'high' })
  expect(makeWorker.mock.calls[0][1]).toMatchObject({ model: 'gpt-5.6-luna', reasoningEffort: 'low' })
  expect(readAssessment(root, story)).toEqual(assessment)
})

it('invalidates assessments when requirements change but not on a passes update', () => {
  saveAssessment(root, story, assessment, { provider: 'codex' })
  expect(readAssessment(root, { ...story, title: 'New contract' })).toBeUndefined()
  expect(assessmentKey({ ...story, passes: true })).toBe(assessmentKey(story))
})

it('blocks malformed planning output without ever invoking an implementer', () => {
  const makeWorker = vi.fn()
  const result = makeAdaptiveRunner({ ...options(), captureRoute: () => ({ success: true, summary: '', output: 'bad' }), makeWorker })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(makeWorker).not.toHaveBeenCalled()
})

it('allows one same-tier repair then escalates across persisted independent failures and stops at budget', () => {
  const models: string[] = []
  const planned = { ...story, assessment }
  for (let i = 0; i < 5; i++) {
    const result = makeAdaptiveRunner({ ...options(), makeWorker: (_agent, selection) => () => { models.push(selection.model!); return { success: true, summary: 'done' } } })({ targetDir: root, story: planned })
    result.routing!.recordOutcome(false)
    result.routing!.recordOutcome(false)
  }
  expect(models).toEqual(['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'])
  const result = makeAdaptiveRunner({ ...options() })({ targetDir: root, story: planned })
  expect(result.routing?.blocked).toBe(true)
})

it('does not escalate infrastructure failures or inherit another project outcome', () => {
  const planned = { ...story, assessment }
  for (let i = 0; i < 3; i++) makeAdaptiveRunner({ ...options(), makeWorker: () => () => ({ success: false, infrastructureFailure: true, summary: 'no credentials' }) })({ targetDir: root, story: planned }).routing!.recordOutcome(false)
  const choice = chooseCapability({ root, story: planned, assessment, workers, parent: 'codex' })
  expect(choice.failures).toBe(0)
  expect(choice.selection.model).toBe('gpt-5.6-luna')
})

it('respects provider affinity and role floors without truncating away strong profiles', () => {
  const choice = chooseCapability({ root, story: { ...story, agent: 'claude' }, assessment: { ...assessment, risk: 'high' }, workers: defaultRoutingWorkers(['codex', 'claude', 'gemini']), parent: 'codex', role: 'critic' })
  expect(choice.provider).toBe('claude')
  expect(choice.selection.model).toBe('opus')
})

it('preserves both planning and implementation usage without counting missing charges as free', async () => {
  const result = await makeAsyncAdaptiveRunner({ ...options(), captureRoute: async () => ({ success: true, summary: '', output: 'YOKE_ASSESS ' + JSON.stringify(assessment), tokens: { inputTokens: 10, outputTokens: 2 } }), makeWorker: () => async () => ({ success: true, summary: 'done', tokens: { inputTokens: 20, outputTokens: 3, totalCostUsd: 0.1 } }) })({ targetDir: root, story })
  expect(result.tokens).toMatchObject({ inputTokens: 30, outputTokens: 5, totalCostUsd: 0.1, measurementComplete: true, costMeasurementComplete: false })
  expect(result.tokens?.calls).toHaveLength(2)
})

it('retries failed worker gates in the same worktree and passes their evidence to the repair', async () => {
  let attempts = 0
  const feedback: Array<string | undefined> = []
  const runner = makeAsyncAdaptiveRunner({ ...options(), captureRoute: async () => { throw new Error('already planned') }, makeWorker: () => async context => {
    feedback.push(context.feedback); attempts++; writeFileSync(join(root, 'patch.txt'), String(attempts)); return { success: true, summary: 'implemented' }
  } })
  const result = await runStoryWorker({ story: { ...story, assessment }, worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'worker' }, runner,
    verify: () => ({ passed: attempts >= 3, summary: 'rename references are incomplete' }) })
  expect(result.kind).toBe('candidate')
  expect(attempts).toBe(3)
  expect(feedback[1]).toContain('rename references')
})

it('does not retry across a critical decision request', async () => {
  let attempts = 0
  mkdirSync(join(root, '.yoke'))
  const runner = makeAsyncAdaptiveRunner({ ...options(), captureRoute: async () => { throw new Error('already planned') }, makeWorker: () => async () => {
    attempts++; writeFileSync(join(root, '.yoke', 'decision-request.yaml'), 'decision'); return { success: true, summary: 'needs a decision' }
  } })
  await runStoryWorker({ story: { ...story, assessment }, worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'worker' }, runner,
    beforeGates: () => 'critical decision', verify: () => ({ passed: false, summary: 'red' }) })
  expect(attempts).toBe(1)
})

it('uses sufficiently sampled project/class/model evidence without lowering the safety floor', () => {
  for (let i = 0; i < 10; i++) recordRoutingObservation({ projectHash: projectHash(root), storyHash: String(i), strategy: 'capability', selected: 'codex-light', provider: 'codex', requestedModel: 'gpt-5.6-luna', actualModel: 'gpt-5.6-luna', requestedReasoningEffort: 'low', orchestratorProvider: 'codex', orchestratorDurationMs: 0, workerDurationMs: 10, processSuccess: true, verificationSuccess: i < 6, inputTokens: 1, outputTokens: 1, taskClass: 'mechanical', requiredTier: 'light', role: 'implementation' })
  expect(chooseCapability({ root, story, assessment, workers, parent: 'codex' }).selection.model).toBe('gpt-5.6-terra')
  expect(chooseCapability({ root: join(root, 'another-project'), story, assessment, workers, parent: 'codex' }).selection.model).toBe('gpt-5.6-luna')
  expect(chooseCapability({ root, story, assessment: { ...assessment, risk: 'high' }, workers, parent: 'codex' }).selection.model).toBe('gpt-6-astra')
})

it('routes review and repair effort independently while preserving explicit role eligibility', () => {
  const config = { canonVersion: 'test', agents: ['codex'] as const, loop: { enabled: true }, runner: { agent: 'codex' as const, model: 'gpt-6-astra' }, routing: { enabled: true, strategy: 'capability' as const, maxCandidates: 3, workers } }
  const mutable = { ...config, agents: [...config.agents] }
  expect(roleSelection(root, mutable, { ...story, assessment }, 'codex', 'reviewer')?.model).toBe('gpt-5.6-terra')
  expect(roleSelection(root, mutable, { ...story, assessment }, 'codex', 'repair', 3)?.model).toBe('gpt-5.6-sol')
  const restricted = workers.map(w => ({ ...w, roles: ['implementation' as const] }))
  expect(chooseCapability({ root, story, assessment, workers: restricted, parent: 'codex', parentSelection: { model: 'gpt-6-astra' }, role: 'reviewer' }).selection.model).toBe('gpt-6-astra')
})

it('stops an infrastructure gate failure without spending a repair or escalating', async () => {
  let attempts = 0
  const planned = { ...story, assessment }
  const runner = makeAsyncAdaptiveRunner({ ...options(), captureRoute: async () => { throw new Error('already planned') }, makeWorker: () => async () => { attempts++; return { success: true, summary: 'done' } } })
  await runStoryWorker({ story: planned, worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'worker' }, runner,
    verify: () => ({ passed: false, summary: 'command not found: test-runtime' }) })
  expect(attempts).toBe(1)
  expect(chooseCapability({ root, story: planned, assessment, workers, parent: 'codex' }).failures).toBe(0)
})

it('runs serial repairs through independent checks and commits only the final green result', () => {
  const prdPath = join(root, 'prd.yaml')
  savePrd(prdPath, [{ ...story, assessment }])
  let attempts = 0
  const commits = vi.fn()
  const runner = makeAdaptiveRunner({ ...options(), makeWorker: () => context => { attempts++; if (attempts > 1) expect(context.feedback).toContain('red'); return { success: true, summary: 'done' } } })
  const result = runLoop({ targetDir: root, prdPath, maxIterations: 1, runner,
    git: { isClean: () => true, commitAll: commits, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} },
    verify: () => ({ passed: attempts >= 3, summary: 'red references' }) })
  expect(result.status).toBe('complete')
  expect(attempts).toBe(3)
  expect(commits).toHaveBeenCalledTimes(1)
})
