import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runLoop } from '../../src/loop/loop.js'
import { loadPrd } from '../../src/loop/prd.js'
import { contextDir } from '../../src/context/context.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentRunner } from '../../src/loop/runner.js'
import type { Verifier } from '../../src/loop/verify.js'
import { type LoopReporter } from '../../src/loop/reporter.js'

let dir: string
const prd = () => join(dir, 'prd.yaml')
const cleanGit = (): GitOps => ({ isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-loop-'))
  writeFileSync(prd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
- { id: S2, title: Second, priority: 2, acceptance: ["y"], passes: false }
`)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const alwaysPass: AgentRunner = () => ({ success: true, summary: 'done' })
const verifyOk: Verifier = () => ({ passed: true, summary: 'green' })
const reviewOk: AgentRunner = () => ({ success: true, summary: 'approved' })
const reviewReject: AgentRunner = () => ({ success: false, summary: 'rejected: criterion unmet' })

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

  it('commits a story when the runner reports failure but verify is GREEN (exit-code ghost)', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const runnerGhost: AgentRunner = () => ({ success: false, summary: 'exit 127 from claude.cmd' })
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: runnerGhost, git, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
    expect(commits.length).toBe(2)
    expect(loadPrd(prd()).every(s => s.passes)).toBe(true)
  })

  it('blocks when the runner fails AND verify is red, naming both', () => {
    const runnerBad: AgentRunner = () => ({ success: false, summary: 'agent boom' })
    const verifyBad: Verifier = () => ({ passed: false, summary: 'tests red' })
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: runnerBad, git: cleanGit(), verify: verifyBad, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/agent boom/)
    expect(res.reason).toMatch(/tests red/)
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

  it('blocks when the reviewer rejects after verify passes (no commit, story stays open)', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, review: reviewReject, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/rejected in review/i)
    expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)
    expect(commits).toHaveLength(0)
  })

  it('completes when the reviewer approves', () => {
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, review: reviewOk, maxIterations: 10 })
    expect(res.status).toBe('complete')
  })

  const decisionsFile = () => join(contextDir(dir), 'DECISIONS.md')

  it('appends a decision per completed story, in the commit', () => {
    const commits: string[] = []
    const git: GitOps = { isClean: () => true, commitAll: (_d, m) => commits.push(m), addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git, verify: verifyOk, maxIterations: 10 })
    const text = readFileSync(decisionsFile(), 'utf8')
    expect(text).toContain('S1: First')
    expect(text).toContain('S2: Second')
  })

  it('does not append a decision when the story is blocked at verify', () => {
    const verifyFail: Verifier = () => ({ passed: false, summary: 'red' })
    runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyFail, maxIterations: 10 })
    expect(existsSync(decisionsFile())).toBe(false)
  })

  it('exposes the story id to the verifier via YOKE_STORY and unsets it after', () => {
    const seen: (string | undefined)[] = []
    const verify: Verifier = () => { seen.push(process.env.YOKE_STORY); return { passed: true, summary: 'green' } }
    runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify, maxIterations: 10 })
    expect(seen).toEqual(['S1', 'S2'])
    expect(process.env.YOKE_STORY).toBeUndefined()
  })

  it('reverts the decision append when the commit fails', () => {
    // Seed a prior DECISIONS.md so the assertion distinguishes "appended then
    // rolled back to prior bytes" from "never appended at all".
    mkdirSync(contextDir(dir), { recursive: true })
    writeFileSync(decisionsFile(), 'PRIOR\n')
    const failingGit: GitOps = { isClean: () => true, commitAll: () => { throw new Error('commit boom') }, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
    const res = runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: failingGit, verify: verifyOk, maxIterations: 10 })
    expect(res.status).toBe('blocked')
    expect(readFileSync(decisionsFile(), 'utf8')).toBe('PRIOR\n')
    expect(loadPrd(prd()).every(s => !s.passes)).toBe(true)
  })
})

function recordingReporter(): { reporter: LoopReporter; events: string[] } {
  const events: string[] = []
  const reporter: LoopReporter = {
    storyStart: (s) => events.push(`start:${s.id}`),
    phase: (p) => events.push(`phase:${p}`),
    blocked: (r) => events.push(`blocked:${r}`),
    complete: () => events.push('complete'),
    capReached: () => events.push('cap'),
  }
  return { reporter, events }
}

describe('runLoop reporter', () => {
  it('drives the reporter through phases on success and reports complete', () => {
    const { reporter, events } = recordingReporter()
    runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: cleanGit(), verify: verifyOk, maxIterations: 10, reporter })
    expect(events).toContain('start:S1')
    expect(events).toContain('phase:verifying')
    expect(events).toContain('phase:committing')
    expect(events[events.length - 1]).toBe('complete')
  })

  it('reports blocked with a leftover hint when the tree is dirty after a block', () => {
    const { reporter, events } = recordingReporter()
    // isClean: true for the pre-dispatch gate (first call), false afterwards so the
    // post-block leftover check sees a dirty tree.
    let calls = 0
    const dirtyAfter: GitOps = {
      isClean: () => { calls += 1; return calls <= 1 },
      commitAll: () => { throw new Error('commit boom') },
      addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {},
    }
    runLoop({ prdPath: prd(), targetDir: dir, runner: alwaysPass, git: dirtyAfter, verify: verifyOk, maxIterations: 10, reporter })
    const blocked = events.find(e => e.startsWith('blocked:'))!
    expect(blocked).toMatch(/uncommitted changes/i)
  })
})

function fsWorktreeGit(repo: string, removed: string[]): GitOps {
  return {
    isClean: () => true,
    commitAll: () => {},
    addWorktree: (_r, wt) => {
      mkdirSync(join(wt, '.yoke'), { recursive: true })
      copyFileSync(join(repo, '.yoke', 'prd.yaml'), join(wt, '.yoke', 'prd.yaml'))
    },
    integrate: (r, wt) => { copyFileSync(join(wt, '.yoke', 'prd.yaml'), join(r, '.yoke', 'prd.yaml')) },
    removeWorktree: (_r, wt) => { removed.push(wt); rmSync(wt, { recursive: true, force: true }) },
  }
}

describe('runLoop with isolation', () => {
  let isoDir: string
  const isoPrd = () => join(isoDir, '.yoke', 'prd.yaml')
  beforeEach(() => {
    isoDir = mkdtempSync(join(tmpdir(), 'yoke-iso-'))
    mkdirSync(join(isoDir, '.yoke'), { recursive: true })
    writeFileSync(isoPrd(), `
- { id: S1, title: First, priority: 1, acceptance: ["x"], passes: false }
`)
  })
  afterEach(() => { rmSync(isoDir, { recursive: true, force: true }) })

  it('completes a story through an isolated worktree and integrates it back', () => {
    const removed: string[] = []
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(isoDir, removed),
      verify: verifyOk, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('complete')
    expect(loadPrd(isoPrd())[0].passes).toBe(true)   // integrated back into main
    expect(removed.length).toBe(1)                    // worktree cleaned up
  })

  it('discards the worktree and leaves the main PRD untouched when verify fails', () => {
    const removed: string[] = []
    const verifyRed: Verifier = () => ({ passed: false, summary: 'red' })
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(isoDir, removed),
      verify: verifyRed, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('blocked')
    expect(loadPrd(isoPrd())[0].passes).toBe(false)  // main tree untouched
    expect(removed.length).toBe(1)                    // worktree still cleaned up
  })

  it('blocks in isolated mode when the reviewer rejects, leaving the main PRD untouched', () => {
    const removed: string[] = []
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(isoDir, removed),
      verify: verifyOk, review: reviewReject, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/rejected in review/i)
    expect(loadPrd(isoPrd())[0].passes).toBe(false)
    expect(removed.length).toBe(1) // worktree still cleaned up
  })

  it('exposes YOKE_STORY to the verifier in isolated mode too, and unsets it after', () => {
    let seen: string | undefined
    const verify: Verifier = () => { seen = process.env.YOKE_STORY; return { passed: true, summary: 'green' } }
    runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: fsWorktreeGit(isoDir, []),
      verify, isolate: true, maxIterations: 5,
    })
    expect(seen).toBe('S1')
    expect(process.env.YOKE_STORY).toBeUndefined()
  })

  it('blocks (does not crash) when addWorktree throws, leaving the main PRD untouched', () => {
    const throwingWorktreeGit: GitOps = {
      isClean: () => true,
      commitAll: () => {},
      addWorktree: () => { throw new Error('git worktree add failed') },
      integrate: () => {},
      removeWorktree: () => {},
    }
    const res = runLoop({
      prdPath: isoPrd(), targetDir: isoDir, runner: alwaysPass, git: throwingWorktreeGit,
      verify: verifyOk, isolate: true, maxIterations: 5,
    })
    expect(res.status).toBe('blocked')
    expect(res.reason).toMatch(/isolated iteration failed/)
    expect(loadPrd(isoPrd())[0].passes).toBe(false)  // main tree untouched
  })
})
