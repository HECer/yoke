import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertSafePath, createSnapshot } from '../../src/code-intelligence/snapshots.js'

function project(): string { const root = mkdtempSync(join(tmpdir(), 'yoke-ci-snapshot-')); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'main.ts'), 'export const value = 1\n'); return root }

describe('code intelligence snapshots', () => {
  it('hashes current file bytes and notices edits, including non-ASCII text', () => {
    const root = project(); const before = createSnapshot(root); writeFileSync(join(root, 'src', 'main.ts'), 'export const value = "Ä"\r\n'); const after = createSnapshot(root)
    expect(after.snapshot_id).not.toBe(before.snapshot_id); expect(after.files.find(file => file.path === 'src/main.ts')?.size).toBeGreaterThan(0)
  })

  it('rejects traversal, sensitive files and symlinks', () => {
    const root = project(); writeFileSync(join(root, '.env'), 'SECRET=do-not-index'); const outside = join(tmpdir(), 'yoke-ci-outside.txt'); writeFileSync(outside, 'outside'); symlinkSync(outside, join(root, 'src', 'link.ts'))
    expect(() => assertSafePath(root, '../outside')).toThrow(); expect(() => assertSafePath(root, '.env')).toThrow(); expect(() => assertSafePath(root, 'src/link.ts')).toThrow()
    expect(createSnapshot(root).files.some(file => file.path.includes('.env') || file.path.includes('link.ts'))).toBe(false)
  })
})
