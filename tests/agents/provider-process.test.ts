import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { killProcessTree } from '../../src/loop/watchdog.js'
import {
  providerSpawnOptions,
  startProviderProcess,
} from '../../src/agents/providers.js'

const completedScript = (stdout: string, stderr = '', code = 0): string =>
  `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code})`

function invocation(script: string, cwd: string) {
  return {
    command: process.execPath,
    args: ['--eval', script],
    input: '',
    cwd,
  }
}

const tempDirs: string[] = []

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yoke-provider-process-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('startProviderProcess', () => {
  it('streams stdout and stderr while preserving cumulative telemetry on successful completion', async () => {
    // Given: a provider-shaped JSON stream and a stderr diagnostic.
    const dir = tempProject()
    const outputs: string[] = []

    // When: the provider process runs.
    const handle = startProviderProcess('codex', invocation(completedScript(
      '{"usage":{"input_tokens":3,"output_tokens":5},"model":"test-model"}\ncomplete\n',
      'diagnostic\n',
    ), dir), {
      onOutput: output => { outputs.push(`${output.stream}:${output.text}`) },
    })
    const result = await handle.completion

    // Then: both streams, output, and telemetry are observable.
    expect(result).toMatchObject({
      kind: 'succeeded',
      stdout: expect.stringContaining('complete'),
      stderr: expect.stringContaining('diagnostic'),
      telemetry: { usageAvailable: true, tokens: { inputTokens: 3, outputTokens: 5, model: 'test-model' } },
    })
    expect(outputs).toEqual(expect.arrayContaining([
      expect.stringContaining('stdout:'),
      expect.stringContaining('stderr:'),
    ]))
  })

  it('returns a failed result with partial output and usage when the provider exits nonzero', async () => {
    // Given: a provider which emits usage before failing.
    const dir = tempProject()

    // When: its process exits with an error code.
    const result = await startProviderProcess('codex', invocation(completedScript(
      '{"usage":{"input_tokens":8,"output_tokens":13}}\npartial\n',
      'provider failed\n',
      7,
    ), dir)).completion

    // Then: the typed failure retains the usable partial evidence.
    expect(result).toMatchObject({
      kind: 'failed',
      exitCode: 7,
      stdout: expect.stringContaining('partial'),
      stderr: expect.stringContaining('provider failed'),
      telemetry: { usageAvailable: true, tokens: { inputTokens: 8, outputTokens: 13 } },
    })
  })

  it('retains only bounded trailing output while reporting truncation', async () => {
    const dir = tempProject()

    const result = await startProviderProcess('codex', invocation(completedScript('0123456789'), dir), {
      outputLimitBytes: 5,
    }).completion

    expect(result).toMatchObject({
      kind: 'succeeded',
      stdout: '56789',
      stdoutTruncated: true,
    })
  })

  it('returns a typed failure without sending input when process record publication fails', async () => {
    // Given: a spawned provider, a record store that rejects publication, and input the child would persist.
    const dir = tempProject()
    const inputPath = join(dir, 'unexpected-input.txt')
    const terminated: Array<readonly [number, boolean]> = []
    const handle = startProviderProcess('codex', invocation(
      `const { writeFileSync } = require("node:fs"); process.stdin.on("data", data => writeFileSync(${JSON.stringify(inputPath)}, data)); setTimeout(() => process.exit(0), 200)`,
      dir,
    ), {
      recordAdapter: {
        publish: () => { throw new Error('record volume unavailable') },
        remove: () => {},
      },
      terminateProcessTree: (pid, force) => {
        terminated.push([pid, force])
        killProcessTree(pid, force)
        return true
      },
    })

    // When: record publication fails after the child has been spawned.
    const [result, repeated] = await Promise.all([handle.completion, handle.completion])

    // Then: the same handle settles once, kills that PID, and never writes provider input or a record.
    expect(result).toMatchObject({ kind: 'spawn-failed', error: expect.stringContaining('process ownership record failure') })
    expect(repeated).toEqual(result)
    const pid = handle.pid
    if (typeof pid !== 'number') throw new Error('expected spawned provider PID')
    expect(terminated).toEqual([[pid, false]])
    expect(existsSync(inputPath)).toBe(false)
    expect(existsSync(handle.recordPath)).toBe(false)
  })

  it('terminates an idle process and reports a typed timeout', async () => {
    // Given: a provider that never writes or exits.
    const dir = tempProject()

    // When: its idle deadline expires.
    const handle = startProviderProcess('codex', invocation('setInterval(() => {}, 1_000)', dir), {
      idleTimeoutMs: 25,
      terminationGraceMs: 10,
    })
    const result = await handle.completion

    // Then: the process is classified as timed out and its scoped record is removed.
    expect(result).toMatchObject({ kind: 'timed-out', reason: 'provider process produced no output before its idle timeout' })
    expect(existsSync(handle.recordPath)).toBe(false)
  })

  it('reconfirms termination after close before retaining the scoped record', async () => {
    const dir = tempProject()
    const terminated: Array<readonly [number, boolean]> = []
    const handle = startProviderProcess('codex', invocation('setInterval(() => {}, 1_000)', dir), {
      idleTimeoutMs: 25,
      terminationGraceMs: 1_000,
      terminateProcessTree: (pid, force) => {
        terminated.push([pid, force])
        try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
        return terminated.length > 1
      },
    })

    await expect(handle.completion).resolves.toMatchObject({ kind: 'timed-out' })
    expect(terminated).toEqual([
      [handle.pid, false],
      [handle.pid, true],
    ])
    expect(existsSync(handle.recordPath)).toBe(false)
  })

  it('cancels an active process exactly once and records the cancellation reason', async () => {
    // Given: an active provider process.
    const dir = tempProject()
    const handle = startProviderProcess('codex', invocation('setInterval(() => {}, 1_000)', dir), {
      terminationGraceMs: 10,
    })

    // When: the worker asks to cancel it twice.
    const accepted = handle.cancel('operator requested cancellation')
    const repeated = handle.cancel('later request')
    const result = await handle.completion

    // Then: cancellation is idempotent and the first reason wins.
    expect(accepted).toBe(true)
    expect(repeated).toBe(false)
    expect(result).toMatchObject({ kind: 'cancelled', reason: 'operator requested cancellation' })
    expect(existsSync(handle.recordPath)).toBe(false)
  })

  it('retains the scoped record when cancellation cannot confirm descendant termination', async () => {
    const dir = tempProject()
    const handle = startProviderProcess('codex', invocation('setInterval(() => {}, 1_000)', dir), {
      terminateProcessTree: () => false,
    })

    expect(handle.cancel('operator requested cancellation')).toBe(true)
    if (typeof handle.pid !== 'number') throw new Error('expected spawned provider PID')
    process.kill(handle.pid, 'SIGKILL')
    await expect(handle.completion).resolves.toMatchObject({ kind: 'cancelled' })
    expect(existsSync(handle.recordPath)).toBe(true)
  })

  it('uses argv arrays and shells only Windows command shims', () => {
    // Given: one provider invocation.
    const inv = invocation('process.exit(0)', '/tmp/project')

    // When: spawn options are derived for each platform contract.
    const unix = providerSpawnOptions(inv, 'linux')
    const windows = providerSpawnOptions({ ...inv, command: 'provider-shim.cmd' }, 'win32')

    // Then: neither platform receives an interpolated command string.
    expect(unix).toMatchObject({ command: inv.command, args: inv.args, shell: false })
    expect(windows).toMatchObject({ command: 'provider-shim.cmd', args: inv.args, shell: true })
    expect(providerSpawnOptions(inv, 'win32')).toMatchObject({ command: inv.command, args: inv.args, shell: false })
    expect(providerSpawnOptions({ ...inv, command: 'node' }, 'win32')).toMatchObject({ command: 'node', args: inv.args, shell: true })
    expect(providerSpawnOptions({ ...inv, command: '/opt/node/bin/node' }, 'win32')).toMatchObject({ command: '/opt/node/bin/node', args: inv.args, shell: false })
  })

  it('records independent scoped PIDs for concurrent provider calls', async () => {
    // Given: two long-running calls in one project.
    const dir = tempProject()
    const script = 'setTimeout(() => process.stdout.write("done\\n"), 100)'

    // When: both handles begin before either exits.
    const first = startProviderProcess('codex', invocation(script, dir), { workerId: 'worker-a' })
    const second = startProviderProcess('codex', invocation(script, dir), { workerId: 'worker-b' })
    const recordDir = join(dir, '.yoke', 'provider-processes')

    // Then: they own separate records and complete independently.
    expect(first.pid).not.toBe(second.pid)
    expect(readdirSync(recordDir)).toHaveLength(2)
    const records = readdirSync(recordDir).map(name => JSON.parse(readFileSync(join(recordDir, name), 'utf8')) as Record<string, unknown>)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, owner: 'provider-process', targetDir: dir, childPid: first.pid, workerId: 'worker-a' }),
      expect.objectContaining({ version: 1, owner: 'provider-process', targetDir: dir, childPid: second.pid, workerId: 'worker-b' }),
    ]))
    await expect(Promise.all([first.completion, second.completion])).resolves.toEqual([
      expect.objectContaining({ kind: 'succeeded', stdout: expect.stringContaining('done') }),
      expect.objectContaining({ kind: 'succeeded', stdout: expect.stringContaining('done') }),
    ])
    expect(readdirSync(recordDir)).toEqual([])
  })
})
