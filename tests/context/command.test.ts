import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runContextInit, runContextStatus } from '../../src/context/command.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-ctxcmd-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runContextInit', () => {
  it('scaffolds the three files and is idempotent + non-destructive', () => {
    expect(runContextInit(dir)).toBe(0)
    const project = join(dir, '.yoke', 'context', 'PROJECT.md')
    writeFileSync(project, 'USER EDIT')
    expect(runContextInit(dir)).toBe(0)
    expect(readFileSync(project, 'utf8')).toBe('USER EDIT')
  })
})

describe('runContextStatus', () => {
  it('reports absence then presence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runContextStatus(dir)
    expect(log.mock.calls.flat().join('\n')).toMatch(/not initialised|no .yoke\/context/i)
    runContextInit(dir)
    log.mockClear()
    runContextStatus(dir)
    expect(log.mock.calls.flat().join('\n')).toContain('PROJECT.md')
    log.mockRestore()
  })
})
