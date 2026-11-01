import { expect, it } from 'vitest'
import { contractKeys } from '../../src/routing/contracts.js'
import type { Story } from '../../src/loop/prd.js'
import { requirementObjective, type RequirementsLedger } from '../../src/prd/requirements.js'
const stories: Story[] = [{ id: 'S1', title: 'Contract', priority: 1, acceptance: ['Preserve invariant'], passes: false }]
it('invalidates task assessments when the approved requirement ledger changes', () => {
  const keys = contractKeys as unknown as (stories: Story[], brief: string, requirementDigest?: string) => Map<string, string>
  expect(keys(stories, 'plan', 'first').get('S1')).not.toBe(keys(stories, 'plan', 'second').get('S1'))
})
it('preserves legacy task identities when no requirement ledger exists', () => {
  const keys = contractKeys as unknown as (stories: Story[], brief: string, requirementDigest?: string) => Map<string, string>
  expect(keys(stories, 'plan', '').get('S1')).toBe(contractKeys(stories, 'plan').get('S1'))
})

const tasks: Story[] = ['A', 'B', 'C'].map(id => ({ id, title: `Implement ${id}`, priority: 1, passes: false, writes: [id], ...(id === 'C' ? { needs: ['A'] } : {}), acceptance: [{ id: 'success', text: 'Succeeds', verify: ['npm run test:success'] }, { id: 'failure', text: 'Recovers', verify: ['npm run test:failure'] }] }))
function ledger(): RequirementsLedger {
  return { version: 1, objective: requirementObjective('Preserve all components'), requirements: tasks.map(story => ({ id: `R-${story.id}`, text: `${story.id} behavior`, criteria: story.acceptance.map(criterion => ({ story: story.id, criterion: typeof criterion === 'string' ? criterion : criterion.id })) })), invariants: [{ id: 'I1', text: 'Never lose user state', criteria: [{ story: 'A', criterion: 'failure' }] }] }
}
it('invalidates relevant tasks and their dependents without reassessing independent requirements', () => {
  const original = ledger(), changed = structuredClone(original)
  changed.requirements[0].text = 'A must also preserve edits'
  const before = contractKeys(tasks, '', original), after = contractKeys(tasks, '', changed)
  expect(after.get('A')).not.toBe(before.get('A'))
  expect(after.get('C')).not.toBe(before.get('C'))
  expect(after.get('B')).toBe(before.get('B'))
})
it('invalidates every task when an applicable invariant changes', () => {
  const original = ledger(), changed = structuredClone(original)
  changed.invariants[0].text = 'Never lose encrypted user state'
  const before = contractKeys(tasks, '', original), after = contractKeys(tasks, '', changed)
  expect(tasks.every(story => after.get(story.id) !== before.get(story.id))).toBe(true)
})
it('ignores ledger ordering and unrelated global change bindings while retaining relevant change provenance', () => {
  const original = ledger(), changed = structuredClone(original)
  changed.requirements.reverse()
  for (const entry of changed.requirements) entry.criteria.reverse()
  expect(contractKeys(tasks, '', changed)).toEqual(contractKeys(tasks, '', original))
  changed.changes = [{ id: 'change-B', request: 'Extend B', createdAt: '2026-11-01T00:00:00.000Z' }]
  changed.objective = requirementObjective(changed.objective.idea, '', changed.changes)
  const updated = tasks.map(story => ({ ...story, requirementsFor: changed.objective.sha256, ...(story.id === 'B' ? { sourceChange: 'change-B' } : {}) }))
  const before = contractKeys(tasks, '', original), after = contractKeys(updated, '', changed)
  expect(after.get('A')).toBe(before.get('A')); expect(after.get('C')).toBe(before.get('C'))
  expect(after.get('B')).not.toBe(before.get('B'))
})
