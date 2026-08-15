import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd, storyPathSegment } from '../../src/loop/prd.js'
import { makeReporter } from '../../src/loop/reporter.js'
import { loadConfig, saveConfig } from '../../src/retrofit/config.js'
import type { GitOps } from '../../src/loop/gates.js'

const projects: string[] = []
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const PairPromptSchema = z.object({
  attemptId: z.string(),
  left: z.object({ label: z.enum(['A', 'B']), digest: z.string(), artifacts: z.array(z.string()) }),
  right: z.object({ label: z.enum(['A', 'B']), digest: z.string(), artifacts: z.array(z.string()) }),
  promptDigest: z.string(),
  rubricDigest: z.string(),
  trustedJudgeProvenance: z.object({ provider: z.string(), model: z.string() }),
})
const QualityPromptSchema = z.object({
  attemptId: z.string(),
  candidateLabel: z.enum(['A', 'B']),
  referenceLabel: z.enum(['A', 'B']),
  candidate: z.object({ digests: z.array(z.string()).min(1) }),
  promptDigest: z.string(),
  rubricDigest: z.string(),
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

describe('runLoopCommand quality candidates', () => {
  it('requires every unfinished candidate story to declare quality before dispatch', async () => {
    const project = createProject(false)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let runs = 0

    const code = await Promise.resolve(runLoopCommand(project, {
      candidates: 2,
      runner: () => { runs += 1; return { success: true, summary: 'unexpected' } },
      git: memoryGit(project),
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    expect(code).toBe(2)
    expect(runs).toBe(0)
    expect(error.mock.calls.flat().join('\n')).toContain('quality declaration')
  })

  it('rejects candidate counts outside the supported and configured bounds before dispatch', async () => {
    const project = createProject(true, 2)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let runs = 0

    for (const candidates of [0, 3, 6]) {
      const code = await Promise.resolve(runLoopCommand(project, {
        candidates,
        runner: () => { runs += 1; return { success: true, summary: 'unexpected' } },
        git: memoryGit(project),
        verify: () => ({ passed: true, summary: 'green' }),
      }))
      expect(code).toBe(2)
    }

    expect(runs).toBe(0)
    expect(error.mock.calls.flat().join('\n')).toContain('maxParallelCandidates')
  })

  it('rejects model-less candidate judging before dispatching runners or worktrees', async () => {
    const project = createProject(true)
    const config = loadConfig(project)!
    saveConfig(project, { ...config, quality: { ...config.quality!, criticModel: undefined } })
    let runs = 0
    let worktrees = 0
    const base = memoryGit(project)
    const code = await Promise.resolve(runLoopCommand(project, {
      candidates: 2,
      runner: () => { runs += 1; return { success: true, summary: 'unexpected' } },
      git: { ...base, addWorktree: (target, worktree) => { worktrees += 1; base.addWorktree(target, worktree) } },
      verify: () => ({ passed: true, summary: 'green' }),
    }))
    expect(code).toBe(2)
    expect(runs).toBe(0)
    expect(worktrees).toBe(0)
  })

  it('blindly selects one green candidate, merges it once, and persists loser proof before cleanup', async () => {
    const project = createProject(true)
    const removals: boolean[] = []
    const integrations: string[] = []
    let integratedCandidate = ''
    let implementations = 0
    let selectedHandle: string | undefined
    const statusLines: string[] = []
    const git = memoryGit(project, {
      remove: () => removals.push(existsSync(join(project, '.yoke', 'proof', storyPathSegment('S1'), 'candidates', 'candidate-2', 'selection.json'))),
      integrate: worktree => { integrations.push(worktree); integratedCandidate = read(worktree, 'candidate.txt') },
    })

    const code = await Promise.resolve(runLoopCommand(project, {
      candidates: 3,
      maxIterations: 1,
      runner: context => {
        implementations += 1
        writeFileSync(join(context.targetDir, 'candidate.txt'), implementations === 1 ? 'red candidate' : `green candidate ${implementations}`)
        return { success: true, summary: `candidate ${implementations}` }
      },
      git,
      verify: path => ({ passed: !existsSync(join(path, 'candidate.txt')) || !read(path, 'candidate.txt').startsWith('red'), summary: 'mechanical gate' }),
      reporter: makeReporter(project, { json: true, log: line => statusLines.push(line) }),
      qualityRuntime: {
        invoke: (_agent, invocation) => {
          const raw = JSON.parse(invocation.input)
          const pair = PairPromptSchema.safeParse(raw)
          if (pair.success) {
            expect(invocation.input).not.toContain('candidate-')
            expect(invocation.input).not.toContain(project)
            expect(pair.data.trustedJudgeProvenance).toEqual({ provider: 'codex', model: 'test-critic' })
            selectedHandle ??= pair.data.right.digest
            const winner = pair.data.left.digest === selectedHandle ? pair.data.left.label : pair.data.right.label
            return {
              success: true,
              output: JSON.stringify({
                schemaVersion: 1,
                attemptId: pair.data.attemptId,
                winner,
                evidence: ['opaque handle selected'],
                confidence: 'high',
                left: { label: pair.data.left.label, digest: pair.data.left.digest },
                right: { label: pair.data.right.label, digest: pair.data.right.digest },
                provenance: { leftDigest: pair.data.left.digest, rightDigest: pair.data.right.digest, ...pair.data.trustedJudgeProvenance, promptDigest: pair.data.promptDigest, rubricDigest: pair.data.rubricDigest },
              }),
              summary: 'pair judged',
            }
          }
          const quality = QualityPromptSchema.parse(raw)
          return {
            success: true,
            output: JSON.stringify({
              schemaVersion: 1,
              attemptId: quality.attemptId,
              winner: 'candidate',
              biggestGap: 'none',
              evidence: ['candidate is acceptable'],
              confidence: 'high',
              candidate: { label: quality.candidateLabel, digest: quality.candidate.digests[0] },
              reference: { label: quality.referenceLabel, digest: digest('trusted reference') },
              provenance: { provider: 'codex', model: 'test-critic', promptDigest: quality.promptDigest, rubricDigest: quality.rubricDigest, referenceDigest: digest('trusted reference'), candidateDigest: quality.candidate.digests[0] },
            }),
            summary: 'quality judged',
          }
        },
        firstLabel: () => 'A',
      },
    }))

    expect(code).toBe(0)
    expect(implementations).toBe(3)
    expect(integrations).toHaveLength(1)
    expect(integratedCandidate).toBe('green candidate 3')
    expect(removals).toHaveLength(3)
    expect(removals.every(Boolean)).toBe(true)
    expect(loadPrd(join(project, '.yoke', 'prd.yaml'))[0]?.passes).toBe(true)
    expect(worktreeEntries(project)).toEqual([])
    expect(read(project, `.yoke/proof/${storyPathSegment('S1')}/candidates/candidate-1/result.json`)).toContain('mechanical-failure')
    expect(read(project, `.yoke/proof/${storyPathSegment('S1')}/candidates/candidate-2/selection.json`)).toContain('not-selected')
    expect(read(project, `.yoke/proof/${storyPathSegment('S1')}/candidates/candidate-3/selection.json`)).toContain('selected')
    expect(statusLines.some(line => line.includes('selecting-candidate'))).toBe(true)
  })

  it.each(['crash', 'pause'] as const)('persists each candidate terminal proof before cleanup after a candidate %s', async mode => {
    const project = createProject(true)
    const removals: string[] = []
    const git = memoryGit(project, { remove: worktree => {
      const candidates = join(project, '.yoke', 'proof', storyPathSegment('S1'), 'candidates')
      const candidate = readdirSync(candidates).find(id => {
        const status = join(candidates, id, 'status.json')
        return existsSync(status) && JSON.parse(readFileSync(status, 'utf8')).worktree === worktree
      })
      if (!candidate) throw new Error(`missing candidate status for ${worktree}`)
      const proof = join(candidates, candidate)
      expect(existsSync(join(proof, 'result.json'))).toBe(true)
      expect(existsSync(join(proof, 'selection.json'))).toBe(true)
      expect(JSON.parse(readFileSync(join(proof, 'status.json'), 'utf8'))).toMatchObject({ candidateId: candidate, state: 'cleaning' })
      removals.push(worktree)
    } })
    const code = await Promise.resolve(runLoopCommand(project, {
      candidates: 3,
      maxIterations: 1,
      runner: context => {
        if (mode === 'crash') throw new Error('fake provider crashed')
        writeFileSync(join(project, '.yoke', 'loop.pause'), '')
        writeFileSync(join(context.targetDir, 'candidate.txt'), 'green candidate')
        return { success: true, summary: 'pause requested' }
      },
      git,
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    expect(code).toBe(mode === 'pause' ? 3 : 1)
    expect(removals).toHaveLength(3)
    expect(worktreeEntries(project)).toEqual([])
  })

  it('rejects disabled quality before claiming or materializing candidate worktrees', async () => {
    const project = createProject(true)
    const base = memoryGit(project)
    let worktrees = 0
    let runs = 0
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const git: GitOps = { ...base, addWorktree: (target, worktree) => { worktrees += 1; base.addWorktree(target, worktree) } }

    const code = await Promise.resolve(runLoopCommand(project, {
      candidates: 2,
      quality: false,
      runner: () => { runs += 1; return { success: true, summary: 'unexpected' } },
      git,
      verify: () => ({ passed: true, summary: 'green' }),
    }))

    expect(code).toBe(2)
    expect(runs).toBe(0)
    expect(worktrees).toBe(0)
    expect(error.mock.calls.flat().join('\n')).toContain('quality cannot be disabled')
  })
})

function createProject(withQuality: boolean, maxParallelCandidates = 3): string {
  const project = mkdtempSync(join(tmpdir(), 'yoke-candidate-command-'))
  projects.push(project)
  mkdirSync(join(project, '.yoke'), { recursive: true })
  writeFileSync(join(project, 'reference.txt'), 'trusted reference')
  writeFileSync(join(project, 'candidate.txt'), 'initial candidate')
  writeFileSync(join(project, '.yoke', 'prd.yaml'), `
- id: S1
  title: Candidate race
  priority: 1
  acceptance: [race works]
  passes: false
${withQuality ? `  quality:
    reference: { name: trusted, source: reference.txt, kind: file, digest: sha256:${digest('trusted reference')} }
    candidate: { kind: files, paths: [candidate.txt] }
    rubric: Choose the stronger candidate
` : ''}`)
  saveConfig(project, {
    canonVersion: 'test',
    agents: ['codex'],
    loop: { enabled: true },
    quality: { enabled: true, policy: 'blocking', maxRounds: 1, maxMinutes: 1, consistencyChecks: 2, maxParallelCandidates, criticAgent: 'codex', criticModel: 'test-critic' },
  })
  return project
}

function memoryGit(project: string, hooks: { readonly remove?: (worktree: string) => void; readonly integrate?: (worktree: string) => void } = {}): GitOps {
  return {
    isClean: () => true,
    addWorktree: (_target, worktree) => {
      mkdirSync(join(worktree, '.yoke'), { recursive: true })
      copyFileSync(join(project, '.yoke', 'prd.yaml'), join(worktree, '.yoke', 'prd.yaml'))
      copyFileSync(join(project, 'reference.txt'), join(worktree, 'reference.txt'))
      copyFileSync(join(project, 'candidate.txt'), join(worktree, 'candidate.txt'))
    },
    removeWorktree: (_target, worktree) => {
      hooks.remove?.(worktree)
      rmSync(worktree, { recursive: true, force: true })
    },
    commitAll: () => undefined,
    integrate: (_target, worktree) => {
      hooks.integrate?.(worktree)
      savePrd(join(project, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
    },
  }
}

function worktreeEntries(project: string): string[] {
  const root = join(project, '.yoke', 'worktrees')
  return existsSync(root) ? readdirSync(root) : []
}

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), 'utf8')
}
