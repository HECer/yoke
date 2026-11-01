import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'
import { loadPrd, type Story } from '../../src/loop/prd.js'
import { requirementObjective, readRequirements } from '../../src/prd/requirements.js'
import { hasPlanningReceipt, planningChange, planningStateDigest, planningTransactionPath, publishPlanningState, readPlanningState, type PlanningState } from '../../src/prd/transaction.js'

let root: string
let before: PlanningState
let after: PlanningState
const request = { id: 'change-1', request: 'Keep edits after reconnecting', createdAt: '2026-11-01T00:00:00.000Z' }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'planning-transaction-'))
  vi.stubEnv('LOCALAPPDATA', `${root}-host-state`)
  mkdirSync(join(root, '.yoke'))
  const objective = requirementObjective('Keep edits')
  const story: Story = { id: 'S1', title: 'Keep edits', priority: 1, passes: false, requirementsFor: objective.sha256, writes: ['src'], acceptance: [{ id: 'offline', text: 'Offline edits persist', verify: ['npm run test:offline'] }, { id: 'online', text: 'Online edits persist', verify: ['npm run test:online'] }] }
  const ledger = { version: 1, objective, requirements: [{ id: 'R1', text: 'Keep edits', criteria: [{ story: 'S1', criterion: 'offline' }] }], invariants: [] }
  before = { prd: stringify([story]), requirements: stringify(ledger), brief: null }
  after = { ...before, prd: stringify([{ ...story, title: 'Keep edits after reconnecting' }]), requirements: stringify({ ...ledger, requirements: [{ ...ledger.requirements[0], text: 'Keep edits after reconnecting' }] }) }
  writeFileSync(join(root, '.yoke/prd.yaml'), before.prd!)
  writeFileSync(join(root, '.yoke/requirements.yaml'), before.requirements!)
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); rmSync(`${root}-host-state`, { recursive: true, force: true }) })

function crashDuringPublication(): void {
  const payload = join(root, 'transaction-input.json')
  writeFileSync(payload, JSON.stringify({ root, before, after, change: planningChange(request) }))
  const module = pathToFileURL(join(process.cwd(), 'src/prd/transaction.ts')).href
  const script = `import { readFileSync } from 'node:fs'; import { publishPlanningState } from ${JSON.stringify(module)}; const data=JSON.parse(readFileSync(process.argv[1], 'utf8')); publishPlanningState(data.root, data.before, data.after, {change:data.change, afterWrite:()=>process.exit(73)});`
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, payload], { cwd: process.cwd(), encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(73)
}

it('restores both exact original files after an ordinary mid-publication failure', () => {
  expect(() => publishPlanningState(root, before, after, { afterWrite: () => { throw Error('injected write failure') } })).toThrow('injected write failure')
  expect(readPlanningState(root)).toEqual(before)
  expect(existsSync(planningTransactionPath(root))).toBe(false)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))[0].title).toBe('Keep edits')
})

it('recovers a real publisher exit before parsing the PRD and preserves the approved receipt', () => {
  crashDuringPublication()
  expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(after.prd)
  expect(readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')).toBe(before.requirements)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))[0].title).toBe('Keep edits after reconnecting')
  expect(readPlanningState(root)).toEqual(after)
  expect(readRequirements(root)!.requirements[0].text).toBe('Keep edits after reconnecting')
  expect(hasPlanningReceipt(root, planningChange(request), after)).toBe(true)
  expect(hasPlanningReceipt(root, planningChange({ ...request, request: 'Different authorization' }), after)).toBe(false)
  expect(existsSync(planningTransactionPath(root))).toBe(false)
})

it('retains recovery state and external edits when a source no longer matches either transaction version', () => {
  crashDuringPublication()
  const edited = before.requirements! + '# concurrent edit after crash\n'
  writeFileSync(join(root, '.yoke/requirements.yaml'), edited)
  expect(() => loadPrd(join(root, '.yoke/prd.yaml'))).toThrow(/changed outside the transaction/)
  expect(readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')).toBe(edited)
  expect(existsSync(planningTransactionPath(root))).toBe(true)
})

it('ignores a forged workspace recovery journal instead of promoting it to host authority', () => {
  mkdirSync(join(root, '.yoke/changes'))
  writeFileSync(join(root, '.yoke/changes/planning-transaction.json'), JSON.stringify({ version: 1, pid: process.pid, before, after, beforeHash: planningStateDigest(before), afterHash: planningStateDigest(after) }))
  expect(readPlanningState(root)).toEqual(before)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))[0].title).toBe('Keep edits')
})

it('retains a later-file edit made between publications and leaves the conflicting journal for inspection', () => {
  const changed = { ...after, brief: 'Approved brief' }
  // Bind the edited brief in the future ledger before testing publication.
  const parsed = JSON.parse(JSON.stringify(changed)) as PlanningState
  parsed.requirements = null
  parsed.prd = stringify([{ id: 'S1', title: 'Approved', priority: 1, passes: false, acceptance: ['works'] }])
  expect(() => publishPlanningState(root, before, parsed, { afterWrite: key => {
    if (key === 'prd') writeFileSync(join(root, '.yoke/plan.md'), 'Concurrent user text')
  } })).toThrow(/changed outside the transaction/)
  expect(readFileSync(join(root, '.yoke/plan.md'), 'utf8')).toBe('Concurrent user text')
  expect(existsSync(planningTransactionPath(root))).toBe(true)
  expect(() => readPlanningState(root)).toThrow(/changed outside the transaction/)
})

it.each(['prd', 'requirements', 'brief'] as const)('rejects a stale %s input before publishing any file', key => {
  const path = join(root, '.yoke', key === 'brief' ? 'plan.md' : `${key}.yaml`)
  writeFileSync(path, (before[key] ?? '') + '# concurrent edit\n')
  const current = readPlanningState(root)
  expect(() => publishPlanningState(root, before, after)).toThrow(/changed/)
  expect(readPlanningState(root)).toEqual(current)
})

it('validates all proposed ledger references before publishing a valid-looking PRD', () => {
  const invalid = { ...after, prd: stringify([]) }
  expect(() => publishPlanningState(root, before, invalid)).toThrow(/coverage/)
  expect(readPlanningState(root)).toEqual(before)
})
