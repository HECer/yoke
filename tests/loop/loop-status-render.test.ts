import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus } from '../../src/loop/reporter.js'
import { loopStatus, relativeTime } from '../../src/loop/run-command.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-ls-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'config.yaml'), 'canonVersion: "0.1.0"\nagents: [claude]\nloop:\n  enabled: true\n')
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: S1, title: t, priority: 1, acceptance: ["x"], passes: true }')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loopStatus with a status file', () => {
  it('renders state, story and reason when blocked', () => {
    writeStatus(dir, { state: 'blocked', story: 'S5', storyTitle: 'Schemas', reason: 'verify failed',
      iteration: 19, progress: { passed: 18, total: 45 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const out = loopStatus(dir)
    expect(out).toMatch(/blocked/i)
    expect(out).toContain('S5')
    expect(out).toContain('verify failed')
    expect(out).toContain('18/45')
  })
  it('falls back to enabled + PRD progress when no status file exists', () => {
    const out = loopStatus(dir)
    expect(out).toMatch(/enabled/i)
    expect(out).toMatch(/1\/1/)
  })
  it('shows a possibly-stuck hint for a running status that is overdue', () => {
    writeStatus(dir, { state: 'running', phase: 'implementing', story: 'S6', storyTitle: 'x',
      iteration: 20, progress: { passed: 19, total: 45 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const now = () => new Date('2026-06-29T11:00:00.000Z') // 1h later, > 20m
    const out = loopStatus(dir, now)
    expect(out).toMatch(/possibly stuck/i)
    expect(out).toContain('1h ago')
  })
  it('does NOT show the stuck hint for a recent running status', () => {
    writeStatus(dir, { state: 'running', phase: 'verifying', story: 'S6', storyTitle: 'x',
      iteration: 20, progress: { passed: 19, total: 45 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const now = () => new Date('2026-06-29T10:05:00.000Z') // 5m later, < 20m
    expect(loopStatus(dir, now)).not.toMatch(/possibly stuck/i)
  })
  it('shows percent and a remaining-time estimate for a running loop', () => {
    writeStatus(dir, { state: 'running', phase: 'implementing', story: 'S3', storyTitle: 'x',
      iteration: 3, progress: { passed: 2, total: 8 }, percent: 25,
      eta: { avgStoryMs: 240_000, remainingStories: 6, etaMs: 1_440_000 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const out = loopStatus(dir, () => new Date('2026-06-29T10:01:00.000Z'))
    expect(out).toContain('(25%)')
    expect(out).toContain('~24m remaining')
    expect(out).toContain('4m/story')
  })
  it('does NOT show the stuck hint for a blocked status even if old', () => {
    writeStatus(dir, { state: 'blocked', reason: 'verify failed', story: 'S5', storyTitle: 'x',
      iteration: 19, progress: { passed: 18, total: 45 },
      startedAt: '2026-06-29T10:00:00.000Z', updatedAt: '2026-06-29T10:00:00.000Z' })
    const now = () => new Date('2026-06-29T15:00:00.000Z') // 5h later
    expect(loopStatus(dir, now)).not.toMatch(/possibly stuck/i)
  })
})

describe('relativeTime', () => {
  it('formats seconds', () => {
    expect(relativeTime('2026-06-29T10:00:00.000Z', new Date('2026-06-29T10:00:30.000Z'))).toBe('30s ago')
  })
  it('formats minutes', () => {
    expect(relativeTime('2026-06-29T10:00:00.000Z', new Date('2026-06-29T10:05:00.000Z'))).toBe('5m ago')
  })
  it('formats hours', () => {
    expect(relativeTime('2026-06-29T10:00:00.000Z', new Date('2026-06-29T13:00:00.000Z'))).toBe('3h ago')
  })
  it('formats days', () => {
    expect(relativeTime('2026-06-29T10:00:00.000Z', new Date('2026-07-01T10:00:00.000Z'))).toBe('2d ago')
  })
  it('clamps negative (future) timestamps to 0s', () => {
    expect(relativeTime('2026-06-29T10:00:00.000Z', new Date('2026-06-29T09:00:00.000Z'))).toBe('0s ago')
  })
})
