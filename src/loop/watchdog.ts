import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'
import { processIncarnation } from '../agents/process-incarnation.js'
import { prepareWindowsInvocation } from '../agents/windows-launch.js'
import { createSupervision, supervisionLimits, assertPreviousProvidersStopped } from '../agents/supervision.js'

export interface SpawnLike {
  (command: string, args: string[], opts: { shell: boolean; detached: boolean }): {
    stdout: { on(ev: 'data', cb: (d: unknown) => void): void }
    stderr: { on(ev: 'data', cb: (d: unknown) => void): void }
    stdin: unknown
    kill(signal?: string): void
    pid?: number
    on(ev: 'close', cb: (code: number | null, signal: string | null) => void): void
    on(ev: 'error', cb: (e: Error) => void): void
  }
}

export interface WatchdogOpts {
  command: string
  args: string[]
  idleMs: number
  attempt?: number
  totalMs?: number
  progressMs?: number
  spawnFn?: SpawnLike
  /** Wait after SIGTERM before force-killing with SIGKILL. Default 5000. */
  graceMs?: number
  stdin?: Readable
  out?: (d: unknown) => void
  err?: (d: unknown) => void
  /**
   * Kill the child's WHOLE process tree. Defaults to `taskkill /T` on win32,
   * where child.kill() only terminates the spawned shell (shell: true) and
   * orphans the actual agent process — which then keeps writing to the
   * worktree, holds file handles, and burns API tokens. Injectable for tests.
   */
  killTree?: (pid: number, force: boolean) => boolean | void
  /**
   * Record {watchdogPid, childPid} here on spawn, remove on exit. This is the
   * scoped-cleanup contract: `yoke loop cleanup` kills ONLY pids recorded in
   * the project's own pid files — never by process-name or command-line
   * pattern, which would take down runners belonging to other projects.
   */
  pidFile?: string
}

// Kill one recorded process tree, platform-appropriately. Exported for
// `yoke loop cleanup` (scoped reaping of recorded runner pids).
export function killProcessTree(pid: number, force = true): void {
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* best-effort */ }
  } else {
    try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
  }
}

export type TaskkillRunner = (command: string, args: string[]) => number | null
export type ProcessSignaler = (pid: number, signal: NodeJS.Signals | 0) => void
export type ProcessAlive = (pid: number) => boolean

function waitForCleanupRetry(): void {
  spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)'], { stdio: 'ignore' })
}

function confirmProcessStopped(pid: number, isProcessAlive: ProcessAlive): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isProcessAlive(pid)) return true
    waitForCleanupRetry()
  }
  return false
}

export function killProcessForCleanup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  runTaskkill: TaskkillRunner = (command, args) => spawnSync(command, args, { stdio: 'ignore', timeout: 5000, windowsHide: true }).status,
  sendSignal: ProcessSignaler = (target, signal) => { process.kill(target, signal) },
  isProcessAlive: ProcessAlive = (target) => {
    try { process.kill(target, 0); return true } catch { return false }
  },
): boolean {
  if (platform === 'win32') {
    if (runTaskkill('taskkill', ['/PID', String(pid), '/T', '/F']) !== 0) return false
    return confirmProcessStopped(pid, isProcessAlive)
  }
  try {
    sendSignal(pid, 'SIGKILL')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
  return confirmProcessStopped(pid, isProcessAlive)
}

export function killProcessTreeForCleanup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  runTaskkill: TaskkillRunner = (command, args) => spawnSync(command, args, { stdio: 'ignore', timeout: 5000, windowsHide: true }).status,
  sendSignal: ProcessSignaler = (target, signal) => { process.kill(target, signal) },
  isProcessAlive: ProcessAlive = (target) => {
    try { process.kill(target, 0); return true } catch { return false }
  },
): boolean {
  if (platform === 'win32') {
    // taskkill reports a non-zero status when the process disappeared between
    // observation and cleanup; that is already the desired terminal state.
    if (runTaskkill('taskkill', ['/PID', String(pid), '/T', '/F']) !== 0) return !isProcessAlive(pid)
    return confirmProcessStopped(pid, isProcessAlive)
  }
  try {
    // Provider processes run detached on POSIX, so their PID is also the
    // process-group leader. Signal the group to reap descendants as well.
    sendSignal(-pid, 'SIGKILL')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
  return true
}

// win32 default: kill the whole tree. Console apps have no reliable soft-close
// on Windows, so both phases force (/F) — the grace pass is a retry, not an
// escalation. Best-effort by design: taskkill is a standard Windows component.
function taskkillTree(pid: number, _force: boolean): void {
  try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* best-effort */ }
}

export function runWatchdog(opts: WatchdogOpts): Promise<number> {
  const spawnFn = opts.spawnFn ?? (spawn as unknown as SpawnLike)
  const out = opts.out ?? ((d) => process.stdout.write(d as Buffer))
  const err = opts.err ?? ((d) => process.stderr.write(d as Buffer))
  let fail: (reason: string) => void = () => {}
  let progress: () => void = () => {}
  const limits = opts.spawnFn ? { totalMs: 30 * 60_000, progressMs: 20 * 60_000 } : supervisionLimits(process.cwd())
  const supervision = opts.spawnFn ? undefined : createSupervision(process.cwd(), reason => fail(reason), () => progress(), opts.attempt)
  let launch
  try {
    if (!opts.spawnFn) assertPreviousProvidersStopped(process.cwd())
    launch = process.platform === 'win32' && !opts.spawnFn
      ? prepareWindowsInvocation({ command: opts.command, args: opts.args, input: '', cwd: process.cwd() })
      : { command: opts.command, args: opts.args, env: process.env }
  } catch (error) {
    const reason = (error as Error).message
    supervision?.stop(reason); err(`Yoke infrastructure: ${reason}\n`); return Promise.resolve(125)
  }
  const child = spawnFn(launch.command, launch.args, { shell: false, detached: process.platform !== 'win32', env: launch.env, windowsHide: true } as Parameters<SpawnLike>[2])
  const incarnation = child.pid === undefined || opts.spawnFn ? undefined : processIncarnation(child.pid)
  supervision?.start(child.pid, 'shell' in launch ? launch.shell : undefined, incarnation)

  if (opts.stdin && (child.stdin as unknown)) {
    try { (opts.stdin as Readable).pipe(child.stdin as never) } catch { /* no stdin */ }
  }

  if (opts.pidFile && child.pid !== undefined) {
    try {
      writeFileSync(opts.pidFile, JSON.stringify({ watchdogPid: process.pid, watchdogIncarnation: processIncarnation(process.pid), childPid: child.pid, childIncarnation: processIncarnation(child.pid), startedAt: new Date().toISOString() }))
    } catch { /* best-effort — cleanup falls back to worktree/lock handling */ }
  }
  const removePidFile = () => {
    if (opts.pidFile) { try { rmSync(opts.pidFile, { force: true }) } catch { /* best-effort */ } }
  }

  const graceMs = opts.graceMs ?? 5000
  // Explicitly-passed killTree wins (including an explicit undefined, which pins
  // the per-process signal path — tests use this to be platform-independent).
  const killTree = 'killTree' in opts ? opts.killTree : opts.spawnFn ? undefined : (pid: number, _force: boolean) => {
    try { process.kill(pid, 0) } catch { return true }
    if (!opts.spawnFn && (!incarnation || processIncarnation(pid) !== incarnation)) return false
    return killProcessTreeForCleanup(pid)
  }
  // Terminate the child — via the tree-killer when we have one and a pid,
  // otherwise per-process signals (POSIX default; SIGKILL is uncatchable).
  let terminationRequested = false
  let terminationConfirmed = false
  const terminate = (child: { pid?: number; kill(signal?: string): void }, force: boolean): void => {
    terminationRequested = true
    if (killTree && child.pid !== undefined) {
      terminationConfirmed = killTree(child.pid, force) === true || terminationConfirmed
      return
    }
    try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
  }

  return new Promise<number>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let killedForIdle = false
    let reason: string | undefined
    let totalTimer: ReturnType<typeof setTimeout> | undefined
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    // Clear BOTH the idle timer and the post-SIGTERM grace timer so no dangling
    // timers survive on any terminal path (close/error) or on each re-arm.
    const clear = () => {
      if (timer) { clearTimeout(timer); timer = undefined }
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined }
    }
    const arm = () => {
      if (opts.idleMs <= 0) return
      // Once we've committed to killing, output no longer rescinds the escalation:
      // a child that catches SIGTERM and keeps emitting heartbeats must not be able
      // to reset the idle clock / cancel the pending SIGKILL. Forwarding still happens
      // because the data handlers call out(d)/err(d) BEFORE arm().
      if (killedForIdle) return
      clear()
      timer = setTimeout(() => {
        timer = undefined
        killedForIdle = true
        reason = 'provider-output-timeout'
        terminate(child, false)
        // Escalation: a child that catches/ignores the soft kill would never emit
        // 'close' and the promise would hang forever — defeating the watchdog.
        // POSIX: SIGKILL is uncatchable. win32: taskkill /T /F again as a retry —
        // and crucially the TREE dies, not just the shell, so no orphaned agent
        // keeps writing to the worktree or burning API tokens.
        graceTimer = setTimeout(() => {
          graceTimer = undefined
          terminate(child, true)
          supervision?.stop(reason, terminationConfirmed)
          if (totalTimer) clearTimeout(totalTimer)
          if (progressTimer) clearTimeout(progressTimer)
          resolve(124)
        }, graceMs)
      }, opts.idleMs)
    }
    fail = (failure) => {
      if (killedForIdle) return
      killedForIdle = true; reason = failure
      err(`Yoke infrastructure: ${failure}\n`)
      clear(); terminate(child, false)
      graceTimer = setTimeout(() => {
        terminate(child, true); supervision?.stop(reason, terminationConfirmed)
        if (totalTimer) clearTimeout(totalTimer)
        if (progressTimer) clearTimeout(progressTimer)
        resolve(125)
      }, graceMs)
    }
    progress = () => {
      if (progressTimer) clearTimeout(progressTimer)
      if ((opts.progressMs ?? limits.progressMs) > 0) progressTimer = setTimeout(() => fail('provider-progress-timeout'), opts.progressMs ?? limits.progressMs)
    }
    if ((opts.totalMs ?? limits.totalMs) > 0) totalTimer = setTimeout(() => fail('provider-total-timeout'), opts.totalMs ?? limits.totalMs)
    progress()
    child.stdout.on('data', (d) => { out(d); supervision?.output('stdout', String(d)); arm() })
    child.stderr.on('data', (d) => { err(d); supervision?.output('stderr', String(d)); arm() })
    const clearAll = () => { clear(); if (totalTimer) clearTimeout(totalTimer); if (progressTimer) clearTimeout(progressTimer) }
    child.on('error', () => { clearAll(); supervision?.stop('provider-spawn-failed'); removePidFile(); resolve(127) })
    child.on('close', (code, signal) => {
      supervision?.flush()
      clearAll()
      supervision?.stop(reason ?? (code === 0 ? 'provider-exited' : 'provider-exit-failed'), !terminationRequested || terminationConfirmed)
      if (!terminationRequested || terminationConfirmed) removePidFile()
      if (killedForIdle) { resolve(124); return }
      if (code !== null) { resolve(code); return }
      const signalNumber = signal ? constants.signals[signal as NodeJS.Signals] : undefined
      resolve(signalNumber === undefined ? 1 : 128 + signalNumber)
    })
    arm()
  })
}

export function parseWatchdogArgs(argv: string[]): { idleMs: number; totalMs?: number; attempt?: number; command: string; args: string[]; pidFile?: string } {
  const sep = argv.indexOf('--')
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const rest = sep === -1 ? [] : argv.slice(sep + 1)
  const idleArg = flags.find((a) => a.startsWith('--idle-ms='))
  const idleMs = idleArg ? Number(idleArg.slice('--idle-ms='.length)) : 0
  const totalArg = flags.find(a => a.startsWith('--total-ms='))?.slice('--total-ms='.length)
  const attempt = Number(flags.find(a => a.startsWith('--attempt='))?.slice('--attempt='.length))
  const pidFile = flags.find((a) => a.startsWith('--pid-file='))?.slice('--pid-file='.length)
  const [command, ...args] = rest
  return { idleMs: Number.isFinite(idleMs) ? idleMs : 0, command: command ?? '', args, ...(pidFile ? { pidFile } : {}), ...(Number.isInteger(attempt) && attempt > 0 ? { attempt } : {}), ...(totalArg && Number.isFinite(Number(totalArg)) && Number(totalArg) > 0 ? { totalMs: Number(totalArg) } : {}) }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  const { idleMs, totalMs, attempt, command, args, pidFile } = parseWatchdogArgs(process.argv.slice(2))
  if (!command) { process.stderr.write('watchdog: no command given\n'); process.exit(2) }
  runWatchdog({ command, args, idleMs, totalMs, attempt, stdin: process.stdin, pidFile }).then((code) => process.exit(code))
}
