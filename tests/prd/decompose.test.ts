import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Invocation } from '../../src/loop/runner.js'
import type { Story } from '../../src/loop/prd.js'
import { runPrdDecompose } from '../../src/prd/decompose.js'

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
