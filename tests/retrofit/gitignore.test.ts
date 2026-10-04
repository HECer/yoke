import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureGitignore, YOKE_IGNORE_LINES } from '../../src/retrofit/gitignore.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-gi-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })
const gi = () => join(dir, '.gitignore')

describe('ensureGitignore', () => {
  it('ignores actual supervision files while preserving user dirtiness', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    ensureGitignore(dir)
    execFileSync('git', ['add', '.gitignore'], { cwd: dir })
    mkdirSync(join(dir, '.yoke', 'supervision'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'supervision', 'assessment.json'), '{}')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).not.toContain('supervision')
    writeFileSync(join(dir, 'user.txt'), 'user change')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toContain('user.txt')
  })
  it('diagnoses already tracked supervision without removing it from the index', () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    mkdirSync(join(dir, '.yoke', 'supervision'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'supervision', 'assessment.json'), '{}')
    execFileSync('git', ['add', '.yoke/supervision/assessment.json'], { cwd: dir })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ensureGitignore(dir)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('already tracked'))
    expect(execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' })).toContain('.yoke/supervision/assessment.json')
  })
  it('ignores provider supervision files idempotently', () => {
    ensureGitignore(dir)
    const first = readFileSync(gi(), 'utf8')
    expect(first).toContain('.yoke/supervision/')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toBe(first)
  })
  it('ignores the live change inbox', () => {
    ensureGitignore(dir)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.yoke/changes/')
  })
  it('ignores local full-output artifacts', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/artifacts/')
    ensureGitignore(dir)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.yoke/artifacts/')
  })
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
    expect(YOKE_IGNORE_LINES).toContain('.yoke/loop.lock.takeover')
    expect(YOKE_IGNORE_LINES).toContain('.yoke/loop.lock.takeover.recovery')
    expect(YOKE_IGNORE_LINES).toContain('.yoke/loop.lock.*.tmp')
    ensureGitignore(dir)
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/loop.lock')
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/loop.lock.takeover')
    expect(readFileSync(gi(), 'utf8')).toContain('.yoke/loop.lock.*.tmp')
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
  it('ensures parallel ownership records are ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/claims/')
    expect(YOKE_IGNORE_LINES).toContain('.yoke/provider-processes/')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).toContain('.yoke/claims/')
    expect(text).toContain('.yoke/provider-processes/')
  })
  it('ensures the ambiguity abort file and story duration history are ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/ambiguity.md')
    expect(YOKE_IGNORE_LINES).toContain('.yoke/story-durations.json')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).toContain('.yoke/ambiguity.md')
    expect(text).toContain('.yoke/story-durations.json')
  })
  it('ensures critical-decision request state is ignored', () => {
    expect(YOKE_IGNORE_LINES).toContain('.yoke/decision-request.yaml')
    expect(YOKE_IGNORE_LINES).toContain('.yoke/pending-decision.yaml')
    ensureGitignore(dir)
    const text = readFileSync(gi(), 'utf8')
    expect(text).toContain('.yoke/decision-request.yaml')
    expect(text).toContain('.yoke/pending-decision.yaml')
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
