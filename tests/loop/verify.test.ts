import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { commandVerifier, commandsVerifier, retryingVerifier, type Verifier, type VerifyResult } from '../../src/loop/verify.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-verify-')) })
afterEach(async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
})

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

  it('keeps a small mixed-stream failure inline without writing an artifact', () => {
    writeFileSync(join(dir, 'small.js'), "console.log('EARLY_ERROR: broken'); console.error('Tests: 1 failed, 2 passed'); process.exit(1)")
    const result = commandVerifier('node small.js', {
      phase: 'verify',
      policy: { previewBytes: 512, artifactThresholdBytes: 8_192 },
    })(dir)

    expect(result.summary).toContain('EARLY_ERROR')
    expect(result.summary).toContain('Tests: 1 failed, 2 passed')
    expect(existsSync(join(dir, '.yoke', 'artifacts'))).toBe(false)
  })

  it('stores a large mixed-stream failure and returns a bounded reference', () => {
    writeFileSync(join(dir, 'large.js'), [
      "console.log('EARLY_ERROR: actionable')",
      "for (let i = 0; i < 100; i++) console.log('repeated progress ' + i)",
      "console.error('Tests: 1 failed, 99 passed')",
      'process.exit(1)',
    ].join(';'))
    const result = commandVerifier('node large.js', {
      phase: 'verify',
      policy: { previewBytes: 256, artifactThresholdBytes: 512 },
    })(dir)

    expect(result.summary).toContain('EARLY_ERROR')
    expect(result.summary).toContain('Tests: 1 failed, 99 passed')
    const relativePath = result.summary.match(/\[full output: ([^|]+) \|/)?.[1].trim()
    expect(relativePath).toBeTruthy()
    const raw = readFileSync(join(dir, ...relativePath!.split('/')), 'utf8')
    expect(raw).toContain('=== stdout ===')
    expect(raw).toContain('EARLY_ERROR: actionable')
    expect(raw).toContain('=== stderr ===')
    expect(raw).toContain('Tests: 1 failed, 99 passed')
  })

  it('does not persist successful command output', () => {
    writeFileSync(join(dir, 'success.js'), "console.log('x'.repeat(2000))")
    const result = commandVerifier('node success.js', {
      phase: 'verify',
      policy: { previewBytes: 128, artifactThresholdBytes: 256 },
    })(dir)
    expect(result).toEqual({ passed: true, summary: 'verify passed: node success.js' })
    expect(existsSync(join(dir, '.yoke', 'artifacts'))).toBe(false)
  })

  it('does not misclassify successful output larger than the default child-process buffer', () => {
    writeFileSync(join(dir, 'large-success.js'), "process.stdout.write('x'.repeat(2_000_000))")

    const result = commandVerifier('node large-success.js')(dir)

    expect(result).toEqual({ passed: true, summary: 'verify passed: node large-success.js' })
    expect(existsSync(join(dir, '.yoke', 'artifacts'))).toBe(false)
  })

  it('preserves complete failure output larger than the default child-process buffer', () => {
    writeFileSync(join(dir, 'large-failure.js'), [
      "process.stdout.write('x'.repeat(2_000_000))",
      "console.error('FINAL_FAILURE_MARKER')",
      'process.exit(1)',
    ].join(';'))

    const result = commandVerifier('node large-failure.js', {
      phase: 'verify',
      policy: { previewBytes: 256, artifactThresholdBytes: 1_024 },
    })(dir)

    expect(result.passed).toBe(false)
    const relativePath = result.summary.match(/\[full output: ([^|]+) \|/)?.[1].trim()
    expect(relativePath).toBeTruthy()
    const raw = readFileSync(join(dir, ...relativePath!.split('/')), 'utf8')
    expect(raw).toContain('FINAL_FAILURE_MARKER')
    expect(Buffer.byteLength(raw)).toBeGreaterThan(2_000_000)
  })

  it('fails closed and labels output that exceeds the bounded capture quota', () => {
    writeFileSync(join(dir, 'capture-overflow.js'), "process.stdout.write('x'.repeat(20_000_000))")

    const result = commandVerifier('node capture-overflow.js', {
      phase: 'verify',
      policy: { previewBytes: 256, artifactThresholdBytes: 1_024 },
    })(dir)

    expect(result.passed).toBe(false)
    expect(result.summary).toContain('capture limit exceeded')
    expect(result.summary).toContain('[truncated output:')
    expect(result.summary).not.toContain('[full output:')
  })

  it('labels timeouts while retaining their bounded failure result', async () => {
    writeFileSync(join(dir, 'hang.js'), 'setTimeout(() => process.exit(0), 80)')
    const result = commandVerifier('node hang.js', { phase: 'verify', timeoutMs: 30 })(dir)
    expect(result.passed).toBe(false)
    expect(result.summary).toMatch(/timed out/i)
  })

  it('retains the preview when artifact persistence fails', () => {
    writeFileSync(join(dir, 'writer-failure.js'), "console.error('FATAL: keep me' + 'x'.repeat(1000)); process.exit(1)")
    const result = commandVerifier('node writer-failure.js', {
      phase: 'verify',
      policy: { previewBytes: 128, artifactThresholdBytes: 64 },
      artifactWriter: () => { throw new Error('disk unavailable') },
    })(dir)
    expect(result.passed).toBe(false)
    expect(result.summary).toContain('FATAL: keep me')
    expect(result.summary).toContain('artifact unavailable: disk unavailable')
  })
})

describe('commandsVerifier', () => {
  it('runs every criterion command and reports the first failure', () => {
    writeFileSync(join(dir, 'fail.js'), "console.error('CRITERION_FAILED'); process.exit(1)")
    const result = commandsVerifier([
      'node -e "process.exit(0)"',
      'node fail.js',
      'node -e "process.exit(0)"',
    ])(dir)
    expect(result.passed).toBe(false)
    expect(result.summary).toContain('CRITERION_FAILED')
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
