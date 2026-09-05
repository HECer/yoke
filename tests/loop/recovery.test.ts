import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareIsolatedWorktree } from '../../src/loop/recovery.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'yoke-recover-')); roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  mkdirSync(join(root, '.yoke')); writeFileSync(join(root, '.yoke', 'prd.yaml'), '[]')
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'seed')
  return { root, wt: join(root, '.yoke', 'worktrees', 'test'), git }
}
it('resumes a registered tree without discarding its unfinished changes', () => {
  const { root, wt } = fixture()
  prepareIsolatedWorktree(root, wt, false)
  writeFileSync(join(wt, 'unfinished.txt'), 'keep me')
  expect(() => prepareIsolatedWorktree(root, wt, false)).toThrow(/resume/i)
  prepareIsolatedWorktree(root, wt, true)
  expect(readFileSync(join(wt, 'unfinished.txt'), 'utf8')).toBe('keep me')
})
it('refuses stale recovery when the target commit changed', () => {
  const { root, wt, git } = fixture()
  prepareIsolatedWorktree(root, wt, false)
  writeFileSync(join(root, 'new.txt'), 'new'); git('add', 'new.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'new')
  expect(() => prepareIsolatedWorktree(root, wt, true)).toThrow(/changed|stale/i)
})
it('refuses recovery of an arbitrary directory', () => {
  const { root } = fixture()
  expect(() => prepareIsolatedWorktree(root, join(root, 'outside'), true)).toThrow(/path|worktree/i)
})
