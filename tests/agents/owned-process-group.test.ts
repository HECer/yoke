import { expect, it } from 'vitest'
import { ownedPosixGroupTerminator } from '../../src/agents/owned-process-group.js'

const missing = () => { throw Object.assign(Error('no process group'), { code: 'ESRCH' }) }

it('signals the owned group without ps and waits for observed group exit', () => {
  const child = { exitCode: null, signalCode: null }
  const signals: Array<[number, NodeJS.Signals | 0]> = []
  let alive = true
  const stop = ownedPosixGroupTerminator(123, child, undefined, () => undefined, (pid, signal) => {
    signals.push([pid, signal]); if (!alive) missing()
  })
  expect(stop()).toBe(false)
  expect(signals).toContainEqual([-123, 'SIGKILL'])
  alive = false
  expect(stop()).toBe(true)
  // An observed disappearance ends this ownership interval permanently.
  alive = true
  signals.length = 0
  expect(stop()).toBe(true)
  expect(signals).toEqual([])
})

it('does not signal a reused identity or an exited child with an ambiguous remaining group', () => {
  for (const child of [{ exitCode: null, signalCode: null }, { exitCode: 0, signalCode: null }]) {
    const signals: Array<NodeJS.Signals | 0> = []
    const stop = ownedPosixGroupTerminator(123, child, child.exitCode === null ? 'original' : undefined, () => 'reused', (_pid, signal) => { signals.push(signal) })
    expect(stop()).toBe(false)
    expect(signals).toEqual([0])
  }
})

it('does not mistake permission errors for confirmed termination', () => {
  const stop = ownedPosixGroupTerminator(123, { exitCode: null, signalCode: null }, undefined, () => undefined, () => {
    throw Object.assign(Error('permission denied'), { code: 'EPERM' })
  })
  expect(stop()).toBe(false)
})
