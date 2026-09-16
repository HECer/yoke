import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
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

function rootAlias(root: string): string {
  const container = mkdtempSync(join(tmpdir(), 'yoke-recover-alias-')); roots.push(container)
  const alias = join(container, 'project')
  symlinkSync(root, alias, 'junction')
  return alias
}
it('resumes one owned tree when controller and candidate use different root spellings', () => {
  const { root, wt } = fixture(), alias = rootAlias(root)
  prepareIsolatedWorktree(root, wt, false)
  writeFileSync(join(wt, 'unfinished.txt'), 'keep me')
  expect(() => prepareIsolatedWorktree(root, join(alias, '.yoke/worktrees/test'), true)).not.toThrow()
  expect(() => prepareIsolatedWorktree(alias, wt, true)).not.toThrow()
  expect(readFileSync(join(wt, 'unfinished.txt'), 'utf8')).toBe('keep me')
})
it('canonicalizes a mixed root spelling before creating missing worktree parents', () => {
  const { root, wt } = fixture(), alias = rootAlias(root)
  expect(existsSync(join(root, '.yoke/worktrees'))).toBe(false)
  prepareIsolatedWorktree(root, join(alias, '.yoke/worktrees/test'), false)
  expect(existsSync(join(wt, '.git'))).toBe(true)
  expect(() => prepareIsolatedWorktree(alias, wt, true)).not.toThrow()
})
it('cannot use a root alias to admit an arbitrary sibling directory', () => {
  const { root } = fixture(), alias = rootAlias(root)
  expect(() => prepareIsolatedWorktree(root, join(alias, 'outside'), false)).toThrow(/direct project worktree/)
  expect(existsSync(join(root, 'outside'))).toBe(false)
})
it('refuses a worktree-parent link redirected outside the canonical project', () => {
  const { root, wt } = fixture(), outside = mkdtempSync(join(tmpdir(), 'yoke-recover-outside-')); roots.push(outside)
  writeFileSync(join(outside, 'sentinel'), 'unchanged')
  symlinkSync(outside, join(root, '.yoke/worktrees'), 'junction')
  expect(() => prepareIsolatedWorktree(root, wt, false)).toThrow(/direct project worktree/)
  expect(existsSync(join(outside, 'test'))).toBe(false)
  expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('unchanged')
})
