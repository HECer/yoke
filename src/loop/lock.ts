import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface LockInfo { pid: number; startedAt: string; ownerToken?: string }
export interface LockResult { acquired: boolean; holderPid?: number; stalePid?: number; ownerToken?: string }

export function lockPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.lock')
}

export function takeoverLockPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.lock.takeover')
}

export function takeoverRecoveryPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.lock.takeover.recovery')
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

function readLockFile(file: string): LockInfo | null {
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as LockInfo
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function readLock(targetDir: string): LockInfo | null {
  return readLockFile(lockPath(targetDir))
}

// Publish complete metadata in one atomic namespace operation. Unlike open('wx')
// followed by write(), contenders can never observe an empty/partial lock file.
function publishLock(file: string, info: LockInfo): boolean {
  const temp = `${file}.${info.ownerToken ?? randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(info), { flag: 'wx' })
  try {
    linkSync(temp, file)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return false
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EXDEV' || code === 'EACCES') {
      throw new Error(`Yoke cannot publish an atomic loop lock on this filesystem (${code}). Move the project to a filesystem with hard-link support.`)
    }
    throw error
  } finally {
    rmSync(temp, { force: true })
  }
}

function releaseLockFile(file: string, ownerToken: string | undefined): void {
  if (!ownerToken) return
  try {
    if (readLockFile(file)?.ownerToken === ownerToken) rmSync(file, { force: true })
  } catch { /* best-effort */ }
}

export function acquireTakeoverLease(targetDir: string, pid: number = process.pid): LockResult {
  const file = takeoverLockPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(takeoverRecoveryPath(targetDir))) {
    return { acquired: false, holderPid: readLockFile(takeoverRecoveryPath(targetDir))?.pid }
  }
  const ownerToken = randomUUID()
  const lease: LockInfo = { pid, startedAt: new Date().toISOString(), ownerToken }
  return publishLock(file, lease)
    ? { acquired: true, ownerToken }
    : { acquired: false, holderPid: readLockFile(file)?.pid }
}

export function releaseTakeoverLease(targetDir: string, ownerToken: string | undefined): void {
  releaseLockFile(takeoverLockPath(targetDir), ownerToken)
}

export function acquireTakeoverRecoveryLease(targetDir: string, pid: number = process.pid): LockResult {
  const file = takeoverRecoveryPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  const ownerToken = randomUUID()
  const lease: LockInfo = { pid, startedAt: new Date().toISOString(), ownerToken }
  return publishLock(file, lease)
    ? { acquired: true, ownerToken }
    : { acquired: false, holderPid: readLockFile(file)?.pid }
}

export function releaseTakeoverRecoveryLease(targetDir: string, ownerToken: string | undefined): void {
  releaseLockFile(takeoverRecoveryPath(targetDir), ownerToken)
}

export function acquireLock(targetDir: string, pid: number = process.pid): LockResult {
  const file = lockPath(targetDir)
  const takeoverFile = takeoverLockPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })

  const ownerToken = randomUUID()
  const candidate: LockInfo = { pid, startedAt: new Date().toISOString(), ownerToken }

  // A stale-lock owner is currently being revalidated. Joining that race would
  // let a late contender publish between removal and replacement.
  const recoveryFile = takeoverRecoveryPath(targetDir)
  if (existsSync(takeoverFile) || existsSync(recoveryFile)) {
    return { acquired: false, holderPid: readLockFile(takeoverFile)?.pid ?? readLockFile(recoveryFile)?.pid }
  }
  if (publishLock(file, candidate)) return { acquired: true, ownerToken }

  const observed = readLock(targetDir)
  if (observed && isPidAlive(observed.pid)) return { acquired: false, holderPid: observed.pid }

  // Serialize stale takeover with a second, atomically published lease. A
  // crashed takeover lease is deliberately recovered by `yoke loop cleanup`;
  // guessing here would recreate the same TOCTOU race one level deeper.
  const takeover = acquireTakeoverLease(targetDir, pid)
  if (!takeover.acquired) return { ...takeover, stalePid: observed?.pid }

  try {
    const current = readLock(targetDir)
    if (current && isPidAlive(current.pid)) return { acquired: false, holderPid: current.pid, stalePid: observed?.pid }
    rmSync(file, { force: true })
    if (publishLock(file, candidate)) return { acquired: true, stalePid: current?.pid ?? observed?.pid, ownerToken }
    return { acquired: false, holderPid: readLock(targetDir)?.pid, stalePid: current?.pid ?? observed?.pid }
  } finally {
    releaseTakeoverLease(targetDir, takeover.ownerToken)
  }
}

// Best-effort and ownership-checked: teardown never deletes a successor's lock.
export function releaseLock(targetDir: string, ownerToken: string | undefined): void {
  releaseLockFile(lockPath(targetDir), ownerToken)
}
