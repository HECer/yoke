import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectProviderEvent, inspectProviderDiagnostic, readSupervision, assertPreviousProvidersStopped } from '../../src/agents/supervision.js'
import { startProviderProcess } from '../../src/agents/process.js'
import { inaccessibleStoreShell, resolveWindowsCommand } from '../../src/agents/windows-launch.js'
import { makeAsyncAdaptiveRunner } from '../../src/routing/router.js'
import { defaultRoutingWorkers } from '../../src/setup/command.js'
import { runStoryWorker } from '../../src/loop/worker.js'
import { providerProcessResultToAgentResult } from '../../src/loop/parallel-command.js'
import { readRoutingObservations } from '../../src/routing/registry.js'

const dirs: string[] = []
const root = () => { const p = mkdtempSync(join(tmpdir(), 'yoke runner & spaces ')); dirs.push(p); return p }
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
afterEach(() => vi.unstubAllEnvs())
const failure = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'failed', exit_code: null, aggregated_output: 'CreateProcessAsUserW failed: -1073283067 private details' } })

it('recognizes actual failed tool envelopes, not optional MCP stderr or quoted task data', () => {
  expect(inspectProviderEvent(failure).failure).toBe('worker-shell-spawn-failed')
  expect(inspectProviderEvent('AuthRequired: No access token was provided')).toEqual({})
  expect(inspectProviderDiagnostic('2026-09-06T18:46:54Z ERROR codex_core::tools::router: error=exec_command failed: CreateProcess { message: "CreateProcessAsUserW failed: 5" }')).toBe('worker-shell-spawn-failed')
  expect(inspectProviderDiagnostic('ERROR rmcp::transport::worker: AuthRequired: No access token was provided')).toBeUndefined()
  expect(inspectProviderEvent(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: failure } })).failure).toBeUndefined()
  expect(inspectProviderEvent(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', exit_code: 0, aggregated_output: failure } })).progress).toBe(true)
})

it('stops a streaming infrastructure failure before an otherwise successful exit and retains redacted proof', async () => {
  const cwd = root()
  const handle = startProviderProcess('codex', { command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(failure + '\n')});setInterval(()=>{},1000)`], input: '', cwd }, { terminationGraceMs: 100, attempt: 2 })
  const result = await handle.completion
  expect(result).toMatchObject({ kind: 'cancelled', reason: 'worker-shell-spawn-failed' })
  const records = readSupervision(cwd, '')
  expect(records[0]).toMatchObject({ state: 'stopped', reason: 'worker-shell-spawn-failed', childPid: handle.pid, retry: 1 })
  expect(JSON.stringify(records)).not.toContain('private details')
}, 20000)

it('enforces a total budget even while a provider continuously prints heartbeats', async () => {
  const cwd = root()
  const result = await startProviderProcess('codex', { command: process.execPath, args: ['-e', 'setInterval(()=>console.log("heartbeat"),10)'], input: '', cwd }, { totalTimeoutMs: 100, idleTimeoutMs: 10000, terminationGraceMs: 50 }).completion
  expect(result).toMatchObject({ kind: 'timed-out', reason: 'provider-total-timeout' })
  expect(readSupervision(cwd, '')[0].lastProgressAt).toBeUndefined()
}, 20000)

it('resolves npm shims to argv-safe Node launches with spaces and metacharacters', () => {
  const cwd = root(), module = join(cwd, 'node_modules', 'example')
  mkdirSync(module, { recursive: true })
  writeFileSync(join(module, 'cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  const shim = join(cwd, 'example.cmd')
  writeFileSync(shim, '@echo off\n"%_prog%" "%dp0%\\node_modules\\example\\cli.js" %*')
  const args = ['a b', 'x&y', '%PATH%', 'a"b', '$(not-a-command)', 'trailing\\']
  const launch = resolveWindowsCommand(shim, args)
  const output = spawnSync(launch.command, launch.args, { shell: false, encoding: 'utf8' })
  expect(output.status).toBe(0)
  expect(JSON.parse(output.stdout)).toEqual(args)
  expect(readFileSync(shim, 'utf8')).toContain('%*')
})

it('recognizes packaged PowerShell without rejecting unrelated native runtime paths', () => {
  expect(inaccessibleStoreShell('C:/Program Files/WindowsApps/Microsoft.PowerShell_7.6.5/pwsh.exe')).toBe(true)
  expect(inaccessibleStoreShell('C:/Users/example/AppData/Local/Microsoft/WindowsApps/pwsh.exe')).toBe(true)
  expect(inaccessibleStoreShell('C:/Program Files/PowerShell/7/pwsh.exe')).toBe(false)
})

it('refuses a new provider while termination of an earlier live PID is unconfirmed', () => {
  const cwd = root(), dir = join(cwd, '.yoke/supervision')
  mkdirSync(dir, { recursive: true })
  const record = { id: 'prior', state: 'termination-unconfirmed', childPid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }
  writeFileSync(join(dir, 'prior.json'), JSON.stringify(record))
  expect(() => assertPreviousProvidersStopped(cwd)).toThrow('unconfirmed')
  writeFileSync(join(dir, 'prior.json'), JSON.stringify({ ...record, state: 'stopped' }))
  expect(() => assertPreviousProvidersStopped(cwd)).not.toThrow()
})

it('blocks the routed worker after one infrastructure failure despite green existing gates', async () => {
  const cwd = root(); vi.stubEnv('YOKE_REGISTRY_DIR', join(cwd, 'registry'))
  const story = { id: 'INFRA', title: 'work', priority: 1, passes: false, acceptance: ['verified'], assessment: { taskClass: 'mechanical' as const, difficulty: 'low' as const, uncertainty: 'low' as const, risk: 'low' as const, scope: 'low' as const, testability: 'high' as const, reason: 'bounded task', approach: 'implement and test' } }
  let attempts = 0
  const runner = makeAsyncAdaptiveRunner({ parent: 'codex', projectRoot: cwd, strategy: 'capability', maxCandidates: 3, workers: defaultRoutingWorkers(['codex']),
    makeWorker: () => async () => {
      attempts++
      return providerProcessResultToAgentResult('codex', story.id, await startProviderProcess('codex', { command: process.execPath, args: ['-e', `process.stderr.write('ERROR codex_core::tools::router: error=exec_command failed: CreateProcess { CreateProcessAsUserW failed: 5 }\\n');setInterval(()=>{},1000)`], input: '', cwd }, { terminationGraceMs: 50 }).completion)
    } })
  const verify = vi.fn(() => ({ passed: true, summary: 'old tests green' }))
  const result = await runStoryWorker({ story, worktree: cwd, baseCommit: 'base', provider: { provider: 'codex', role: 'worker' }, runner, verify })
  expect(result.kind).toBe('mechanical-failure')
  expect(attempts).toBe(1); expect(verify).not.toHaveBeenCalled()
  const observations = readRoutingObservations()
  expect(observations).toHaveLength(1)
  expect(observations[0]).toMatchObject({ failureKind: 'infrastructure', verificationSuccess: false })
}, 20000)
