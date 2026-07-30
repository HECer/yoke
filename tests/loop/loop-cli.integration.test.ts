import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { setLoopEnabled, loopStatus } from '../../src/loop/run-command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { loadConfig } from '../../src/retrofit/config.js'
import { loadPrd } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'
import type { Verifier } from '../../src/loop/verify.js'
import { readDecisionResume } from '../../src/loop/decision.js'

let dir: string
const cfg = () => ({ canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } })
const stubGit: GitOps = {
  isClean: () => true,
  commitAll: () => {},
  addWorktree: () => {},
  removeWorktree: () => {},
  integrate: () => {},
}
const passRunner: AgentRunner = () => ({ success: true, summary: 'ok' })
const verifyOk: Verifier = () => ({ passed: true, summary: 'ok' })
const reviewReject: AgentRunner = () => ({ success: false, summary: 'nope' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-loopcli-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'),
    `- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('yoke loop CLI', () => {
  it('rejects unsupported parallel CLI workers instead of silently running serially', () => {
    expect(runLoopCommand(dir, { maxIterations: 1, parallel: 2 })).toBe(2)
  })
  it('setLoopEnabled on/off updates the config', () => {
    saveConfig(dir, cfg())
    setLoopEnabled(dir, false)
    expect(loadConfig(dir)!.loop.enabled).toBe(false)
    setLoopEnabled(dir, true)
    expect(loadConfig(dir)!.loop.enabled).toBe(true)
  })

  it('setLoopEnabled preserves timeout and decision policy', () => {
    saveConfig(dir, { ...cfg(), loop: { enabled: true, timeoutMinutes: 30, decisionPolicy: 'critical' } })
    setLoopEnabled(dir, false)
    expect(loadConfig(dir)?.loop).toEqual({ enabled: false, timeoutMinutes: 30, decisionPolicy: 'critical' })
  })

  it('loopStatus reports enabled state and progress', () => {
    saveConfig(dir, cfg())
    const out = loopStatus(dir)
    expect(out).toMatch(/enabled/i)
    expect(out).toContain('0/1')
  })

  it('run refuses when the loop is disabled', () => {
    saveConfig(dir, { ...cfg(), loop: { enabled: false } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('run refuses to dispatch while a critical decision is still pending', () => {
    saveConfig(dir, cfg())
    writeFileSync(join(dir, '.yoke', 'pending-decision.yaml'), [
      'version: 1', 'storyId: S1', 'question: Which identity model?', 'reason: Public API choice.',
      'options:', '  - { id: A, label: Accounts }', '  - { id: B, label: Profiles }',
      'recommended: A', '',
    ].join('\n'))
    let runs = 0
    const code = runLoopCommand(dir, {
      maxIterations: 5, runner: () => { runs += 1; return passRunner({ targetDir: dir, story: loadPrd(join(dir, '.yoke', 'prd.yaml'))[0] }) },
      git: stubGit, verify: verifyOk,
    })
    expect(code).toBe(1)
    expect(runs).toBe(0)
  })

  it('run refuses to dispatch while an interrupted decision answer needs recovery', () => {
    saveConfig(dir, cfg())
    writeFileSync(join(dir, '.yoke', 'decision-answering.yaml'), [
      'version: 1', 'storyId: S1', 'question: Which identity model?', 'reason: Public API choice.',
      'options:', '  - { id: A, label: Accounts }', '  - { id: B, label: Profiles }', 'recommended: A', '',
    ].join('\n'))
    let runs = 0
    expect(runLoopCommand(dir, {
      maxIterations: 5, runner: () => { runs += 1; return { success: true, summary: 'unexpected' } },
      git: stubGit, verify: verifyOk,
    })).toBe(1)
    expect(runs).toBe(0)
  })

  it('persists the trusted run options needed to resume after a critical decision', () => {
    saveConfig(dir, { ...cfg(), agents: ['codex', 'claude'], loop: { enabled: true, decisionPolicy: 'critical' } })
    const decisionRunner: AgentRunner = (ctx) => {
      writeFileSync(join(ctx.targetDir, '.yoke', 'decision-request.yaml'), [
        'version: 1', `storyId: ${ctx.story.id}`, 'question: Which identity model?', 'reason: Public API choice.',
        'options:', '  - { id: A, label: Accounts }', '  - { id: B, label: Profiles }', 'recommended: A', '',
      ].join('\n'))
      return { success: true, summary: 'waiting' }
    }
    expect(runLoopCommand(dir, {
      maxIterations: 7, agent: 'codex', runner: decisionRunner, git: stubGit, verify: verifyOk,
      reviewer: 'claude', reviewRunner: passRunner, review: true, allowSelfReview: false,
      timeoutMinutes: 12, json: true, onAmbiguity: 'resolve', permissions: 'safe',
    })).toBe(1)
    expect(readDecisionResume(dir)).toMatchObject({
      maxIterations: 7, agent: 'codex', reviewer: 'claude', review: true,
      timeoutMinutes: 12, json: true, onAmbiguity: 'resolve', permissions: 'safe', parallel: 1,
    })
    expect(readDecisionResume(dir)?.decisionPolicy).toBeUndefined()
  })

  it('run completes the PRD with an injected passing runner', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
  })

  it('run returns 2 when the loop is enabled but the PRD file is missing', () => {
    saveConfig(dir, cfg())
    rmSync(join(dir, '.yoke', 'prd.yaml'))
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(2)
  })

  it('setLoopEnabled creates a config when none exists yet', () => {
    expect(existsSync(join(dir, '.yoke', 'config.yaml'))).toBe(false)
    setLoopEnabled(dir, true)
    expect(loadConfig(dir)!.loop.enabled).toBe(true)
  })

  it('refuses to run when no verify command is configured or detectable', () => {
    saveConfig(dir, cfg())
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('runs when a verify command is configured', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
  })

  it('refuses to run when the selected agent CLI is unavailable', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5,
      git: stubGit,
      verify: verifyOk,
      agent: 'codex',
      isAvailable: () => false,
    })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('does not run the readiness gate when a runner is injected', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5,
      runner: passRunner,
      git: stubGit,
      verify: verifyOk,
      isAvailable: () => false, // ignored because runner is injected
    })
    expect(code).toBe(0)
  })

  it('blocks when an injected review runner rejects', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk, reviewRunner: reviewReject })
    expect(code).toBe(1)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('refuses to run when the reviewer agent CLI is unavailable', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, {
      maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk,
      reviewer: 'codex', isAvailable: (a) => a !== 'codex',
    })
    expect(code).toBe(2)
  })

  it('refuses explicit self-review unless it is allowed', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const common = { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk, agent: 'claude' as const, reviewer: 'claude' as const, isAvailable: () => true }
    expect(runLoopCommand(dir, common)).toBe(2)
  })

  it('returns 2 when another loop holds the lock', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    writeFileSync(join(dir, '.yoke', 'loop.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('run exits 3 when a pause file stops the loop, consuming it and releasing the lock', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    writeFileSync(join(dir, '.yoke', 'loop.pause'), '')
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(3)
    expect(existsSync(join(dir, '.yoke', 'loop.pause'))).toBe(false)  // signal consumed
    expect(existsSync(join(dir, '.yoke', 'loop.lock'))).toBe(false)   // lock released
    expect(loadPrd(join(dir, '.yoke', 'prd.yaml'))[0].passes).toBe(false) // paused before any story
  })

  it('releases the lock after a run', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(0)
    expect(existsSync(join(dir, '.yoke', 'loop.lock'))).toBe(false)
  })

  it('run with json:true emits NDJSON status lines on stdout and keeps the narrative off it', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const chunks: string[] = []
    const logged: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { chunks.push(String(c)); return true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logged.push(a.join(' ')) })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let code: number
    try {
      code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk, json: true })
    } finally {
      outSpy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore()
    }
    expect(code).toBe(0)
    const lines = chunks.join('').split('\n').filter(l => l.trim() !== '')
    expect(lines.length).toBeGreaterThanOrEqual(3) // implementing, verifying, committing, complete
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ type: 'status' })
    expect(lines.map(l => JSON.parse(l).state)).toContain('complete')
    expect(logged).toEqual([]) // machine consumers own stdout in json mode
  })

  it('run without json keeps the human narrative on stdout (no JSON lines)', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const chunks: string[] = []
    const logged: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { chunks.push(String(c)); return true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logged.push(a.join(' ')) })
    try {
      runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    } finally {
      outSpy.mockRestore(); logSpy.mockRestore()
    }
    const all = chunks.join('')
    expect(all).toContain('implementing')            // narrative present
    expect(all).not.toContain('"type":"status"')     // no machine lines
    expect(logged.join('\n')).toMatch(/Loop complete/) // final summary via console.log
  })

  it('passes isolate:true through to runLoop (addWorktree is called)', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    let addWorktreeCalled = false
    const trackingGit: GitOps = {
      isClean: () => true, commitAll: () => {},
      addWorktree: () => { addWorktreeCalled = true },
      integrate: () => {}, removeWorktree: () => {},
    }
    runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: trackingGit, verify: verifyOk, isolate: true })
    expect(addWorktreeCalled).toBe(true)
  })
})
