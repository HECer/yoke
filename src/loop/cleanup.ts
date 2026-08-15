import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseProviderProcessRecord } from '../agents/process-record.js'
import { processIncarnation } from '../agents/process-incarnation.js'
import {
  acquireTakeoverLease, acquireTakeoverRecoveryLease, lockPath, takeoverLockPath, readLock, isPidAlive,
  releaseTakeoverLease, releaseTakeoverRecoveryLease, takeoverRecoveryPath,
} from './lock.js'
import { killProcessForCleanup, killProcessTreeForCleanup } from './watchdog.js'
import { cleanupClaims } from './claims.js'

export interface CleanupOptions {
  git?: (args: string[], cwd: string) => void
  isAlive?: (pid: number) => boolean
  killTree?: (pid: number) => boolean
  processIncarnation?: (pid: number) => string | undefined
  removeWorktrees?: boolean
  discardStaleRecovery?: boolean
}

// Reap orphaned runners PROJECT-SCOPED: kill only pids recorded in this project's
// .yoke/runner.pid files (main dir + each worktree). Never by process-name or
// command-line pattern — that takes down runners belonging to OTHER projects,
// which then stall mid-story. Skipped entirely while the loop lock holder is
// alive: a live loop's runner is healthy, not an orphan.
export function reapRecordedRunners(targetDir: string, wtDir: string, isAlive: (pid: number) => boolean, isTreeAlive: (pid: number) => boolean, killChildTree: (pid: number) => boolean, killWatchdog: (pid: number) => boolean, currentIncarnation: (pid: number) => string | undefined): number {
  const pidFiles = [join(targetDir, '.yoke', 'runner.pid')]
  if (existsSync(wtDir)) {
    for (const name of readdirSync(wtDir)) pidFiles.push(join(wtDir, name, '.yoke', 'runner.pid'))
  }
  let killed = 0
  for (const file of pidFiles) {
    if (!existsSync(file)) continue
    let rec: { watchdogPid?: unknown; childPid?: unknown; watchdogIncarnation?: unknown; childIncarnation?: unknown } | undefined
    try {
      rec = JSON.parse(readFileSync(file, 'utf8')) as { watchdogPid?: unknown; childPid?: unknown; watchdogIncarnation?: unknown; childIncarnation?: unknown }
    } catch { /* malformed record — still consume the file below */ }
    if (!rec) {
      rmSync(file, { force: true })
      continue
    }
    // Child (agent tree) first, then the watchdog wrapper.
    for (const [pid, incarnation, treeOwned] of [[rec.childPid, rec.childIncarnation, true], [rec.watchdogPid, rec.watchdogIncarnation, false]] as const) {
      const alive = typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && (isAlive(pid) || (treeOwned && isTreeAlive(pid)))
      if (alive && typeof pid === 'number') {
        if (isAlive(pid) && (typeof incarnation !== 'string' || currentIncarnation(pid) !== incarnation)) {
          throw new Error(`could not confirm legacy runner process incarnation for pid ${pid}`)
        }
        const terminated = treeOwned ? killChildTree(pid) : killWatchdog(pid)
        if (!terminated && (isAlive(pid) || (treeOwned && isTreeAlive(pid)))) {
          throw new Error(`could not confirm legacy runner process tree termination for pid ${pid}`)
        }
        if (terminated) killed++
      }
    }
    rmSync(file, { force: true })
  }
  return killed
}

export function reapProviderProcesses(targetDir: string, isAlive: (pid: number) => boolean, isTreeAlive: (pid: number) => boolean, killTree: (pid: number) => boolean, currentIncarnation: (pid: number) => string | undefined = processIncarnation): number {
  const recordsDir = join(targetDir, '.yoke', 'provider-processes')
  if (!existsSync(recordsDir)) return 0
  const expectedTarget = resolve(targetDir)
  let killed = 0
  for (const name of readdirSync(recordsDir)) {
    const recordPath = join(recordsDir, name)
    let parsed: ReturnType<typeof parseProviderProcessRecord> = null
    try {
      parsed = parseProviderProcessRecord(JSON.parse(readFileSync(recordPath, 'utf8')))
    } catch { /* malformed records are not trusted or consumed */ }
    if (!parsed || parsed.targetDir !== expectedTarget) continue
    if (isAlive(parsed.childPid) || isTreeAlive(parsed.childPid)) {
      if (isAlive(parsed.childPid) && currentIncarnation(parsed.childPid) !== parsed.startedAt) {
        throw new Error(`could not confirm provider process incarnation for pid ${parsed.childPid}`)
      }
      const terminated = killTree(parsed.childPid)
      if (!terminated && (isAlive(parsed.childPid) || isTreeAlive(parsed.childPid))) {
        throw new Error(`could not confirm provider process tree termination for pid ${parsed.childPid}`)
      }
      if (terminated) killed++
    }
    rmSync(recordPath, { force: true })
  }
  return killed
}

export function isProviderTreeAlive(pid: number): boolean {
  if (process.platform === 'win32') return isPidAlive(pid)
  try { process.kill(-pid, 0); return true } catch { return false }
}

// Cleans ONLY yoke-created runtime artifacts: recorded orphan runners,
// .yoke/worktrees/*, and a stale loop.lock. Never touches user-created
// worktrees, a lock whose holder is alive, or any process it did not record.
export function runLoopCleanup(targetDir: string, opts: CleanupOptions = {}): number {
  const git = opts.git ?? ((args: string[], cwd: string) => { execFileSync('git', args, { cwd, stdio: 'pipe' }) })
  const isAlive = opts.isAlive ?? isPidAlive
  const killWatchdog = opts.killTree ?? killProcessForCleanup
  const killProviderTree = opts.killTree ?? killProcessTreeForCleanup
  const providerTreeAlive = process.platform === 'win32' ? isAlive : isProviderTreeAlive
  const currentIncarnation = opts.processIncarnation ?? processIncarnation
  const wtDir = join(targetDir, '.yoke', 'worktrees')

  const recoveryFile = takeoverRecoveryPath(targetDir)
  if (opts.discardStaleRecovery && existsSync(recoveryFile)) {
    let recoveryPid: number | undefined
    try {
      const parsed = JSON.parse(readFileSync(recoveryFile, 'utf8')) as { pid?: unknown }
      recoveryPid = typeof parsed.pid === 'number' ? parsed.pid : undefined
    } catch { /* corrupt recovery lease can only be operator-discarded */ }
    if (recoveryPid && isAlive(recoveryPid)) {
      console.error(`Refusing to discard a live takeover-recovery lease (pid ${recoveryPid}).`)
      return 1
    }
    rmSync(recoveryFile, { force: true })
    console.warn(`Discarded stale takeover-recovery lease${recoveryPid ? ` from dead pid ${recoveryPid}` : ''}. Do not run this flag concurrently.`)
  }

  const takeoverFile = takeoverLockPath(targetDir)
  let cleanupLease: ReturnType<typeof acquireTakeoverLease>
  try { cleanupLease = acquireTakeoverLease(targetDir) } catch (error) {
    console.error(`Cannot acquire the Yoke cleanup lease: ${(error as Error).message}`)
    return 1
  }
  if (!cleanupLease.acquired) {
    let recoveryLease: ReturnType<typeof acquireTakeoverRecoveryLease>
    try { recoveryLease = acquireTakeoverRecoveryLease(targetDir) } catch (error) {
      console.error(`Cannot acquire the Yoke takeover-recovery lease: ${(error as Error).message}`)
      return 1
    }
    if (!recoveryLease.acquired) {
      if (recoveryLease.holderPid && isAlive(recoveryLease.holderPid)) {
        console.log(`Loop lock takeover recovery is active (pid ${recoveryLease.holderPid}) — no cleanup performed.`)
        return 0
      }
      console.error('A stale takeover-recovery lease is blocking cleanup. Re-run explicitly with: yoke loop cleanup . --discard-stale-recovery')
      return 1
    }
    try {
      // This fixed recovery lease is recognized by normal acquisition and all
      // cleanup processes, so revalidation + removal cannot target a successor.
      let takeoverPid: number | undefined
      try {
        const parsed = JSON.parse(readFileSync(takeoverFile, 'utf8')) as { pid?: unknown }
        takeoverPid = typeof parsed.pid === 'number' ? parsed.pid : undefined
      } catch { /* corrupt takeover lease is stale */ }
      if (takeoverPid && isAlive(takeoverPid)) {
        console.log(`Loop lock takeover held by a live process (pid ${takeoverPid}) — no cleanup performed.`)
      } else {
        rmSync(takeoverFile, { force: true })
        console.log('Removed stale loop lock takeover lease; rerun cleanup to perform destructive cleanup safely.')
      }
    } finally {
      releaseTakeoverRecoveryLease(targetDir, recoveryLease.ownerToken)
    }
    return 0
  }

  try {
    // Holding this lease blocks every loop acquisition for the entire cleanup,
    // including runner reaping and worktree removal.
    const holder = readLock(targetDir)
    if (holder && isAlive(holder.pid)) {
      console.log(`Loop lock held by a live process (pid ${holder.pid}) — no cleanup performed.`)
      return 0
    }

    let killed: number
    try {
      killed = reapRecordedRunners(targetDir, wtDir, isAlive, providerTreeAlive, killProviderTree, killWatchdog, currentIncarnation) + reapProviderProcesses(targetDir, isAlive, providerTreeAlive, killProviderTree, currentIncarnation)
    } catch (error) {
      console.error(`Failed to reap recorded process trees: ${(error as Error).message}`)
      return 1
    }

    let removed = 0
    let failed = 0
    if (existsSync(wtDir)) {
      for (const name of readdirSync(wtDir)) {
        const path = join(wtDir, name)
        try {
          killed += reapProviderProcesses(path, isAlive, providerTreeAlive, killProviderTree, currentIncarnation)
        } catch (error) {
          console.error(`Failed to reap provider processes for worktree ${path}: ${(error as Error).message}`)
          failed++
          continue
        }
        if (!opts.removeWorktrees) {
          console.log(`Yoke worktree retained: ${path} (pass --remove-worktrees to remove it)`)
          continue
        }
        try {
          git(['worktree', 'remove', '--force', path], targetDir)
          markCandidateWorktreeRemoved(targetDir, path)
          removed++
        } catch (e) {
          console.error(`Failed to remove worktree ${path}: ${(e as Error).message}`)
          failed++
        }
      }
      if (opts.removeWorktrees) { try { git(['worktree', 'prune'], targetDir) } catch { /* best-effort */ } }
    }
    if (killed > 0) console.log(`Killed ${killed} orphaned process tree(s) from project-scoped Yoke records.`)
    if (opts.removeWorktrees && failed === 0) cleanupClaims(targetDir)

    const lockFile = lockPath(targetDir)
    if (existsSync(lockFile)) {
      rmSync(lockFile, { force: true })
      console.log('Removed stale loop lock.')
    }
    console.log(removed === 0 && failed === 0 ? 'No destructive cleanup performed.' : `Removed ${removed} worktree(s)${failed > 0 ? `, ${failed} failed` : ''}.`)
    return failed === 0 ? 0 : 1
  } finally {
    releaseTakeoverLease(targetDir, cleanupLease.ownerToken)
  }
}

function markCandidateWorktreeRemoved(targetDir: string, worktree: string): void {
  const proofRoot = join(targetDir, '.yoke', 'proof')
  if (!existsSync(proofRoot)) return
  for (const storyId of readdirSync(proofRoot)) {
    const candidates = join(proofRoot, storyId, 'candidates')
    if (!existsSync(candidates)) continue
    for (const candidateId of readdirSync(candidates)) {
      const status = join(candidates, candidateId, 'status.json')
      if (!existsSync(status)) continue
      try {
        const parsed = JSON.parse(readFileSync(status, 'utf8')) as { worktree?: unknown }
        if (parsed.worktree !== worktree) continue
        writeFileSync(status, JSON.stringify({ ...parsed, state: 'removed', reason: 'external cleanup recovered candidate worktree' }))
      } catch { continue }
    }
  }
}
