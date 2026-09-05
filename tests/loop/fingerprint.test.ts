import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repositoryFingerprint } from '../../src/loop/runner.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
it('detects edits to the contents of an existing untracked file', () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-fingerprint-')); roots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  writeFileSync(join(root, 'new.txt'), 'before')
  const before = repositoryFingerprint(root)
  writeFileSync(join(root, 'new.txt'), 'after')
  expect(repositoryFingerprint(root)).not.toBe(before)
})
it('refuses a missing workspace instead of returning an empty fingerprint', () => {
  expect(() => repositoryFingerprint(join(tmpdir(), 'yoke-missing-fingerprint-root-582394'))).toThrow()
})
