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
  it('ensures the loop lock file is ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/loop.lock')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/loop.lock')
  })
  it('ensures the flow-smoke proof dir is ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/proof/')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/proof/')
  })
  it('ensures the pause control file is ignored', () => {
    // Missing from the list, the loop's own `git add -A` story commit swept
    // the pause file into history; its removal then dirtied the tree and the
    // pre-dispatch gate blocked the resume run.
    expect(YOKE_IGNORE_LINES).toContain('.yoke/loop.pause')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/loop.pause')
  })
  it('ensures the runner pid file is ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/runner.pid')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/runner.pid')
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
