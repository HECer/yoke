import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reapProviderProcesses, reapRecordedRunners, runLoopCleanup } from '../../src/loop/cleanup.js'
import { lockPath, takeoverLockPath, takeoverRecoveryPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-clean-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runLoopCleanup', () => {
  it('reports nothing to clean on a fresh dir', () => {
    expect(runLoopCleanup(dir, { git: () => { throw new Error('must not be called') } })).toBe(0)
  })

  it('clears stale running status after successful cleanup', () => {
    const status = join(dir, '.yoke', 'loop-status.json')
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(status, JSON.stringify({ state: 'running', updatedAt: '2020-01-01T00:00:00.000Z' }))

    expect(runLoopCleanup(dir, { git: () => undefined })).toBe(0)
    expect(existsSync(status)).toBe(false)
  })

  it('removes every yoke worktree via git and prunes', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-1'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-2'), { recursive: true })
    const calls: string[][] = []
    const code = runLoopCleanup(dir, { git: (args) => { calls.push(args) }, removeWorktrees: true })
    expect(code).toBe(0)
    const removes = calls.filter(a => a[1] === 'remove')
    expect(removes).toHaveLength(2)
    expect(calls.some(a => a[1] === 'prune')).toBe(true)
  })

  it('returns 1 when a removal fails but continues with the rest', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'B'), { recursive: true })
    let n = 0
    const code = runLoopCleanup(dir, { git: (args) => { if (args[1] === 'remove' && n++ === 0) throw new Error('boom') }, removeWorktrees: true })
    expect(code).toBe(1)
    expect(n).toBeGreaterThan(0)
  })

  it('reports provider worktrees without removing them by default', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A'), { recursive: true })
    const calls: string[][] = []
    expect(runLoopCleanup(dir, { git: args => calls.push(args) })).toBe(0)
    expect(calls.filter(args => args[1] === 'remove')).toEqual([])
    expect(existsSync(join(dir, '.yoke', 'worktrees', 'A'))).toBe(true)
  })

  it('reaps provider processes inside retained worktrees during default cleanup', () => {
    const worktree = join(dir, '.yoke', 'worktrees', 'A')
    const record = join(worktree, '.yoke', 'provider-processes', 'worker.json')
    mkdirSync(join(worktree, '.yoke', 'provider-processes'), { recursive: true })
    writeFileSync(record, JSON.stringify({ version: 1, owner: 'provider-process', targetDir: worktree, childPid: 777, startedAt: 'incarnation-a' }))
    const killed: number[] = []

    expect(runLoopCleanup(dir, {
      git: () => undefined,
      isAlive: pid => pid === 777,
      killTree: pid => { killed.push(pid); return true },
      processIncarnation: () => 'incarnation-a',
    })).toBe(0)

    expect(killed).toEqual([777])
    expect(existsSync(record)).toBe(false)
    expect(existsSync(worktree)).toBe(true)
  })

  it('kills only the pids recorded in runner.pid files (project-scoped, never pattern-based)', () => {
    // Main-dir runner + one worktree runner left behind by a dead loop.
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A', '.yoke'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 111, watchdogIncarnation: 'incarnation-a', childPid: 222, childIncarnation: 'incarnation-a' }))
    writeFileSync(join(dir, '.yoke', 'worktrees', 'A', '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 333, watchdogIncarnation: 'incarnation-a', childPid: 444, childIncarnation: 'incarnation-a' }))
    const killed: number[] = []
    const code = runLoopCleanup(dir, {
      git: () => {},
      isAlive: (pid) => pid === 222 || pid === 333, // 111 and 444 already exited
      killTree: (pid) => { killed.push(pid); return true },
      processIncarnation: () => 'incarnation-a',
    })
    expect(code).toBe(0)
    expect(killed.sort()).toEqual([222, 333]) // only recorded-and-alive pids — nothing else on the machine
    expect(existsSync(join(dir, '.yoke', 'runner.pid'))).toBe(false) // consumed
  })

  it('recovers each persisted candidate status and its candidate-race claim when external cleanup removes worktrees', () => {
    const candidateDir = join(dir, '.yoke', 'worktrees', 'S1-candidate-1')
    const statusPath = join(dir, '.yoke', 'proof', 'S1', 'candidates', 'candidate-1', 'status.json')
    const claimPath = join(dir, '.yoke', 'claims', 'S1.json')
    mkdirSync(join(candidateDir, '.yoke'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'proof', 'S1', 'candidates', 'candidate-1'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'claims'), { recursive: true })
    writeFileSync(statusPath, JSON.stringify({ candidateId: 'candidate-1', worktree: candidateDir, state: 'running', result: { kind: 'provider-error' }, selection: { state: 'not-selected' } }))
    writeFileSync(claimPath, JSON.stringify({ storyId: 'S1', owner: 'candidate-race:S1', pid: process.pid, claimedAt: 'now' }))

    expect(runLoopCleanup(dir, {
      removeWorktrees: true,
      git: args => { if (args[1] === 'remove') rmSync(args[3]!, { recursive: true, force: true }) },
    })).toBe(0)

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toMatchObject({ candidateId: 'candidate-1', state: 'removed', reason: 'external cleanup recovered candidate worktree', result: { kind: 'provider-error' }, selection: { state: 'not-selected' } })
    expect(existsSync(claimPath)).toBe(false)
    expect(readdirSync(join(dir, '.yoke', 'worktrees'))).toEqual([])
  })

  it('retains a candidate runner record and worktree until child and watchdog termination are confirmed', () => {
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const pidFile = join(candidateDir, '.yoke', 'runner.pid')
    mkdirSync(join(candidateDir, '.yoke'), { recursive: true })
    writeFileSync(pidFile, JSON.stringify({ childPid: 901, childIncarnation: 'incarnation-a', watchdogPid: 902, watchdogIncarnation: 'incarnation-a' }))
    const events: string[] = []
    let firstCleanup = true
    const options = {
      git: (args: string[]) => { if (args[1] === 'remove') events.push('remove') },
      isAlive: (pid: number) => pid === 901 || pid === 902,
      killTree: (pid: number) => {
        events.push(`kill:${pid}`)
        if (firstCleanup) return false
        return true
      },
      processIncarnation: () => 'incarnation-a',
      removeWorktrees: true,
    }

    expect(runLoopCleanup(dir, options)).toBe(1)
    expect(events).toEqual(['kill:901'])
    expect(existsSync(pidFile)).toBe(true)

    firstCleanup = false
    expect(runLoopCleanup(dir, options)).toBe(0)
    expect(events).toEqual(['kill:901', 'kill:901', 'kill:902', 'remove'])
    expect(existsSync(pidFile)).toBe(false)
  })

  it('fails closed when a live legacy runner PID has different incarnation evidence', () => {
    const pidFile = join(dir, '.yoke', 'runner.pid')
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(pidFile, JSON.stringify({
      childPid: 901,
      childIncarnation: 'incarnation-a',
      watchdogPid: 902,
      watchdogIncarnation: 'incarnation-a',
    }))
    const killed: number[] = []

    expect(runLoopCleanup(dir, {
      git: () => {},
      isAlive: () => true,
      killTree: pid => { killed.push(pid); return true },
      processIncarnation: () => 'incarnation-b',
    })).toBe(1)

    expect(killed).toEqual([])
    expect(existsSync(pidFile)).toBe(true)
  })

  it('retains legacy runner.pid when a dead child leader still owns a live detached tree', () => {
    const pidFile = join(dir, '.yoke', 'runner.pid')
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(pidFile, JSON.stringify({ childPid: 901, childIncarnation: 'incarnation-a', watchdogPid: 902, watchdogIncarnation: 'incarnation-a' }))

    expect(() => reapRecordedRunners(dir, join(dir, '.yoke', 'worktrees'), () => false, pid => pid === 901, () => false, () => true, () => 'incarnation-a')).toThrow('could not confirm legacy runner process tree termination')
    expect(existsSync(pidFile)).toBe(true)
  })

  it('does not infer quality critic or repair process ownership from unrecognized pid files', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'quality-critic.pid'), JSON.stringify({ watchdogPid: 111, childPid: 222 }))
    writeFileSync(join(dir, '.yoke', 'quality-repair.pid'), JSON.stringify({ watchdogPid: 333, childPid: 444 }))
    const killed: number[] = []

    expect(runLoopCleanup(dir, { git: () => {}, isAlive: () => true, killTree: pid => { killed.push(pid); return true } })).toBe(0)
    expect(killed).toEqual([])
    expect(existsSync(join(dir, '.yoke', 'quality-critic.pid'))).toBe(true)
    expect(existsSync(join(dir, '.yoke', 'quality-repair.pid'))).toBe(true)
  })

  it('consumes only this target project\'s named provider-process records', () => {
    const processDir = join(dir, '.yoke', 'provider-processes')
    mkdirSync(processDir, { recursive: true })
    const ownedRecord = join(processDir, 'owned.json')
    const foreignRecord = join(processDir, 'foreign.json')
    writeFileSync(ownedRecord, JSON.stringify({ version: 1, owner: 'provider-process', targetDir: dir, childPid: 555, startedAt: 'incarnation-a' }))
    writeFileSync(foreignRecord, JSON.stringify({ version: 1, owner: 'provider-process', targetDir: '/other/project', childPid: 666, startedAt: 'foreign-incarnation' }))
    const killed: number[] = []

    expect(runLoopCleanup(dir, {
      git: () => {},
      isAlive: () => true,
      killTree: pid => { killed.push(pid); return true },
      processIncarnation: () => 'incarnation-a',
    })).toBe(0)

    expect(killed).toEqual([555])
    expect(existsSync(ownedRecord)).toBe(false)
    expect(existsSync(foreignRecord)).toBe(true)
  })

  it('fails closed when a provider PID has a different process incarnation', () => {
    const recordsDir = join(dir, '.yoke', 'provider-processes')
    const recordPath = join(recordsDir, 'worker.json')
    mkdirSync(recordsDir, { recursive: true })
    writeFileSync(recordPath, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: dir,
      childPid: 701,
      startedAt: 'incarnation-a',
    }))
    const killed: number[] = []

    expect(runLoopCleanup(dir, {
      git: () => {},
      isAlive: pid => pid === 701,
      killTree: pid => { killed.push(pid); return true },
      processIncarnation: () => 'incarnation-b',
    })).toBe(1)
    expect(killed).toEqual([])
    expect(existsSync(recordPath)).toBe(true)
  })

  it('retains a leader-dead provider record while its detached tree remains alive and unconfirmed', () => {
    const recordsDir = join(dir, '.yoke', 'provider-processes')
    const recordPath = join(recordsDir, 'worker.json')
    mkdirSync(recordsDir, { recursive: true })
    writeFileSync(recordPath, JSON.stringify({ version: 1, owner: 'provider-process', targetDir: dir, childPid: 702, startedAt: 'incarnation-a' }))

    expect(() => reapProviderProcesses(dir, () => false, () => true, () => false)).toThrow('could not confirm provider process tree termination')
    expect(existsSync(recordPath)).toBe(true)
  })

  it('reaps an owned candidate provider process before removing that candidate worktree', () => {
    // Given: a crashed dispatcher leaves a live provider record inside its candidate worktree.
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const recordPath = join(candidateDir, '.yoke', 'provider-processes', 'worker.json')
    mkdirSync(join(candidateDir, '.yoke', 'provider-processes'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: candidateDir,
      childPid: 777,
      startedAt: 'incarnation-a',
    }))
    const events: string[] = []

    // When: crash cleanup removes the Yoke-owned candidate worktree.
    expect(runLoopCleanup(dir, {
      git: args => {
        if (args[1] === 'remove') events.push(`remove:${args[3]}`)
      },
      isAlive: pid => pid === 777,
      killTree: pid => { events.push(`kill:${pid}`); return true },
      processIncarnation: () => 'incarnation-a',
      removeWorktrees: true,
    })).toBe(0)

    // Then: the owned provider tree is reaped and its record consumed before removal.
    expect(events).toEqual([`kill:777`, `remove:${candidateDir}`])
    expect(existsSync(recordPath)).toBe(false)
  })

  it('retains a live candidate record and worktree when termination is not confirmed', () => {
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const recordPath = join(candidateDir, '.yoke', 'provider-processes', 'worker.json')
    mkdirSync(join(candidateDir, '.yoke', 'provider-processes'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: candidateDir,
      childPid: 778,
      startedAt: 'incarnation-a',
    }))
    const removals: string[] = []

    expect(runLoopCleanup(dir, {
      git: args => { if (args[1] === 'remove') removals.push(args[3] ?? '') },
      isAlive: pid => pid === 778,
      killTree: () => false,
      processIncarnation: () => 'incarnation-a',
      removeWorktrees: true,
    })).toBe(1)

    expect(removals).toEqual([])
    expect(existsSync(recordPath)).toBe(true)
  })

  it('retries a retained candidate record before removing its worktree', () => {
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const recordPath = join(candidateDir, '.yoke', 'provider-processes', 'worker.json')
    mkdirSync(join(candidateDir, '.yoke', 'provider-processes'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: candidateDir,
      childPid: 779,
      startedAt: 'incarnation-a',
    }))
    const events: string[] = []
    let killAttempts = 0
    const options = {
      git: (args: string[]) => { if (args[1] === 'remove') events.push('remove') },
      isAlive: (pid: number) => pid === 779,
      killTree: () => {
        killAttempts += 1
        events.push('kill')
        return killAttempts === 2
      },
      removeWorktrees: true,
      processIncarnation: () => 'incarnation-a',
    }

    expect(runLoopCleanup(dir, options)).toBe(1)
    expect(existsSync(recordPath)).toBe(true)
    expect(runLoopCleanup(dir, options)).toBe(0)
    expect(events).toEqual(['kill', 'kill', 'remove'])
    expect(existsSync(recordPath)).toBe(false)
  })

  it('consumes an already-dead candidate record without invoking termination', () => {
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const recordPath = join(candidateDir, '.yoke', 'provider-processes', 'worker.json')
    mkdirSync(join(candidateDir, '.yoke', 'provider-processes'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: candidateDir,
      childPid: 780,
      startedAt: 'incarnation-a',
    }))
    const removals: string[] = []

    expect(runLoopCleanup(dir, {
      git: args => { if (args[1] === 'remove') removals.push(args[3] ?? '') },
      isAlive: () => false,
      killTree: () => { throw new Error('must not terminate a dead process') },
      processIncarnation: () => 'incarnation-a',
      removeWorktrees: true,
    })).toBe(0)

    expect(removals).toEqual([candidateDir])
    expect(existsSync(recordPath)).toBe(false)
  })

  it('does not trust malformed or out-of-scope candidate provider records', () => {
    // Given: candidate-local records that cannot prove they own a process in that candidate.
    const candidateDir = join(dir, '.yoke', 'worktrees', 'STORY-1')
    const recordsDir = join(candidateDir, '.yoke', 'provider-processes')
    const malformedRecord = join(recordsDir, 'malformed.json')
    const foreignRecord = join(recordsDir, 'foreign.json')
    mkdirSync(recordsDir, { recursive: true })
    writeFileSync(malformedRecord, '{')
    writeFileSync(foreignRecord, JSON.stringify({
      version: 1,
      owner: 'provider-process',
      targetDir: dir,
      childPid: 888,
    }))
    const killed: number[] = []

    // When: crash cleanup removes the Yoke-owned candidate worktree.
    expect(runLoopCleanup(dir, {
      git: () => {},
      isAlive: () => true,
      killTree: pid => { killed.push(pid); return true },
      removeWorktrees: true,
    })).toBe(0)

    // Then: neither untrusted record can select a process tree to kill.
    expect(killed).toEqual([])
    expect(existsSync(malformedRecord)).toBe(true)
    expect(existsSync(foreignRecord)).toBe(true)
  })

  it('does NOT kill recorded runners while the loop lock holder is alive', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x' }))
    writeFileSync(join(dir, '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 111, childPid: 222 }))
    const killed: number[] = []
    runLoopCleanup(dir, { git: () => {}, isAlive: () => true, killTree: (pid) => { killed.push(pid); return true } })
    expect(killed).toEqual([]) // that runner belongs to a live, healthy loop
    expect(existsSync(join(dir, '.yoke', 'runner.pid'))).toBe(true) // left for the live loop
  })

  it('removes a stale lock but keeps a live one', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 4194304 + 999, startedAt: 'x' }))
    runLoopCleanup(dir, { git: () => {} })
    expect(existsSync(lockPath(dir))).toBe(false)

    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x' }))
    runLoopCleanup(dir, { git: () => {} })
    expect(existsSync(lockPath(dir))).toBe(true)
  })

  it('recovers a crashed takeover lease but preserves a live one', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(takeoverLockPath(dir), JSON.stringify({ pid: 4194304 + 999, startedAt: 'x', ownerToken: 'dead' }))
    expect(runLoopCleanup(dir, { git: () => {} })).toBe(0)
    expect(existsSync(takeoverLockPath(dir))).toBe(false)

    writeFileSync(takeoverLockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x', ownerToken: 'live' }))
    expect(runLoopCleanup(dir, { git: () => {} })).toBe(0)
    expect(existsSync(takeoverLockPath(dir))).toBe(true)
  })

  it('requires the explicit operator flag to discard a crashed recovery lease', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(takeoverRecoveryPath(dir), JSON.stringify({ pid: 4194304 + 999, startedAt: 'x', ownerToken: 'dead-recovery' }))
    expect(runLoopCleanup(dir, { git: () => {} })).toBe(1)
    expect(existsSync(takeoverRecoveryPath(dir))).toBe(true)
    expect(runLoopCleanup(dir, { git: () => {}, discardStaleRecovery: true })).toBe(0)
    expect(existsSync(takeoverRecoveryPath(dir))).toBe(false)

    writeFileSync(takeoverRecoveryPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x', ownerToken: 'live-recovery' }))
    expect(runLoopCleanup(dir, { git: () => {}, discardStaleRecovery: true })).toBe(1)
    expect(existsSync(takeoverRecoveryPath(dir))).toBe(true)
  })
})
