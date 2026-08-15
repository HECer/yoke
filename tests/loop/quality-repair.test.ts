import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoop, type QualityStage } from '../../src/loop/loop.js'
import type { GitOps } from '../../src/loop/gates.js'
import type { AgentResult, AgentRunner } from '../../src/loop/runner.js'

let projectDir: string

const prdPath = (): string => join(projectDir, '.yoke', 'prd.yaml')
const passingRunner: AgentRunner = () => ({ success: true, summary: 'implemented' })
const green = () => ({ passed: true, summary: 'green' })

function writeQualityStory(): void {
  mkdirSync(join(projectDir, '.yoke'), { recursive: true })
  writeFileSync(prdPath(), `
- id: S1
  title: Quality repair
  priority: 1
  acceptance:
    - { id: behavior, text: Behavior works, verify: [npm run test:behavior] }
    - { id: recovery, text: Recovery works, verify: [npm run test:recovery] }
  passes: false
`)
}

function cleanGit(): GitOps {
  return { isClean: () => true, commitAll: () => {}, addWorktree: () => {}, removeWorktree: () => {}, integrate: () => {} }
}

function isolatedGit(): GitOps {
  return {
    ...cleanGit(),
    addWorktree: (_repo, worktree) => {
      mkdirSync(join(worktree, '.yoke'), { recursive: true })
      copyFileSync(prdPath(), join(worktree, '.yoke', 'prd.yaml'))
    },
    integrate: (_repo, worktree) => copyFileSync(join(worktree, '.yoke', 'prd.yaml'), prdPath()),
    removeWorktree: (_repo, worktree) => rmSync(worktree, { recursive: true, force: true }),
  }
}

function qualityLoss(gap: string): QualityStage {
  return { kind: 'lose', biggestGap: gap, evidence: [`${gap}-evidence`], summary: `${gap} needs repair` }
}

function rejectedReview(): AgentResult {
  return {
    success: false,
    summary: 'rejected',
    reviewOutcome: {
      kind: 'rejected',
      verdict: { approved: false, summary: 'repair', findings: [{ severity: 'blocking', message: 'review gap' }] },
    },
  }
}

function approvedReview(): AgentResult {
  return {
    success: true,
    summary: 'approved',
    reviewOutcome: { kind: 'approved', verdict: { approved: true, summary: 'approved', findings: [] } },
  }
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'yoke-quality-repair-'))
  writeQualityStory()
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('runLoop shared quality and review repairs', () => {
  it.each([
    ['direct', false],
    ['isolated', true],
  ])('uses monotonic repair rounds and reruns every gate across quality and review in %s mode', (_mode, isolate) => {
    const events: string[] = []
    const repairRounds: number[] = []
    const repairSources: string[] = []
    const repairEvidence: (readonly string[] | undefined)[] = []
    const qualityRounds: number[] = []
    let qualityCalls = 0
    let reviewCalls = 0

    const result = runLoop({
      prdPath: prdPath(),
      targetDir: projectDir,
      runner: passingRunner,
      git: isolate ? isolatedGit() : cleanGit(),
      isolate,
      maxIterations: 1,
      requireCriterionEvidence: true,
      verifyCriterion: () => { events.push('criterion'); return green() },
      verify: () => { events.push('verify'); return green() },
      perf: () => { events.push('perf'); return green() },
      audit: () => { events.push('audit'); return green() },
      qualityStage: (_context, round) => {
        qualityCalls += 1
        qualityRounds.push(round)
        events.push(`quality:${qualityCalls}`)
        return qualityCalls === 1 ? qualityLoss('quality gap') : { kind: 'pass' }
      },
      review: () => {
        reviewCalls += 1
        events.push(`review:${reviewCalls}`)
        return reviewCalls === 1 ? rejectedReview() : approvedReview()
      },
      repair: (_context, request) => {
        repairRounds.push(request.round)
        repairSources.push(request.source)
        repairEvidence.push(request.finding.evidence)
        events.push(`repair:${request.round}`)
        return { success: true, summary: 'repaired' }
      },
    })

    expect(result.status).toBe('complete')
    expect(repairRounds).toEqual([1, 2])
    expect(repairSources).toEqual(['quality', 'review'])
    expect(repairEvidence).toEqual([['quality gap-evidence'], undefined])
    expect(qualityRounds).toEqual([1, 2, 3])
    expect(events).toEqual([
      'criterion', 'criterion', 'verify', 'perf', 'audit', 'quality:1', 'repair:1',
      'criterion', 'criterion', 'verify', 'perf', 'audit', 'quality:2', 'review:1', 'repair:2',
      'criterion', 'criterion', 'verify', 'perf', 'audit', 'quality:3', 'review:2',
    ])
  })

  it('exhausts one shared repair budget after a quality repair before a review rejection', () => {
    let qualityCalls = 0
    let repairs = 0
    const result = runLoop({
      prdPath: prdPath(), targetDir: projectDir, runner: passingRunner, git: cleanGit(), maxIterations: 1,
      verifyCriterion: () => green(),
      verify: green,
      qualityStage: () => {
        qualityCalls += 1
        return qualityCalls === 1 ? qualityLoss('quality gap') : { kind: 'pass' }
      },
      review: rejectedReview,
      repair: () => { repairs += 1; return { success: true, summary: 'repaired' } },
      repairLimits: { maxRounds: 1 },
    })

    expect(result).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/round-budget-exhausted/) })
    expect(repairs).toBe(1)
  })

  it('allows more than three quality repairs when the shared controller is unbounded', () => {
    const repairRounds: number[] = []
    let qualityCalls = 0
    const result = runLoop({
      prdPath: prdPath(), targetDir: projectDir, runner: passingRunner, git: cleanGit(), maxIterations: 1,
      verifyCriterion: () => green(),
      verify: green,
      qualityStage: () => {
        qualityCalls += 1
        return qualityCalls <= 4 ? qualityLoss(`quality gap ${qualityCalls}`) : { kind: 'pass' }
      },
      review: approvedReview,
      repair: (_context, request) => {
        repairRounds.push(request.round)
        return { success: true, summary: 'repaired' }
      },
      repairLimits: { maxRounds: 1, unbounded: true },
    })

    expect(result.status).toBe('complete')
    expect(repairRounds).toEqual([1, 2, 3, 4])
  })

  it('consumes a pause request after repair gates and before a story can commit', () => {
    let comparisons = 0
    let commits = 0
    const result = runLoop({
      prdPath: prdPath(), targetDir: projectDir, runner: passingRunner,
      git: { ...cleanGit(), commitAll: () => { commits += 1 } }, maxIterations: 1, verify: green,
      verifyCriterion: green,
      qualityStage: () => {
        comparisons += 1
        return comparisons === 1 ? qualityLoss('quality gap') : { kind: 'pass' }
      },
      repair: () => {
        writeFileSync(join(projectDir, '.yoke', 'loop.pause'), '')
        return { success: true, summary: 'repaired' }
      },
    })

    expect(result.status).toBe('paused')
    expect(commits).toBe(0)
    expect(existsSync(join(projectDir, '.yoke', 'loop.pause'))).toBe(false)
  })
})
