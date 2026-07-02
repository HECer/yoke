import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { lockPath, readLock, isPidAlive } from './lock.js'

export interface CleanupOptions {
  git?: (args: string[], cwd: string) => void
}

// Cleans ONLY yoke-created runtime artifacts: .yoke/worktrees/* and a stale loop.lock.
// Never touches user-created worktrees or a lock whose holder is alive.
export function runLoopCleanup(targetDir: string, opts: CleanupOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const wtDir = join(targetDir, '.yoke', 'worktrees')
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
