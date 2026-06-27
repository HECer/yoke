import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoop } from '../../src/loop/loop.js'
import { loadPrd } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
const cleanGit = (): GitOps => ({ isClean: () => true, commitAll: () => {} })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-loop-'))
  writeFileSync(prd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
- { id: S2, title: Second, priority: 2, acceptance: ["y"], passes: false }
`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const alwaysPass: AgentRunner = () => ({ success: true, summary: 'done' })

describe('runLoop', () => {
  it('completes all stories with a passing runner', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m) }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(res.iterations).toBe(2)
    expect(res.finalProgress).toEqual({ passed: 2, total: 2 })
    expect(loadPrd(prd()).every(s => s.passes)).toBe(true)
    expect(commits).toHaveLength(2)
  })

  it('blocks when the runner fails a story', () => {
    const failS1: AgentRunner = ({ story }) => ({ success: story.id !== 'S1', summary: 'boom' })
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: failS1, git: cleanGit(), maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/S1/)
  })

  it('stops at the iteration cap', () => {
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), maxIterations: 1 })
    expect(res.status).toBe('cap-reached')
    expect(res.iterations).toBe(1)
    expect(res.finalProgress).toEqual({ passed: 1, total: 2 })
  })

  it('blocks via pre-dispatch gate on a dirty worktree', () => {
    const dirtyGit: GitOps = { isClean: () => false, commitAll: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: dirtyGit, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/worktree/i)
    expect(res.iterations).toBe(0)
  })

  it('blocks via stop-the-line when the next story lacks acceptance', () => {
    writeFileSync(prd(), `- { id: S1, title: t, priority: 1, acceptance: [], passes: false }`)
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/acceptance/i)
  })
})
