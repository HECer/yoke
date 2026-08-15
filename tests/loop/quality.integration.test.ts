import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, storyPathSegment } from '../../src/loop/prd.js'
import { makeReporter, readStatus } from '../../src/loop/reporter.js'
import type { Invocation } from '../../src/loop/runner.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { GitOps } from '../../src/loop/gates.js'

let projectDir: string

const git: GitOps = {
  isClean: () => true,
  commitAll: () => {},
  addWorktree: () => {},
  removeWorktree: () => {},
  integrate: () => {},
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function writeQualityProject(referenceDigest: string, policy: 'blocking' | 'advisory' = 'blocking', repairGates = false): void {
  mkdirSync(join(projectDir, '.yoke'), { recursive: true })
  writeFileSync(join(projectDir, 'reference.txt'), 'trusted reference')
  writeFileSync(join(projectDir, 'candidate.txt'), 'candidate artifact')
  writeFileSync(join(projectDir, '.yoke', 'prd.yaml'), `
- id: S1
  title: Quality gate
  priority: 1
  acceptance: [quality works]
  passes: false
  quality:
    reference: { name: approved-reference, source: reference.txt, kind: file, digest: sha256:${referenceDigest} }
    candidate: { kind: files, paths: [candidate.txt] }
    rubric: Compare the candidate with the approved reference
    policy: ${policy}
`)
  saveConfig(projectDir, {
    canonVersion: 'test',
    agents: ['codex'],
    loop: { enabled: true },
    ...(repairGates ? { verify: { command: 'npm run test:S1' }, perf: { command: 'npm run benchmark:S1' } } : {}),
    quality: { enabled: true, policy: 'blocking', maxRounds: 1, maxMinutes: 1, consistencyChecks: 2, maxParallelCandidates: 1, criticAgent: 'codex', criticModel: 'test-critic' },
  })
}

function qualityVerdict(attemptId: string, candidateLabel: 'A' | 'B', promptDigest: string, rubricDigest: string, winner: 'candidate' | 'reference' = 'candidate'): string {
  return JSON.stringify({
    schemaVersion: 1,
    attemptId,
    winner,
    biggestGap: 'header alignment',
    evidence: ['header is offset by 8px'],
    confidence: 'high',
    candidate: { label: candidateLabel, digest: digest('candidate artifact') },
    reference: { label: candidateLabel === 'A' ? 'B' : 'A', digest: digest('trusted reference') },
    provenance: {
      provider: 'codex',
      model: 'test-critic',
      promptDigest,
      rubricDigest,
      referenceDigest: digest('trusted reference'),
      candidateDigest: digest('candidate artifact'),
    },
  })
}

const CriticPromptSchema = z.object({ attemptId: z.string(), candidateLabel: z.enum(['A', 'B']), promptDigest: z.string(), rubricDigest: z.string() })
const StagedCriticPromptSchema = CriticPromptSchema.extend({
  reference: z.object({ digest: z.string(), artifact: z.string() }),
  candidate: z.object({ digests: z.array(z.string()), artifacts: z.array(z.string()) }),
})
const RepairPromptSchema = z.object({
  schemaVersion: z.literal(1),
  role: z.literal('quality-repair'),
  story: z.object({ id: z.string(), title: z.string(), acceptance: z.array(z.unknown()) }),
  settledContext: z.string(),
  currentDiff: z.string(),
  gates: z.object({ verify: z.string(), perf: z.string() }),
})

function qualityVerdictFor(invocation: Invocation, winner: 'candidate' | 'reference' = 'candidate'): string {
  const request = CriticPromptSchema.parse(JSON.parse(invocation.input))
  return qualityVerdict(request.attemptId, request.candidateLabel, request.promptDigest, request.rubricDigest, winner)
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'yoke-quality-integration-'))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe('runLoopCommand declared quality integration', () => {
  it('enables quality only for declared stories when the invocation opts in over disabled project defaults', () => {
    writeQualityProject(digest('trusted reference'))
    saveConfig(projectDir, {
      canonVersion: 'test', agents: ['codex'], loop: { enabled: true },
      quality: { enabled: false, policy: 'blocking', maxRounds: 1, maxMinutes: 1, consistencyChecks: 2, maxParallelCandidates: 1, criticAgent: 'codex', criticModel: 'test-critic' },
    })
    let critics = 0

    const code = runLoopCommand(projectDir, {
      maxIterations: 1, quality: true, git, verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => { critics += 1; return { success: true, output: qualityVerdictFor(invocation), summary: 'critic completed' } },
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(critics).toBe(2)
  })

  it('disables every quality hook for one invocation without changing the blocking declaration', () => {
    writeQualityProject(digest('different bytes'))
    let implementations = 0

    const code = runLoopCommand(projectDir, {
      maxIterations: 1, quality: false, git, verify: () => ({ passed: true, summary: 'green' }),
      runner: () => { implementations += 1; return { success: true, summary: 'implemented' } },
    })

    expect(code).toBe(0)
    expect(implementations).toBe(1)
  })

  it('gives the invocation policy override precedence over the story declaration', () => {
    writeQualityProject(digest('different bytes'), 'blocking')

    const code = runLoopCommand(projectDir, {
      maxIterations: 1, qualityPolicy: 'advisory', git, verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
    })

    expect(code).toBe(0)
  })

  it('uses explicit unbounded mode to exceed configured repair caps while keeping the quality hook active', () => {
    writeQualityProject(digest('trusted reference'))
    const winners: Array<'candidate' | 'reference'> = ['reference', 'reference', 'reference', 'reference', 'reference', 'reference', 'reference', 'reference', 'candidate', 'candidate']

    const statusLines: string[] = []
    const code = runLoopCommand(projectDir, {
      maxIterations: 1, qualityUnbounded: true, git, verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      reporter: makeReporter(projectDir, { json: true, log: line => statusLines.push(line) }),
      qualityRuntime: {
        invoke: (_agent, invocation) => ({
          success: true,
          output: invocation.args.includes('read-only') ? qualityVerdictFor(invocation, winners.shift() ?? 'candidate') : 'repair completed',
          summary: 'provider completed',
        }),
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(readStatus(projectDir)?.quality).toMatchObject({ currentRound: 5, usedRepairs: 4, unbounded: true, policy: 'blocking', referenceDigest: digest('trusted reference') })
    expect(readStatus(projectDir)?.quality).not.toHaveProperty('maxRepairs')
    expect(statusLines.map(line => JSON.parse(line)).some(status => status.quality?.unbounded === true)).toBe(true)
  })

  it('blocks a blocking reference preflight before implementation when the declared digest does not match', () => {
    writeQualityProject(digest('different bytes'))
    let implementations = 0

    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => {
        implementations += 1
        return { success: true, summary: 'implemented' }
      },
      qualityRuntime: {
        invoke: () => ({ success: true, output: '', summary: 'unexpected critic call' }),
      },
    })

    expect(code).toBe(1)
    expect(implementations).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
    expect(existsSync(join(projectDir, '.yoke', 'references'))).toBe(false)
  })

  it('uses story advisory policy to record a failed acquisition and commit without a critic call', () => {
    writeQualityProject(digest('different bytes'), 'advisory')
    let implementations = 0
    let commits = 0
    let critics = 0
    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git: { ...git, commitAll: () => { commits += 1 } },
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => { implementations += 1; return { success: true, summary: 'implemented' } },
      qualityRuntime: {
        invoke: () => { critics += 1; return { success: true, output: '', summary: 'unexpected critic call' } },
      },
    })

    expect(code).toBe(0)
    expect(implementations).toBe(1)
    expect(commits).toBe(1)
    expect(critics).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'preflight.json'))).toBe(true)
  })

  it('collects declared artifacts, runs two read-only blind critics, and commits a passing candidate', () => {
    writeQualityProject(digest('trusted reference'))
    const invocations: string[][] = []
    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => {
          invocations.push(invocation.args)
          return { success: true, output: qualityVerdictFor(invocation), summary: 'critic completed' }
        },
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(invocations).toHaveLength(2)
    expect(invocations.every(args => args.includes('read-only'))).toBe(true)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'references', digest('trusted reference'), 'content'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'references', digest('trusted reference'), 'provenance.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'candidate.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'normal.verdict.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'swapped.verdict.json'))).toBe(true)
  })

  it('stages anonymous reference and candidate bytes in an isolated critic directory', () => {
    writeQualityProject(digest('trusted reference'))
    const criticRoots: string[] = []

    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => {
          const request = StagedCriticPromptSchema.parse(JSON.parse(invocation.input))
          criticRoots.push(invocation.cwd)
          expect(invocation.cwd).not.toBe(projectDir)
          expect(readdirSync(invocation.cwd).sort()).toEqual([request.reference.artifact, ...request.candidate.artifacts].sort())
          expect(readFileSync(join(invocation.cwd, request.reference.artifact), 'utf8')).toBe('trusted reference')
          expect(readFileSync(join(invocation.cwd, request.candidate.artifacts[0] ?? ''), 'utf8')).toBe('candidate artifact')
          return { success: true, output: qualityVerdictFor(invocation), summary: 'critic completed' }
        },
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(criticRoots).toHaveLength(2)
    expect(criticRoots.every(root => !existsSync(root))).toBe(true)
  })

  it('blocks a verdict when provider telemetry reports a different critic model', () => {
    writeQualityProject(digest('trusted reference'))
    let commits = 0

    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git: { ...git, commitAll: () => { commits += 1 } },
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => ({
          success: true,
          output: qualityVerdictFor(invocation),
          summary: 'critic completed',
          tokens: { inputTokens: 10, outputTokens: 4, model: 'unexpected-model' },
        }),
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(1)
    expect(commits).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('blocks when the declared reference changes after preflight', () => {
    writeQualityProject(digest('trusted reference'))
    let critics = 0
    let commits = 0

    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git: { ...git, commitAll: () => { commits += 1 } },
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => {
        writeFileSync(join(projectDir, 'reference.txt'), 'mutated reference')
        return { success: true, summary: 'implemented' }
      },
      qualityRuntime: {
        invoke: () => { critics += 1; return { success: true, output: '', summary: 'unexpected critic call' } },
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(1)
    expect(critics).toBe(0)
    expect(commits).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
  })

  it('repairs one reference-selected gap, reruns gates, and rejudges before committing', () => {
    writeQualityProject(digest('trusted reference'), 'blocking', true)
    mkdirSync(join(projectDir, '.yoke', 'context'), { recursive: true })
    writeFileSync(join(projectDir, '.yoke', 'context', 'PROJECT.md'), 'SETTLED PROJECT CONTEXT')
    const events: string[] = []
    const repairs: z.infer<typeof RepairPromptSchema>[] = []
    const winners: Array<'candidate' | 'reference'> = ['reference', 'reference', 'candidate', 'candidate']
    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git: { ...git, commitAll: () => { events.push('commit') } },
      verify: () => { events.push('verify'); return { passed: true, summary: 'green' } },
      perf: () => ({ passed: true, summary: 'within budget' }),
      runner: () => { events.push('implement'); return { success: true, summary: 'implemented' } },
      qualityRuntime: {
        invoke: (_agent, invocation) => {
          events.push(invocation.args.includes('read-only') ? 'critic' : 'repair')
          if (!invocation.args.includes('read-only')) repairs.push(RepairPromptSchema.parse(JSON.parse(invocation.input)))
          return {
            success: true,
            output: invocation.args.includes('read-only') ? qualityVerdictFor(invocation, winners.shift() ?? 'candidate') : 'repair completed',
            summary: 'provider completed',
          }
        },
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(events).toEqual(['implement', 'verify', 'critic', 'critic', 'repair', 'verify', 'critic', 'critic', 'commit'])
    expect(repairs).toMatchObject([{
      story: { id: 'S1', acceptance: ['quality works'] },
      settledContext: expect.stringContaining('SETTLED PROJECT CONTEXT'),
      currentDiff: expect.any(String),
      gates: { verify: 'npm run test:S1', perf: 'npm run benchmark:S1' },
    }])
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-2', 'normal.verdict.json'))).toBe(true)
  })

  it('blocks an inconsistent blind verdict without committing the story', () => {
    writeQualityProject(digest('trusted reference'))
    let commits = 0
    const winners: Array<'candidate' | 'reference'> = ['candidate', 'reference']
    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      git: { ...git, commitAll: () => { commits += 1 } },
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => ({ success: true, output: qualityVerdictFor(invocation, winners.shift() ?? 'candidate'), summary: 'critic completed' }),
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(1)
    expect(commits).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(false)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'normal.verdict.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'swapped.verdict.json'))).toBe(true)
  })

  it('collects candidates from an isolated execution root while persisting quality evidence beneath the main target', () => {
    writeQualityProject(digest('trusted reference'))
    const isolatedGit: GitOps = {
      ...git,
      addWorktree: (_target, worktree) => {
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        copyFileSync(join(projectDir, '.yoke', 'prd.yaml'), join(worktree, '.yoke', 'prd.yaml'))
        copyFileSync(join(projectDir, 'candidate.txt'), join(worktree, 'candidate.txt'))
      },
      integrate: (_target, worktree) => copyFileSync(join(worktree, '.yoke', 'prd.yaml'), join(projectDir, '.yoke', 'prd.yaml')),
      removeWorktree: (_target, worktree) => rmSync(worktree, { recursive: true, force: true }),
    }

    const code = runLoopCommand(projectDir, {
      maxIterations: 1,
      isolate: true,
      git: isolatedGit,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      qualityRuntime: {
        invoke: (_agent, invocation) => ({ success: true, output: qualityVerdictFor(invocation), summary: 'critic completed' }),
        firstLabel: () => 'A',
      },
    })

    expect(code).toBe(0)
    expect(loadPrd(join(projectDir, '.yoke', 'prd.yaml'))[0].passes).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'candidate.json'))).toBe(true)
    expect(existsSync(join(projectDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'normal.verdict.json'))).toBe(true)
  })
})
