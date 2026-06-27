import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { realGitOps } from '../../src/loop/git.js'

let dir: string
function git(...args: string[]) { execFileSync('git', args, { cwd: dir, stdio: 'pipe' }) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-git-'))
  git('init', '-q')
  git('config', 'user.email', 'test@forge.local')
  git('config', 'user.name', 'Forge Test')
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
    realGitOps.commitAll(dir, 'forge: test commit')
    expect(realGitOps.isClean(dir)).toBe(true)
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir }).toString()
    expect(log).toContain('forge: test commit')
  })

  it('commitAll throws when there is nothing to commit', () => {
    expect(() => realGitOps.commitAll(dir, 'forge: empty commit')).toThrow(/nothing to commit/)
  })
})
