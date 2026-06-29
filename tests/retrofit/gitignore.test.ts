import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureGitignore, YOKE_IGNORE_LINES } from '../../src/retrofit/gitignore.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-gi-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const gi = () => join(dir, '.gitignore')

describe('ensureGitignore', () => {
  it('creates .gitignore with the managed block when absent', () => {
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    for (const line of YOKE_IGNORE_LINES) expect(text).toContain(line)
  })
  it('appends the block without disturbing existing content', () => {
    writeFileSync(gi(), 'node_modules/\n')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).toContain('node_modules/')
    expect(text).toContain('.yoke/loop-status.json')
  })
  it('is idempotent — a second run adds nothing', () => {
    ensureGitignore(dir)
    const first = readFileSync(gi(), 'utf8')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toBe(first)
  })
  it('does not re-add a line that already exists individually', () => {
    writeFileSync(gi(), '.yoke/backup/\n')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text.match(/\.yoke\/backup\//g)?.length).toBe(1)
  })
  it('appends cleanly when the existing file has no trailing newline (no glued lines)', () => {
    writeFileSync(gi(), 'node_modules/') // no trailing newline — the load-bearing prefix branch
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).not.toContain('node_modules/#')          // not glued to the managed header
    expect(text).toMatch(/node_modules\/\r?\n/)            // its own line preserved
    expect(text).toContain('.yoke/loop.log')
  })
})
