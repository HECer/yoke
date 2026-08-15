import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { readReviewVerdict, reviewVerdictPath, selectRepairFinding } from '../../src/review/verdict.js'

const provenance = { provider: 'codex', model: 'test-model', role: 'review', promptVersion: 1, permissions: 'safe' } as const
const verdict = (approved: boolean, summary: string, findings: readonly Record<string, unknown>[]) => ({
  schemaVersion: 1 as const,
  approved,
  summary,
  findings,
  provenance,
})

describe('structured review verdicts', () => {
  it('reads approval and findings, then cleans up the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify(verdict(true, 'sound', [{ severity: 'info', message: 'covered' }])))
    expect(readReviewVerdict(path)).toEqual(verdict(true, 'sound', [{ severity: 'info', message: 'covered' }]))
    expect(existsSync(path)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a rejecting verdict with a blocking finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify(verdict(false, 'bug', [{ severity: 'blocking', message: 'null crash', file: 'src/a.ts', line: 4 }])))
    expect(readReviewVerdict(path).approved).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps legacy verdicts valid while accepting actionable evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify(verdict(false, 'repair needed', [{ id: 'missing-boundary-guard', severity: 'blocking', message: 'missing guard', actionable: true, suggestedFix: 'guard the boundary', evidence: ['src/auth.ts:20'] }])))
    expect(readReviewVerdict(path).findings[0]).toMatchObject({ id: 'missing-boundary-guard', actionable: true, evidence: ['src/auth.ts:20'] })
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not treat the removed references field as review evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify(verdict(false, 'repair needed', [{ severity: 'blocking', message: 'missing guard', references: ['src/auth.ts:20'] }])))
    expect(readReviewVerdict(path).findings[0]).not.toHaveProperty('references')
    rmSync(dir, { recursive: true, force: true })
  })

  it('selects the highest-severity actionable repair finding while preserving finding order on ties', () => {
    const finding = selectRepairFinding(verdict(false, 'repair needed', [
      { severity: 'warning', message: 'first warning', actionable: true },
      { severity: 'blocking', message: 'blocked but deferred', actionable: false },
      { severity: 'blocking', message: 'first blocking repair', actionable: true },
      { severity: 'blocking', message: 'second blocking repair', actionable: true },
    ]))
    expect(finding?.message).toBe('first blocking repair')
  })

  it('treats legacy blocking findings as repairable and returns null without a repairable finding', () => {
    expect(selectRepairFinding(verdict(false, 'legacy', [{ severity: 'blocking', message: 'legacy blocker' }]))?.message)
      .toBe('legacy blocker')
    expect(selectRepairFinding(verdict(true, 'clean', [{ severity: 'info', message: 'note', actionable: true }]))).toBeNull()
  })

  it('rejects malformed JSON and missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, '{ nope')
    expect(() => readReviewVerdict(path)).toThrow(/malformed/i)
    expect(existsSync(path)).toBe(false)
    expect(() => readReviewVerdict(path)).toThrow(/missing/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects invalid fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify({ approved: 'yes', summary: '', findings: [] }))
    expect(() => readReviewVerdict(path)).toThrow(/invalid/i)
    rmSync(dir, { recursive: true, force: true })
  })
})
