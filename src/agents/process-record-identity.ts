import { execFile, type ChildProcess } from 'node:child_process'
import { writeFileSync, renameSync, existsSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ProviderProcessRecord } from './process-record.js'
import { processIncarnation } from './process-incarnation.js'

/** Resolve ownership without blocking cancellation timers on a slow CIM query. */
export function trackProcessRecordIdentity(record: ProviderProcessRecord | undefined, child: ChildProcess): () => void {
  let cancelled = false
  const update = (identity: string | undefined): void => {
    if (!identity || cancelled || child.exitCode !== null || child.signalCode !== null || !record || !existsSync(record.path)) return
    const temporary = `${record.path}.${randomUUID()}.tmp`
    try { writeFileSync(temporary, JSON.stringify({ version: record.version, owner: record.owner, targetDir: record.targetDir, childPid: record.childPid, startedAt: identity, workerId: record.workerId }), { flag: 'wx', mode: 0o600 }); renameSync(temporary, record.path) } catch { /* unknown identity remains conservative */ } finally { try { rmSync(temporary, { force: true }) } catch { /* stale temporary is diagnostic evidence */ } }
  }
  if (!record || !child.pid) return () => {}
  if (process.platform !== 'win32') { update(processIncarnation(child.pid)); return () => { cancelled = true } }
  const query = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId = $env:YOKE_PROCESS_PID").CreationDate'], { env: { ...process.env, YOKE_PROCESS_PID: String(child.pid) }, windowsHide: true, timeout: 5000, maxBuffer: 4096 }, (error, stdout) => update(!error && stdout.trim() ? `win32:${stdout.trim()}` : undefined))
  return () => { cancelled = true; if (query.exitCode === null && query.signalCode === null) query.kill('SIGKILL') }
}
