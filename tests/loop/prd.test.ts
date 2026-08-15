import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrd, savePrd, selectNextStory, allPass, progress, storyPathSegment, validateDependencies } from '../../src/loop/prd.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-prd-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sample = `
- { id: S1, title: First, priority: 2, acceptance: ["does X"], passes: false }
- { id: S2, title: Second, priority: 1, acceptance: ["does Y"], passes: false }
- { id: S3, title: Third, priority: 3, acceptance: ["does Z"], passes: true }
`

describe('prd', () => {
  it('loads stories from yaml', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    expect(stories).toHaveLength(3)
    expect(stories[0]).toMatchObject({ id: 'S1', priority: 2, passes: false })
  })

  it('loads structured acceptance criteria with stable ids and verification commands', () => {
    writeFileSync(prd(), `
- id: S1
  title: Unlock paid access
  priority: 1
  acceptance:
    - id: purchase-unlocks-pro
      text: A successful purchase unlocks Pro in the app
      verify:
        - npm run test:purchase-unlocks-pro
    - id: relaunch-keeps-pro
      text: Pro remains unlocked after relaunch
      verify:
        - npm run test:relaunch-keeps-pro
  passes: false
`)

    const [story] = loadPrd(prd())
    expect(story.acceptance[0]).toEqual({
      id: 'purchase-unlocks-pro',
      text: 'A successful purchase unlocks Pro in the app',
      verify: ['npm run test:purchase-unlocks-pro'],
    })
  })

  it('rejects structured criteria without a verification command', () => {
    writeFileSync(prd(), `
- id: S1
  title: Unlock paid access
  priority: 1
  acceptance:
    - id: purchase-unlocks-pro
      text: A successful purchase unlocks Pro in the app
      verify: []
  passes: false
`)

    expect(() => loadPrd(prd())).toThrow()
  })

  it('rejects duplicate structured criterion IDs within one story', () => {
    writeFileSync(prd(), `
- id: S1
  title: Unlock paid access
  priority: 1
  acceptance:
    - { id: purchase-unlocks, text: Purchase unlocks Pro, verify: [npm test] }
    - { id: purchase-unlocks, text: Relaunch keeps Pro, verify: [npm test] }
  passes: false
`)

    expect(() => loadPrd(prd())).toThrow(/criterion ids/i)
  })

  it.each([1, 6])('rejects structured stories with %i criteria', count => {
    const criteria = Array.from({ length: count }, (_, index) =>
      `    - { id: criterion-${index + 1}, text: Criterion ${index + 1}, verify: [npm run test:criterion-${index + 1}] }`).join('\n')
    writeFileSync(prd(), [
      '- id: S1', '  title: Strict story', '  priority: 1', '  acceptance:', criteria, '  passes: false', '',
    ].join('\n'))
    expect(() => loadPrd(prd())).toThrow(/2-5 structured acceptance criteria/i)
  })

  it('keeps legacy story ids compatible while encoding them for filesystem paths', () => {
    writeFileSync(prd(), `- { id: "Auth callback: ../../outside", title: Legacy, priority: 1, acceptance: ["x"], passes: false }`)
    expect(loadPrd(prd())[0].id).toBe('Auth callback: ../../outside')
    expect(storyPathSegment('Auth callback: ../../outside')).toMatch(/^story-[A-Za-z0-9%._-]+$/)
    expect(storyPathSegment('Auth callback: ../../outside')).not.toContain('..')
  })

  it('uses lowercase fixed-length keys that distinguish case-folding filesystem story ids', () => {
    const lowercase = storyPathSegment('story-a')
    const uppercase = storyPathSegment('STORY-A')

    expect(lowercase).toMatch(/^story-[a-f0-9]{64}$/)
    expect(uppercase).toMatch(/^story-[a-f0-9]{64}$/)
    expect(lowercase).not.toBe(uppercase)
  })

  it('selects the highest-priority (lowest number) unfinished story', () => {
    writeFileSync(prd(), sample)
    const next = selectNextStory(loadPrd(prd()))
    expect(next?.id).toBe('S2')
  })

  it('selectNextStory returns null when all pass', () => {
    expect(selectNextStory([{ id: 'A', title: 't', priority: 1, acceptance: ['x'], passes: true }])).toBeNull()
  })

  it('allPass and progress report completion', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    expect(allPass(stories)).toBe(false)
    expect(progress(stories)).toEqual({ passed: 1, total: 3 })
  })

  it('saves stories back to yaml round-trip', () => {
    writeFileSync(prd(), sample)
    const stories = loadPrd(prd())
    stories[0].passes = true
    savePrd(prd(), stories)
    expect(progress(loadPrd(prd()))).toEqual({ passed: 2, total: 3 })
  })

  it('rejects a malformed story (missing acceptance)', () => {
    writeFileSync(prd(), `- { id: X, title: t, priority: 1, passes: false }`)
    expect(() => loadPrd(prd())).toThrow()
  })
})

describe('PRD dependency graph', () => {
  it('accepts optional needs, area, and agent fields', () => {
    const stories = [{ id: 'A', title: 'A', priority: 1, acceptance: ['x'], passes: false, needs: [], area: 'api', agent: 'codex' as const }]
    expect(validateDependencies(stories)).toEqual([])
  })
  it('accepts the required story quality reference, candidate, and rubric contract', () => {
    writeFileSync(prd(), `
- id: A
  title: A
  priority: 1
  acceptance: [x]
  passes: false
  quality:
    reference: { name: product-brief, source: docs/brief.md, kind: file, digest: sha256:abc }
    candidate: { kind: screenshots, paths: [artifacts/home.png] }
    rubric: Screenshot matches the approved product brief
    policy: advisory
`)
    expect(loadPrd(prd())[0].quality).toMatchObject({
      reference: { name: 'product-brief', kind: 'file' },
      candidate: { kind: 'screenshots', paths: ['artifacts/home.png'] },
      policy: 'advisory',
    })
  })
  it('requires candidate paths for file evidence and a command for command evidence', () => {
    writeFileSync(prd(), `
- id: A
  title: A
  priority: 1
  acceptance: [x]
  passes: false
  quality:
    reference: { name: product-brief, source: docs/brief.md, kind: file }
    candidate: { kind: files }
    rubric: Check output
`)
    expect(() => loadPrd(prd())).toThrow()
  })
  it('diagnoses unknown, self, duplicate, and cyclic dependencies', () => {
    const base = (id: string, needs: string[] = []) => ({ id, title: id, priority: 1, acceptance: ['x'], passes: false, needs })
    expect(validateDependencies([base('A', ['missing'])]).join(' ')).toMatch(/unknown/i)
    expect(validateDependencies([base('A', ['A'])]).join(' ')).toMatch(/itself/i)
    expect(validateDependencies([base('A'), base('A')]).join(' ')).toMatch(/duplicate/i)
    expect(validateDependencies([base('A', ['B']), base('B', ['A'])]).join(' ')).toMatch(/cycle/i)
  })
})
