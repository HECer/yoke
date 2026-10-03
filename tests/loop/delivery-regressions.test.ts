import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runLoop } from '../../src/loop/loop.js'
import { runStoryWorker } from '../../src/loop/worker.js'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd, type Story } from '../../src/loop/prd.js'
import { saveConfig } from '../../src/retrofit/config.js'
import { makeReporter, noopReporter, readStatus } from '../../src/loop/reporter.js'
import type { GitOps } from '../../src/loop/gates.js'

const roots: string[] = []
function fixture(git = false): string {
  const root = mkdtempSync(join(tmpdir(), 'yoke-delivery-regression-'))
  roots.push(root)
  mkdirSync(join(root, '.yoke'))
  savePrd(join(root, '.yoke/prd.yaml'), [story()])
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true } })
  writeFileSync(join(root, 'source.txt'), 'original')
  if (git) {
    writeFileSync(join(root, '.gitignore'), '.yoke/*\n!.yoke/config.yaml\n!.yoke/prd.yaml\n')
    const command = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    command('init'); command('config', 'user.name', 'Test'); command('config', 'user.email', 'test@example.invalid')
    command('add', '.'); command('commit', '-m', 'fixture')
  }
  return root
}
function story(): Story {
  return { id: 'S1', title: 'Complete user flow', priority: 1, passes: false, acceptance: [
    { id: 'flow-one', text: 'First flow', verify: ['npm run test:flow-one'] },
    { id: 'flow-two', text: 'Second flow', verify: ['npm run test:flow-two'] },
  ] }
}
const virtualGit: GitOps = { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs() })

describe('local acceptance execution', () => {
  it.each(['serial', 'worker'] as const)('runs each successful routed local gate once in %s', async path => {
    const root = fixture()
    const runner = vi.fn(() => ({ success: true, summary: 'implemented', routing: { canRetry: true, recordOutcome: () => {} } }))
    const verifyCriterion = vi.fn(() => ({ passed: true, summary: 'criterion green' }))
    const verify = vi.fn(() => ({ passed: true, summary: 'verify green' }))
    const design = vi.fn(() => ({ passed: true, summary: 'design green' }))
    const perf = vi.fn(() => ({ passed: true, summary: 'perf green' }))
    const audit = vi.fn(() => ({ passed: true, summary: 'audit green' }))
    const gates = { verifyCriterion, verify, design, perf, audit }
    if (path === 'serial') {
      expect(runLoop({ targetDir: root, prdPath: join(root, '.yoke/prd.yaml'), runner, git: virtualGit, maxIterations: 1, ...gates }).status).toBe('complete')
    } else {
      expect((await runStoryWorker({ story: story(), worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' }, runner, ...gates })).kind).toBe('candidate')
    }
    expect(runner).toHaveBeenCalledOnce()
    expect(verifyCriterion).toHaveBeenCalledTimes(2)
    for (const gate of [verify, design, perf, audit]) expect(gate).toHaveBeenCalledOnce()
  })

  it('reruns local gates when a boundary callback changes source after verification', async () => {
    const root = fixture()
    const verify = vi.fn(() => ({ passed: readFileSync(join(root, 'source.txt'), 'utf8') === 'original', summary: 'source must remain original' }))
    const result = await runStoryWorker({ story: story(), worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' },
      runner: () => ({ success: true, summary: 'done', routing: { canRetry: true, recordOutcome: () => {} } }),
      verifyCriterion: () => ({ passed: true, summary: 'green' }), verify,
      beforeGates: () => { writeFileSync(join(root, 'source.txt'), 'changed'); return null },
    })
    expect(result).toMatchObject({ kind: 'mechanical-failure', stage: 'verify' })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a green gate result that changed source while checking it', async () => {
    const root = fixture()
    const verify = vi.fn(() => {
      const passed = readFileSync(join(root, 'source.txt'), 'utf8') === 'original'
      writeFileSync(join(root, 'source.txt'), 'changed')
      return { passed, summary: 'source before gate side effect' }
    })
    const result = await runStoryWorker({ story: story(), worktree: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' },
      runner: () => ({ success: true, summary: 'done', routing: { canRetry: true, recordOutcome: () => {} } }),
      verifyCriterion: () => ({ passed: true, summary: 'green' }), verify,
    })
    expect(result).toMatchObject({ kind: 'mechanical-failure', stage: 'verify' })
    expect(verify).toHaveBeenCalledTimes(2)
  })
})

describe('completion and abort parity', () => {
  it.each([1, 2])('honors an explicit ambiguity abort with parallel=%s', async parallel => {
    const root = fixture(true)
    const legacy = { ...story(), acceptance: ['An undecidable existing user flow'] }
    savePrd(join(root, '.yoke/prd.yaml'), [legacy])
    execFileSync('git', ['add', '.yoke/prd.yaml'], { cwd: root, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'legacy acceptance fixture'], { cwd: root, stdio: 'pipe' })
    const state = fixture()
    vi.stubEnv('XDG_STATE_HOME', state)
    vi.stubEnv('LOCALAPPDATA', '')
    const code = await runLoopCommand(root, { parallel, maxIterations: 1, onAmbiguity: 'abort', agent: 'codex', routing: false, quiet: true,
      runner: context => { writeFileSync(join(context.targetDir, '.yoke/ambiguity.md'), 'Which behavior is required?'); return { success: true, summary: 'stopped on ambiguity' } },
      verify: () => ({ passed: true, summary: 'existing checks green' }),
      intake: () => ({ ok: true, added: 0, summary: 'no intake' }), isAvailable: () => false,
    })
    expect(code).toBe(1)
    expect(loadPrd(join(root, '.yoke/prd.yaml'))[0]?.passes).toBe(false)
    expect(readStatus(root)?.reason).toContain('ambiguous acceptance criteria')
    expect(existsSync(join(root, '.yoke/ambiguity.md'))).toBe(false)
  })

  it('persists a typed completion failure for a normally failing verifier', () => {
    const root = fixture()
    savePrd(join(root, '.yoke/prd.yaml'), [{ ...story(), passes: true }])
    const reporter = makeReporter(root, { quiet: true })
    const result = runLoop({ targetDir: root, prdPath: join(root, '.yoke/prd.yaml'), maxIterations: 1, git: virtualGit,
      runner: () => { throw Error('implementation must not start') }, verify: () => ({ passed: true, summary: 'green' }),
      completion: () => ({ passed: false, summary: 'login flow failed' }), reporter,
    })
    expect(result).toMatchObject({ status: 'blocked', failure: { kind: 'completion-failed' } })
    expect(readStatus(root)).toMatchObject({ state: 'blocked', failure: { kind: 'completion-failed' } })
  })
})

describe('diagnosis before unchanged retry', () => {
  it.each(['serial', 'worker'] as const)('gives one diagnostic attempt then blocks the unchanged %s failure', async path => {
    const root = fixture()
    const feedback: (string | undefined)[] = []
    const runner = (context: { feedback?: string }) => { feedback.push(context.feedback); return { success: true, summary: 'unchanged implementation', routing: { canRetry: true, recordOutcome: () => {} } } }
    const gates = { verifyCriterion: () => ({ passed: true, summary: 'criterion green' }), verify: () => ({ passed: false, summary: 'same tracking assertion failed' }) }
    const result = path === 'serial'
      ? runLoop({ targetDir: root, prdPath: join(root, '.yoke/prd.yaml'), runner, git: virtualGit, maxIterations: 1, ...gates })
      : await runStoryWorker({ story: story(), worktree: root, failureRoot: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' }, runner, ...gates })
    expect(result).toMatchObject({ failure: { kind: 'no-progress', stage: 'verify', repeats: 3 } })
    expect(feedback).toHaveLength(3)
    expect(feedback[2]).toContain('diagnose')
  })

  it('allows bounded repairs that actually change the candidate', async () => {
    const root = fixture(); let calls = 0
    const result = await runStoryWorker({ story: story(), worktree: root, failureRoot: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' },
      runner: () => { calls++; writeFileSync(join(root, 'source.txt'), `hypothesis ${calls}`); return { success: true, summary: 'changed implementation', routing: { canRetry: true, recordOutcome: () => {} } } },
      verifyCriterion: () => ({ passed: true, summary: 'criterion green' }), verify: () => ({ passed: calls === 4, summary: 'same assertion until fourth implementation' }),
    })
    expect(result.kind).toBe('candidate')
    expect(calls).toBe(4)
  })

  it('does not spend every quality repair round on an unchanged finding', async () => {
    const root = fixture(); const repairs: string[] = []
    const result = await runStoryWorker({ story: story(), worktree: root, failureRoot: root, baseCommit: 'base', provider: { provider: 'codex', role: 'implementation' },
      runner: () => ({ success: true, summary: 'implemented' }), verifyCriterion: () => ({ passed: true, summary: 'criterion green' }), verify: () => ({ passed: true, summary: 'green' }),
      qualityStage: () => ({ kind: 'lose', biggestGap: 'Tracking does not persist', evidence: ['repro test'], summary: 'same gap' }),
      repair: (_context, request) => { repairs.push(request.finding.message); return { success: true, summary: 'no change' } }, repairLimits: { maxRounds: 20 },
    })
    expect(result).toMatchObject({ failure: { kind: 'no-progress', stage: 'quality', repeats: 3 } })
    expect(repairs).toHaveLength(2)
    expect(repairs[1]).toContain('diagnose')
  })
})
