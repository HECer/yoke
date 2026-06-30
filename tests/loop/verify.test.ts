import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commandVerifier, retryingVerifier, type Verifier, type VerifyResult } from '../../src/loop/verify.js'

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

function stub(results: VerifyResult[]): Verifier {
  let i = 0
  return () => results[Math.min(i++, results.length - 1)]
}
const ok: VerifyResult = { passed: true, summary: 'green' }
const bad: VerifyResult = { passed: false, summary: 'red' }

describe('retryingVerifier', () => {
  it('passes immediately without retrying when the inner verifier passes', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return ok }
    expect(retryingVerifier(inner, 2)('/d').passed).toBe(true)
    expect(calls).toBe(1)
  })
  it('passes on a retry when the inner fails then passes', () => {
    const r = retryingVerifier(stub([bad, ok]), 2)('/d')
    expect(r.passed).toBe(true)
    expect(r.summary).toMatch(/retry 1/i)
  })
  it('fails after exhausting the retries', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return bad }
    const r = retryingVerifier(inner, 2)('/d')
    expect(r.passed).toBe(false)
    expect(calls).toBe(3)
    expect(r.summary).toMatch(/after 2 retr/i)
  })
  it('retries:0 is a single shot', () => {
    let calls = 0
    const inner: Verifier = () => { calls++; return bad }
    expect(retryingVerifier(inner, 0)('/d').passed).toBe(false)
    expect(calls).toBe(1)
  })
})
