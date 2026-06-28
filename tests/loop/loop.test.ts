import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoop } from '../../src/loop/loop.js'
import { loadPrd } from '../../src/loop/prd.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'
import type { Verifier } from '../../src/loop/verify.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
const cleanGit = (): GitOps => ({ isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-loop-'))
  writeFileSync(prd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
- { id: S2, title: Second, priority: 2, acceptance: ["y"], passes: false }
`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const alwaysPass: AgentRunner = () => ({ success: true, summary: 'done' })
const verifyOk: Verifier = () => ({ passed: true, summary: 'green' })

describe('runLoop', () => {
  it('completes all stories with a passing runner', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(res.iterations).toBe(2)
    expect(res.finalProgress).toEqual({ passed: 2, total: 2 })
    expect(loadPrd(prd()).every(s => s.passes)).toBe(true)
    expect(commits).toHaveLength(2)
  })

  it('blocks when the runner fails a story', () => {
    const failS1: AgentRunner = ({ story }) => ({ success: story.id !== 'S1', summary: 'boom' })
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: failS1, git: cleanGit(), verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/S1/)
  })

  it('stops at the iteration cap', () => {
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, maxIterations: 1 })
    expect(res.status).toBe('cap-reached')
    expect(res.iterations).toBe(1)
    expect(res.finalProgress).toEqual({ passed: 1, total: 2 })
  })

  it('blocks via pre-dispatch gate on a dirty worktree', () => {
    const dirtyGit: GitOps = { isClean: () => false, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: dirtyGit, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/worktree/i)
    expect(res.iterations).toBe(0)
  })

  it('blocks via stop-the-line when the next story lacks acceptance', () => {
    writeFileSync(prd(), `- { id: S1, title: t, priority: 1, acceptance: [], passes: false }`)
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/acceptance/i)
  })

  it('blocks and reverts the PRD when the commit fails', () => {
    const throwingGit: GitOps = {
      isClean: () => true,
      commitAll: () => { throw new Error('nothing to commit after agent run') },
      addWorktree: () => {},
      removeWorktree: () => {},
      integrate: () => {},
    }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: throwingGit, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/commit failed/)
    // PRD must be reverted: the story stays passes:false, never persisted without a commit.
    expect(loadPrd(prd()).find(s => s.id === 'S1')?.passes).toBe(false)
  })

  it('blocks when the PRD has no stories', () => {
    writeFileSync(prd(), `[]`)
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/no stories/)
  })

  it('does NOT mark a story passed when verification fails after a successful runner', () => {
    const verifyRed: Verifier = () => ({ passed: false, summary: 'tests red' })
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyRed, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/verif/i)
    expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)
    expect(commits).toHaveLength(0)
  })

  it('marks passed and commits only when runner AND verify both succeed', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(commits).toHaveLength(2)
  })
})
