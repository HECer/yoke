import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { Agent } from '../retrofit/config.js'
import type { AgentInvocation, ProviderTelemetry } from './types.js'
import { killProcessTreeForCleanup } from '../loop/watchdog.js'
import {
  createProviderProcessRecord,
  filesystemProviderProcessRecordAdapter,
  type ProviderProcessRecordAdapter,
} from './process-record.js'
import { createBoundedOutput, createTelemetryAccumulator } from './process-streams.js'
import { processIncarnation } from './process-incarnation.js'

export type ProviderProcessOutput = {
  readonly stream: 'stdout' | 'stderr'
  readonly text: string
}

export type ProviderProcessOptions = {
  readonly idleTimeoutMs?: number
  readonly terminationGraceMs?: number
  readonly outputLimitBytes?: number
  readonly workerId?: string
  readonly onOutput?: (output: ProviderProcessOutput) => void
  readonly signal?: AbortSignal
  readonly recordAdapter?: ProviderProcessRecordAdapter
  readonly terminateProcessTree?: (pid: number, force: boolean) => boolean
}

export type ProviderSpawnOptions = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly shell: boolean
  readonly detached: boolean
}

type ProcessEvidence = {
  readonly invocation: AgentInvocation
  readonly pid: number | undefined
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly telemetry: ProviderTelemetry
}

export type ProviderProcessResult =
  | (ProcessEvidence & { readonly kind: 'succeeded'; readonly exitCode: 0 })
  | (ProcessEvidence & { readonly kind: 'failed'; readonly exitCode: number | null })
  | (ProcessEvidence & { readonly kind: 'timed-out'; readonly reason: string })
  | (ProcessEvidence & { readonly kind: 'cancelled'; readonly reason: string })
  | (ProcessEvidence & { readonly kind: 'spawn-failed'; readonly error: string })

export type ProviderProcessHandle = {
  readonly pid: number | undefined
  readonly invocation: AgentInvocation
  readonly recordPath: string
  readonly completion: Promise<ProviderProcessResult>
  cancel(reason: string): boolean
}

type ProcessTermination =
  | { readonly kind: 'timed-out'; readonly reason: string }
  | { readonly kind: 'cancelled'; readonly reason: string }

function cancellationReason(signal: AbortSignal): string {
  return typeof signal.reason === 'string' && signal.reason.length > 0
    ? signal.reason
    : 'provider process cancellation requested'
}

export function providerSpawnOptions(invocation: AgentInvocation, platform: NodeJS.Platform = process.platform): ProviderSpawnOptions {
  const windowsCommandShim = !/[\\/]/u.test(invocation.command) || /\.(?:bat|cmd)$/iu.test(invocation.command)
  return {
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
    shell: platform === 'win32' && windowsCommandShim,
    detached: platform !== 'win32',
  }
}

export function startProviderProcess(agent: Agent, invocation: AgentInvocation, options: ProviderProcessOptions = {}): ProviderProcessHandle {
  const spawnOptions = providerSpawnOptions(invocation)
  const child = spawn(spawnOptions.command, [...spawnOptions.args], {
    cwd: spawnOptions.cwd,
    shell: spawnOptions.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: spawnOptions.detached,
  })
  const targetDir = resolve(invocation.cwd)
  const pid = child.pid
  const startedAt = pid === undefined ? `unverified:${new Date().toISOString()}` : processIncarnation(pid) ?? `unverified:${new Date().toISOString()}`
  const record = createProviderProcessRecord(targetDir, pid ?? 0, options.workerId, startedAt)
  const recordAdapter = options.recordAdapter ?? filesystemProviderProcessRecordAdapter
  const terminateProcessTree = options.terminateProcessTree ?? ((processPid: number) => killProcessTreeForCleanup(processPid))
  let recordPublished = false

  const stdout = createBoundedOutput(options.outputLimitBytes ?? 1_048_576)
  const stderr = createBoundedOutput(options.outputLimitBytes ?? 1_048_576)
  const telemetry = createTelemetryAccumulator(agent)
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  const terminationGraceMs = options.terminationGraceMs ?? 5_000
  let termination: ProcessTermination | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  let recordFailure: string | undefined
  let terminationConfirmed = false
  let settled = false
  let resolveCompletion: (result: ProviderProcessResult) => void = () => {}

  const completion = new Promise<ProviderProcessResult>(resolveCompletionValue => {
    resolveCompletion = resolveCompletionValue
  })

  const removeRecord = (): void => {
    if (recordPublished) recordAdapter.remove(record.path)
  }
  const clearTimers = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    if (forceTimer) clearTimeout(forceTimer)
    idleTimer = undefined
    forceTimer = undefined
  }
  const finish = (result: ProviderProcessResult): void => {
    if (settled) return
    settled = true
    clearTimers()
    options.signal?.removeEventListener('abort', onAbort)
    if (!termination || terminationConfirmed) removeRecord()
    resolveCompletion(result)
  }
  const evidence = (): ProcessEvidence => ({
    invocation,
    pid,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    telemetry: telemetry.finish(),
  })
  const finalize = (exitCode: number | null): void => {
    const details = evidence()
    if (recordFailure) {
      finish({ ...details, kind: 'spawn-failed', error: recordFailure })
      return
    }
    if (termination?.kind === 'timed-out') {
      finish({ ...details, kind: 'timed-out', reason: termination.reason })
      return
    }
    if (termination?.kind === 'cancelled') {
      finish({ ...details, kind: 'cancelled', reason: termination.reason })
      return
    }
    if (exitCode === 0) {
      finish({ ...details, kind: 'succeeded', exitCode })
      return
    }
    finish({ ...details, kind: 'failed', exitCode })
  }
  const terminate = (next: ProcessTermination): boolean => {
    if (termination || settled) return false
    termination = next
    if (pid !== undefined) terminationConfirmed = terminateProcessTree(pid, false)
    forceTimer = setTimeout(() => {
      if (pid !== undefined && !settled) terminationConfirmed = terminateProcessTree(pid, true)
    }, terminationGraceMs)
    return true
  }
  const armIdleTimer = (): void => {
    if (idleTimeoutMs <= 0 || termination || settled) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      terminate({ kind: 'timed-out', reason: 'provider process produced no output before its idle timeout' })
    }, idleTimeoutMs)
  }
  const onAbort = (): void => {
    if (options.signal) terminate({ kind: 'cancelled', reason: cancellationReason(options.signal) })
  }
  const onOutput = (stream: ProviderProcessOutput['stream'], chunk: Buffer | string): void => {
    const text = String(chunk)
    if (stream === 'stdout') {
      stdout.append(text)
      telemetry.append(text)
    } else {
      stderr.append(text)
    }
    options.onOutput?.({ stream, text })
    armIdleTimer()
  }

  child.stdout?.on('data', chunk => { onOutput('stdout', chunk) })
  child.stderr?.on('data', chunk => { onOutput('stderr', chunk) })
  child.stdin?.on('error', () => {})
  child.on('close', code => { finalize(code) })
  child.on('error', error => {
    finish({ ...evidence(), kind: 'spawn-failed', error: recordFailure ?? error.message })
  })
  if (pid !== undefined) {
    try {
      recordAdapter.publish(record)
      recordPublished = true
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      recordFailure = `process ownership record failure: ${reason}`
      child.stdin?.end()
      terminate({ kind: 'cancelled', reason: recordFailure })
    }
  }

  const handle: ProviderProcessHandle = {
    pid,
    invocation,
    recordPath: record.path,
    completion,
    cancel(reason: string): boolean {
      return terminate({ kind: 'cancelled', reason })
    },
  }
  if (recordFailure) return handle
  child.stdin?.end(invocation.input)
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
  armIdleTimer()

  return handle
}
