import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'

export interface SpawnLike {
  (command: string, args: string[], opts: { shell: boolean }): {
    stdout: { on(ev: 'data', cb: (d: unknown) => void): void }
    stderr: { on(ev: 'data', cb: (d: unknown) => void): void }
    stdin: unknown
    kill(signal?: string): void
    pid?: number
    on(ev: 'close', cb: (code: number | null) => void): void
    on(ev: 'error', cb: (e: Error) => void): void
  }
}

export interface WatchdogOpts {
  command: string
  args: string[]
  idleMs: number
  spawnFn?: SpawnLike
  /** Wait after SIGTERM before force-killing with SIGKILL. Default 5000. */
  graceMs?: number
  stdin?: Readable
  out?: (d: unknown) => void
  err?: (d: unknown) => void
}

export function runWatchdog(opts: WatchdogOpts): Promise<number> {
  const spawnFn = opts.spawnFn ?? (spawn as unknown as SpawnLike)
  const out = opts.out ?? ((d) => process.stdout.write(d as Buffer))
  const err = opts.err ?? ((d) => process.stderr.write(d as Buffer))
  const child = spawnFn(opts.command, opts.args, { shell: process.platform === 'win32' })

  if (opts.stdin && (child.stdin as unknown)) {
    try { (opts.stdin as Readable).pipe(child.stdin as never) } catch { /* no stdin */ }
  }

  const graceMs = opts.graceMs ?? 5000

  return new Promise<number>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let killedForIdle = false
    // Clear BOTH the idle timer and the post-SIGTERM grace timer so no dangling
    // timers survive on any terminal path (close/error) or on each re-arm.
    const clear = () => {
      if (timer) { clearTimeout(timer); timer = undefined }
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined }
    }
    const arm = () => {
      if (opts.idleMs <= 0) return
      clear()
      timer = setTimeout(() => {
        timer = undefined
        killedForIdle = true
        try { child.kill('SIGTERM') } catch { /* already gone */ }
        // Escalation: a child that catches/ignores SIGTERM would never emit
        // 'close' and the promise would hang forever — defeating the watchdog.
        // SIGKILL is uncatchable, so the child must close and we resolve.
        // win32 limitation: with shell:true, SIGKILL on the shell may orphan
        // grandchild processes (a resource-cleanup edge, not a hang) — not fixed here.
        graceTimer = setTimeout(() => {
          graceTimer = undefined
          try { child.kill('SIGKILL') } catch { /* already gone */ }
        }, graceMs)
      }, opts.idleMs)
    }
    child.stdout.on('data', (d) => { out(d); arm() })
    child.stderr.on('data', (d) => { err(d); arm() })
    child.on('error', () => { clear(); resolve(127) })
    child.on('close', (code) => { clear(); resolve(killedForIdle ? 124 : (code ?? 0)) })
    arm()
  })
}

export function parseWatchdogArgs(argv: string[]): { idleMs: number; command: string; args: string[] } {
  const sep = argv.indexOf('--')
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const rest = sep === -1 ? [] : argv.slice(sep + 1)
  const idleArg = flags.find((a) => a.startsWith('--idle-ms='))
  const idleMs = idleArg ? Number(idleArg.slice('--idle-ms='.length)) : 0
  const [command, ...args] = rest
  return { idleMs: Number.isFinite(idleMs) ? idleMs : 0, command: command ?? '', args }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
  const { idleMs, command, args } = parseWatchdogArgs(process.argv.slice(2))
  if (!command) { process.stderr.write('watchdog: no command given\n'); process.exit(2) }
  runWatchdog({ command, args, idleMs, stdin: process.stdin }).then((code) => process.exit(code))
}
