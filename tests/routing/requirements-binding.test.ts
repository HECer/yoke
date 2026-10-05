import { expect, it } from 'vitest'
import { contractKeys } from '../../src/routing/contracts.js'
import type { Story } from '../../src/loop/prd.js'
const stories: Story[] = [{ id: 'S1', title: 'Contract', priority: 1, acceptance: ['Preserve invariant'], passes: false }]
it('invalidates task assessments when the approved requirement ledger changes', () => {
  const keys = contractKeys as unknown as (stories: Story[], brief: string, requirementDigest?: string) => Map<string, string>
  expect(keys(stories, 'plan', 'first').get('S1')).not.toBe(keys(stories, 'plan', 'second').get('S1'))
})
it('preserves legacy task identities when no requirement ledger exists', () => {
  const keys = contractKeys as unknown as (stories: Story[], brief: string, requirementDigest?: string) => Map<string, string>
  expect(keys(stories, 'plan', '').get('S1')).toBe(contractKeys(stories, 'plan').get('S1'))
})
