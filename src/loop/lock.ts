import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface LockInfo { pid: number; startedAt: string }
export interface LockResult { acquired: boolean; holderPid?: number; stalePid?: number }

export function lockPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.lock')
}

// Liveness probe via signal 0. EPERM means "exists but not ours" — alive.
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function readLock(targetDir: string): LockInfo | null {
  const file = lockPath(targetDir)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as LockInfo
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function acquireLock(targetDir: string, pid: number = process.pid): LockResult {
  const file = lockPath(targetDir)
  const holder = readLock(targetDir)
  if (holder && isPidAlive(holder.pid)) return { acquired: false, holderPid: holder.pid }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ pid, startedAt: new Date().toISOString() }))
  return holder ? { acquired: true, stalePid: holder.pid } : { acquired: true }
}

// Best-effort: a missing file or an unwritable disk must never crash loop teardown.
export function releaseLock(targetDir: string): void {
  try { rmSync(lockPath(targetDir), { force: true }) } catch { /* best-effort */ }
}
