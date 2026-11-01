import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { readRequirements, requirementObjective, requirementsPacket } from '../../src/prd/requirements.js'
import { pendingChanges, proposalFile, queueChange, reviewFile, runChangeApply } from '../../src/change/inbox.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { executionBudgetStatus } from '../../src/execution/budget.js'

let root: string
const story: Story = { id: 'S1', title: 'Keep edits', priority: 1, passes: true, writes: ['src'], acceptance: [{ id: 'offline', text: 'Keep offline edits', verify: ['npm run test:offline'] }, { id: 'online', text: 'Keep online edits', verify: ['npm run test:online'] }] }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'inbox-contract-')); vi.stubEnv('LOCALAPPDATA', `${root}-host-state`); mkdirSync(join(root, '.yoke')); savePrd(join(root, '.yoke', 'prd.yaml'), [story]); queueChange(root, 'Add accounts', { id: 'change' }) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); rmSync(`${root}-host-state`, { recursive: true, force: true }) })
function withLedger(): void {
  const objective = requirementObjective('Keep edits')
  savePrd(join(root, '.yoke', 'prd.yaml'), [{ ...story, requirementsFor: objective.sha256 }])
  writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify({ version: 1, objective, requirements: [{ id: 'R1', text: 'Keep edits', criteria: [{ story: 'S1', criterion: 'offline' }] }], invariants: [{ id: 'I1', text: 'Online edits remain intact', criteria: [{ story: 'S1', criterion: 'online' }] }] }))
}
function proposal(): { stories: Story[]; requirements: { id: string; text: string; criteria: { story: string; criterion: string }[] }[]; invariants: [] } {
  return { stories: [{ ...story, id: 'S2', title: 'Add accounts', passes: false, writes: ['accounts'] }], requirements: [{ id: 'R2', text: 'Accounts preserve edits', criteria: [{ story: 'S2', criterion: 'offline' }, { story: 'S2', criterion: 'online' }] }], invariants: [] }
}
const approved = () => { writeFileSync(reviewFile(root, 'change'), JSON.stringify({ version: 1, changeId: 'change', approved: true, summary: 'covered', uncovered: [] })); return { success: true, summary: 'reviewed' } }

it('retains the host budget after a change planner deletes project configuration', () => {
  withLedger()
  vi.stubEnv('LOCALAPPDATA', `${root}-host-state`)
  const config = { canonVersion: 'test', agents: ['codex' as const], loop: { enabled: true }, executionBudget: { id: 'approved allowance', maxCalls: 1 } }
  saveConfig(root, config)
  const before = readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')
  const review = vi.fn(approved)
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: () => {
    writeFileSync(proposalFile(root, 'change'), stringify(proposal()))
    rmSync(join(root, '.yoke/config.yaml'))
    return { success: true, summary: 'planned', tokens: { inputTokens: 8, outputTokens: 2 } }
  }, review, commit: () => { throw Error('must not publish an unreviewed proposal') } })
  expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('call limit 1 exhausted') })
  expect(review).not.toHaveBeenCalled()
  expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(before)
  expect(pendingChanges(root)).toHaveLength(1)
  saveConfig(root, config)
  expect(executionBudgetStatus(root)).toMatchObject({ configured: true, admittedCalls: 1, knownTokens: 10 })
})

it('adds ledger-covered work, preserves original intent and commits every planning file', () => {
  withLedger()
  const original = readRequirements(root)!
  const request = pendingChanges(root)[0]
  let calls = 0
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: inv => {
    calls++; expect(inv.input).toContain('Online edits remain intact')
    writeFileSync(proposalFile(root, 'change'), stringify(proposal())); return { success: true, summary: 'planned' }
  }, review: inv => {
    calls++; expect(inv.input).toContain('Add accounts'); expect(inv.input).toContain('Online edits remain intact')
    return approved()
  }, commit: (_path, change, paths) => { expect(change).toEqual(request); expect(paths).toEqual(['.yoke/prd.yaml', '.yoke/requirements.yaml']) } })
  expect(result).toMatchObject({ ok: true, added: 1 }); expect(calls).toBe(2)
  const next = readRequirements(root)!
  expect(next.objective.idea).toBe(original.objective.idea)
  expect(next.objective.sha256).not.toBe(original.objective.sha256)
  expect(next.requirements[0]).toEqual(original.requirements[0]); expect(next.invariants).toEqual(original.invariants)
  expect(next.changes).toEqual([{ id: request.id, request: request.request, createdAt: request.createdAt }])
  const loaded = loadPrd(join(root, '.yoke/prd.yaml'))
  expect(loaded).toHaveLength(2)
  expect(loaded.every(item => item.requirementsFor === next.objective.sha256)).toBe(true)
  expect(loaded[0]).toMatchObject({ ...story, requirementsFor: next.objective.sha256 })
  expect(requirementsPacket(root, 'S2')).toContain('Add accounts')
  expect(pendingChanges(root)).toHaveLength(0)
})

it.each(['old-reference', 'missing-coverage', 'duplicate-requirement', 'overlapping-writer', 'invented-objective'] as const)('rejects %s before coverage review and preserves both source files', kind => {
  withLedger()
  const before = readFileSync(join(root, '.yoke/prd.yaml'), 'utf8'), ledgerBefore = readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')
  let reviewed = false
  const candidate = proposal()
  if (kind === 'old-reference') candidate.requirements[0].criteria[0].story = 'S1'
  if (kind === 'missing-coverage') candidate.requirements[0].criteria.pop()
  if (kind === 'duplicate-requirement') candidate.requirements[0].id = 'R1'
  if (kind === 'overlapping-writer') candidate.stories[0].writes = ['src']
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, commit: () => {}, run: () => {
    writeFileSync(proposalFile(root, 'change'), stringify(kind === 'invented-objective' ? { ...candidate, objective: { idea: 'Discard existing edits' } } : candidate))
    return { success: true, summary: 'planned' }
  }, review: () => { reviewed = true; return approved() } })
  expect(result.ok).toBe(false); expect(reviewed).toBe(false)
  expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(before)
  expect(readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')).toBe(ledgerBefore)
  expect(pendingChanges(root)).toHaveLength(1)
})

it('rolls back both planning files when committing fails', () => {
  withLedger()
  const before = readFileSync(join(root, '.yoke/prd.yaml'), 'utf8'), ledgerBefore = readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: () => { writeFileSync(proposalFile(root, 'change'), stringify(proposal())); return { success: true, summary: 'planned' } }, review: approved, commit: () => { throw Error('commit unavailable') } })
  expect(result.ok).toBe(false); expect(result.summary).toContain('commit unavailable')
  expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(before)
  expect(readFileSync(join(root, '.yoke/requirements.yaml'), 'utf8')).toBe(ledgerBefore)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))).toHaveLength(1)
})

it('retries the exact approved state after an archival failure without another provider call', () => {
  withLedger()
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: () => { writeFileSync(proposalFile(root, 'change'), stringify(proposal())); return { success: true, summary: 'planned' } }, review: approved, commit: () => {}, archive: () => { throw Error('archive unavailable') } })
  expect(result.ok).toBe(false)
  let commits = 0
  const resumed = runChangeApply(root, { runner: 'codex', isAvailable: () => { throw Error('must reuse approved state') }, commit: () => { commits++ } })
  expect(resumed).toMatchObject({ ok: true, added: 0 }); expect(commits).toBe(1)
  expect(loadPrd(join(root, '.yoke/prd.yaml'))).toHaveLength(2)
  expect(readRequirements(root)!.changes).toHaveLength(1)
})

it('does not authorize committing edits made after the approved transaction receipt', () => {
  withLedger()
  runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: () => { writeFileSync(proposalFile(root, 'change'), stringify(proposal())); return { success: true, summary: 'planned' } }, review: approved, commit: () => {}, archive: () => { throw Error('archive unavailable') } })
  const path = join(root, '.yoke/prd.yaml')
  writeFileSync(path, readFileSync(path, 'utf8') + '# unapproved edit\n')
  let committed = false
  const result = runChangeApply(root, { runner: 'codex', commit: () => { committed = true } })
  expect(result.ok).toBe(false); expect(committed).toBe(false); expect(result.summary).toContain('host approval receipt')
})
it.each(['planner', 'reviewer'])('rejects ledger additions during the legacy %s call', stage => {
  const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, commit: () => {}, run: () => {
    writeFileSync(proposalFile(root, 'change'), stringify([{ ...story, id: 'S2', passes: false, writes: ['accounts'] }]))
    if (stage === 'planner') writeFileSync(join(root, '.yoke', 'requirements.yaml'), 'unauthorized ledger')
    return { success: true, summary: 'planned' }
  }, review: () => {
    if (stage === 'reviewer') writeFileSync(join(root, '.yoke', 'requirements.yaml'), 'unauthorized ledger')
    writeFileSync(reviewFile(root, 'change'), JSON.stringify({ version: 1, changeId: 'change', approved: true, summary: 'covered', uncovered: [] }))
    return { success: true, summary: 'reviewed' }
  } })
  expect(result.ok).toBe(false); expect(result.summary).toMatch(/changed|ledger|requirement/i)
  expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before); expect(pendingChanges(root)).toHaveLength(1)
})
it('rejects proposed host bindings that would create a bound PRD without its ledger', () => {
  const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, commit: () => {}, run: () => {
    writeFileSync(proposalFile(root, 'change'), stringify([{ ...story, id: 'S2', passes: false, writes: ['accounts'], requirementsFor: 'a'.repeat(64) }]))
    return { success: true, summary: 'planned' }
  }, review: () => {
    writeFileSync(reviewFile(root, 'change'), JSON.stringify({ version: 1, changeId: 'change', approved: true, summary: 'covered', uncovered: [] }))
    return { success: true, summary: 'reviewed' }
  } })
  expect(result.ok).toBe(false); expect(result.summary).toMatch(/binding|requirement/i)
  expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
})
