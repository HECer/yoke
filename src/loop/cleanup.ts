import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { lockPath, readLock, isPidAlive } from './lock.js'
import { killProcessTree } from './watchdog.js'

export interface CleanupOptions {
  git?: (args: string[], cwd: string) => void
  isAlive?: (pid: number) => boolean
  killTree?: (pid: number) => void
}

// Reap orphaned runners PROJECT-SCOPED: kill only pids recorded in this project's
// .yoke/runner.pid files (main dir + each worktree). Never by process-name or
// command-line pattern — that takes down runners belonging to OTHER projects,
// which then stall mid-story. Skipped entirely while the loop lock holder is
// alive: a live loop's runner is healthy, not an orphan.
function reapRecordedRunners(targetDir: string, wtDir: string, isAlive: (pid: number) => boolean, killTree: (pid: number) => void): number {
  const pidFiles = [join(targetDir, '.yoke', 'runner.pid')]
  if (existsSync(wtDir)) {
    for (const name of readdirSync(wtDir)) pidFiles.push(join(wtDir, name, '.yoke', 'runner.pid'))
  }
  let killed = 0
  for (const file of pidFiles) {
    if (!existsSync(file)) continue
    try {
      const rec = JSON.parse(readFileSync(file, 'utf8')) as { watchdogPid?: unknown; childPid?: unknown }
      // Child (agent tree) first, then the watchdog wrapper.
      for (const pid of [rec.childPid, rec.watchdogPid]) {
        if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
          killTree(pid)
          killed++
        }
      }
    } catch { /* malformed record — still consume the file below */ }
    rmSync(file, { force: true })
  }
  return killed
}

// Cleans ONLY yoke-created runtime artifacts: recorded orphan runners,
// .yoke/worktrees/*, and a stale loop.lock. Never touches user-created
// worktrees, a lock whose holder is alive, or any process it did not record.
export function runLoopCleanup(targetDir: string, opts: CleanupOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const isAlive = opts.isAlive ?? isPidAlive
  const killTree = opts.killTree ?? killProcessTree
  const wtDir = join(targetDir, '.yoke', 'worktrees')

  const holder = readLock(targetDir)
  const lockHeld = holder !== null && isPidAlive(holder.pid)
  if (!lockHeld) {
    const killed = reapRecordedRunners(targetDir, wtDir, isAlive, killTree)
    if (killed > 0) console.log(`Killed ${killed} orphaned runner process tree(s) recorded in runner.pid files.`)
  }

  let removed = 0
  let failed = 0
  if (existsSync(wtDir)) {
    for (const name of readdirSync(wtDir)) {
      const path = join(wtDir, name)
      try {
        git(['worktree', 'remove', '--force', path], targetDir)
        removed++
      } catch (e) {
        console.error(`Failed to remove worktree ${path}: ${(e as Error).message}`)
        failed++
      }
    }
    try { git(['worktree', 'prune'], targetDir) } catch { /* best-effort */ }
  }
  const lockFile = lockPath(targetDir)
  if (existsSync(lockFile)) {
    const holder = readLock(targetDir)
    if (holder && isPidAlive(holder.pid)) {
      console.log(`Loop lock held by a live process (pid ${holder.pid}) — left in place.`)
    } else {
      rmSync(lockFile, { force: true })
      console.log('Removed stale loop lock.')
    }
  }
  console.log(removed === 0 && failed === 0 ? 'Nothing to clean.' : `Removed ${removed} worktree(s)${failed > 0 ? `, ${failed} failed` : ''}.`)
  return failed === 0 ? 0 : 1
}
