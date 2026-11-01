import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../src/cli.js'
import { saveConfig } from '../src/retrofit/config.js'
import { withExecutionBudget } from '../src/execution/budget.js'
import { runSetup } from '../src/setup/command.js'
import { runRetrofit } from '../src/retrofit/command.js'

vi.mock('../src/setup/command.js', () => ({ runSetup: vi.fn(() => 0) }))
vi.mock('../src/retrofit/command.js', () => ({ runRetrofit: vi.fn(() => 0) }))
let temporary: string, root: string
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'yoke-cli-budget-'))
  root = join(temporary, 'project'); mkdirSync(root)
  vi.stubEnv('LOCALAPPDATA', join(temporary, 'host-state'))
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(temporary, { recursive: true, force: true }) })

it('starts the real Node ESM CLI and validates canon outside the Vitest module graph', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'validate', 'canon'], { cwd: process.cwd(), env: process.env, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('canon valid')
})

it('reports and explicitly resets the durable work-package budget through the CLI', async () => {
  saveConfig(root, { canonVersion: 'test', agents: ['codex'], loop: { enabled: true }, executionBudget: { id: 'approved work', maxCalls: 1 } })
  withExecutionBudget({ root, provider: 'codex', role: 'prd-draft', prompt: 'approved task' }, () => ({ tokens: { inputTokens: 10, outputTokens: 2 } }))
  expect(await main(['budget', 'status', root, '--json'])).toBe(0)
  const first = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string)
  expect(first).toMatchObject({ configured: true, admittedCalls: 1, knownTokens: 12 })
  expect(await main(['budget', 'reset', root, '--json'])).toBe(0)
  const reset = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0] as string)
  expect(reset).toMatchObject({ configured: true, admittedCalls: 0 })
  expect(reset.epoch).not.toBe(first.epoch)
  expect(await main(['budget', 'reset', root, '--force'])).toBe(1)
})

it.each(['setup', 'retrofit'])('%s forwards graph=none and explicit browser selection', async command => {
  const run = command === 'setup' ? runSetup : runRetrofit
  expect(await main([command, root, '--code-graph=none', '--browser-tools'])).toBe(0)
  expect(run).toHaveBeenLastCalledWith(root, expect.objectContaining({ codeGraph: 'none', browserTools: true }))
  expect(await main([command, root, '--no-browser-tools'])).toBe(0)
  expect(run).toHaveBeenLastCalledWith(root, expect.objectContaining({ browserTools: false }))
  const count = vi.mocked(run).mock.calls.length
  expect(await main([command, root, '--browser-tools', '--no-browser-tools'])).toBe(1)
  expect(vi.mocked(run).mock.calls).toHaveLength(count)
})
