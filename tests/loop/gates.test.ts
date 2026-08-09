import { describe, it, expect } from 'vitest'
import { stopTheLineGate, preDispatchGate } from '../../src/loop/gates.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { Story } from '../../src/loop/prd.js'

const story = (over: Partial<Story> = {}): Story => ({
  id: 'S1', title: 't', priority: 1, acceptance: ['does X'], passes: false, ...over,
})

const git = (clean: boolean): GitOps => ({
  isClean: () => clean,
  commitAll: () => {},
  addWorktree: () => {},
  removeWorktree: () => {},
  integrate: () => {},
})

describe('gates', () => {
  it('stopTheLineGate passes when acceptance criteria exist', () => {
    expect(stopTheLineGate(story()).ok).toBe(true)
  })

  it('stopTheLineGate blocks when acceptance is empty', () => {
    const r = stopTheLineGate(story({ acceptance: [] }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/acceptance/i)
  })

  it('strict criteria require targeted single test commands instead of a broad suite', () => {
    const r = stopTheLineGate(story({ acceptance: [
      { id: 'purchase-unlocks', text: 'Purchase unlocks Pro', verify: ['npm test'] },
      { id: 'relaunch-keeps-pro', text: 'Relaunch keeps Pro', verify: ['npm test'] },
    ] }), true)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/target.*criterion id/i)
  })

  it('strict criteria reject shell control operators from planner output', () => {
    const r = stopTheLineGate(story({ acceptance: [
      { id: 'purchase-unlocks', text: 'Purchase unlocks Pro', verify: ['npm run test:purchase-unlocks & echo injected'] },
      { id: 'relaunch-keeps-pro', text: 'Relaunch keeps Pro', verify: ['npm run test:relaunch-keeps-pro'] },
    ] }), true)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/single test command/i)
  })

  it.each([
    'npx vitest-malware purchase-unlocks',
    'npm testevil purchase-unlocks',
    'pytest-malware purchase-unlocks',
  ])('rejects approved-runner prefix spoofing: %s', command => {
    const r = stopTheLineGate(story({ acceptance: [
      { id: 'purchase-unlocks', text: 'Purchase unlocks Pro', verify: [command] },
      { id: 'relaunch-keeps-pro', text: 'Relaunch keeps Pro', verify: ['npm run test:relaunch-keeps-pro'] },
    ] }), true)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/approved test command/i)
  })

  it('rejects unsafe structured commands even when legacy string criteria remain allowed', () => {
    const r = stopTheLineGate(story({ acceptance: [
      { id: 'purchase-unlocks', text: 'Purchase unlocks Pro', verify: ['npm run test:purchase-unlocks & echo injected'] },
      { id: 'relaunch-keeps-pro', text: 'Relaunch keeps Pro', verify: ['npm run test:relaunch-keeps-pro'] },
    ] }), false)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/single test command/i)
  })

  it('strict criteria accept safe commands targeted by normalized criterion id', () => {
    const r = stopTheLineGate(story({ acceptance: [
      { id: 'purchase-unlocks', text: 'Purchase unlocks Pro', verify: ['npm run test:purchase-unlocks'] },
      { id: 'auth-callback', text: 'Auth callback signs in', verify: ['pytest tests/test_auth_callback.py'] },
    ] }), true)
    expect(r.ok).toBe(true)
  })

  it('preDispatchGate passes on a clean worktree', () => {
    expect(preDispatchGate('/x', git(true)).ok).toBe(true)
  })

  it('preDispatchGate blocks on a dirty worktree', () => {
    const r = preDispatchGate('/x', git(false))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/worktree/i)
  })
})
