import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commandVerifier } from '../../src/loop/verify.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-verify-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('commandVerifier', () => {
  it('passes when the command exits 0', () => {
    const r = commandVerifier('node -e "process.exit(0)"')(dir)
    expect(r.passed).toBe(true)
  })

  it('fails when the command exits non-zero', () => {
    const r = commandVerifier('node -e "process.exit(1)"')(dir)
    expect(r.passed).toBe(false)
    expect(r.summary).toMatch(/verify failed/i)
  })

  it('includes the failing command output in the summary', () => {
    // Write a tiny script that prints a marker to stderr and exits 1, so the
    // assertion is deterministic across platforms (no fiddly inline quoting).
    writeFileSync(join(dir, 'boom.js'), "console.error('BOOM_MARKER'); process.exit(1)")
    const r = commandVerifier('node boom.js')(dir)
    expect(r.passed).toBe(false)
    expect(r.summary).toContain('BOOM_MARKER')
  })
})
