import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectGoal, runProjectGoal, readProjectGoal, goalHandoff, pauseProjectGoal, goalRoutingStory } from '../../src/goals/command.js'
import { loadAcceptance } from '../../src/check/command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { saveAssessment } from '../../src/routing/capability.js'
import { defaultRoutingWorkers } from '../../src/setup/command.js'
import { acquireSharedWorker, globalWorkerLimit } from '../../src/loop/resource-pool.js'
import * as providers from '../../src/agents/providers.js'
import * as nativeGoals from '../../src/goals/codex-native.js'
let root: string
let state: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-goal-')); state = mkdtempSync(join(tmpdir(), 'yoke-state-')); vi.stubEnv('YOKE_STATE_DIR', state); vi.stubEnv('LOCALAPPDATA', join(state, 'local')); vi.stubEnv('YOKE_REGISTRY_DIR', join(state, 'registry')); mkdirSync(join(root, '.yoke')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks() })
function manifest() { writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\nprotected: [test.mjs]\ncriteria:\n- id: outcome\n  text: Expected outcome\n  commands: [node test.mjs]\n') }
it('uses a cached goal assessment to choose a smaller model and retains independent acceptance', async () => {
  vi.stubEnv('YOKE_REGISTRY_DIR', join(state, 'routing'))
  manifest()
  writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, routing: { enabled: true, strategy: 'capability', maxCandidates: 3, workers: defaultRoutingWorkers(['codex']) } })
  saveAssessment(root, goalRoutingStory(goal, loadAcceptance(root)!, 'codex'), { taskClass: 'implementation', difficulty: 'medium', uncertainty: 'low', risk: 'low', scope: 'low', testability: 'high', reason: 'Known implementation', approach: 'Implement and run node test.mjs' }, { provider: 'codex', model: 'gpt-6-astra' })
  const result = await runProjectGoal(root, { provider: 'codex', selection: { model: 'gpt-6-astra' }, execute: async input => {
    expect(input.selection.model).toBe('gpt-5.6-terra')
    expect(input.prompt).toContain('Implement and run node test.mjs')
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'implemented', inputTokens: 10, outputTokens: 2, model: 'gpt-5.6-terra' }
  } })
  expect(result.status).toBe('complete')
  expect(result.attempts[0]).toMatchObject({ model: 'gpt-5.6-terra', inputTokens: 10, outputTokens: 2 })
})
it('does not replace an unfinished objective', () => {
  createProjectGoal(root, 'First objective')
  expect(() => createProjectGoal(root, 'Different objective')).toThrow(/unfinished|active/i)
})
it('rejects a linked Yoke state parent without writing a pause marker elsewhere', () => {
  createProjectGoal(root, 'First')
  rmSync(join(root, '.yoke'), { recursive: true })
  symlinkSync(state, join(root, '.yoke'), 'junction')
  expect(() => pauseProjectGoal(root)).toThrow(/linked/i)
  expect(existsSync(join(state, 'goal.pause'))).toBe(false)
})
it('clears an old pause when a new goal is explicitly created', () => {
  const goal = createProjectGoal(root, 'First')
  pauseProjectGoal(root)
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal, status: 'complete' }))
  createProjectGoal(root, 'Second')
  expect(existsSync(join(root, '.yoke', 'goal.pause'))).toBe(false)
})
it('never runs an agent for an objective without executable acceptance', async () => {
  createProjectGoal(root, 'Ship checkout')
  let ran = false
  const result = await runProjectGoal(root, { execute: async () => { ran = true; return { success: true, summary: 'done' } } })
  expect(ran).toBe(false); expect(result.status).toBe('blocked')
})
it('does not complete an unbound new objective using unrelated green checks', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(0)')
  createProjectGoal(root, 'Implement a completely new feature')
  const result = await runProjectGoal(root)
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/bind|criteria/i)
})
it('records a token overrun even when independent acceptance passes', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  createProjectGoal(root, 'Expected outcome', { tokenBudget: 1, acceptanceIds: ['outcome'] } as Parameters<typeof createProjectGoal>[2])
  const result = await runProjectGoal(root, { execute: async () => {
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'done', inputTokens: 10, outputTokens: 2 }
  } })
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/token/i)
  expect(result.attempts).toHaveLength(1)
})
it('accepts completion exactly at the measured token ceiling', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  createProjectGoal(root, 'Expected outcome', { tokenBudget: 12, acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async () => { writeFileSync(join(root, 'implemented.txt'), 'done'); return { success: true, summary: 'done', inputTokens: 10, outputTokens: 2 } } })
  expect(result.status).toBe('complete')
})
it('blocks native plus bare startup before any provider call', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  let called = false
  const result = await runProjectGoal(root, { native: true, selection: { bare: true }, execute: async () => { called = true; return { success: true, summary: 'done' } } })
  expect(result.status).toBe('blocked'); expect(result.reason).toMatch(/bare/i); expect(called).toBe(false)
})
it('uses project execution defaults and disables unmanaged delegation', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  saveConfig(root, { canonVersion: 'test', agents: ['gemini'], loop: { enabled: true }, runner: { agent: 'gemini', model: 'small-model', reasoningEffort: 'low', bare: true } })
  const result = await runProjectGoal(root, { selection: { model: undefined }, execute: async input => {
    expect(input.provider).toBe('gemini')
    expect(input.selection).toMatchObject({ model: 'small-model', reasoningEffort: 'low', bare: true, nativeMultiAgent: false })
    writeFileSync(join(root, 'implemented.txt'), 'done')
    return { success: true, summary: 'done' }
  } })
  expect(result.status).toBe('complete')
})
it('waits for shared worker admission before invoking an executor', async () => {
  vi.stubEnv('LOCALAPPDATA', join(state, 'pool'))
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], maxAttempts: 1 })
  const lease = await acquireSharedWorker({ targetDir: root, storyId: 'occupant', provider: 'codex', role: 'implementation', units: globalWorkerLimit() })
  let called = false
  const promise = runProjectGoal(root, { execute: async () => { called = true; return { success: false, summary: 'not done' } } })
  await new Promise(resolve => setTimeout(resolve, 800))
  expect(called).toBe(false)
  await lease.release()
  await promise
  expect(called).toBe(true)
})
it('includes protected checks in the optional wall-time budget', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'setTimeout(() => process.exit(1), 5000)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], maxWallMinutes: 0.005 })
  let called = false
  const started = Date.now()
  const result = await runProjectGoal(root, { execute: async () => { called = true; return { success: true, summary: 'done' } } })
  expect(called).toBe(false)
  expect(result.status).toBe('blocked')
  expect(Date.now() - started).toBeLessThan(4500)
  expect(readProjectGoal(root)?.wallDurationMs).toBeGreaterThan(0)
})
it('retains blocked state and stops checks after unconfirmed provider cleanup', async () => {
  vi.stubEnv('LOCALAPPDATA', join(state, 'cleanup-pool'))
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async () => { throw Object.assign(new Error('cleanup failed'), { cleanupUnconfirmed: true }) } })
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/cleanup/i)
  expect(readProjectGoal(root)?.status).toBe('blocked')
  expect(result.attempts).toHaveLength(1)
})
it('does not contact native Codex when an existing binding is explicitly disabled', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(0)')
  const goal = createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  writeFileSync(join(root, '.yoke', 'goal.json'), JSON.stringify({ ...goal, nativeBinding: { provider: 'codex', threadId: 'legacy-thread', objectiveRevision: '0'.repeat(64) } }))
  const sync = vi.spyOn(nativeGoals, 'synchronizeNativeGoal').mockRejectedValue(new Error('should not contact native runtime'))
  const result = await runProjectGoal(root, { native: false, selection: { bare: true } })
  expect(result.status).toBe('complete'); expect(sync).not.toHaveBeenCalled()
})
it('cancels a native turn when streamed cumulative usage exceeds the budget', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], tokenBudget: 1 })
  vi.spyOn(nativeGoals, 'executeCodexGoal').mockImplementation(async input => {
    input.onUsageUpdate?.({ inputTokens: 10, outputTokens: 2 })
    expect(input.signal.aborted).toBe(true)
    throw new Error('Native turn cancelled')
  })
  const result = await runProjectGoal(root, { native: true })
  expect(result.status).toBe('blocked'); expect(result.reason).toMatch(/token/i)
  expect(result.attempts).toHaveLength(1)
})
it('retains admission for an ordinary provider with unresolved process ownership', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'], maxAttempts: 1 })
  vi.spyOn(providers, 'startProviderProcess').mockImplementation(() => {
    const recordPath = join(root, '.yoke', 'provider-processes', 'unresolved.json')
    mkdirSync(join(root, '.yoke', 'provider-processes'), { recursive: true }); writeFileSync(recordPath, '{}')
    return { recordPath, completion: Promise.resolve({ kind: 'cancelled', stderr: 'cleanup unresolved', telemetry: {} }) } as unknown as ReturnType<typeof providers.startProviderProcess>
  })
  const result = await runProjectGoal(root)
  expect(result.status).toBe('blocked'); expect(result.reason).toMatch(/cleanup/i)
})
it('rejects a changed resume identity without altering the current goal', async () => {
  const goal = createProjectGoal(root, 'Current objective')
  await expect(runProjectGoal(root, { expectedGoalId: 'different' })).rejects.toThrow(/identity/i)
  expect(readProjectGoal(root)?.status).toBe(goal.status)
})
it('honors a pause during admitted execution and resumes without a stale marker', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async input => {
    pauseProjectGoal(root)
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
    return { success: false, summary: 'paused' }
  } })
  expect(result.status).toBe('paused')
  expect(existsSync(join(root, '.yoke', 'goal.pause'))).toBe(false)
  expect(readProjectGoal(root)?.status).toBe('paused')
})
it('only completes after independent acceptance passes', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async () => { writeFileSync(join(root, 'implemented.txt'), 'done'); return { success: true, summary: 'implemented' } } })
  expect(result.status).toBe('complete'); expect(result.attempts).toHaveLength(1)
  expect(readProjectGoal(root)?.status).toBe('complete')
})
it('stops bounded retries and passes failure context to a different provider', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { maxAttempts: 2, acceptanceIds: ['outcome'] })
  const prompts: string[] = []
  const result = await runProjectGoal(root, { provider: 'gemini', execute: async input => { prompts.push(input.prompt); return { success: false, summary: 'still blocked' } } })
  expect(result.status).toBe('blocked'); expect(result.attempts).toHaveLength(2)
  expect(prompts[1]).toContain('still blocked')
  expect(goalHandoff(root)).toContain('Expected outcome')
})
it('blocks attempts to weaken the acceptance manifest during implementation', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)')
  createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async () => {
    writeFileSync(join(root, '.yoke', 'acceptance.yaml'), 'version: 1\ncriteria:\n- id: fake\n  text: Nothing\n  commands: [node -e "process.exit(0)"]\n')
    return { success: true, summary: 'done' }
  } })
  expect(result.status).toBe('blocked')
  expect(result.reason).toMatch(/acceptance/i)
})
it('does not accept a worker rewriting its protected test', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)'); createProjectGoal(root, 'Expected outcome', { acceptanceIds: ['outcome'] })
  const result = await runProjectGoal(root, { execute: async () => { writeFileSync(join(root, 'test.mjs'), 'process.exit(0)'); return { success: true, summary: 'fake' } } })
  expect(result.status).toBe('blocked')
})
it('revalidates a previously completed goal', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'import {existsSync} from "node:fs"; process.exit(existsSync("implemented.txt") ? 0 : 1)')
  writeFileSync(join(root, 'implemented.txt'), 'done'); createProjectGoal(root, 'Expected outcome', { maxAttempts: 1, acceptanceIds: ['outcome'] })
  expect((await runProjectGoal(root)).status).toBe('complete')
  rmSync(join(root, 'implemented.txt'))
  expect((await runProjectGoal(root, { execute: async () => ({ success: false, summary: 'regressed' }) })).status).toBe('blocked')
})
it('charges interrupted attempts before allowing budgeted continuation', async () => {
  manifest(); writeFileSync(join(root, 'test.mjs'), 'process.exit(1)'); createProjectGoal(root, 'Expected outcome', { tokenBudget: 100, acceptanceIds: ['outcome'] })
  const path = join(root, '.yoke', 'goal.json')
  const goal = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...goal, status: 'running', pendingAttempt: { provider: 'claude', startedAt: new Date().toISOString() } }))
  let ran = false
  const result = await runProjectGoal(root, { execute: async () => { ran = true; return { success: true, summary: 'should not run' } } })
  expect(ran).toBe(false); expect(result.attempts).toHaveLength(1); expect(result.reason).toMatch(/unknown/i)
})
