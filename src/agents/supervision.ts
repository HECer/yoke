import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { processIncarnation } from './process-incarnation.js'
import { loadConfig } from '../retrofit/config.js'
import { createLineFramer } from './stream-buffer.js'
import { parseProviderProcessRecord } from './process-record.js'

export function supervisionLimits(cwd: string): { totalMs: number; progressMs: number } {
  const loop = loadConfig(cwd)?.loop
  return { totalMs: (loop?.maxCallMinutes ?? 30) * 60_000, progressMs: (loop?.progressTimeoutMinutes ?? 20) * 60_000 }
}

export function assertPreviousProvidersStopped(cwd: string): void {
  if (readSupervision(cwd, '', true).some(record => record.state === 'termination-unconfirmed' && (record.liveness !== 'exited' || record.ownershipRetained))) {
    throw Error('A previous provider termination is unconfirmed; inspect owned process records before starting another worker')
  }
}

export interface SupervisionState {
  id: string; supervisorPid: number; childPid?: number; startedAt: string; heartbeatAt: string;
  lastOutputAt?: string; lastProgressAt?: string; state: 'preflight' | 'running' | 'stopping' | 'stopped' | 'termination-unconfirmed';
  reason?: string; shell?: string; retry: number;
  childIncarnation?: string; liveness?: 'alive' | 'exited' | 'identity-unverified';
  ownershipRetained?: boolean;
}

/** A dead leader does not prove its tree exited; explicit cleanup consumes ownership. */
function retainedOwnership(cwd: string, pid: number): boolean {
  const dir = join(cwd, '.yoke', 'provider-processes')
  try {
    if (lstatSync(dir).isSymbolicLink()) return true
    const names = readdirSync(dir).filter(name => name.endsWith('.json'))
    if (names.length > 200) return true
    for (const name of names) {
      try {
        const path = join(dir, name), stat = lstatSync(path)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) return true
        const record = parseProviderProcessRecord(JSON.parse(readFileSync(path, 'utf8')))
        if (!record) return true
        // The record is in this project's ownership directory. A path alias or
        // casing difference cannot prove the retained process tree has exited.
        if (record.childPid === pid) return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
        // Cleanup of another entry cannot hide a later retained ownership record.
      }
    }
    return false
  } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT' }
}

/** Only provider error/tool-result envelopes are failure evidence; stderr MCP chatter is not. */
export function inspectProviderEvent(line: string): { failure?: string; progress?: boolean } {
  let event: any
  try { event = JSON.parse(line) } catch { return {} }
  if (!event || typeof event !== 'object') return {}
  const item = event.item
  const failedCommand = event.type === 'item.completed' && item?.type === 'command_execution' && (item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0))
  const fatal = event.type === 'error' || event.type === 'turn.failed' || (event.type === 'result' && (event.is_error === true || event.status === 'error'))
  if (failedCommand || fatal) {
    const details = JSON.stringify(failedCommand ? item.aggregated_output : event.error ?? event.errors ?? event.result ?? event.message)
    if (/CreateProcess(?:AsUserW|W)? failed|Failed to create unified exec process/iu.test(details ?? '')) return { failure: 'worker-shell-spawn-failed' }
    if (/AuthRequired|authentication failed|invalid api key|No access token|credentials (?:missing|not found)/iu.test(details ?? '')) return { failure: 'provider-authentication-failed' }
    if (fatal) return { failure: 'provider-terminal-error' }
  }
  return { progress: (event.type === 'item.completed' && ((item?.type === 'command_execution' && item.exit_code === 0) || (item?.type === 'file_change' && item.status === 'completed')))
    || (event.type === 'tool_execution_end' && event.isError === false)
    || (event.type === 'tool_use' && event.part?.type === 'tool' && event.part.state?.status === 'completed')
    || (event.type === 'tool_result' && (event.status === 'success' || event.is_error === false))
    || (event.type === 'user' && Array.isArray(event.message?.content) && event.message.content.some((part: any) => part.type === 'tool_result' && part.is_error === false)) }
}

export function inspectProviderDiagnostic(line: string): string | undefined {
  if (/\bERROR codex_core::tools::router: error=exec_command failed: CreateProcess\b/u.test(line) && /CreateProcess(?:AsUserW|W)? failed/u.test(line)) return 'worker-shell-spawn-failed'
  // Unrelated rmcp/MCP authentication diagnostics are intentionally excluded.
  if (/^(?:Error: |error: )(?:authentication failed|invalid api key|No access token)/iu.test(line)) return 'provider-authentication-failed'
  return undefined
}

export function createSupervision(cwd: string, onFailure: (reason: string) => void, onProgress: () => void = () => {}, attempt = 1) {
  const id = randomUUID(), dir = join(cwd, '.yoke', 'supervision'), path = join(dir, id + '.json')
  const now = () => new Date().toISOString()
  const state: SupervisionState = { id, supervisorPid: process.pid, startedAt: now(), heartbeatAt: now(), state: 'preflight', retry: Math.max(0, attempt - 1) }
  let terminal = false, failure: string | undefined
  const save = () => {
    state.heartbeatAt = now()
    mkdirSync(dir, { recursive: true })
    const temp = path + '.tmp'; writeFileSync(temp, JSON.stringify(state)); renameSync(temp, path)
  }
  const consume = (stream: string, line: string) => {
    const result = stream === 'stdout' ? inspectProviderEvent(line) : { failure: inspectProviderDiagnostic(line) }
    if (result.progress) { state.lastProgressAt = now(); onProgress() }
    if (result.failure && !failure) { failure = result.failure; state.reason = failure; state.state = 'stopping'; save(); onFailure(failure) }
  }
  // Discard an oversized line through its newline. A suffix is not a new event.
  const stdout = createLineFramer(line => consume('stdout', line), () => {}, 262144)
  const stderr = createLineFramer(line => consume('stderr', line), () => {}, 262144)
  save()
  const timer = setInterval(() => {
    if (terminal) return
    try { save() } catch {
      clearInterval(timer)
      failure ??= 'provider-supervision-storage-failed'
      state.reason = failure; state.state = 'stopping'
      onFailure(failure)
    }
  }, 5000)
  timer.unref()
  return {
    state,
    flush() { stdout.finish(); stderr.finish() },
    start(pid?: number, shell?: string, incarnation?: string) { state.childPid = pid; state.childIncarnation = incarnation; state.shell = shell; state.state = 'running'; save() },
    output(stream: string, text: string) {
      state.lastOutputAt = now()
      ;(stream === 'stdout' ? stdout : stderr).append(text)
    },
    stop(reason?: string, confirmed = true) { terminal = true; clearInterval(timer); state.reason = failure ?? reason; state.state = confirmed ? 'stopped' : 'termination-unconfirmed'; save() },
    get failure() { return failure },
  }
}

export function readSupervision(root: string, since: string, complete = false): SupervisionState[] {
  const roots = [root]
  try {
    const names = readdirSync(join(root, '.yoke', 'worktrees'))
    for (const name of complete ? names : names.slice(0, 100)) {
      const path = join(root, '.yoke', 'worktrees', name)
      try {
        const stat = lstatSync(path)
        if (stat.isDirectory() && !stat.isSymbolicLink()) roots.push(path)
        else if (complete && stat.isSymbolicLink()) throw Error('Cannot verify symlinked worktree')
      } catch (error) { if (complete && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  } catch (error) {
    if (complete && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const records: SupervisionState[] = []
  for (const cwd of roots) {
    const dir = join(cwd, '.yoke', 'supervision')
    try {
      if (lstatSync(dir).isSymbolicLink()) { if (complete) throw Error('Cannot verify symlinked supervision records'); continue }
      const names = readdirSync(dir).filter(n => n.endsWith('.json'))
      for (const name of complete ? names : names.slice(-200)) {
        try {
          const path = join(dir, name), stat = lstatSync(path)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) { if (complete) throw Error('Cannot verify unsafe supervision record'); continue }
          const record = JSON.parse(readFileSync(path, 'utf8')); if (record && typeof record.startedAt === 'string' && record.startedAt >= since && typeof record.heartbeatAt === 'string'
            && (!complete || ['preflight', 'running', 'stopping', 'stopped', 'termination-unconfirmed'].includes(record.state))) records.push({ ...record,
          ownershipRetained: record.state === 'termination-unconfirmed' && retainedOwnership(cwd, record.childPid) })
          else if (complete) throw Error('Cannot verify malformed supervision record')
        } catch (error) { if (complete && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    } catch (error) { if (complete && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const sorted = records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return (complete ? sorted : sorted.slice(0, 20)).map(record => ({ ...record, liveness: processLiveness(record) }))
}

const identities = new Map<number, { at: number; value?: string }>()
function processLiveness(record: SupervisionState): SupervisionState['liveness'] {
  if (!Number.isInteger(record.childPid) || record.childPid! <= 0) return 'identity-unverified'
  try { process.kill(record.childPid!, 0) } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'exited' : 'identity-unverified' }
  if (!record.childIncarnation) return 'identity-unverified'
  let identity = identities.get(record.childPid!)
  if (!identity || Date.now() - identity.at > 5000) {
    identity = { at: Date.now(), value: processIncarnation(record.childPid!) }; identities.set(record.childPid!, identity)
    if (identities.size > 100) identities.delete(identities.keys().next().value!)
  }
  return identity.value === record.childIncarnation ? 'alive' : 'identity-unverified'
}
