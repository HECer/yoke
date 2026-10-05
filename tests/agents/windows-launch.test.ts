import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareWindowsInvocation, resolveWindowsCommand } from '../../src/agents/windows-launch.js'
import * as windowsLaunch from '../../src/agents/windows-launch.js'
import { startProviderProcess } from '../../src/agents/process.js'
import { prepareChildEnvironment } from '../../src/agents/child-environment.js'

const dirs: string[] = []
const root = (sameDrive = false) => { const dir = mkdtempSync(join(sameDrive ? process.cwd() : tmpdir(), 'yoke-child-env-')); dirs.push(dir); return dir }
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

it('returns an absolute validated cwd for relative provider invocations', () => {
  const cwd = root(true)
  const launch = prepareWindowsInvocation({ command: 'node', args: [], input: '', cwd: relative(process.cwd(), cwd) })
  expect(launch).toHaveProperty('cwd', cwd)
})

it('rejects nonexistent and file cwd before provider execution', () => {
  const cwd = root(), file = join(cwd, 'file.txt')
  writeFileSync(file, 'not a directory')
  for (const invalid of [join(cwd, 'absent'), file]) {
    expect(() => prepareWindowsInvocation({ command: 'node', args: [], input: '', cwd: invalid })).toThrow(/working directory/iu)
  }
})

it('bounds Windows PATH without changing parent env or removing project and system tools', () => {
  const cwd = root(), bin = join(cwd, 'node_modules', '.bin'), nested = join(cwd, 'packages', 'api', 'node_modules', '.bin')
  const parent = Object.freeze({ Path: `C:\\tools;${bin};c:\\TOOLS\\;C:\\old\\node_modules\\.bin;${nested};${bin.toUpperCase()};C:\\Windows\\System32`, OTHER: 'retained' })
  const launch = prepareWindowsInvocation({ command: 'node', args: [], input: '', cwd }, parent)
  expect(launch.env).toEqual({ PATH: `C:\\tools;${bin};${nested};C:\\Windows\\System32`, OTHER: 'retained' })
  expect(launch.env).not.toBe(parent)
  expect(parent.Path).toContain('C:\\old\\node_modules\\.bin')
})

it('merges conflicting PATH key casing and removes empty search entries', () => {
  const cwd = root()
  const launch = prepareWindowsInvocation({ command: 'node', args: [], input: '', cwd }, { Path: 'C:\\tools;;', PATH: 'c:\\tools;C:\\Windows' })
  expect(launch.env).toEqual({ PATH: 'C:\\tools;C:\\Windows' })
})

it('preserves POSIX environment key casing and search paths', () => {
  const cwd = root(), env = Object.freeze({ PATH: '/tools:/tools:/foreign/node_modules/.bin', Path: 'case-sensitive variable' })
  const prepared = prepareChildEnvironment(cwd, env, 'linux')
  expect(prepared.env).toEqual(env)
  expect(prepared.env).not.toBe(env)
})

it('rejects missing absolute executables and npm shim entrypoints with pre-model evidence', () => {
  const cwd = root(), shim = join(cwd, 'example.cmd')
  mkdirSync(join(cwd, 'node_modules'), { recursive: true })
  writeFileSync(shim, '@echo off\n"%_prog%" "%dp0%\\node_modules\\example\\cli.js" %*')
  for (const command of [resolve(cwd, 'absent.exe'), shim]) {
    let error: unknown
    try { resolveWindowsCommand(command, []) } catch (caught) { error = caught }
    expect(error).toMatchObject({ failure: { failureCategory: 'infrastructure', failureCause: 'missing-executable', modelExecution: 'not-started' } })
  }
})

it('resolves child-relative PATH entries against the validated cwd', () => {
  const cwd = root()
  const launch = prepareWindowsInvocation({ command: 'node', args: [], input: '', cwd }, { Path: 'tools;node_modules/.bin' })
  expect(launch.env.PATH).toBe(`${win32.resolve(cwd, 'tools')};${win32.resolve(cwd, 'node_modules', '.bin')}`)
})

it('fails explicitly when an installed watchdog and its source fallback are unavailable', () => {
  const cwd = root(), moduleUrl = pathToFileURL(join(cwd, 'agents', 'windows-launch.js')).href
  let error: unknown
  try { windowsLaunch.windowsWatchdogArgs(moduleUrl) } catch (caught) { error = caught }
  expect(error).toMatchObject({ failure: { failureCause: 'missing-executable', modelExecution: 'not-started' } })
})

it('fails explicitly when source watchdog exists but its tsx prerequisite is absent', () => {
  const cwd = root(), moduleUrl = pathToFileURL(join(cwd, 'agents', 'windows-launch.js')).href
  mkdirSync(join(cwd, 'loop'), { recursive: true })
  writeFileSync(join(cwd, 'loop', 'watchdog.ts'), '')
  let error: unknown
  try { windowsLaunch.windowsWatchdogArgs(moduleUrl) } catch (caught) { error = caught }
  expect(error).toMatchObject({ failure: { failureCause: 'missing-executable', modelExecution: 'not-started' } })
})

it.skipIf(process.platform !== 'win32')('returns measured zero model usage and structured evidence for provider preflight failure', async () => {
  const cwd = root()
  const result = await startProviderProcess('codex', { command: join(cwd, 'missing.exe'), args: [], input: '', cwd }).completion
  expect(result).toMatchObject({ kind: 'spawn-failed', failure: { failureCause: 'missing-executable', modelExecution: 'not-started' }, telemetry: { usageAvailable: true, tokens: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 } } })
})

it('records the absolute invocation cwd when the provider received a relative directory', async () => {
  const cwd = root(true)
  const handle = startProviderProcess('codex', { command: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'], input: '', cwd: relative(process.cwd(), cwd) })
  const result = await handle.completion
  expect(handle.invocation.cwd).toBe(cwd)
  expect(result).toMatchObject({ kind: 'succeeded', stdout: cwd, invocation: { cwd } })
}, 20000)
