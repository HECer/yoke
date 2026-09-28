import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runPrdExplore } from '../../src/prd/explore.js'
import { loadPrd } from '../../src/loop/prd.js'
import { realGitOps } from '../../src/loop/git.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-explore-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), [
    '- id: BASE',
    '  title: Baseline',
    '  priority: 1',
    '  acceptance: ["baseline is verified"]',
    '  passes: true',
    '',
  ].join('\n'))
  writeFileSync(join(dir, '.yoke', 'plan.md'), 'Improve the existing project safely.\n')
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const value = 1\n')
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Yoke Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'yoke-test@example.invalid'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '--all'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' })
})

afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function plannedOutput(): string {
  return `YOKE_EXPLORATION\n${JSON.stringify({
    decision: 'add',
    summary: 'Add a small behavior improvement supported by source evidence.',
    tasks: [{
      title: 'Expose the app value',
      rationale: 'The source currently exposes no named behavior contract.',
      expectedBenefit: 'Callers can read a stable, testable value.',
      confidence: 0.9,
      risk: 'low',
      evidence: [{ path: 'src/app.ts', observation: 'The module exports one fixed value.' }],
      writes: ['src/app.ts'],
      acceptance: [
        { id: 'VALUE-EXPORT', text: 'The app value is exported.', verify: ['npm test -- -t VALUE-EXPORT'] },
        { id: 'VALUE-STABLE', text: 'The exported value remains stable.', verify: ['npm test -- -t VALUE-STABLE'] },
      ],
    }],
  })}`
}

describe('continuous exploration planning', () => {
  it('validates, appends and commits an evidence-backed task before implementation', () => {
    const run = vi.fn(() => ({ success: true, summary: 'planned', output: plannedOutput() }))
    const result = runPrdExplore(dir, { runner: 'codex', isAvailable: () => true, run, onUsage: () => {} })

    expect(result.kind).toBe('added')
    if (result.kind !== 'added') return
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({ id: expect.stringMatching(/^AUTO-[A-F0-9]{12}$/u), passes: false })
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))).toHaveLength(2)
    expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir }).toString()).toContain('yoke: explore AUTO-')
    expect(realGitOps.isClean(dir)).toBe(true)
  }, 30_000)

  it('discards malformed proposals without changing or committing the PRD', () => {
    const before = loadPrd(join(dir, '.yoke', 'prd.yaml'))
    const run = vi.fn(() => ({ success: true, summary: 'malformed', output: 'YOKE_EXPLORATION {"decision":"add","summary":"empty","tasks":[]}' }))
    const result = runPrdExplore(dir, { runner: 'codex', isAvailable: () => true, run, onUsage: () => {} })

    expect(result.kind).toBe('retry')
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))).toEqual(before)
    expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir }).toString().trim()).toBe('fixture')
    expect(realGitOps.isClean(dir)).toBe(true)
  })

  it('honors a pause before invoking the planner', () => {
    const run = vi.fn()
    const result = runPrdExplore(dir, { runner: 'codex', isAvailable: () => true, run, pause: () => true, onUsage: () => {} })

    expect(result).toEqual({ kind: 'paused' })
    expect(run).not.toHaveBeenCalled()
    expect(realGitOps.isClean(dir)).toBe(true)
  })
})
