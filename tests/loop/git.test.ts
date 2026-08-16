import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { commitPaths, realGitOps } from '../../src/loop/git.js'

let dir: string
function git(...args: string[]) { execFileSync('git', args, { cwd: dir, stdio: 'pipe' }) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-git-'))
  git('init', '-q')
  git('config', 'user.email', 'test@yoke.local')
  git('config', 'user.name', 'Yoke Test')
  writeFileSync(join(dir, 'a.txt'), 'hello')
  git('add', '-A'); git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('realGitOps', () => {
  it('isClean is true on a committed tree', () => {
    expect(realGitOps.isClean(dir)).toBe(true)
  })

  it('isClean is false with uncommitted changes', () => {
    writeFileSync(join(dir, 'b.txt'), 'new')
    expect(realGitOps.isClean(dir)).toBe(false)
  })

  it('commitAll stages and commits, leaving a clean tree', () => {
    writeFileSync(join(dir, 'b.txt'), 'new')
    realGitOps.commitAll(dir, 'yoke: test commit')
    expect(realGitOps.isClean(dir)).toBe(true)
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir }).toString()
    expect(log).toContain('yoke: test commit')
  })

  it('treats local output artifacts as runtime state in upgraded projects', () => {
    mkdirSync(join(dir, '.yoke', 'artifacts', 'S1'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'artifacts', 'S1', 'verify-secret.log'), 'secret output')

    expect(realGitOps.isClean(dir)).toBe(true)
  })

  it('never stages output artifacts in story commits', () => {
    mkdirSync(join(dir, '.yoke', 'artifacts', 'S1'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'artifacts', 'S1', 'verify-secret.log'), 'secret output')
    writeFileSync(join(dir, 'b.txt'), 'safe change')

    realGitOps.commitAll(dir, 'yoke: safe commit')

    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir }).toString()
    expect(committed).toContain('b.txt')
    expect(committed).not.toContain('.yoke/artifacts')
    expect(realGitOps.isClean(dir)).toBe(true)
  })

  it('unstages pre-staged output artifacts before a story commit', () => {
    mkdirSync(join(dir, '.yoke', 'artifacts', 'S1'), { recursive: true })
    const artifact = join('.yoke', 'artifacts', 'S1', 'verify-secret.log')
    writeFileSync(join(dir, artifact), 'secret output')
    git('add', '-f', '--', artifact)
    writeFileSync(join(dir, 'b.txt'), 'safe change')

    realGitOps.commitAll(dir, 'yoke: safe staged commit')

    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir }).toString()
    expect(committed).toContain('b.txt')
    expect(committed).not.toContain('.yoke/artifacts')
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString()).not.toContain('.yoke/artifacts')
  })

  it('enforces the supplied author and committer and strips AI co-author trailers by default', () => {
    writeFileSync(join(dir, 'owned.txt'), 'human owned')
    realGitOps.commitAll(dir, 'feat: owned\n\nCo-Authored-By: Claude <noreply@anthropic.com>', {
      authorName: 'HECer', authorEmail: 'hec_er@web.de', allowCoAuthors: false,
    })
    const meta = execFileSync('git', ['log', '-1', '--format=%an|%ae|%cn|%ce%n%B'], { cwd: dir }).toString()
    expect(meta).toContain('HECer|hec_er@web.de|HECer|hec_er@web.de')
    expect(meta).not.toContain('Co-Authored-By:')
  })

  it('commitAll throws when there is nothing to commit', () => {
    expect(() => realGitOps.commitAll(dir, 'yoke: empty commit')).toThrow(/nothing to commit/)
  })

  it('commitPaths commits only the named file and leaves concurrent changes untouched', () => {
    writeFileSync(join(dir, 'decision.md'), 'approved')
    writeFileSync(join(dir, 'unrelated.txt'), 'editor change')
    commitPaths(dir, ['decision.md'], 'yoke: decision')
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir }).toString().trim()).toBe('decision.md')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toContain('unrelated.txt')
  })

  it('addWorktree creates a working copy, integrate brings its commit back, removeWorktree cleans up', () => {
    const wt = join(dir, '.yoke', 'worktrees', 'S1')
    realGitOps.addWorktree(dir, wt)
    expect(existsSync(join(wt, 'a.txt'))).toBe(true)        // checked out from HEAD

    // make + commit a change inside the worktree
    writeFileSync(join(wt, 'a.txt'), 'changed in worktree')
    realGitOps.commitAll(wt, 'yoke: worktree change')

    // integrate fast-forwards the main repo to the worktree commit
    realGitOps.integrate(dir, wt)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('changed in worktree')

    // removeWorktree must happen before isClean: on Windows the worktree dir at
    // .yoke/worktrees/S1 shows as an untracked path until it is removed.
    realGitOps.removeWorktree(dir, wt)
    expect(existsSync(wt)).toBe(false)
    expect(realGitOps.isClean(dir)).toBe(true)
  })
})
