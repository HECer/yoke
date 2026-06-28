import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadContext, formatForPrompt, contextDir, appendDecision } from '../../src/context/context.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-ctx-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('contextDir', () => {
  it('resolves under .yoke/context', () => {
    expect(contextDir('/proj')).toBe(join('/proj', '.yoke', 'context'))
  })
})

describe('loadContext', () => {
  it('returns empty strings when no files exist', () => {
    expect(loadContext(dir)).toEqual({ project: '', decisions: '', knowledge: '' })
  })
  it('reads each file that is present', () => {
    writeFileSync(join(dir, 'PROJECT.md'), 'goal')
    writeFileSync(join(dir, 'KNOWLEDGE.md'), 'gotcha')
    const ctx = loadContext(dir)
    expect(ctx.project).toBe('goal')
    expect(ctx.knowledge).toBe('gotcha')
    expect(ctx.decisions).toBe('')
  })
})

describe('formatForPrompt', () => {
  it('returns empty string when all files are empty', () => {
    expect(formatForPrompt({ project: '', decisions: '', knowledge: '' })).toBe('')
  })
  it('includes a header and only the non-empty sections', () => {
    const out = formatForPrompt({ project: 'GOAL', decisions: '', knowledge: 'GOTCHA' })
    expect(out).toContain('Project context')
    expect(out).toContain('GOAL')
    expect(out).toContain('GOTCHA')
    expect(out).not.toContain('Recent decisions')
  })
  it('head-bounds PROJECT and tail-bounds DECISIONS', () => {
    const project = 'P'.repeat(50) + 'TAILP'
    const decisions = 'HEADD' + 'D'.repeat(50)
    const out = formatForPrompt({ project, decisions, knowledge: '' }, 10)
    expect(out).toContain('PPPPPPPPPP')
    expect(out).not.toContain('TAILP')
    expect(out).toContain('DDDDDDDDDD')
    expect(out).not.toContain('HEADD')
    expect(out).toContain('truncated')
  })
})

describe('appendDecision', () => {
  const entry = { storyId: 'S1', title: 'First story', summary: 'did the thing' }
  const fixedDate = new Date('2026-06-28T12:00:00Z')

  it('creates DECISIONS.md when absent and writes a dated heading', () => {
    appendDecision(dir, entry, fixedDate)
    const text = readFileSync(join(dir, 'DECISIONS.md'), 'utf8')
    expect(text).toContain('## 2026-06-28 — S1: First story')
    expect(text).toContain('did the thing')
  })
  it('appends to existing content without clobbering it', () => {
    writeFileSync(join(dir, 'DECISIONS.md'), '# Decisions\n\nold entry\n')
    appendDecision(dir, entry, fixedDate)
    const text = readFileSync(join(dir, 'DECISIONS.md'), 'utf8')
    expect(text).toContain('old entry')
    expect(text.indexOf('old entry')).toBeLessThan(text.indexOf('S1'))
  })
  it('rollback restores prior content', () => {
    writeFileSync(join(dir, 'DECISIONS.md'), 'PRIOR\n')
    const { rollback } = appendDecision(dir, entry, fixedDate)
    rollback()
    expect(readFileSync(join(dir, 'DECISIONS.md'), 'utf8')).toBe('PRIOR\n')
  })
  it('rollback removes the file when it did not exist before', () => {
    const { rollback } = appendDecision(dir, entry, fixedDate)
    rollback()
    expect(existsSync(join(dir, 'DECISIONS.md'))).toBe(false)
  })
})
