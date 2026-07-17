import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCleanup } from '../../src/loop/cleanup.js'
import { lockPath } from '../../src/loop/lock.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-clean-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('runLoopCleanup', () => {
  it('reports nothing to clean on a fresh dir', () => {
    expect(runLoopCleanup(dir, { git: () => { throw new Error('must not be called') } })).toBe(0)
  })

  it('removes every yoke worktree via git and prunes', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-1'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'STORY-2'), { recursive: true })
    const calls: string[][] = []
    const code = runLoopCleanup(dir, { git: (args) => { calls.push(args) } })
    expect(code).toBe(0)
    const removes = calls.filter(a => a[1] === 'remove')
    expect(removes).toHaveLength(2)
    expect(calls.some(a => a[1] === 'prune')).toBe(true)
  })

  it('returns 1 when a removal fails but continues with the rest', () => {
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A'), { recursive: true })
    mkdirSync(join(dir, '.yoke', 'worktrees', 'B'), { recursive: true })
    let n = 0
    const code = runLoopCleanup(dir, { git: (args) => { if (args[1] === 'remove' && n++ === 0) throw new Error('boom') } })
    expect(code).toBe(1)
    expect(n).toBeGreaterThan(0)
  })

  it('kills only the pids recorded in runner.pid files (project-scoped, never pattern-based)', () => {
    // Main-dir runner + one worktree runner left behind by a dead loop.
    mkdirSync(join(dir, '.yoke', 'worktrees', 'A', '.yoke'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 111, childPid: 222 }))
    writeFileSync(join(dir, '.yoke', 'worktrees', 'A', '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 333, childPid: 444 }))
    const killed: number[] = []
    const code = runLoopCleanup(dir, {
      git: () => {},
      isAlive: (pid) => pid === 222 || pid === 333, // 111 and 444 already exited
      killTree: (pid) => { killed.push(pid) },
    })
    expect(code).toBe(0)
    expect(killed.sort()).toEqual([222, 333]) // only recorded-and-alive pids — nothing else on the machine
    expect(existsSync(join(dir, '.yoke', 'runner.pid'))).toBe(false) // consumed
  })

  it('does NOT kill recorded runners while the loop lock holder is alive', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x' }))
    writeFileSync(join(dir, '.yoke', 'runner.pid'), JSON.stringify({ watchdogPid: 111, childPid: 222 }))
    const killed: number[] = []
    runLoopCleanup(dir, { git: () => {}, isAlive: () => true, killTree: (pid) => { killed.push(pid) } })
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
})
