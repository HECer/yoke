import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrd, savePrd, selectNextStory, allPass, progress } from '../../src/loop/prd.js'

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
