import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadContext, formatForPrompt, contextDir } from '../../src/context/context.js'

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
