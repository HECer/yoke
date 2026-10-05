import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepareWindowsInvocation } from '../../src/agents/windows-launch.js'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: vi.fn(),
}))
const dirs: string[] = []
afterEach(() => { vi.resetAllMocks(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
const root = () => {
  const cwd = mkdtempSync(join(process.cwd(), 'yoke-preflight-')); dirs.push(cwd)
  writeFileSync(join(cwd, 'codex.exe'), '')
  writeFileSync(join(cwd, 'pwsh.exe'), '')
  return cwd
}

it.each([['safe', ['exec', '--approve-for-me'], ':workspace'], ['read-only', ['exec', '--sandbox', 'read-only'], ':read-only']] as const)('uses absolute sandbox cwd and bounded PATH under the %s profile', (_name, args, profile) => {
  const cwd = root(), env = Object.freeze({ Path: `${cwd};${cwd.toUpperCase()}` })
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'YOKE_SHELL_OK', stderr: '', output: [], pid: 0, signal: null })
  const launch = prepareWindowsInvocation({ command: 'codex', args: [...args], input: '', cwd: relative(process.cwd(), cwd) }, env)
  expect(launch.cwd).toBe(cwd)
  expect(launch.env.PATH).toBe(cwd)
  const call = vi.mocked(spawnSync).mock.calls[0]
  expect(call[1]).toEqual(expect.arrayContaining(['sandbox', '-P', profile, '-C', cwd]))
  expect(call[2]).toMatchObject({ cwd, shell: false, env: { PATH: cwd } })
  expect(launch.args.slice(0, args.length)).toEqual(args)
  expect(launch.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
})

it('attributes unsuccessful native sandbox probes before model execution', () => {
  const cwd = root()
  vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'CreateProcessAsUserW failed: 5', output: [], pid: 0, signal: null })
  let error: unknown
  try { prepareWindowsInvocation({ command: 'codex', args: ['exec'], input: '', cwd }, { PATH: cwd }) } catch (caught) { error = caught }
  expect(error).toMatchObject({ failure: { failureCause: 'preflight', modelExecution: 'not-started' } })
})
