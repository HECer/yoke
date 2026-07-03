import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { statSync } from 'node:fs'
import { writeStatus, readStatus, makeReporter, noopReporter, appendLog, type LoopStatus, type LoopReporter } from '../../src/loop/reporter.js'

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
  it('paused() records state paused and a "paused" log label', () => {
    const r = makeReporter(dir, { log: () => {} }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.paused({ passed: 1, total: 2 })
    expect(readStatus(dir)).toMatchObject({ state: 'paused', progress: { passed: 1, total: 2 } })
    expect(readStatus(dir)?.phase).toBeUndefined()
    const log = readFileSync(join(dir, '.yoke', 'loop.log'), 'utf8')
    expect(log).toMatch(/paused/)
  })
  it('quiet suppresses the console callback but still writes files', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s), quiet: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    expect(lines).toEqual([])
    expect(readStatus(dir)?.story).toBe('S1')
  })
})

describe('makeReporter json mode', () => {
  it('emits exactly one JSON line per transition instead of the narrative', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s), json: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.phase('verifying')
    r.complete({ passed: 2, total: 2 })
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line).not.toContain('\n')          // one event = one line
      expect(JSON.parse(line).type).toBe('status')
    }
    expect(JSON.parse(lines[0])).toMatchObject({
      type: 'status', state: 'running', phase: 'implementing', story: 'S1',
      iteration: 1, progress: { passed: 0, total: 2 },
    })
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'status', phase: 'verifying' })
    expect(JSON.parse(lines[2])).toMatchObject({ type: 'status', state: 'complete', progress: { passed: 2, total: 2 } })
  })
  it('emits a JSON line for blocked with the reason', () => {
    const lines: string[] = []
    const r = makeReporter(dir, { log: (s) => lines.push(s), json: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    r.blocked('verify failed')
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'status', state: 'blocked', reason: 'verify failed' })
  })
  it('still writes the status file and log in json mode', () => {
    const r = makeReporter(dir, { log: () => {}, json: true }, fixedNow)
    r.storyStart({ id: 'S1', title: 'First' }, 1, prog)
    expect(readStatus(dir)).toMatchObject({ state: 'running', story: 'S1' })
    expect(readFileSync(join(dir, '.yoke', 'loop.log'), 'utf8')).toContain('implementing')
  })
})

describe('noopReporter', () => {
  it('does nothing and writes no files', () => {
    noopReporter.storyStart({ id: 'S1', title: 'x' }, 1, prog)
    noopReporter.blocked('x')
    expect(existsSync(join(dir, '.yoke', 'loop-status.json'))).toBe(false)
  })
})

describe('appendLog cap', () => {
  it('keeps the log bounded and retains the most recent lines', () => {
    const file = join(dir, '.yoke', 'loop.log')
    const cap = 2000 // small cap for the test
    for (let i = 0; i < 500; i++) appendLog(dir, `line ${i} ${'x'.repeat(40)}`, cap)
    const size = statSync(file).size
    expect(size).toBeLessThanOrEqual(cap + 200) // bounded (allow the truncation header)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('line 499')          // most recent retained
    expect(text).not.toContain('line 0 ')        // oldest dropped
    expect(text).toMatch(/truncated/i)           // a marker is left
  })
  it('creates the file and appends a single line under the cap', () => {
    const file = join(dir, '.yoke', 'loop.log')
    appendLog(dir, 'first line', 100000)
    expect(readFileSync(file, 'utf8')).toBe('first line\n')
  })
})
