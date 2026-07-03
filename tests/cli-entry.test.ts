import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { isMainEntry } from '../src/cli.js'

let dir: string
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'yoke-entry-'))) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('isMainEntry', () => {
  it('true when argv[1] is the module path itself', () => {
    const file = join(dir, 'cli.js')
    writeFileSync(file, '')
    expect(isMainEntry(file, pathToFileURL(file).href)).toBe(true)
  })

  it('true when argv[1] reaches the module through a symlinked directory (global npm install)', () => {
    // npm install -g from a local dir symlinks node_modules/yoke -> the repo.
    // Node realpaths the ESM entry for import.meta.url but argv[1] keeps the
    // symlinked path — the guard must realpath argv[1] before comparing, or the
    // globally installed CLI silently exits 0 without running main.
    const real = join(dir, 'repo')
    mkdirSync(join(real, 'dist'), { recursive: true })
    const file = join(real, 'dist', 'cli.js')
    writeFileSync(file, '')
    const link = join(dir, 'linked')
    symlinkSync(real, link, 'junction')
    const argv1 = join(link, 'dist', 'cli.js')
    expect(isMainEntry(argv1, pathToFileURL(file).href)).toBe(true)
  })

  it('false for a different file', () => {
    const a = join(dir, 'a.js')
    const b = join(dir, 'b.js')
    writeFileSync(a, '')
    writeFileSync(b, '')
    expect(isMainEntry(a, pathToFileURL(b).href)).toBe(false)
  })

  it('false when argv[1] is undefined (embedded/eval contexts)', () => {
    expect(isMainEntry(undefined, pathToFileURL(join(dir, 'x.js')).href)).toBe(false)
  })

  it('does not throw on a nonexistent argv[1] — falls back to a literal compare', () => {
    const ghost = join(dir, 'nope', 'cli.js')
    expect(isMainEntry(ghost, pathToFileURL(ghost).href)).toBe(true)
    expect(isMainEntry(ghost, pathToFileURL(join(dir, 'other.js')).href)).toBe(false)
  })
})
