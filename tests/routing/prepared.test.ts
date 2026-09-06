import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeAdaptiveRunner, makeAsyncAdaptiveRunner } from '../../src/routing/router.js'
import { bindAssessments, preparedProblems } from '../../src/prd/assess.js'
import { savePrd, type Story } from '../../src/loop/prd.js'
import { readAssessment, saveAssessment } from '../../src/routing/capability.js'
import { resolvePlanner } from '../../src/routing/planning.js'
import { defaultRoutingWorkers } from '../../src/setup/command.js'
import { YokeConfigSchema } from '../../src/retrofit/config.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { runPrdDraft, runPrdCheck } from '../../src/prd/command.js'
import { loadPrd } from '../../src/loop/prd.js'
import { acquireLock, releaseLock } from '../../src/loop/lock.js'

let root: string
const assessment = { taskClass: 'implementation' as const, difficulty: 'medium' as const, uncertainty: 'low' as const, risk: 'low' as const, scope: 'low' as const, testability: 'high' as const, reason: 'Executable handler checks', approach: 'Implement handler and verify outputs' }
const task = (id: string, needs: string[] = []): Story => ({ id, title: id, needs, priority: 1, passes: false, writes: ['src/' + id], acceptance: ['works', 'fails'].map(suffix => ({ id: id + '-' + suffix, text: suffix, verify: ['npx vitest run -t ' + id + '-' + suffix] })), assessment })
const options = () => ({ parent: 'codex' as const, parentSelection: { model: 'start' }, strategy: 'capability' as const, workers: defaultRoutingWorkers(['codex']), maxCandidates: 3, projectRoot: root })
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-prepared-')); mkdirSync(join(root, '.yoke')); vi.stubEnv('YOKE_REGISTRY_DIR', join(root, 'registry')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })

it('drafts a fully assessed package with the planning model and rejects an incomplete replacement', () => {
  saveConfig(root, { canonVersion: '1.9.0', agents: ['codex'], loop: { enabled: true }, runner: { agent: 'codex', model: 'terra' }, planning: { model: 'astra' },
    routing: { enabled: true, strategy: 'capability', assessmentPolicy: 'prepared', fallback: 'block', workers: defaultRoutingWorkers(['codex']), maxCandidates: 3 } })
  const run = vi.fn(inv => { expect(inv.args).toContain('astra'); savePrd(join(root, '.yoke/prd.yaml'), [task('A'), task('B', ['A'])]); return { success: true, summary: 'planned' } })
  expect(runPrdDraft(root, { idea: 'package', isAvailable: () => true, run })).toBe(0)
  expect(run).toHaveBeenCalledTimes(1)
  expect(runPrdCheck(root)).toBe(0)
  expect(preparedProblems(loadPrd(join(root, '.yoke/prd.yaml')))).toEqual([])
  expect(runPrdDraft(root, { idea: 'replacement', force: true, isAvailable: () => true, run: () => {
    savePrd(join(root, '.yoke/prd.yaml'), [{ ...task('C'), assessment: undefined }]); return { success: true, summary: 'incomplete' }
  } })).toBe(1)
  expect(loadPrd(join(root, '.yoke/prd.yaml')).map(s => s.id)).toEqual(['A', 'B'])
})

it('does not start drafting while a loop owns the project', () => {
  const lock = acquireLock(root), run = vi.fn()
  try { expect(runPrdDraft(root, { idea: 'package', isAvailable: () => true, run })).toBe(1); expect(run).not.toHaveBeenCalled() }
  finally { releaseLock(root, lock.ownerToken) }
})

it('does not send a configured planning model to an explicitly different provider', () => {
  expect(resolvePlanner({ planning: { agent: 'claude', model: 'opus' } }, 'codex', { model: 'terra' }, 'gemini')).toMatchObject({ agent: 'gemini', selection: { model: undefined } })
})

it('runs a prepared package without any assessment calls in serial and async routing', async () => {
  const stories = bindAssessments([task('A'), task('B', ['A'])])
  savePrd(join(root, '.yoke/prd.yaml'), stories)
  const captureRoute = vi.fn(), makeWorker = vi.fn(() => () => ({ success: true, summary: 'done' }))
  const opts = { ...options(), assessmentPolicy: 'prepared' as const, captureRoute, makeWorker }
  expect(makeAdaptiveRunner(opts)({ targetDir: root, story: stories[0] }).success).toBe(true)
  expect((await makeAsyncAdaptiveRunner(opts)({ targetDir: root, story: stories[1] })).success).toBe(true)
  expect(captureRoute).not.toHaveBeenCalled()
  expect(makeWorker.mock.calls.map(call => call[1].model)).toEqual(['gpt-5.6-terra', 'gpt-5.6-terra'])
})

it('invalidates changed contracts and downstream tasks but keeps unrelated tasks and progress updates current', () => {
  const stories = bindAssessments([task('A'), task('B', ['A']), task('C')])
  stories[0].passes = true
  expect(preparedProblems(stories)).toEqual([])
  stories[0].title = 'changed API contract'
  savePrd(join(root, '.yoke/prd.yaml'), stories)
  expect(readAssessment(root, stories[1], true)).toBeUndefined()
  expect(readAssessment(root, stories[2], true)).toEqual(assessment)
  expect(preparedProblems(stories).join(' ')).toContain('B: missing or stale')
  expect(preparedProblems(stories).join(' ')).not.toContain('C:')
  writeFileSync(join(root, '.yoke/plan.md'), 'New architectural constraint')
  expect(readAssessment(root, stories[2], true)).toBeUndefined()
})

it('invalidates cached assessments on brief changes and can save the replacement', () => {
  const story = { ...task('A'), assessment: undefined }
  saveAssessment(root, story, assessment, { provider: 'codex' })
  expect(readAssessment(root, story)).toEqual(assessment)
  writeFileSync(join(root, '.yoke/plan.md'), 'New constraint')
  expect(readAssessment(root, story)).toBeUndefined()
  saveAssessment(root, story, { ...assessment, risk: 'high' }, { provider: 'codex' })
  expect(readAssessment(root, story)?.risk).toBe('high')
  writeFileSync(join(root, '.yoke/plan.md'), 'Another constraint')
  const makeWorker = vi.fn()
  const result = makeAdaptiveRunner({ ...options(), makeWorker, captureRoute: () => {
    writeFileSync(join(root, '.yoke/plan.md'), 'Edited while assessing')
    return { success: true, summary: '', output: 'YOKE_ASSESS ' + JSON.stringify(assessment) }
  } })({ targetDir: root, story })
  expect(result.routing?.blocked).toBe(true)
  expect(makeWorker).not.toHaveBeenCalled()
  expect(readAssessment(root, story)).toBeUndefined()
})

it('blocks missing preparation even with an explicit routing rule, without spending a call', () => {
  const captureRoute = vi.fn(), makeWorker = vi.fn()
  const result = makeAdaptiveRunner({ ...options(), assessmentPolicy: 'prepared', captureRoute, makeWorker, rules: [{ storyId: 'A', worker: 'codex-standard' }] })({ targetDir: root, story: task('A') })
  expect(result.routing?.blocked).toBe(true)
  expect(captureRoute).not.toHaveBeenCalled(); expect(makeWorker).not.toHaveBeenCalled()
})

it('uses the configured planning provider and model independently of worker execution', () => {
  const captureRoute = vi.fn(() => ({ success: true, summary: '', output: 'YOKE_ASSESS ' + JSON.stringify(assessment) }))
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'done' }))
  const planner = resolvePlanner({ planning: { agent: 'claude', model: 'opus' } }, 'codex', { model: 'terra' })
  const result = makeAdaptiveRunner({ ...options(), planner, captureRoute, makeWorker })({ targetDir: root, story: { ...task('A'), assessment: undefined } })
  expect(result.success).toBe(true)
  expect(captureRoute.mock.calls[0][0]).toBe('claude')
  expect(captureRoute.mock.calls[0][3]).toMatchObject({ model: 'opus' })
  expect(makeWorker.mock.calls[0][0]).toBe('codex')
  expect(makeWorker.mock.calls[0][1].model).toBe('gpt-5.6-terra')
})

it('blocks unavailable profiles and tier ceilings instead of falling back to the parent', () => {
  const makeWorker = vi.fn()
  for (const extra of [{ workers: [], fallback: 'block' as const }, { maxTier: 'light' as const }, { maxTier: 'standard' as const, rules: [{ storyId: 'A', worker: 'codex-frontier' }] }]) {
    expect(makeAdaptiveRunner({ ...options(), ...extra, makeWorker })({ targetDir: root, story: task('A') }).routing?.blocked).toBe(true)
  }
  expect(makeWorker).not.toHaveBeenCalled()
})

it('allows one repair at the permitted tier then stops escalation at the ceiling', () => {
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'patch' }))
  const runner = makeAdaptiveRunner({ ...options(), maxTier: 'standard', fallback: 'block', makeWorker })
  for (let i = 0; i < 2; i++) runner({ targetDir: root, story: task('A') }).routing!.recordOutcome(false)
  expect(runner({ targetDir: root, story: task('A') }).routing?.blocked).toBe(true)
  expect(makeWorker).toHaveBeenCalledTimes(2)
})

it('keeps legacy unbound assessments and explicit parent fallback available', () => {
  const makeWorker = vi.fn(() => () => ({ success: true, summary: 'done' }))
  expect(makeAdaptiveRunner({ ...options(), workers: [], fallback: 'parent', makeWorker })({ targetDir: root, story: task('A') }).success).toBe(true)
  expect(makeWorker.mock.calls[0][1].model).toBe('start')
  expect(() => YokeConfigSchema.parse({ canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, planning: { maxTasks: 0 } })).toThrow()
})
