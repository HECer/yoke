import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runWatchdog, parseWatchdogArgs, type SpawnLike } from '../../src/loop/watchdog.js'

function fakeChild() {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { }
  child.kill = vi.fn()
  child.pid = 4242
  return child
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('runWatchdog', () => {
  it('does NOT kill while the child keeps emitting output, and passes its exit code', async () => {
    const child = fakeChild()
    const spawnFn: SpawnLike = () => child
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn, stdin: new EventEmitter() as any })
    for (let t = 0; t < 300; t += 50) { vi.advanceTimersByTime(50); child.stdout.emit('data', Buffer.from('x')) }
    child.emit('close', 0)
    await expect(p).resolves.toBe(0)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills a silent child after the idle window and resolves 124', async () => {
    const child = fakeChild()
    // killTree: undefined pins the per-process signal path (POSIX behavior) on any host platform.
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn: () => child, stdin: new EventEmitter() as any, killTree: undefined })
    vi.advanceTimersByTime(150)
    expect(child.kill).toHaveBeenCalled()
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
  })

  it('escalates SIGTERM then SIGKILL after the grace window and resolves 124', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, graceMs: 200, spawnFn: () => child, stdin: new EventEmitter() as any, killTree: undefined })
    vi.advanceTimersByTime(150)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL')
    vi.advanceTimersByTime(250)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
  })

  it('a normally-closing child never triggers the grace SIGKILL', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, graceMs: 200, spawnFn: () => child, stdin: new EventEmitter() as any })
    vi.advanceTimersByTime(50)
    child.stdout.emit('data', Buffer.from('x'))
    vi.advanceTimersByTime(50)
    child.emit('close', 0)
    await expect(p).resolves.toBe(0)
    expect(child.kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL')
  })

  it('does NOT let death-throes output rescind the committed idle-kill', async () => {
    const child = fakeChild()
    const out = vi.fn()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, graceMs: 200, spawnFn: () => child, stdin: new EventEmitter() as any, out, killTree: undefined })
    vi.advanceTimersByTime(150)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    // A child that caught SIGTERM coughs out one last byte before the grace window ends.
    child.stdout.emit('data', Buffer.from('dying'))
    expect(out).toHaveBeenCalled() // output still forwards
    vi.advanceTimersByTime(250)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL') // escalation NOT cancelled
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
  })

  it('resolves 127 on spawn error', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn: () => child, stdin: new EventEmitter() as any })
    child.emit('error', new Error('ENOENT'))
    await expect(p).resolves.toBe(127)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('with idleMs=0 never starts a timer and passes the exit code through', async () => {
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 0, spawnFn: () => child, stdin: new EventEmitter() as any })
    vi.advanceTimersByTime(10_000)
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('close', 3)
    await expect(p).resolves.toBe(3)
  })
})

describe('runWatchdog process-tree kill (win32 orphan fix)', () => {
  it('uses killTree with the child pid instead of child.kill, soft then forced', async () => {
    const child = fakeChild()
    const killTree = vi.fn()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, graceMs: 200, spawnFn: () => child, stdin: new EventEmitter() as any, killTree })
    vi.advanceTimersByTime(150)
    expect(killTree).toHaveBeenCalledWith(4242, false)
    expect(child.kill).not.toHaveBeenCalled() // killing only the shell orphans the real agent
    vi.advanceTimersByTime(250)
    expect(killTree).toHaveBeenCalledWith(4242, true)
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
  })

  it('falls back to child.kill when the child has no pid', async () => {
    const child = fakeChild()
    child.pid = undefined
    const killTree = vi.fn()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn: () => child, stdin: new EventEmitter() as any, killTree })
    vi.advanceTimersByTime(150)
    expect(killTree).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
  })
})

describe('runWatchdog pid file (scoped-cleanup contract)', () => {
  it('records watchdog + child pids on spawn and removes the file on close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-wd-pid-'))
    const pidFile = join(dir, 'runner.pid')
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 0, spawnFn: () => child, stdin: new EventEmitter() as any, pidFile })
    const rec = JSON.parse(readFileSync(pidFile, 'utf8'))
    expect(rec.childPid).toBe(4242)
    expect(rec.watchdogPid).toBe(process.pid)
    child.emit('close', 0)
    await expect(p).resolves.toBe(0)
    expect(existsSync(pidFile)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes the pid file on spawn error too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-wd-pid2-'))
    const pidFile = join(dir, 'runner.pid')
    const child = fakeChild()
    const p = runWatchdog({ command: 'x', args: [], idleMs: 0, spawnFn: () => child, stdin: new EventEmitter() as any, pidFile })
    child.emit('error', new Error('ENOENT'))
    await expect(p).resolves.toBe(127)
    expect(existsSync(pidFile)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('parseWatchdogArgs', () => {
  it('splits flags from the command after --', () => {
    expect(parseWatchdogArgs(['--idle-ms=500', '--', 'claude', '-p'])).toEqual({ idleMs: 500, command: 'claude', args: ['-p'] })
  })
  it('defaults idleMs to 0 when absent', () => {
    expect(parseWatchdogArgs(['--', 'node']).idleMs).toBe(0)
  })
  it('parses --pid-file', () => {
    expect(parseWatchdogArgs(['--idle-ms=5', '--pid-file=/tmp/r.pid', '--', 'x']).pidFile).toBe('/tmp/r.pid')
    expect(parseWatchdogArgs(['--', 'x']).pidFile).toBeUndefined()
  })
})
