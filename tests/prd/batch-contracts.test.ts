import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { runPrdAssess } from '../../src/prd/assess.js'
import type { Agent } from '../../src/retrofit/config.js'
import type { TaskAssessment } from '../../src/routing/assessment.js'
import type { CapturedAgentRun, Invocation } from '../../src/loop/runner.js'

let root: string

const assessment: TaskAssessment = {
  taskClass: 'implementation', difficulty: 'medium', uncertainty: 'low', risk: 'low', scope: 'medium', testability: 'high',
  reason: 'The change has bounded code and test coverage.', approach: 'Implement the task and run its targeted tests.',
}

const story = (id: string, passes = false) => ({
  id,
  title: `Task ${id}`,
  priority: 1,
  acceptance: [
    { id: `${id.toLowerCase()}-works`, text: `${id} works`, verify: [`npx vitest run tests/${id.toLowerCase()}-works.test.ts`] },
    { id: `${id.toLowerCase()}-fails`, text: `${id} rejects invalid input`, verify: [`npx vitest run tests/${id.toLowerCase()}-fails.test.ts`] },
  ],
  passes,
})

function writePrd(stories: ReturnType<typeof story>[]): void {
  writeFileSync(join(root, '.yoke', 'prd.yaml'), stringify(stories))
}

function output(items: { id: string, assessment?: unknown }[]): string {
  return `YOKE_BATCH ${JSON.stringify({ assessments: items.map(item => ({ id: item.id, assessment: item.assessment ?? assessment })) })}`
}

function runner(value: CapturedAgentRun, calls: Invocation[], mutate?: () => void) {
  return (_agent: Agent, invocation: Invocation) => {
    calls.push(invocation)
    mutate?.()
    return value
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yoke-batch-contracts-'))
  mkdirSync(join(root, '.yoke'), { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('batch-calls', () => {
  it('batch-calls makes one planner call for several tasks, binds contracts, and suppresses fresh assessments', () => {
    writePrd([story('ONE'), story('TWO'), story('THREE')])
    const calls: Invocation[] = []
    const options = {
      runner: 'codex' as Agent,
      isAvailable: () => true,
      run: runner({ success: true, summary: 'ok', output: output([{ id: 'ONE' }, { id: 'TWO' }, { id: 'THREE' }]) }, calls),
    }

    expect(runPrdAssess(root, options)).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toContain('"id":"ONE"')
    expect(calls[0].input).toContain('"id":"TWO"')
    expect(calls[0].input).toContain('"id":"THREE"')
    const assessed = parse(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')) as { assessment?: TaskAssessment, assessmentFor?: string }[]
    expect(assessed).toHaveLength(3)
    for (const item of assessed) {
      expect(item.assessment).toEqual(assessment)
      expect(item.assessmentFor).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(runPrdAssess(root, options)).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('batch-calls rejects invalid executable criteria before calling the planner', () => {
    const invalid = story('BAD')
    invalid.acceptance[1].verify = ['npm test']
    writePrd([invalid])
    const calls: Invocation[] = []

    expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: runner({ success: true, summary: 'ok', output: output([{ id: 'BAD' }]) }, calls) })).toBe(1)
    expect(calls).toHaveLength(0)
  })
})

describe('batch-atomicity', () => {
  for (const [label, response] of [
    ['duplicate IDs', output([{ id: 'ONE' }, { id: 'ONE' }])],
    ['missing IDs', output([{ id: 'ONE' }])],
    ['extra IDs', output([{ id: 'ONE' }, { id: 'TWO' }, { id: 'EXTRA' }])],
    ['invalid responses', 'YOKE_BATCH {"assessments":[{"id":"ONE","assessment":{"taskClass":"unknown"}}]}'],
  ]) {
    it(`batch-atomicity rejects ${label} without partially overwriting the PRD`, () => {
      writePrd([story('ONE'), story('TWO'), story('DONE', true)])
      const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
      const calls: Invocation[] = []

      expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: runner({ success: true, summary: 'ok', output: response }, calls) })).toBe(1)
      expect(calls).toHaveLength(1)
      expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
    })
  }

  it('batch-atomicity preserves the PRD when the provider fails', () => {
    writePrd([story('ONE'), story('TWO'), story('DONE', true)])
    const before = readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')
    const calls: Invocation[] = []

    expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: runner({ success: false, summary: 'provider down', output: '' }, calls) })).toBe(1)
    expect(calls).toHaveLength(1)
    expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(before)
  })

  it('batch-atomicity preserves a concurrent PRD edit instead of publishing stale output', () => {
    writePrd([story('ONE'), story('TWO'), story('DONE', true)])
    const calls: Invocation[] = []
    const concurrent = () => writePrd([{ ...story('ONE'), title: 'Edited while assessing' }, story('TWO'), story('DONE', true)])

    expect(runPrdAssess(root, { runner: 'codex', isAvailable: () => true, run: runner({ success: true, summary: 'ok', output: output([{ id: 'ONE' }, { id: 'TWO' }]) }, calls, concurrent) })).toBe(1)
    expect(calls).toHaveLength(1)
    expect(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')).toBe(stringify([{ ...story('ONE'), title: 'Edited while assessing' }, story('TWO'), story('DONE', true)]))
  })

  it('batch-atomicity selectively assesses one unfinished story and preserves passed tasks', () => {
    writePrd([story('ONE'), story('TWO'), story('DONE', true)])
    const calls: Invocation[] = []

    expect(runPrdAssess(root, { story: 'TWO', runner: 'codex', isAvailable: () => true, run: runner({ success: true, summary: 'ok', output: output([{ id: 'TWO' }]) }, calls) })).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toContain('"id":"TWO"')
    expect(calls[0].input).not.toContain('"id":"ONE"')
    const after = parse(readFileSync(join(root, '.yoke', 'prd.yaml'), 'utf8')) as { id: string, assessment?: TaskAssessment, passes: boolean }[]
    expect(after.find((item: { id: string }) => item.id === 'ONE').assessment).toBeUndefined()
    expect(after.find((item: { id: string }) => item.id === 'TWO').assessment).toEqual(assessment)
    expect(after.find((item: { id: string }) => item.id === 'DONE')).toMatchObject({ passes: true })
  })
})
