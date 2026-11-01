import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { runPrdDraft, runPrdCheck } from '../../src/prd/command.js'
import { runPrdDecompose } from '../../src/prd/decompose.js'
import { preparedProblems, runPrdAssess } from '../../src/prd/assess.js'
import { readRequirements } from '../../src/prd/requirements.js'
import { loadPrd, type Story } from '../../src/loop/prd.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { proposalFile, queueChange, reviewFile, runChangeApply } from '../../src/change/inbox.js'
import { draftFile, writeDraftCoverage } from './draft-fixture.js'
import { executionBudgetStatus } from '../../src/execution/budget.js'

let root: string
const assessment = { taskClass: 'implementation' as const, difficulty: 'medium' as const, uncertainty: 'low' as const, risk: 'low' as const, scope: 'low' as const, testability: 'high' as const, reason: 'Bounded behavior with explicit tests', approach: 'Implement and verify the listed criteria' }
const criterion = (id: string) => ({ id, text: `${id} works`, verify: [`npm run test:${id}`] })
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'planning-flow-'))
  vi.stubEnv('LOCALAPPDATA', `${root}-host-state`)
  mkdirSync(join(root, '.yoke'))
  saveConfig(root, { canonVersion: '1.25.1', agents: ['codex'], loop: { enabled: false }, executionBudget: { id: 'complete workflow', maxCalls: 5 }, routing: { enabled: true, assessmentPolicy: 'prepared', workers: [] } })
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); rmSync(`${root}-host-state`, { recursive: true, force: true }) })

it('keeps a default-format draft → split → assess → incremental change fully loadable and prepared', () => {
  const parent: Story = { id: 'PARENT', title: 'Build API and web behavior', priority: 1, passes: false, writes: ['src/api', 'src/web'], assessment, acceptance: ['api-success', 'api-failure', 'web-success', 'web-failure'].map(criterion) }
  expect(runPrdDraft(root, { idea: 'Preserve both successful and failed API/web behavior', runner: 'codex', isAvailable: () => true, run: inv => {
    writeFileSync(draftFile(inv), stringify([parent]))
    writeDraftCoverage(root, inv, [parent])
    return { success: true, summary: 'drafted' }
  } })).toBe(0)
  expect(runPrdCheck(root)).toBe(0)

  expect(runPrdDecompose(root, { story: 'PARENT', apply: true, runner: 'codex', isAvailable: () => true, run: inv => {
    const file = inv.input.match(/to (\.yoke\/\.decompose-[a-f0-9-]+\.json)\. Do not edit/u)![1]
    writeFileSync(join(root, file), JSON.stringify([
      { id: 'API', title: 'Preserve API behavior', acceptanceIds: ['api-success', 'api-failure'], writes: ['src/api'] },
      { id: 'WEB', title: 'Preserve web behavior', acceptanceIds: ['web-success', 'web-failure'], writes: ['src/web'] },
    ]))
    return { success: true, summary: 'split' }
  } })).toBe(0)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))).toHaveLength(2)
  expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: () => ({ success: true, summary: 'assessed', output: 'YOKE_BATCH ' + JSON.stringify({ assessments: ['API', 'WEB'].map(id => ({ id, assessment })) }) }) })).toBe(0)
  const before = loadPrd(join(root, '.yoke/prd.yaml'))

  const request = queueChange(root, 'Add accounts with a rejected duplicate path', { id: 'accounts' })
  const added: Story = { id: 'ACCOUNTS', title: 'Add accounts', priority: 2, passes: false, writes: ['src/accounts'], assessment, acceptance: ['account-created', 'account-rejected'].map(criterion) }
  expect(runChangeApply(root, { runner: 'codex', isAvailable: () => true, commit: () => {}, run: () => {
    writeFileSync(proposalFile(root, request.id), stringify({ stories: [added], requirements: [{ id: 'accounts-behavior', text: request.request, criteria: added.acceptance.map(value => ({ story: added.id, criterion: typeof value === 'string' ? value : value.id })) }], invariants: [] }))
    return { success: true, summary: 'planned' }
  }, review: () => {
    writeFileSync(reviewFile(root, request.id), JSON.stringify({ version: 1, changeId: request.id, approved: true, summary: 'Every requested state is covered', uncovered: [] }))
    return { success: true, summary: 'reviewed' }
  } })).toMatchObject({ ok: true, added: 1 })
  const final = loadPrd(join(root, '.yoke/prd.yaml'))
  expect(final).toHaveLength(3)
  expect(final.slice(0, 2).map(story => story.assessmentFor)).toEqual(before.map(story => story.assessmentFor))
  expect(preparedProblems(final, '', readRequirements(root)!)).toEqual([])
  expect(runPrdCheck(root)).toBe(0)
  const budget = executionBudgetStatus(root)
  expect(budget).toMatchObject({ configured: true, admittedCalls: 5 })
  expect(budget.configured && budget.calls.map(call => call.role)).toEqual(['prd-draft', 'prd-decompose', 'assessment', 'change-planner', 'coverage-review'])
  queueChange(root, 'Add another feature after budget exhaustion', { id: 'over-budget' })
  const overBudget = vi.fn()
  expect(runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: overBudget })).toMatchObject({ ok: false, summary: expect.stringContaining('call limit 5 exhausted') })
  expect(overBudget).not.toHaveBeenCalled()
  expect(loadPrd(join(root, '.yoke/prd.yaml'))).toHaveLength(3)
})
