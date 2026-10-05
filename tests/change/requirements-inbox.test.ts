import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { savePrd, type Story } from '../../src/loop/prd.js'
import { requirementObjective } from '../../src/prd/requirements.js'
import { pendingChanges, proposalFile, queueChange, reviewFile, runChangeApply } from '../../src/change/inbox.js'

let root: string
const story: Story = { id: 'S1', title: 'Keep edits', priority: 1, passes: true, writes: ['src'], acceptance: [{ id: 'offline', text: 'Keep offline edits', verify: ['npm run test:offline'] }, { id: 'online', text: 'Keep online edits', verify: ['npm run test:online'] }] }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'inbox-contract-')); mkdirSync(join(root, '.yoke')); savePrd(join(root, '.yoke', 'prd.yaml'), [story]); queueChange(root, 'Add accounts', { id: 'change' }) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('fails unsupported active-ledger change intake before spending planner or reviewer calls', () => {
  const objective = requirementObjective('Keep edits')
  savePrd(join(root, '.yoke', 'prd.yaml'), [{ ...story, requirementsFor: objective.sha256 }])
  writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify({ version: 1, objective, requirements: [{ id: 'R1', text: 'Keep edits', criteria: [{ story: 'S1', criterion: 'offline' }] }], invariants: [] }))
  let calls = 0
  const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
  const result = runChangeApply(root, { runner: 'codex', isAvailable: () => true, run: () => { calls++; return { success: true, summary: 'unexpected' } }, review: () => { calls++; return { success: true, summary: 'unexpected' } } })
  expect(result.ok).toBe(false); expect(result.summary).toMatch(/ledger|requirement/i); expect(calls).toBe(0)
  expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before); expect(pendingChanges(root)).toHaveLength(1)
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
