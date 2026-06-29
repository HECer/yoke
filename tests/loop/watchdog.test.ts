import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
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
    const p = runWatchdog({ command: 'x', args: [], idleMs: 100, spawnFn: () => child, stdin: new EventEmitter() as any })
    vi.advanceTimersByTime(150)
    expect(child.kill).toHaveBeenCalled()
    child.emit('close', null)
    await expect(p).resolves.toBe(124)
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

describe('parseWatchdogArgs', () => {
  it('splits flags from the command after --', () => {
    expect(parseWatchdogArgs(['--idle-ms=500', '--', 'claude', '-p'])).toEqual({ idleMs: 500, command: 'claude', args: ['-p'] })
  })
  it('defaults idleMs to 0 when absent', () => {
    expect(parseWatchdogArgs(['--', 'node']).idleMs).toBe(0)
  })
})
