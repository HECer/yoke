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
import { prepareWindowsInvocation, resolveWindowsCommand } from './windows-launch.js'
import { createSupervision, supervisionLimits, assertPreviousProvidersStopped } from './supervision.js'

export type ProviderProcessOutput = {
  readonly stream: 'stdout' | 'stderr'
  readonly text: string
}

export type ProviderProcessOptions = {
  readonly attempt?: number
  readonly idleTimeoutMs?: number
  readonly totalTimeoutMs?: number
  readonly progressTimeoutMs?: number
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
  const resolved = platform === 'win32' ? resolveWindowsCommand(invocation.command, invocation.args) : invocation
  return {
    command: resolved.command,
    args: resolved.args,
    cwd: invocation.cwd,
    shell: false,
    detached: platform !== 'win32',
  }
}

export function startProviderProcess(agent: Agent, invocation: AgentInvocation, options: ProviderProcessOptions = {}): ProviderProcessHandle {
  let failure: (reason: string) => void = () => {}
  let progress: () => void = () => {}
  const limits = supervisionLimits(invocation.cwd)
  const supervision = createSupervision(invocation.cwd, reason => failure(reason), () => progress(), options.attempt)
  let prepared
  try { assertPreviousProvidersStopped(invocation.cwd); prepared = process.platform === 'win32' ? prepareWindowsInvocation(invocation) : { command: invocation.command, args: invocation.args, env: process.env } }
  catch (error) {
    const message = (error as Error).message; supervision.stop(message)
    return { pid: undefined, invocation, recordPath: '', cancel: () => false, completion: Promise.resolve({ kind: 'spawn-failed', error: message, invocation, pid: undefined, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, telemetry: { usageAvailable: false } }) }
  }
  const spawnOptions = { ...prepared, cwd: invocation.cwd, shell: false, detached: process.platform !== 'win32' }
  const child = spawn(spawnOptions.command, [...spawnOptions.args], {
    cwd: spawnOptions.cwd,
    shell: spawnOptions.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: spawnOptions.detached,
    env: prepared.env,
    windowsHide: true,
  })
  const targetDir = resolve(invocation.cwd)
  const pid = child.pid
  const startedAt = pid === undefined ? `unverified:${new Date().toISOString()}` : processIncarnation(pid) ?? `unverified:${new Date().toISOString()}`
  supervision.start(pid, 'shell' in prepared ? prepared.shell : undefined, startedAt.startsWith('unverified:') ? undefined : startedAt)
  const record = createProviderProcessRecord(targetDir, pid ?? 0, options.workerId, startedAt)
  const recordAdapter = options.recordAdapter ?? filesystemProviderProcessRecordAdapter
  const terminateProcessTree = options.terminateProcessTree ?? ((processPid: number) => {
    try { process.kill(processPid, 0) } catch { return true }
    if (startedAt.startsWith('unverified:') || processIncarnation(processPid) !== startedAt) return false
    return killProcessTreeForCleanup(processPid)
  })
  let recordPublished = false

  const stdout = createBoundedOutput(options.outputLimitBytes ?? 1_048_576)
  const stderr = createBoundedOutput(options.outputLimitBytes ?? 1_048_576)
  const telemetry = createTelemetryAccumulator(agent)
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  const terminationGraceMs = options.terminationGraceMs ?? 5_000
  let termination: ProcessTermination | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  let totalTimer: ReturnType<typeof setTimeout> | undefined
  let progressTimer: ReturnType<typeof setTimeout> | undefined
  let completionTimer: ReturnType<typeof setTimeout> | undefined
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
    if (totalTimer) clearTimeout(totalTimer)
    if (progressTimer) clearTimeout(progressTimer)
    if (completionTimer) clearTimeout(completionTimer)
    idleTimer = undefined
    forceTimer = undefined
  }
  const finish = (result: ProviderProcessResult): void => {
    if (settled) return
    settled = true
    clearTimers()
    supervision.stop(termination?.reason ?? (result.kind === 'succeeded' ? 'provider-exited' : 'provider-failed'), !termination || terminationConfirmed)
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
    if (settled) return
    supervision.flush()
    // Windows can emit close before taskkill's process-tree state is observable.
    // Reconfirm here so successful termination does not leave a stale ownership record.
    if (termination && pid !== undefined && !terminationConfirmed) {
      terminationConfirmed = terminateProcessTree(pid, true)
    }
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
      // Allow close/pipe draining to confirm termination before the bounded fallback.
      if (!settled) completionTimer = setTimeout(() => {
        if (settled) return
        // A killer's return value is not an observed process exit.
        if (pid !== undefined) { try { process.kill(pid, 0); terminationConfirmed = false } catch { /* exited */ } }
        finalize(null)
      }, 5000)
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
    supervision.output(stream, text)
    armIdleTimer()
  }
  failure = reason => { terminate({ kind: 'cancelled', reason }) }
  progress = () => {
    if (progressTimer) clearTimeout(progressTimer)
    if ((options.progressTimeoutMs ?? limits.progressMs) > 0) progressTimer = setTimeout(() => terminate({ kind: 'timed-out', reason: 'provider-progress-timeout' }), options.progressTimeoutMs ?? limits.progressMs)
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
  if ((options.totalTimeoutMs ?? limits.totalMs) > 0) totalTimer = setTimeout(() => terminate({ kind: 'timed-out', reason: 'provider-total-timeout' }), options.totalTimeoutMs ?? limits.totalMs)
  progress()

  return handle
}
