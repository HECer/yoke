import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareWindowsInvocation } from '../../src/agents/windows-launch.js'
import { observedError } from '../../src/observability/failure.js'
import { buildWatchdogInvocation, makeRunner, makeReviewRunner, runCapturedAgent, runReviewAgent } from '../../src/loop/runner.js'

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFileSync: vi.fn() }))
vi.mock('../../src/agents/windows-launch.js', async original => ({ ...await original<typeof import('../../src/agents/windows-launch.js')>(), prepareWindowsInvocation: vi.fn() }))
const dirs: string[] = []
const root = () => { const cwd = mkdtempSync(join(process.cwd(), 'yoke-sync-preflight-')); dirs.push(cwd); return cwd }
const story = { id: 'S1', title: 'Scoped change', priority: 1, passes: false, acceptance: ['criterion'] }
afterEach(() => { vi.resetAllMocks(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
beforeEach(() => { vi.mocked(execFileSync).mockReturnValue('') })

it('retains a prepared environment when wrapping the provider in the watchdog', () => {
  const cwd = root(), env = { PATH: 'prepared-tools' }
  expect(buildWatchdogInvocation({ command: 'native', args: [], input: '', cwd, env }, 10)).toMatchObject({ env })
})

it.skipIf(process.platform !== 'win32')('preflights the original provider before the synchronous watchdog launch', () => {
  const cwd = root()
  vi.mocked(prepareWindowsInvocation).mockImplementation((inv, env) => ({ command: inv.command === 'codex' ? 'native-codex.exe' : process.execPath, args: inv.args, cwd: inv.cwd, env: { ...env, YOKE_PREPARED: 'yes' } }))
  vi.mocked(execFileSync).mockReturnValue('{"usage":{"input_tokens":4,"output_tokens":2}}')
  const result = makeRunner('codex', 100)({ targetDir: relative(process.cwd(), cwd), story })
  expect(result.success).toBe(true)
  expect(vi.mocked(prepareWindowsInvocation).mock.calls[0][0]).toMatchObject({ command: 'codex', cwd })
  const call = vi.mocked(execFileSync).mock.calls[0]
  expect(call[1]).toEqual(expect.arrayContaining(['native-codex.exe', 'exec']))
  expect(call[2]).toMatchObject({ cwd, env: { YOKE_PREPARED: 'yes' } })
})

it.skipIf(process.platform !== 'win32')('returns complete zero usage when original provider preflight proves no model started', () => {
  const cwd = root()
  vi.mocked(prepareWindowsInvocation).mockImplementation(inv => {
    if (inv.command === 'codex') throw observedError('missing provider', 'missing-executable', 'not-started')
    return { command: process.execPath, args: inv.args, cwd: inv.cwd, env: process.env }
  })
  const result = makeRunner('codex', 100)({ targetDir: cwd, story })
  expect(result).toMatchObject({ success: false, failure: { modelExecution: 'not-started' }, tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, measurementComplete: true, costMeasurementComplete: true } })
  expect(vi.mocked(execFileSync)).not.toHaveBeenCalled()
})

it.each([runCapturedAgent.bind(null, 'codex'), runReviewAgent])('preserves preflight evidence in one-shot execution', run => {
  const cwd = root()
  vi.mocked(prepareWindowsInvocation).mockImplementation(() => { throw observedError('invalid cwd', 'invalid-cwd', 'not-started') })
  const result = run({ command: 'codex', args: ['exec'], cwd: join(cwd, 'absent'), input: '' })
  expect(result).toMatchObject({ success: false, failure: { modelExecution: 'not-started' }, tokens: { inputTokens: 0, outputTokens: 0, measurementComplete: true } })
})

it('keeps injected execution compatible and supplies absolute cwd and child environment', () => {
  const cwd = root()
  const result = makeRunner('codex', 0, { execCapture: inv => {
    expect(inv.cwd).toBe(cwd)
    expect(inv.env).toBeDefined()
    expect(inv.args).toContain('codex')
    return '{"usage":{"input_tokens":1,"output_tokens":1}}'
  } })({ targetDir: relative(process.cwd(), cwd), story })
  expect(result.success).toBe(true)
})

it('retains ambiguous execution failures as unmeasured', () => {
  const cwd = root()
  const result = makeRunner('codex', 0, { execCapture: () => { throw new Error('ambiguous execution failure') } })({ targetDir: cwd, story })
  expect(result.success).toBe(false)
  expect(result.tokens).toBeUndefined()
})

it.skipIf(process.platform !== 'win32')('preserves reviewer preflight evidence and returns an infrastructure review outcome', () => {
  const cwd = root()
  vi.mocked(prepareWindowsInvocation).mockImplementation(inv => {
    if (inv.command === 'codex') throw observedError('missing provider', 'missing-executable', 'not-started')
    return { command: process.execPath, args: inv.args, cwd: inv.cwd, env: process.env }
  })
  const result = makeReviewRunner('codex', 100)({ targetDir: cwd, story })
  expect(result).toMatchObject({ success: false, failure: { modelExecution: 'not-started' }, tokens: { measurementComplete: true, inputTokens: 0, outputTokens: 0 }, reviewOutcome: { kind: 'infrastructure' } })
})
