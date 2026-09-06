import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { processIncarnation } from './process-incarnation.js'
import { loadConfig } from '../retrofit/config.js'

export function supervisionLimits(cwd: string): { totalMs: number; progressMs: number } {
  const loop = loadConfig(cwd)?.loop
  return { totalMs: (loop?.maxCallMinutes ?? 30) * 60_000, progressMs: (loop?.progressTimeoutMinutes ?? 20) * 60_000 }
}

export function assertPreviousProvidersStopped(cwd: string): void {
  if (readSupervision(cwd, '').some(record => record.state === 'termination-unconfirmed' && record.liveness !== 'exited')) {
    throw Error('A previous provider termination is unconfirmed; inspect owned process records before starting another worker')
  }
}

export interface SupervisionState {
  id: string; supervisorPid: number; childPid?: number; startedAt: string; heartbeatAt: string;
  lastOutputAt?: string; lastProgressAt?: string; state: 'preflight' | 'running' | 'stopping' | 'stopped' | 'termination-unconfirmed';
  reason?: string; shell?: string; retry: number;
  childIncarnation?: string; liveness?: 'alive' | 'exited' | 'identity-unverified';
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
    || (event.type === 'tool_result' && event.status === 'success')
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
  let pending = '', stderrPending = '', terminal = false, failure: string | undefined
  const save = () => {
    state.heartbeatAt = now()
    mkdirSync(dir, { recursive: true })
    const temp = path + '.tmp'; writeFileSync(temp, JSON.stringify(state)); renameSync(temp, path)
  }
  save()
  const timer = setInterval(() => { if (!terminal) save() }, 5000)
  timer.unref()
  return {
    state,
    flush() { if (pending) this.output('stdout', '\n'); if (stderrPending) this.output('stderr', '\n') },
    start(pid?: number, shell?: string, incarnation?: string) { state.childPid = pid; state.childIncarnation = incarnation; state.shell = shell; state.state = 'running'; save() },
    output(stream: string, text: string) {
      state.lastOutputAt = now()
      const lines = ((stream === 'stdout' ? pending : stderrPending) + text).split(/\r?\n/u)
      const tail = lines.pop() ?? ''
      if (stream === 'stdout') pending = tail.length > 262144 ? '' : tail
      else stderrPending = tail.length > 262144 ? '' : tail
      for (const line of lines) {
        if (line.length > 262144) continue
        const result = stream === 'stdout' ? inspectProviderEvent(line) : { failure: inspectProviderDiagnostic(line) }
        if (result.progress) { state.lastProgressAt = now(); onProgress() }
        if (result.failure && !failure) { failure = result.failure; state.reason = failure; state.state = 'stopping'; save(); onFailure(failure) }
      }
    },
    stop(reason?: string, confirmed = true) { terminal = true; clearInterval(timer); state.reason = failure ?? reason; state.state = confirmed ? 'stopped' : 'termination-unconfirmed'; save() },
    get failure() { return failure },
  }
}

export function readSupervision(root: string, since: string): SupervisionState[] {
  const roots = [root]
  try {
    for (const name of readdirSync(join(root, '.yoke', 'worktrees')).slice(0, 100)) {
      const path = join(root, '.yoke', 'worktrees', name)
      if (lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()) roots.push(path)
    }
  } catch { /* no isolated workers */ }
  const records: SupervisionState[] = []
  for (const cwd of roots) {
    const dir = join(cwd, '.yoke', 'supervision')
    try {
      if (lstatSync(dir).isSymbolicLink()) continue
      for (const name of readdirSync(dir).filter(n => n.endsWith('.json')).slice(-200)) {
        const path = join(dir, name), stat = lstatSync(path)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) continue
        try { const record = JSON.parse(readFileSync(path, 'utf8')); if (typeof record.startedAt === 'string' && record.startedAt >= since && typeof record.heartbeatAt === 'string') records.push(record) } catch { /* incomplete/untrusted state */ }
      }
    } catch { /* no process evidence */ }
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20).map(record => ({ ...record, liveness: processLiveness(record) }))
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
