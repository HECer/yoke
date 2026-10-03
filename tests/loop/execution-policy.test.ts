import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runLoopCommand, type RunLoopCommandOptions } from '../../src/loop/run-command.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { AdaptiveRunnerOptions } from '../../src/routing/router.js'
import type { ParallelCommandInput } from '../../src/loop/parallel-command.js'

const { adaptive, parallel } = vi.hoisted(() => ({
  adaptive: vi.fn((_options: AdaptiveRunnerOptions) => () => { throw new Error('completed-backlog policy test must not invoke a model') }),
  parallel: vi.fn(async (_input: ParallelCommandInput) => 0),
}))
vi.mock('../../src/routing/router.js', async original => ({ ...await original<typeof import('../../src/routing/router.js')>(), makeAdaptiveRunner: adaptive }))
vi.mock('../../src/loop/parallel-command.js', async original => ({ ...await original<typeof import('../../src/loop/parallel-command.js')>(), runParallelLoopCommand: parallel }))

const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.clearAllMocks(); vi.unstubAllEnvs() })

async function policy(options: RunLoopCommandOptions = {}, configChanges: Parameters<typeof saveConfig>[1] = { canonVersion: 'test' }) {
  const root = mkdtempSync(join(tmpdir(), 'yoke-policy-')); roots.push(root)
  vi.stubEnv('XDG_STATE_HOME', root); vi.stubEnv('LOCALAPPDATA', '')
  mkdirSync(join(root, '.yoke'))
  writeFileSync(join(root, '.yoke/prd.yaml'), '- { id: S1, title: Build, priority: 1, acceptance: [build], passes: true }')
  saveConfig(root, {
    canonVersion: 'test', agents: ['codex', 'claude'], loop: { enabled: true, isolate: false, parallel: 1 },
    verify: { command: 'node -e "process.exit(0)"' },
    routing: { enabled: true, strategy: 'capability', maxCandidates: 1, workers: [{ id: 'worker', agent: 'codex', model: 'fixture-model', costTier: 'low', capabilities: [] }], optimization: { version: 1, objective: 'balanced' } },
    ...configChanges,
  })
  for (const args of [['init', '-q'], ['config', 'user.name', 'Test'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  }
  await runLoopCommand(root, { agent: 'codex', parallel: 1, maxIterations: 1, isAvailable: () => true, quiet: true, ...options })
  const call = options.parallel && options.parallel > 1 ? parallel.mock.calls.at(-1) : adaptive.mock.calls.at(-1)
  return call?.[0] as unknown as { accountingScope?: string; executionPolicyKey?: string; optimization?: unknown }
}

it('gives native production attempts a stable effective policy and execution scope', async () => {
  const first = await policy()
  expect(first).toMatchObject({ accountingScope: 'execution-attempt', executionPolicyKey: expect.stringMatching(/^[a-f0-9]{64}$/u), optimization: { version: 1, objective: 'balanced' } })
  expect((await policy()).executionPolicyKey).toBe(first.executionPolicyKey)
})

it('separates actual gate, permissions, reviewer and dispatcher policy changes', async () => {
  const base = await policy()
  const changed = [
    await policy({}, { canonVersion: 'test', verify: { command: 'node verify-another-flow.js', retries: 2 } }),
    await policy({ permissions: 'read-only' }),
    await policy({ review: true, reviewer: 'claude' }),
    await policy({ parallel: 2 }),
    await policy({}, { canonVersion: 'test', design: { mode: 'on', max: 50 } }),
  ]
  for (const result of changed) {
    expect(result.accountingScope).toBe('execution-attempt')
    expect(result.executionPolicyKey).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.executionPolicyKey).not.toBe(base.executionPolicyKey)
  }
})

it('does not claim complete economic coverage for opaque injected gates', async () => {
  const input = await policy({ verify: () => ({ passed: true, summary: 'opaque verifier' }) })
  expect(input.accountingScope).toBeUndefined()
  expect(input.executionPolicyKey).toBeUndefined()
})
