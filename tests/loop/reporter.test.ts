import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus, readStatus, makeReporter, noopReporter, type LoopStatus, type LoopReporter } from '../../src/loop/reporter.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-rep-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sample: LoopStatus = {
  state: 'running', phase: 'implementing', story: 'S1', storyTitle: 'First',
  iteration: 1, progress: { passed: 0, total: 2 },
  startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z',
}

describe('writeStatus / readStatus', () => {
  it('returns null when no status file exists', () => {
    expect(readStatus(dir)).toBeNull()
  })
  it('round-trips a status through .yoke/loop-status.json', () => {
    writeStatus(dir, sample)
    expect(readStatus(dir)).toEqual(sample)
  })
  it('overwrites in place and leaves no temp file behind', () => {
    writeStatus(dir, sample)
    writeStatus(dir, { ...sample, phase: 'verifying' })
    expect(readStatus(dir)?.phase).toBe('verifying')
    const leftovers = readdirSync(join(dir, '.yoke')).filter(f => f.includes('.tmp'))
    expect(leftovers).toEqual([])
  })
  it('returns null on a corrupt status file', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'loop-status.json'), '{ not json')
    expect(readStatus(dir)).toBeNull()
  })
})

const fixedNow = () => new Date('2026-06-29T10:00:00.000Z')
const prog = { passed: 0, total: 2 }

describe('makeReporter', () => {
  it('writes running state + a log line + console line on storyStart', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s) }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    const st = readStatus(dir)!
    expect(st.state).toBe('running')
    expect(st.phase).toBe('implementing')
    expect(st.story).toBe('S1')
    expect(lines.join('\n')).toContain('S1')
    const log = readFileSync(join(dir, '.yoke', 'loop.log'), 'utf8')
    expect(log).toContain('implementing')
    expect(log).toContain('S1')
  })
  it('phase() updates phase but keeps story', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.phase('verifying')
    expect(readStatus(dir)).toMatchObject({ state: 'running', phase: 'verifying', story: 'S1' })
  })
  it('blocked() records state + reason', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.blocked('verify failed')
    expect(readStatus(dir)).toMatchObject({ state: 'blocked', reason: 'verify failed' })
  })
  it('complete() records state + final progress', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.complete({ passed: 2, total: 2 })
    expect(readStatus(dir)).toMatchObject({ state: 'complete', progress: { passed: 2, total: 2 } })
  })
  it('quiet suppresses the console callback but still writes files', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s), quiet: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    expect(lines).toEqual([])
    expect(readStatus(dir)?.story).toBe('S1')
  })
})

describe('noopReporter', () => {
  it('does nothing and writes no files', () => {
    noopReporter.storyStart({ id: 'S1', title: 'x' }, 1, prog)
    noopReporter.blocked('x')
    expect(existsSync(join(dir, '.yoke', 'loop-status.json'))).toBe(false)
  })
})
