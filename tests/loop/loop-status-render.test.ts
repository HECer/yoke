import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeStatus } from '../../src/loop/reporter.js'
import { loopStatus } from '../../src/loop/run-command.js'

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
})
