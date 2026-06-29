import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus, readStatus, type LoopStatus } from '../../src/loop/reporter.js'

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
