import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { readReviewVerdict, reviewVerdictPath } from '../../src/review/verdict.js'

describe('structured review verdicts', () => {
  it('reads approval and findings, then cleans up the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify({ approved: true, summary: 'sound', findings: [{ severity: 'info', message: 'covered' }] }))
    expect(readReviewVerdict(path)).toEqual({ approved: true, summary: 'sound', findings: [{ severity: 'info', message: 'covered' }] })
    expect(existsSync(path)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a rejecting verdict with a blocking finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-verdict-'))
    const path = reviewVerdictPath(dir)
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(path, JSON.stringify({ approved: false, summary: 'bug', findings: [{ severity: 'blocking', message: 'null crash', file: 'src/a.ts', line: 4 }] }))
    expect(readReviewVerdict(path).approved).toBe(false)
    rmSync(dir, { recursive: true, force: true })
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
