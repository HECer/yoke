import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assessProjectGoal, budgetProjectGoal, createProjectGoal, goalRoutingStory, readProjectGoal, runProjectGoal } from '../../src/goals/command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { defaultRoutingWorkers } from '../../src/setup/command.js'
import * as providers from '../../src/agents/providers.js'
import * as nativeGoals from '../../src/goals/codex-native.js'
import type { TokenUsage } from '../../src/loop/reporter.js'
import { readEvents } from '../../src/observability/events.js'
import { loadAcceptance } from '../../src/check/command.js'
import { readRoutingAttempts, reserveRoutingAttempt } from '../../src/routing/attempts.js'
import { routingAssessmentKey, saveAssessment } from '../../src/routing/capability.js'

let root: string
let state: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yoke-goal-budget-'))
  state = mkdtempSync(join(tmpdir(), 'yoke-goal-budget-state-'))
  vi.stubEnv('YOKE_STATE_DIR', join(state, 'state'))
  vi.stubEnv('LOCALAPPDATA', join(state, 'local'))
  vi.stubEnv('YOKE_REGISTRY_DIR', join(state, 'routing'))
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: outcome\n  text: Expected outcome\n  commands: [node test.mjs]\n')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }) })
const assessment = { taskClass: 'implementation', difficulty: 'medium', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Known fixture', approach: 'Write implemented.txt' }
function planner(usage?: TokenUsage, partialUsage?: Partial<TokenUsage>) {
  return vi.spyOn(providers, 'startProviderProcess').mockImplementation(() => ({
    recordPath: '', completion: Promise.resolve({ kind: 'succeeded', stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `YOKE_ASSESS ${JSON.stringify(assessment)}` } }), stderr: '', telemetry: { usageAvailable: usage !== undefined && usage.measurementComplete !== false, tokens: usage, partialUsage } }),
  } as unknown as ReturnType<typeof providers.startProviderProcess>))
}
function configure(policy: 'prepared' | 'on-demand' = 'on-demand') {
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, runner: { agent: 'codex', model: 'fixture-parent' }, routing: { enabled: true, strategy: 'capability', assessmentPolicy: policy, maxCandidates: 3, workers: defaultRoutingWorkers(['codex']) } })
}
function implement(inputTokens = 1, outputTokens = 1) {
  return vi.fn(async () => { writeFileSync(join(root, 'implemented.txt'), 'done'); return { success: true, summary: 'implemented', inputTokens, outputTokens } })
}
it('does not dispatch a worker after its planner has reached the goal token ceiling', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); planner({ inputTokens: 90, outputTokens: 10 })
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/token.*exhaust|budget/i)
  expect(result.attempts[0]).toMatchObject({ inputTokens: 90, outputTokens: 10 })
  expect(readRoutingAttempts(root, goal.id, routingAssessmentKey(root, goalRoutingStory(goal, loadAcceptance(root)!, 'codex')))).toHaveLength(0)
})
it('durably charges a planner overrun before dispatch and does not double-charge it after a budget increase', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); const plan = planner({ inputTokens: 1000, outputTokens: 100 })
  const worker = implement()
  const first = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(first.attempts[0]).toMatchObject({ inputTokens: 1000, outputTokens: 100 })
  budgetProjectGoal(root, { tokenBudget: 1102 })
  const second = await runProjectGoal(root, { execute: worker })
  expect(plan).toHaveBeenCalledTimes(1)
  expect(worker).toHaveBeenCalledTimes(1)
  expect(second.status).toBe('complete')
  expect(second.attempts.reduce((n, a) => n + (a.inputTokens ?? 0) + (a.outputTokens ?? 0), 0)).toBe(1102)
})
it.each([undefined, { inputTokens: 0, outputTokens: 0, measurementComplete: false }])('does not dispatch a budgeted worker after unknown planner usage (%j)', async usage => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); planner(usage)
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/unknown/i)
  budgetProjectGoal(root, { tokenBudget: 10000 })
  await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
})
it('allows exactly the remaining native budget and includes planner consumption in streamed cancellation', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); planner({ inputTokens: 8, outputTokens: 2 })
  let remaining: number | undefined, aborted = false
  const native = vi.spyOn(nativeGoals, 'executeCodexGoal').mockImplementation(async input => {
    remaining = input.tokenBudget
    input.onUsageUpdate?.({ inputTokens: 80, outputTokens: 15 })
    aborted = input.signal.aborted
    throw new Error('Native turn cancelled')
  })
  const result = await runProjectGoal(root, { native: true })
  expect(native).toHaveBeenCalledTimes(1)
  expect(remaining).toBe(90)
  expect(aborted).toBe(true)
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/token|budget/i)
})
it('retains partial planner consumption as a lower bound and blocks the next budgeted call', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); planner(undefined, { inputTokens: 30, totalCostUsd: 0.02 })
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(result.usageLedger?.calls[0]).toMatchObject({ inputTokens: 30, totalCostUsd: 0.02, usageComplete: false })
  const usage = readEvents(root, 1000).find(event => event.type === 'tokens')
  expect(usage?.data).toMatchObject({ inputTokens: 30, measurementComplete: false })
})
it('does not spend on explicit preparation when protected acceptance has changed', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  configure('prepared'); const plan = planner({ inputTokens: 1, outputTokens: 1 })
  writeFileSync(join(root, 'test.mjs'), 'process.exit(0)')
  const result = await assessProjectGoal(root)
  expect(result.assessed).toBe(false)
  expect(result.reason).toMatch(/protected|acceptance/i)
  expect(plan).not.toHaveBeenCalled()
})
it('respects prepared routing by refusing all model calls when the goal has not been assessed', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  configure('prepared'); const plan = planner({ inputTokens: 1, outputTokens: 1 }); const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(plan).not.toHaveBeenCalled()
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/prepared|assessment/i)
})
it('honors an explicit goal routing rule without a planner call', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const workers = defaultRoutingWorkers(['codex'])
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, routing: { enabled: true, strategy: 'capability', maxCandidates: 3, workers, rules: [{ storyId: goal.id, worker: workers[0].id }] } })
  const plan = planner({ inputTokens: 1, outputTokens: 1 }); const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(plan).not.toHaveBeenCalled()
  expect(worker).toHaveBeenCalledTimes(1)
  expect(result.status).toBe('complete')
})
it('does not inherit model, effort, variant, provider or bare settings when changing the goal runner', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  saveConfig(root, { canonVersion: 'test', agents: ['opencode', 'claude'], loop: { enabled: true }, runner: { agent: 'opencode', provider: 'old-provider', model: 'old-model', reasoningEffort: 'high', variant: 'old-variant', bare: true } })
  const worker = vi.fn(async input => {
    expect(input.provider).toBe('claude')
    expect(input.selection).toEqual({ nativeMultiAgent: false })
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'done' }
  })
  expect((await runProjectGoal(root, { provider: 'claude', execute: worker })).status).toBe('complete')
  expect(worker).toHaveBeenCalledTimes(1)
})
it('does not contact the abandoned Codex binding when the goal switches to another runner', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal, nativeBinding: { provider: 'codex', threadId: 'old-thread', objectiveRevision: nativeGoals.objectiveRevision(goal.objective) } }))
  saveConfig(root, { canonVersion: 'test', agents: ['claude'], loop: { enabled: true }, goals: { nativeCodex: true } })
  const sync = vi.spyOn(nativeGoals, 'synchronizeNativeGoal').mockRejectedValue(new Error('Old Codex must not be required'))
  const result = await runProjectGoal(root, { provider: 'claude', execute: implement() })
  expect(result.status).toBe('complete')
  expect(sync).not.toHaveBeenCalled()
  expect(readProjectGoal(root)?.nativeBinding).toBeUndefined()
  expect(readProjectGoal(root)?.detachedNativeBindings?.[0].binding.threadId).toBe('old-thread')
})

it('prepares a goal once and reuses its exact executable contract without a second planner call', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure('prepared'); const plan = planner({ inputTokens: 10, outputTokens: 2 })
  const assessment = await assessProjectGoal(root)
  expect(assessment.assessed).toBe(true)
  expect(plan).toHaveBeenCalledTimes(1)
  expect(readProjectGoal(root)?.attempts).toHaveLength(0)
  const plannedUsage = readEvents(root, 1000).filter(event => event.type === 'tokens')
  expect(plannedUsage).toHaveLength(1)
  expect(plannedUsage[0].data).toMatchObject({ callId: readProjectGoal(root)!.usageLedger!.calls[0].id, inputTokens: 10, outputTokens: 2, measurementComplete: true })
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(plan).toHaveBeenCalledTimes(1)
  expect(worker).toHaveBeenCalledTimes(1)
  expect(result.status).toBe('complete')
  expect(result.attempts[0]).toMatchObject({ inputTokens: 11, outputTokens: 3 })
  const allUsage = readEvents(root, 1000).filter(event => event.type === 'tokens')
  expect(allUsage).toHaveLength(2)
  expect(new Set(allUsage.map(event => event.data?.callId)).size).toBe(2)
  expect(allUsage.reduce((sum, event) => sum + Number(event.data?.inputTokens) + Number(event.data?.outputTokens), 0)).toBe(14)
  expect(result.lastCheckEvidencePath).toMatch(/checks.+\.json$/)
  expect(JSON.parse(readFileSync(result.lastCheckEvidencePath!, 'utf8'))).toMatchObject({ id: result.lastCheck, status: 'passed', delivery: { version: 1 } })
})
it('invalidates a prepared goal assessment after its approved planning brief changes', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  configure('prepared'); const plan = planner({ inputTokens: 1, outputTokens: 1 })
  expect((await assessProjectGoal(root)).assessed).toBe(true)
  writeFileSync(join(root, '.yoke', 'plan.md'), 'Changed product constraint')
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/assessment|prepared/i)
  expect(plan).toHaveBeenCalledTimes(1)
  expect(worker).not.toHaveBeenCalled()
})
it('recovers a completed planner call after interruption without granting its tokens again', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  const startedAt = new Date().toISOString()
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal,
    pendingAttempt: { provider: 'codex', startedAt },
    usageLedger: { legacyAttemptCount: 0, calls: [{ id: 'c01d0000-0000-4000-8000-000000000001', attempt: 1, provider: 'codex', role: 'planning', startedAt, durationMs: 1, status: 'completed', usageComplete: true, inputTokens: 90, outputTokens: 10 }] },
  }))
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/token.*exhaust|budget/i)
  expect(result.attempts[0]).toMatchObject({ inputTokens: 90, outputTokens: 10 })
  budgetProjectGoal(root, { tokenBudget: 102 })
  expect((await runProjectGoal(root, { execute: worker })).status).toBe('complete')
  expect(worker).toHaveBeenCalledTimes(1)
})
it('preserves partial native usage across interruption and refuses another budgeted call', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  const startedAt = new Date().toISOString()
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal,
    pendingAttempt: { provider: 'codex', startedAt },
    usageLedger: { legacyAttemptCount: 0, calls: [{ id: 'c01d0000-0000-4000-8000-000000000002', attempt: 1, provider: 'codex', role: 'implementation', startedAt, status: 'pending', usageComplete: false, inputTokens: 20, outputTokens: 5 }] },
  }))
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/unknown/i)
  const saved = JSON.parse(readFileSync(join(root, '.yoke', 'goal.json'), 'utf8'))
  expect(saved.usageLedger.calls[0]).toMatchObject({ status: 'interrupted', inputTokens: 20, outputTokens: 5, usageComplete: false })
})
it('does not invent an unknown goal call when routing refuses admission before invocation', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure('prepared')
  const story = goalRoutingStory(goal, loadAcceptance(root)!, 'codex')
  saveAssessment(root, story, assessment as Parameters<typeof saveAssessment>[2], { provider: 'codex' })
  const contractKey = routingAssessmentKey(root, story)
  for (let i = 0; i < goal.maxAttempts; i++) reserveRoutingAttempt({ root, storyId: goal.id, contractKey, limit: goal.maxAttempts, profile: 'fixture', provider: 'codex' })
  const plan = planner(), worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(plan).not.toHaveBeenCalled()
  expect(worker).not.toHaveBeenCalled()
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/routing attempt budget/i)
  expect(result.usageLedger?.calls).toHaveLength(0)
  expect(result.attempts[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 })
  expect(readEvents(root, 1000).filter(event => event.type === 'tokens')).toHaveLength(0)
})
it('migrates earlier measured attempt totals once without discounting or duplicating new calls', async () => {
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 52 })
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal, attempts: [{ provider: 'codex', startedAt: new Date().toISOString(), durationMs: 1, success: false, summary: 'Earlier release', checkId: 'earlier', inputTokens: 40, outputTokens: 10 }] }))
  const worker = implement()
  const result = await runProjectGoal(root, { execute: worker })
  expect(worker).toHaveBeenCalledTimes(1)
  expect(result.status).toBe('complete')
  expect(result.usageLedger).toMatchObject({ legacyAttemptCount: 1 })
  expect(result.usageLedger?.calls).toHaveLength(1)
  expect(result.attempts[1]).toMatchObject({ inputTokens: 1, outputTokens: 1 })
})
it('charges cumulative native updates once alongside its planner and accepts the exact ceiling', async () => {
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 100 })
  configure(); planner({ inputTokens: 8, outputTokens: 2 })
  let remaining: number | undefined
  vi.spyOn(nativeGoals, 'executeCodexGoal').mockImplementation(async input => {
    remaining = input.tokenBudget
    input.onUsageUpdate?.({ inputTokens: 40, outputTokens: 5 })
    input.onUsageUpdate?.({ inputTokens: 80, outputTokens: 10 })
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'done', inputTokens: 80, outputTokens: 10,
      nativeBinding: { provider: 'codex', threadId: 'fixture', objectiveRevision: nativeGoals.objectiveRevision(input.objective) }, nativeStatus: 'paused', nativeObservedStatus: 'paused', nativeTokensUsed: 90 }
  })
  const result = await runProjectGoal(root, { native: true })
  expect(remaining).toBe(90)
  expect(result.status).toBe('complete')
  expect(result.attempts[0]).toMatchObject({ inputTokens: 88, outputTokens: 12 })
  const usage = readEvents(root, 1000).filter(event => event.type === 'tokens')
  expect(usage).toHaveLength(2)
  expect(usage.reduce((sum, event) => sum + Number(event.data?.inputTokens) + Number(event.data?.outputTokens), 0)).toBe(100)
})
