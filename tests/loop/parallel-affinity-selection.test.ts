import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd } from '../../src/loop/prd.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { ModelSelection } from '../../src/agents/types.js'
import type { GitOps } from '../../src/loop/gates.js'

const { makeAsyncRunner } = vi.hoisted(() => ({ makeAsyncRunner: vi.fn() }))

vi.mock('../../src/loop/runner.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/loop/runner.js')>(),
  makeAsyncRunner,
}))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-affinity-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), '- { id: A, title: API, priority: 1, acceptance: ["a"], passes: false, agent: codex }')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parallel affinity selection', () => {
  it('uses the selected profile defaults without inheriting global effort while retaining safety flags', async () => {
    const selections: ModelSelection[] = []
    makeAsyncRunner.mockImplementation((_agent, options) => {
      selections.push(options.selection)
      return context => ({
        pid: undefined,
        invocation: { command: 'codex', args: [], input: '', cwd: context.targetDir },
        recordPath: '',
        completion: Promise.resolve({
          kind: 'succeeded' as const,
          exitCode: 0 as const,
          invocation: { command: 'codex', args: [], input: '', cwd: context.targetDir },
          pid: undefined,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          telemetry: { usageAvailable: false },
        }),
        cancel: () => false,
      })
    })
    saveConfig(dir, {
      canonVersion: 'test',
      agents: ['claude', 'codex'],
      loop: { enabled: true },
      runner: { agent: 'claude', model: 'claude-global', reasoningEffort: 'high', bare: true },
      routing: {
        enabled: true,
        strategy: 'balanced',
        maxCandidates: 1,
        workers: [{ id: 'codex-affinity', agent: 'codex', model: 'codex-affinity', costTier: 'medium', capabilities: [] }],
      },
      verify: { command: 'node -e "process.exit(0)"' },
    })

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      routing: false,
      git: parallelGit(),
      isAvailable: () => true,
    }))

    expect(code).toBe(0)
    expect(selections).toEqual([{ model: 'codex-affinity', bare: true, nativeMultiAgent: false }])
  })
})

function parallelGit(): GitOps {
  return {
    isClean: () => true,
    addWorktree: (_target, worktree) => {
      mkdirSync(join(worktree, '.yoke'), { recursive: true })
      writeFileSync(join(worktree, '.yoke', 'prd.yaml'), readFileSync(join(dir, '.yoke', 'prd.yaml'), 'utf8'))
    },
    removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
    commitAll: () => undefined,
    integrate: (_target, worktree) => {
      savePrd(join(dir, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
    },
  }
}
