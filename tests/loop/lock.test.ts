import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock, readLock, isPidAlive, lockPath, takeoverLockPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-lock-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loop lock', () => {
  it('acquires when no lock exists (creates .yoke if needed)', () => {
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
    expect(r.ownerToken).toBeTruthy()
    expect(readLock(dir)?.pid).toBe(process.pid)
  })

  it('refuses when the holder pid is alive', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    const r = acquireLock(dir, 999999)
    expect(r.acquired).toBe(false)
    expect(r.holderPid).toBe(process.pid)
  })

  it('takes over a stale lock (dead pid) and reports it', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    // 2^22 exceeds the default pid_max on every platform we target — treat as dead
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 4194304 + 12345, startedAt: new Date().toISOString() }))
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
    expect(r.stalePid).toBe(4194304 + 12345)
    expect(readLock(dir)?.pid).toBe(process.pid)
  })

  it('takes over a corrupt lock file', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), 'not json')
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
  })

  it('does not race a stale takeover lease and leaves both files untouched', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 4194304 + 10, startedAt: new Date().toISOString(), ownerToken: 'stale' }))
    writeFileSync(takeoverLockPath(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ownerToken: 'takeover' }))
    const result = acquireLock(dir, process.pid)
    expect(result.acquired).toBe(false)
    expect(readLock(dir)?.ownerToken).toBe('stale')
    expect(existsSync(takeoverLockPath(dir))).toBe(true)
  })

  it('publishes complete owner metadata atomically', () => {
    const result = acquireLock(dir, process.pid)
    expect(result.acquired).toBe(true)
    expect(JSON.parse(readFileSync(lockPath(dir), 'utf8'))).toEqual(expect.objectContaining({
      pid: process.pid, ownerToken: result.ownerToken,
    }))
  })

  it('releaseLock removes only the lock owned by its token and never throws', () => {
    const first = acquireLock(dir, process.pid)
    releaseLock(dir, first.ownerToken)
    expect(existsSync(lockPath(dir))).toBe(false)
    releaseLock(dir, first.ownerToken) // second call: no throw
  })

  it('does not release a lock whose owner token has been replaced', () => {
    const first = acquireLock(dir, process.pid)
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ownerToken: 'replacement' }))
    releaseLock(dir, first.ownerToken)
    expect(readLock(dir)?.ownerToken).toBe('replacement')
  })

  it('isPidAlive: own pid true, absurd pid false, non-positive false', () => {
    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(4194304 + 54321)).toBe(false)
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
  })
})
