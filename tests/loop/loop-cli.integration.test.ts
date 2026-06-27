import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

let dir: string
const cfg = () => ({ canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } })
const stubGit: GitOps = { isClean: () => true, commitAll: () => {} }
const passRunner: AgentRunner = () => ({ success: true, summary: 'ok' })
const verifyOk: Verifier = () => ({ passed: true, summary: 'ok' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-loopcli-'))
  mkdirSync(join(dir, '.forge'), { recursive: true })
  writeFileSync(join(dir, '.forge', 'prd.yaml'),
    `- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('forge loop CLI', () => {
  it('setLoopEnabled on/off updates the config', () => {
    saveConfig(dir, cfg())
    setLoopEnabled(dir, false)
    expect(loadConfig(dir)!.loop.enabled).toBe(false)
    setLoopEnabled(dir, true)
    expect(loadConfig(dir)!.loop.enabled).toBe(true)
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
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('run completes the PRD with an injected passing runner', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(true)
  })

  it('run returns 2 when the loop is enabled but the PRD file is missing', () => {
    saveConfig(dir, cfg())
    rmSync(join(dir, '.forge', 'prd.yaml'))
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit, verify: verifyOk })
    expect(code).toBe(2)
  })

  it('setLoopEnabled creates a config when none exists yet', () => {
    expect(existsSync(join(dir, '.forge', 'config.yaml'))).toBe(false)
    setLoopEnabled(dir, true)
    expect(loadConfig(dir)!.loop.enabled).toBe(true)
  })

  it('refuses to run when no verify command is configured or detectable', () => {
    saveConfig(dir, cfg())
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(2)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('runs when a verify command is configured', () => {
    saveConfig(dir, { ...cfg(), verify: { command: 'node -e "process.exit(0)"' } })
    const code = runLoopCommand(dir, { maxIterations: 5, runner: passRunner, git: stubGit })
    expect(code).toBe(0)
    expect(loadPrd(join(dir, '.forge', 'prd.yaml'))[0].passes).toBe(true)
  })
})
