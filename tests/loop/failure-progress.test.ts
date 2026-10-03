import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { observeFailure, clearFailureProgress } from '../../src/loop/failure.js'
const roots: string[] = []
const story = { id: 'A', title: 'Tracking', priority: 1, acceptance: ['track'], passes: false }
function fixture() { const root = mkdtempSync(join(tmpdir(), 'yoke-failure-progress-')); roots.push(root); mkdirSync(join(root, '.yoke')); writeFileSync(join(root, 'app.ts'), 'broken'); return root }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
it('persists one diagnostic opportunity before blocking an unchanged failure', () => {
  const root = fixture()
  const input = { root, directory: root, story, stage: 'verify' as const, summary: 'tracking test failed' }
  expect(observeFailure(input)).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
  expect(observeFailure(input)).toMatchObject({ action: 'diagnose', feedback: expect.stringContaining('diagnose'), failure: { repeats: 2 } })
  expect(observeFailure(input)).toMatchObject({ action: 'blocked', failure: { kind: 'no-progress', repeats: 3 } })
  expect(readdirSync(join(root, '.yoke/failure-progress'))).toHaveLength(1)
})
it('resets the guard when source, error or approved story contract changes', () => {
  const root = fixture()
  const input = { root, directory: root, story, stage: 'verify' as const, summary: 'same assertion' }
  observeFailure(input); observeFailure(input); observeFailure(input)
  writeFileSync(join(root, 'app.ts'), 'repaired differently')
  expect(observeFailure(input)).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
  expect(observeFailure({ ...input, summary: 'different assertion' })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
  expect(observeFailure({ ...input, story: { ...story, acceptance: ['new approved contract'] } })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
})
it('forgets the outstanding failure only after a passing checkpoint', () => {
  const root = fixture(); const input = { root, directory: root, story, stage: 'verify' as const, summary: 'same' }
  observeFailure(input); observeFailure(input); clearFailureProgress(root, story.id)
  expect(observeFailure(input)).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
})
it('blocks automatic continuation if progress evidence is corrupt', () => {
  const root = fixture()
  const input = { root, directory: root, story, stage: 'verify' as const, summary: 'same' }
  observeFailure(input)
  const name = readdirSync(join(root, '.yoke/failure-progress'))[0]!
  writeFileSync(join(root, '.yoke/failure-progress', name), '{invalid')
  expect(observeFailure(input)).toMatchObject({ action: 'blocked', failure: { kind: 'no-progress' }, feedback: expect.stringContaining('progress') })
})
it('resets on an approved replan even when the retained worker source is unchanged', () => {
  const root = fixture(); const worker = fixture()
  const input = { root, directory: worker, story, stage: 'verify' as const, summary: 'same assertion' }
  observeFailure(input); observeFailure(input); observeFailure(input)
  writeFileSync(join(root, '.yoke/plan.md'), 'Approved revised plan with a new dependency strategy')
  expect(observeFailure(input)).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
})
it('keeps concurrent candidate failure counts separate and clears all after acceptance', () => {
  const root = fixture(); const input = { root, directory: root, story, stage: 'verify' as const, summary: 'same assertion' }
  observeFailure({ ...input, scope: 'candidate-1' }); observeFailure({ ...input, scope: 'candidate-1' })
  expect(observeFailure({ ...input, scope: 'candidate-2' })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
  expect(observeFailure({ ...input, scope: 'candidate-1' })).toMatchObject({ action: 'blocked', failure: { repeats: 3 } })
  clearFailureProgress(root, story.id)
  expect(observeFailure({ ...input, scope: 'candidate-1' })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
  expect(observeFailure({ ...input, scope: 'candidate-2' })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
})
it('ignores known test reporter timing and output-size metadata while retaining assertion values', () => {
  const root = fixture(); const input = { root, directory: root, story, stage: 'verify' as const }
  const summary = (duration: number, actual = 40) => `verify failed: npm test\n × tracking should persist ${duration}ms\nAssertionError: expected ${actual} to equal 42\n Start at 03:00:${duration}\n Duration ${duration}ms (tests ${duration}ms)\n[… omitted; ${100 + duration} lines, ${4000 + duration} bytes total …]\n[full output: .yoke/artifacts/${duration}.log]`
  expect(observeFailure({ ...input, summary: summary(10) })).toMatchObject({ action: 'retry' })
  expect(observeFailure({ ...input, summary: summary(11) })).toMatchObject({ action: 'diagnose' })
  expect(observeFailure({ ...input, summary: summary(12) })).toMatchObject({ action: 'blocked', failure: { repeats: 3 } })
  expect(observeFailure({ ...input, summary: summary(13, 41) })).toMatchObject({ action: 'retry', failure: { repeats: 1 } })
})
