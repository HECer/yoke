import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Invocation } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'
import { runPrdDecompose } from '../../src/prd/decompose.js'
import { loadPrd } from '../../src/loop/prd.js'
import { readRequirements, requirementObjective } from '../../src/prd/requirements.js'

vi.mock('../../src/agents/process-incarnation.js', () => ({ processIncarnation: () => 'test-process:1' }))

let root: string
let previousLocalAppData: string | undefined
const proposal = [
  { id: 'PARENT-api', title: 'Implement the API slice', acceptanceIds: ['AC-1', 'AC-2'], writes: ['src/api'] },
  { id: 'PARENT-web', title: 'Implement the web slice', acceptanceIds: ['AC-3', 'AC-4'], writes: ['src/web'] },
]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yoke-prd-decompose-'))
  mkdirSync(join(root, '.yoke'), { recursive: true })
  previousLocalAppData = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = join(root, 'pool-state')
  writeFileSync(join(root, '.yoke', 'plan.md'), '# Approved plan\nKeep the existing public API.')
})

afterEach(() => {
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previousLocalAppData
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function fixture(): Story[] {
  const criteria = ['AC-1', 'AC-2', 'AC-3', 'AC-4'].map(id => ({ id, text: `Requirement ${id}`, verify: ['npm test'] }))
  return [
    { id: 'UPSTREAM', title: 'Existing API foundation', priority: 1, acceptance: ['foundation'], passes: true },
    { id: 'PARENT', title: 'Build a full API experience', priority: 2, needs: ['UPSTREAM'], acceptance: criteria, passes: false, writes: ['src/api', 'src/web'], assessmentFor: 'a'.repeat(64) },
    { id: 'DOWNSTREAM', title: 'Add integration flow', priority: 3, needs: ['PARENT'], acceptance: ['integration'], passes: false, assessmentFor: 'b'.repeat(64) },
    { id: 'FINAL', title: 'Document the flow', priority: 4, needs: ['DOWNSTREAM'], acceptance: ['docs'], passes: false, assessmentFor: 'c'.repeat(64) },
  ]
}

function writeFixture(stories = fixture()): string {
  const path = join(root, '.yoke', 'prd.yaml')
  writeFileSync(path, stringify(stories))
  return path
}

function planner(proposalValue: unknown, beforeWrite?: (invocation: Invocation) => void) {
  return (invocation: Invocation) => {
    beforeWrite?.(invocation)
    const path = invocation.input.match(/to (\.yoke\/\.decompose-[a-f0-9-]+\.json)\. Do not edit/u)?.[1]
    expect(path).toBeTruthy()
    writeFileSync(join(invocation.cwd, path!), JSON.stringify(proposalValue))
    return { success: true, summary: 'proposal ready' }
  }
}

describe('yoke prd decompose', () => {
  function ledgerFixture(): void {
    const parent = fixture().find(story => story.id === 'PARENT')!
    const objective = requirementObjective('Keep both API and web behavior', readFileSync(join(root, '.yoke/plan.md'), 'utf8'))
    parent.needs = []
    parent.requirementsFor = objective.sha256
    parent.sourceChange = 'earlier-change'
    parent.acceptance = parent.acceptance.map(criterion => typeof criterion === 'string' ? criterion : { ...criterion, verify: [`npm run test:${criterion.id}`] })
    const changes = [{ id: 'earlier-change', request: 'Add the web slice', createdAt: '2026-10-01T00:00:00.000Z' }]
    const bound = requirementObjective(objective.idea, readFileSync(join(root, '.yoke/plan.md'), 'utf8'), changes)
    parent.requirementsFor = bound.sha256
    writeFixture([parent])
    writeFileSync(join(root, '.yoke/requirements.yaml'), stringify({
      version: 1, objective: bound, changes,
      requirements: [{ id: 'R1', text: 'API and web work', criteria: ['AC-1', 'AC-3'].map(criterion => ({ story: parent.id, criterion })) }],
      invariants: [{ id: 'I1', text: 'Failures remain recoverable', criteria: ['AC-2', 'AC-4'].map(criterion => ({ story: parent.id, criterion })) }],
    }))
  }

  it('remaps every ledger reference and retains objective/change bindings in loadable children', () => {
    ledgerFixture()
    const before = readRequirements(root)!
    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', apply: true, isAvailable: () => true, run: planner(proposal) })).toBe(0)
    const children = loadPrd(join(root, '.yoke/prd.yaml'))
    expect(children).toHaveLength(2)
    expect(children.every(story => story.requirementsFor === before.objective.sha256 && story.sourceChange === 'earlier-change')).toBe(true)
    const ledger = readRequirements(root)!
    expect(ledger.objective).toEqual(before.objective)
    expect(ledger.changes).toEqual(before.changes)
    expect(ledger.requirements[0].criteria).toEqual([{ story: 'PARENT-api', criterion: 'AC-1' }, { story: 'PARENT-web', criterion: 'AC-3' }])
    expect(ledger.invariants[0].criteria).toEqual([{ story: 'PARENT-api', criterion: 'AC-2' }, { story: 'PARENT-web', criterion: 'AC-4' }])
  })

  it('preserves a concurrent ledger edit instead of applying a stale decomposition', () => {
    ledgerFixture()
    const path = join(root, '.yoke/requirements.yaml')
    const beforePrd = readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')
    const changed = readFileSync(path, 'utf8') + '# concurrent edit\n'
    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', apply: true, isAvailable: () => true, run: planner(proposal, () => writeFileSync(path, changed)) })).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(changed)
    expect(readFileSync(join(root, '.yoke/prd.yaml'), 'utf8')).toBe(beforePrd)
  })

  it.each(['quality', 'exploration'] as const)('refuses to discard unpartitioned %s semantics before a provider call', kind => {
    const stories = fixture()
    const parent = stories.find(story => story.id === 'PARENT')!
    if (kind === 'quality') parent.quality = { reference: { name: 'baseline', source: 'reference.txt', kind: 'file', digest: `sha256:${'a'.repeat(64)}` }, candidate: { kind: 'files', paths: ['candidate.txt'] }, rubric: 'Preserve the complete experience' }
    else parent.exploration = { version: 1, rationale: 'Existing evidence', expectedBenefit: 'Preserve behavior', confidence: 0.9, risk: 'low', evidence: [{ path: 'src/api/index.ts', observation: 'API and web are coupled' }], discoveredAt: '2026-10-01T00:00:00.000Z' }
    const path = writeFixture(stories)
    const before = readFileSync(path, 'utf8')
    const run = vi.fn(planner(proposal))
    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', apply: true, isAvailable: () => true, run })).toBe(1)
    expect(run).not.toHaveBeenCalled()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('previews an exact split without changing the PRD', async () => {
    const path = writeFixture()
    const before = readFileSync(path, 'utf8')

    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', isAvailable: () => true, run: planner(proposal) })).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(existsSync(join(root, '.yoke', 'loop.lock'))).toBe(false)
    expect(readdirSync(join(root, '.yoke')).some(name => name.startsWith('.decompose-'))).toBe(false)
  })

  it('applies the split atomically and invalidates every downstream assessment binding', async () => {
    const path = writeFixture()

    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', apply: true, isAvailable: () => true, run: planner(proposal) })).toBe(0)
    const stories = parse(readFileSync(path, 'utf8')) as Story[]
    const api = stories.find(story => story.id === 'PARENT-api')!
    const web = stories.find(story => story.id === 'PARENT-web')!
    const downstream = stories.find(story => story.id === 'DOWNSTREAM')!
    const final = stories.find(story => story.id === 'FINAL')!

    expect(api).toMatchObject({ needs: ['UPSTREAM'], writes: ['src/api'], passes: false })
    expect(api.acceptance.map(item => typeof item === 'string' ? item : item.id)).toEqual(['AC-1', 'AC-2'])
    expect(web.acceptance.map(item => typeof item === 'string' ? item : item.id)).toEqual(['AC-3', 'AC-4'])
    expect(api).not.toHaveProperty('assessmentFor')
    expect(downstream.needs).toEqual(['PARENT-api', 'PARENT-web'])
    expect(downstream).not.toHaveProperty('assessmentFor')
    expect(final.needs).toEqual(['DOWNSTREAM'])
    expect(final).not.toHaveProperty('assessmentFor')
    expect(stories.some(story => story.id === 'PARENT')).toBe(false)
  })

  it('refuses to publish a proposal when the PRD changes during planning', async () => {
    const path = writeFixture()
    const changed = [...fixture(), { id: 'NEW', title: 'New requirement', priority: 5, acceptance: ['new'], passes: false }]

    expect(runPrdDecompose(root, {
      story: 'PARENT', runner: 'codex', apply: true, isAvailable: () => true,
      run: planner(proposal, () => writeFileSync(path, stringify(changed))),
    })).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(stringify(changed))
    expect(existsSync(join(root, '.yoke', 'loop.lock'))).toBe(false)
  })

  it('rejects malformed partitions and refuses stories without enough executable criteria', async () => {
    const path = writeFixture()
    const overlapping = [proposal[0]!, { ...proposal[1]!, acceptanceIds: ['AC-2', 'AC-4'] }]
    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', isAvailable: () => true, run: planner(overlapping) })).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(stringify(fixture()))

    const tooSmall = fixture().map(story => story.id === 'PARENT' ? { ...story, acceptance: story.acceptance.slice(0, 3) } : story)
    writeFixture(tooSmall)
    let invoked = false
    expect(runPrdDecompose(root, { story: 'PARENT', runner: 'codex', isAvailable: () => true, run: () => { invoked = true; return { success: true, summary: 'unexpected' } } })).toBe(1)
    expect(invoked).toBe(false)
  })
})
