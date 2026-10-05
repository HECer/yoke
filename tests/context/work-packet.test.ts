import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClaudePrompt, buildReviewPrompt, makeRunner } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'
import * as packet from '../../src/context/packet.js'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yoke-packet-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
const story: Story = { id: 'S1', title: 'Fix billing', priority: 1, passes: false, acceptance: ['Do not charge twice'], writes: ['src/billing', 'tests/billing'] }
it('provides the binding write ownership and shared-contract rule to implementers', () => {
  const prompt = buildClaudePrompt(story, '')
  expect(prompt).toContain('src/billing')
  expect(prompt).toContain('tests/billing')
  expect(prompt).toMatch(/shared.*contract.*scope/i)
})
it('requires reviewers to check invariants, preserved behavior and test adequacy', () => {
  const prompt = buildReviewPrompt(story, '')
  expect(prompt).toMatch(/invariants/i)
  expect(prompt).toMatch(/preserv.*(?:capabilit|behavio)/i)
  expect(prompt).toMatch(/test.*(?:adequacy|meaningful|detect)/i)
})
it('packs large reference material deterministically with source digest and relevant excerpts', () => {
  expect(packet).toHaveProperty('referencePacket')
  const source = '## Images\n' + 'Resize pictures.\n'.repeat(10000) + '\n## Billing invariant\nDo not charge a payment twice.\n'
  const make = (packet as unknown as { referencePacket: (name: string, text: string, query: string, budget: number) => string }).referencePacket
  const result = make('.yoke/plan.md', source, 'payment billing', 4000)
  expect(result.length).toBeLessThanOrEqual(4000)
  expect(result).toContain('.yoke/plan.md')
  expect(result).toMatch(/sha256:[a-f0-9]{64}/)
  expect(result).toContain('Do not charge a payment twice.')
  expect(make('.yoke/plan.md', source, 'payment billing', 4000)).toBe(result)
})
it('bounds repeated repair feedback and retains artifact references', () => {
  let prompt = ''
  const runner = makeRunner('codex', 0, { execCapture: inv => { prompt = inv.input; return '' } })
  const feedback = 'Diagnostic start\n' + 'x'.repeat(3000) + '\n[full output: .yoke/output/failed.log]\n' + 'y'.repeat(20000) + '\nFailure at final assertion'
  runner({ targetDir: root, story, feedback })
  expect(prompt.length).toBeLessThan(6500)
  expect(prompt).toContain('Diagnostic start')
  expect(prompt).toContain('Failure at final assertion')
  expect(prompt).toContain('[full output: .yoke/output/failed.log]')
  expect(prompt).toMatch(/excerpt/i)
})
it('keeps every acceptance criterion intact even when secondary context is long', () => {
  const criteria = ['BINDING-FIRST', 'BINDING-LAST']
  expect(buildClaudePrompt({ ...story, acceptance: criteria }, '')).toContain('BINDING-LAST')
  expect(buildClaudePrompt({ ...story, acceptance: criteria }, '')).toContain('BINDING-FIRST')
})
