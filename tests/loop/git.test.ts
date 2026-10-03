import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { commitPaths, realGitOps, stageImplementation } from '../../src/loop/git.js'
import { acquireClaim, releaseClaim } from '../../src/loop/claims.js'

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
  it('excludes live nested worktree content from cleanliness, staging and commits without ignore rules', () => {
    const worktree = join(dir, '.yoke', 'worktrees', 'owned')
    realGitOps.addWorktree(dir, worktree)
    try {
      expect(realGitOps.isClean(dir)).toBe(true)
      writeFileSync(join(worktree, 'worker-only.txt'), 'isolated implementation')
      writeFileSync(join(dir, 'b.txt'), 'target implementation')
      stageImplementation(dir)
      expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('b.txt')
      realGitOps.commitAll(dir, 'target implementation while isolated worker exists')
      expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('b.txt')
      expect(execFileSync('git', ['ls-files', '.yoke/worktrees'], { cwd: dir, encoding: 'utf8' })).toBe('')
      expect(realGitOps.isClean(dir)).toBe(true)
    } finally { realGitOps.removeWorktree(dir, worktree) }
  })
  it('keeps the integration target clean while an actual story claim exists without ignore rules', () => {
    expect(acquireClaim(dir, 'A', 'dispatcher', { dispatcherId: 'dispatcher', ownerToken: 'owner' })).not.toBeNull()
    try { expect(realGitOps.isClean(dir)).toBe(true) }
    finally { releaseClaim(dir, 'A', 'owner') }
  })
  it.each([false, true])('never stages or commits live story claims without ignore rules (pre-staged: %s)', prestaged => {
    expect(acquireClaim(dir, 'A', 'dispatcher', { dispatcherId: 'dispatcher', ownerToken: 'owner' })).not.toBeNull()
    try {
      if (prestaged) git('add', '--', '.yoke/claims')
      writeFileSync(join(dir, 'b.txt'), 'implementation')
      stageImplementation(dir)
      expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('b.txt')
      realGitOps.commitAll(dir, 'implementation while claim is held')
      expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('b.txt')
      expect(execFileSync('git', ['ls-files', '.yoke/claims'], { cwd: dir, encoding: 'utf8' })).toBe('')
      expect(realGitOps.isClean(dir)).toBe(true)
    } finally { releaseClaim(dir, 'A', 'owner') }
  })
  it('ignores its own live lock and dashboard status without project ignore rules', () => {
    mkdirSync(join(dir, '.yoke'))
    for (const file of ['loop.lock', 'loop-status.json', 'runner.pid', 'story-durations.json']) {
      writeFileSync(join(dir, '.yoke', file), '{}')
    }
    expect(realGitOps.isClean(dir)).toBe(true)
    writeFileSync(join(dir, 'b.txt'), 'implementation')
    realGitOps.commitAll(dir, 'implementation with live status')
    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir }).toString()
    expect(committed.trim()).toBe('b.txt')
    expect(existsSync(join(dir, '.yoke', 'loop.lock'))).toBe(true)
  })

  it.each([false, true])('keeps durable attempt and failure records out of story commits (pre-staged: %s)', prestaged => {
    for (const name of ['routing-attempts', 'failure-progress']) {
      mkdirSync(join(dir, '.yoke', name), { recursive: true })
      writeFileSync(join(dir, '.yoke', name, 'record.json'), '{"cost":0.42}')
    }
    if (prestaged) git('add', '--', '.yoke')
    expect(realGitOps.isClean(dir)).toBe(true)
    writeFileSync(join(dir, 'b.txt'), 'implementation')
    realGitOps.commitAll(dir, 'implementation with durable attempt accounting')
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('b.txt')
    expect(execFileSync('git', ['ls-files', '.yoke'], { cwd: dir, encoding: 'utf8' })).toBe('')
    expect(readFileSync(join(dir, '.yoke/routing-attempts/record.json'), 'utf8')).toContain('0.42')
  })

  it('commits source when runtime directories are already gitignored', () => {
    writeFileSync(join(dir, '.gitignore'), '.yoke/events/\n.yoke/history/\n')
    for (const name of ['events', 'history']) {
      mkdirSync(join(dir, '.yoke', name), { recursive: true })
      writeFileSync(join(dir, '.yoke', name, 'record.json'), '{}')
    }
    writeFileSync(join(dir, 'b.txt'), 'implementation')
    realGitOps.commitAll(dir, 'implementation with ignored history')
    expect(realGitOps.isClean(dir)).toBe(true)
    expect(execFileSync('git', ['ls-files'], { cwd: dir }).toString()).not.toContain('.yoke/')
  })

  it('stages tracked deletions and literal filenames without expanding pathspec syntax', () => {
    rmSync(join(dir, 'a.txt'))
    writeFileSync(join(dir, '[draft] notes.txt'), 'literal filename')
    realGitOps.commitAll(dir, 'delete and add literal file')
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: dir }).toString().split('\0').filter(Boolean)
    expect(files).toEqual(['[draft] notes.txt'])
    expect(realGitOps.isClean(dir)).toBe(true)
  })

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

    expect(realGitOps.isClean(dir)).toBe(true)
    realGitOps.removeWorktree(dir, wt)
    expect(existsSync(wt)).toBe(false)
    expect(realGitOps.isClean(dir)).toBe(true)
  })
})
