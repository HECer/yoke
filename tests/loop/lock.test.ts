import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock, readLock, isPidAlive, lockPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-lock-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loop lock', () => {
  it('acquires when no lock exists (creates .yoke if needed)', () => {
    const r = acquireLock(dir, process.pid)
    expect(r.acquired).toBe(true)
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

  it('releaseLock removes the file and never throws', () => {
    acquireLock(dir, process.pid)
    releaseLock(dir)
    expect(existsSync(lockPath(dir))).toBe(false)
    releaseLock(dir) // second call: no throw
  })

  it('isPidAlive: own pid true, absurd pid false, non-positive false', () => {
    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(4194304 + 54321)).toBe(false)
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
  })
})
