import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { stringify } from 'yaml'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { buildPrdDraftPrompt, runPrdCheck, runPrdDraft } from '../../src/prd/command.js'
import { requirementsPacket } from '../../src/prd/requirements.js'
import { writeDraftCoverage } from './draft-fixture.js'
import { bindAssessments, preparedProblems, runPrdAssess } from '../../src/prd/assess.js'

let root: string
const digest = (v: string) => createHash('sha256').update(v).digest('hex')
const objective = (idea = 'Keep offline edits') => ({ idea, approvedPlanSha256: digest(''), sha256: digest(JSON.stringify({ idea, approvedPlanSha256: digest('') })) })
const story = (id = 'S1'): Story => ({ id, title: 'Keep edits', priority: 1, passes: false, writes: ['src'], acceptance: [{ id: 'offline', text: 'offline edits persist', verify: ['npm run test:offline'] }, { id: 'online', text: 'online edits persist', verify: ['npm run test:online'] }] })
const ledger = () => ({ version: 1, objective: objective(), requirements: [{ id: 'R1', text: 'Keep offline edits', criteria: [{ story: 'S1', criterion: 'offline' }] }], invariants: [{ id: 'I1', text: 'Keep online edits', criteria: [{ story: 'S1', criterion: 'online' }] }] })
const write = (l: unknown = ledger(), stories = [story()]) => { writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify(stories)); writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify(l)) }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'requirements-')); mkdirSync(join(root, '.yoke')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('accepts valid coverage and preserves ledger on progress saves', () => {
  write(); const stories = loadPrd(join(root, '.yoke', 'prd.yaml')); stories[0].passes = true
  const before = readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')
  savePrd(join(root, '.yoke', 'prd.yaml'), stories)
  expect(runPrdCheck(root)).toBe(0)
  expect(readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')).toBe(before)
})
it('rejects uncovered requirements before loading a runnable story', () => {
  const l = ledger(); l.requirements[0].criteria = []; write(l)
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/coverage|criteria/i)
  expect(runPrdCheck(root)).toBe(1)
})
it.each(['missing-story', 'missing-criterion', 'duplicate-ref', 'duplicate-id', 'stale-objective', 'stale-plan', 'unsafe-command', 'missing-writes'])('rejects %s ledger bindings', kind => {
  const l = ledger(); const stories = [story()]
  if (kind === 'missing-story') l.requirements[0].criteria[0].story = 'absent'
  if (kind === 'missing-criterion') l.requirements[0].criteria[0].criterion = 'absent'
  if (kind === 'duplicate-ref') l.requirements[0].criteria.push(l.requirements[0].criteria[0])
  if (kind === 'duplicate-id') l.invariants[0].id = 'R1'
  if (kind === 'stale-objective') l.objective.idea = 'Changed objective'
  if (kind === 'stale-plan') writeFileSync(join(root, '.yoke', 'plan.md'), 'new approved plan')
  if (kind === 'unsafe-command') (stories[0].acceptance[0] as { verify: string[] }).verify = ['npm test']
  if (kind === 'missing-writes') delete stories[0].writes
  write(l, stories)
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow()
})
it('rejects unordered shared file writers but accepts explicit dependency ownership', () => {
  write(ledger(), [story(), story('S2')])
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/ownership|overlap/i)
  const second = { ...story('S2'), needs: ['S1'] }; write(ledger(), [story(), second])
  expect(loadPrd(join(root, '.yoke', 'prd.yaml'))).toHaveLength(2)
})
it('bounds the ledger before expensive validation', () => {
  write(); writeFileSync(join(root, '.yoke', 'requirements.yaml'), 'x'.repeat(200_001))
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/limit|large/i)
})
it('requires the smallest coherent 1-12 decomposition and exact objective source', () => {
  const prompt = buildPrdDraftPrompt('Keep offline edits')
  expect(prompt).toContain('1-12'); expect(prompt).toContain('smallest coherent')
  expect(prompt).toContain('requirements.yaml'); expect(prompt).toMatch(/shared.*owner|ownership/i)
})
it('rejects missing ledger on new drafts and restores original planning output', () => {
  write(); const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
  expect(runPrdDraft(root, { idea: 'different', force: true, isAvailable: () => true, run: () => {
    writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify([story()]))
    rmSync(join(root, '.yoke', 'requirements.yaml'))
    return { success: true, summary: 'done' }
  } })).toBe(1)
  expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
  expect(readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')).toContain('Keep offline edits')
})
it('rejects a self-consistent ledger that silently redefines the supplied idea', () => {
  expect(runPrdDraft(root, { idea: 'Original approved idea', isAvailable: () => true, run: () => { write(); return { success: true, summary: 'done' } } })).toBe(1)
})
it('exposes relevant requirements and every preserved invariant to task and review prompts', () => {
  const l = ledger(); l.requirements.push({ id: 'R2', text: 'Other story behavior', criteria: [{ story: 'S2', criterion: 'offline' }] })
  write(l, [story(), { ...story('S2'), writes: ['other'] }])
  expect(requirementsPacket(root, 'S1')).toContain('Keep offline edits')
  expect(requirementsPacket(root, 'S1')).toContain('Keep online edits')
  expect(requirementsPacket(root, 'S1')).not.toContain('Other story behavior')
  expect(requirementsPacket(root)).toContain('Other story behavior')
})
it('refuses stale packets instead of replaying obsolete approved requirements', () => {
  write(); writeFileSync(join(root, '.yoke', 'plan.md'), 'changed')
  expect(() => requirementsPacket(root, 'S1')).toThrow(/Stale/)
})
it('requires all active story criteria to use structured executable evidence', () => {
  const mixed = story(); mixed.acceptance[1] = 'looks correct'; write(ledger(), [mixed])
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow()
})
it('rejects a new draft with an untested criterion even if mapped outcomes are executable', () => {
  const l = ledger(); l.invariants = []; const mixed = story(); mixed.acceptance.push('looks correct')
  write(l, [mixed]); expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/executable|structured/i)
})
const assessment = { taskClass: 'implementation' as const, difficulty: 'medium' as const, uncertainty: 'low' as const, risk: 'low' as const, scope: 'low' as const, testability: 'high' as const, reason: 'Keep behavior', approach: 'Verify edits' }
it('invalidates prepared assessments when approved requirement text changes', () => {
  write(); const source = readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')
  const bound = bindAssessments([{ ...story(), assessment }], '', digest(source))
  expect(preparedProblems(bound, '', digest(source))).toEqual([])
  expect(preparedProblems(bound, '', digest(source + '\n'))).not.toEqual([])
})
it('rejects changed ledger during batch assessment without publishing stale preparation', () => {
  write(); const path = join(root, '.yoke', 'prd.yaml'), before = readFileSync(path, 'utf8')
  expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: () => {
    const l = ledger(); l.requirements[0].text = 'Changed approved meaning'; writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify(l))
    return { success: true, summary: 'done', output: 'YOKE_BATCH ' + JSON.stringify({ assessments: [{ id: 'S1', assessment }] }) }
  } })).toBe(1)
  expect(readFileSync(path, 'utf8')).toBe(before)
})
it('rejects oversized original idea before calling the planning provider', () => {
  let called = false
  expect(runPrdDraft(root, { idea: 'x'.repeat(20_001), isAvailable: () => true, run: () => { called = true; return { success: true, summary: 'done' } } })).toBe(1)
  expect(called).toBe(false)
})
it('preserves whitespace in the exact original objective with one planning call', () => {
  let calls = 0
  const idea = '  Keep offline edits\n'
  expect(runPrdDraft(root, { idea, isAvailable: () => true, run: inv => {
    calls++; writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify([story()]))
    writeDraftCoverage(root, inv, [story()]); return { success: true, summary: 'done' }
  } })).toBe(0)
  expect(calls).toBe(1)
  expect(requirementsPacket(root)).toContain(idea)
})
function draftBound(): void {
  expect(runPrdDraft(root, { idea: 'Keep offline edits', isAvailable: () => true, run: inv => {
    writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify([story()])); writeDraftCoverage(root, inv, [story()])
    return { success: true, summary: 'done' }
  } })).toBe(0)
}
it('host binds drafted stories and persists the original objective through progress saves', () => {
  draftBound(); const file = join(root, '.yoke', 'prd.yaml'), stories = loadPrd(file)
  expect(stories[0]).toHaveProperty('requirementsFor', objective().sha256)
  stories[0].passes = true; savePrd(file, stories)
  expect(loadPrd(file)[0]).toHaveProperty('requirementsFor', objective().sha256)
})
it('rejects ledger deletion from a host-bound PRD instead of downgrading it to legacy', () => {
  draftBound(); rmSync(join(root, '.yoke', 'requirements.yaml'))
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/requirement|ledger/i)
  expect(runPrdCheck(root)).toBe(1)
})
it('does not silently omit binding context after the bound ledger is deleted', () => {
  draftBound(); rmSync(join(root, '.yoke', 'requirements.yaml'))
  expect(() => requirementsPacket(root, 'S1')).toThrow(/ledger/i)
})
it('rejects a self-consistent objective rewrite against the host-bound original source', () => {
  draftBound(); const rewritten = ledger(); rewritten.objective = objective('Silently replace original objective')
  writeFileSync(join(root, '.yoke', 'requirements.yaml'), stringify(rewritten))
  expect(() => loadPrd(join(root, '.yoke', 'prd.yaml'))).toThrow(/binding|objective/i)
})
it('rejects inconsistent planner supplied objective markers and restores both old files', () => {
  draftBound(); const file = join(root, '.yoke', 'prd.yaml'), before = readFileSync(file, 'utf8')
  const ledgerBefore = readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')
  expect(runPrdDraft(root, { idea: 'Keep offline edits', force: true, isAvailable: () => true, run: inv => {
    writeFileSync(file, stringify([{ ...story(), requirementsFor: 'a'.repeat(64) }]))
    writeDraftCoverage(root, inv, [story()]); return { success: true, summary: 'done' }
  } })).toBe(1)
  expect(readFileSync(file, 'utf8')).toBe(before)
  expect(readFileSync(join(root, '.yoke', 'requirements.yaml'), 'utf8')).toBe(ledgerBefore)
})
it('rejects planner removal of a retained story original-objective binding', () => {
  draftBound(); const file = join(root, '.yoke', 'prd.yaml'), before = readFileSync(file, 'utf8')
  expect(runPrdDraft(root, { idea: 'Keep offline edits', force: true, isAvailable: () => true, run: inv => {
    writeFileSync(file, stringify([story()])); writeDraftCoverage(root, inv, [story()])
    return { success: true, summary: 'removed host binding' }
  } })).toBe(1)
  expect(readFileSync(file, 'utf8')).toBe(before)
})
it('allows an authorized forced objective change with retained story IDs and preserved old markers', () => {
  draftBound(); const file = join(root, '.yoke', 'prd.yaml'), original = loadPrd(file)
  const idea = 'Keep encrypted offline edits'
  expect(runPrdDraft(root, { idea, force: true, isAvailable: () => true, run: inv => {
    writeFileSync(file, stringify(original)); writeDraftCoverage(root, inv, original)
    return { success: true, summary: 'authorized new objective' }
  } })).toBe(0)
  expect(loadPrd(file)[0]).toHaveProperty('requirementsFor', objective(idea).sha256)
  expect(loadPrd(file)[0].id).toBe('S1')
  expect(requirementsPacket(root)).toContain(idea)
})
