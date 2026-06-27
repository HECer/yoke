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

  it('preDispatchGate passes on a clean worktree', () => {
    expect(preDispatchGate('/x', git(true)).ok).toBe(true)
  })

  it('preDispatchGate blocks on a dirty worktree', () => {
    const r = preDispatchGate('/x', git(false))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/worktree/i)
  })
})
