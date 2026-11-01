import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { captureRepairDiff } from '../../src/quality/repair-context.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function project() { const root = mkdtempSync(join(tmpdir(), 'yoke-repair-context-')); roots.push(root); execFileSync('git', ['init', '-q'], { cwd: root }); return root }
const story = { id: 'S1', title: 'Repair scoped files', priority: 1, passes: false, acceptance: ['scope works'], writes: ['src/**'] }

it('retains staged, unstaged and new files while limiting inline context to relevant writes', () => {
  const root = project(), git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  mkdirSync(join(root, 'src'))
  for (const path of ['src/staged.ts', 'src/unstaged.ts', 'outside.ts']) writeFileSync(join(root, path), 'before\n')
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial')
  writeFileSync(join(root, 'src/staged.ts'), 'staged-change\n'); git('add', 'src/staged.ts')
  writeFileSync(join(root, 'src/unstaged.ts'), 'unstaged-change\n')
  writeFileSync(join(root, 'outside.ts'), 'outside-change\n')
  const full = 'new relevant file\n' + 'x'.repeat(12000) + '\nRETAINED_END\n'
  writeFileSync(join(root, 'src/new.ts'), full)
  writeFileSync(join(root, 'outside-new.ts'), 'outside-new-file\n')
  const result = captureRepairDiff(root, story, 1)
  expect(result.currentDiff).toContain('staged-change')
  expect(result.currentDiff).toContain('unstaged-change')
  expect(result.currentDiff).toContain('new relevant file')
  expect(result.currentDiff).not.toContain('outside-change')
  expect(result.currentDiff).not.toContain('outside-new-file')
  expect(Buffer.byteLength(result.currentDiff)).toBeLessThanOrEqual(8192)
  expect(result.diffEvidence).toMatchObject({ available: true, truncated: true })
  if (!result.diffEvidence.available) throw Error('expected retained evidence')
  const manifestPath = join(root, result.diffEvidence.artifact), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  expect(readFileSync(join(dirname(manifestPath), manifest.patch.path), 'utf8')).toContain('outside-change')
  const newFile = manifest.untracked.find((file: { path: string }) => file.path === 'src/new.ts')
  expect(readFileSync(join(dirname(manifestPath), newFile.artifact), 'utf8')).toBe(full)
  expect(manifest.untracked.map((file: { path: string }) => file.path).sort()).toEqual(['outside-new.ts', 'src/new.ts'])
})

it('retains both index and worktree changes in an unborn repository', () => {
  const root = project(); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/file.ts'), 'staged first\n')
  execFileSync('git', ['add', 'src/file.ts'], { cwd: root })
  writeFileSync(join(root, 'src/file.ts'), 'unstaged second\n')
  const result = captureRepairDiff(root, story, 1)
  expect(result.currentDiff).toContain('staged first')
  expect(result.currentDiff).toContain('unstaged second')
  expect(result.diffEvidence.available).toBe(true)
})

it.each([Buffer.from('界'.repeat(6000)), Buffer.alloc(12000, 0xff)])('keeps decoded multibyte and invalid UTF-8 previews inside the byte limit', contents => {
  const root = project(); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/new.txt'), contents)
  const result = captureRepairDiff(root, story, 1)
  expect(Buffer.byteLength(result.currentDiff)).toBeLessThanOrEqual(8192)
  expect(result.diffEvidence).toMatchObject({ available: true, truncated: true, previewBytes: Buffer.byteLength(result.currentDiff) })
})
