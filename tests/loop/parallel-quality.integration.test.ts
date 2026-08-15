import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLoopCommand } from '../../src/loop/run-command.js'
import { loadPrd, savePrd, storyPathSegment } from '../../src/loop/prd.js'
import { saveConfig } from '../../src/retrofit/config.js'
import type { GitOps } from '../../src/loop/gates.js'

let dir: string

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function qualityVerdict(attemptId: string, candidateLabel: 'A' | 'B', promptDigest: string, rubricDigest: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    attemptId,
    winner: 'candidate',
    biggestGap: 'none',
    evidence: ['candidate matches the approved reference'],
    confidence: 'high',
    candidate: { label: candidateLabel, digest: digest('candidate artifact') },
    reference: { label: candidateLabel === 'A' ? 'B' : 'A', digest: digest('trusted reference') },
    provenance: {
      provider: 'codex', model: 'test-critic', promptDigest, rubricDigest,
      referenceDigest: digest('trusted reference'), candidateDigest: digest('candidate artifact'),
    },
  })
}

function qualityVerdictFor(input: string): string {
  const request = JSON.parse(input) as { attemptId: string; candidateLabel: 'A' | 'B'; promptDigest: string; rubricDigest: string }
  return qualityVerdict(request.attemptId, request.candidateLabel, request.promptDigest, request.rubricDigest)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yoke-parallel-quality-'))
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  writeFileSync(join(dir, 'reference.txt'), 'trusted reference')
  writeFileSync(join(dir, 'candidate.txt'), 'candidate artifact')
  writeFileSync(join(dir, '.yoke', 'prd.yaml'), `
- id: S1
  title: Parallel quality
  priority: 1
  acceptance: [quality works]
  passes: false
  quality:
    reference: { name: approved-reference, source: reference.txt, kind: file, digest: sha256:${digest('trusted reference')} }
    candidate: { kind: files, paths: [candidate.txt] }
    rubric: Compare the candidate with the approved reference
`)
  saveConfig(dir, {
    canonVersion: 'test', agents: ['codex', 'claude'], loop: { enabled: true },
    quality: { enabled: true, policy: 'blocking', maxRounds: 1, maxMinutes: 1, consistencyChecks: 2, maxParallelCandidates: 1, criticAgent: 'codex', criticModel: 'test-critic' },
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parallel quality lifecycle', () => {
  it('runs fresh merge quality and review while preserving separate worker and integration evidence', async () => {
    let reviews = 0
    const git: GitOps = {
      isClean: () => true,
      addWorktree: (_target, worktree) => {
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        copyFileSync(join(dir, '.yoke', 'prd.yaml'), join(worktree, '.yoke', 'prd.yaml'))
        copyFileSync(join(dir, 'reference.txt'), join(worktree, 'reference.txt'))
        copyFileSync(join(dir, 'candidate.txt'), join(worktree, 'candidate.txt'))
      },
      removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
      commitAll: () => undefined,
      integrate: (_target, worktree) => {
        savePrd(join(dir, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
      },
    }

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: () => ({ success: true, summary: 'implemented' }),
      reviewRunner: () => {
        reviews += 1
        return { success: true, summary: 'approved' }
      },
      qualityRuntime: {
        invoke: (_agent, invocation) => ({ success: true, output: qualityVerdictFor(invocation.input), summary: 'critic completed' }),
        firstLabel: () => 'A',
      },
    }))
    expect(code).toBe(0)
    expect(reviews).toBe(2)
    expect(existsSync(join(dir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'normal.verdict.json'))).toBe(true)
    expect(existsSync(join(dir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'integration-round-10000', 'normal.verdict.json'))).toBe(true)
  })

  it.each(['command-output', 'benchmark'] as const)('judges %s artifacts from the candidate worktree during worker and integration checks', async candidateKind => {
    writeFileSync(join(dir, 'candidate.txt'), 'root artifact')
    writeFileSync(join(dir, '.yoke', 'prd.yaml'), `
- id: S1
  title: Parallel quality
  priority: 1
  acceptance: [quality works]
  passes: false
  quality:
    reference: { name: approved-reference, source: reference.txt, kind: file, digest: sha256:${digest('trusted reference')} }
    candidate: { kind: ${candidateKind}, command: 'node -e "process.stdout.write(require(''node:fs'').readFileSync(''candidate.txt'', ''utf8''))"' }
    rubric: Compare the candidate with the approved reference
`)
    const git: GitOps = {
      isClean: () => true,
      addWorktree: (_target, worktree) => {
        mkdirSync(join(worktree, '.yoke'), { recursive: true })
        copyFileSync(join(dir, '.yoke', 'prd.yaml'), join(worktree, '.yoke', 'prd.yaml'))
        copyFileSync(join(dir, 'reference.txt'), join(worktree, 'reference.txt'))
        copyFileSync(join(dir, 'candidate.txt'), join(worktree, 'candidate.txt'))
      },
      removeWorktree: (_target, worktree) => { rmSync(worktree, { recursive: true, force: true }) },
      commitAll: () => undefined,
      integrate: (_target, worktree) => {
        savePrd(join(dir, '.yoke', 'prd.yaml'), loadPrd(join(worktree, '.yoke', 'prd.yaml')))
      },
    }

    const code = await Promise.resolve(runLoopCommand(dir, {
      parallel: 2,
      maxIterations: 1,
      git,
      verify: () => ({ passed: true, summary: 'green' }),
      runner: context => {
        writeFileSync(join(context.targetDir, 'candidate.txt'), 'candidate artifact')
        return { success: true, summary: 'implemented' }
      },
      qualityRuntime: {
        invoke: (_agent, invocation) => ({ success: true, output: qualityVerdictFor(invocation.input), summary: 'critic completed' }),
        firstLabel: () => 'A',
      },
    }))

    expect(digest('root artifact')).not.toBe(digest('candidate artifact'))
    expect(code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'candidate.json'), 'utf8'))).toMatchObject({
      kind: 'collected',
      candidate: { digests: [digest('candidate artifact')] },
    })
    expect(JSON.parse(readFileSync(join(dir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'integration-round-10000', 'candidate.json'), 'utf8'))).toMatchObject({
      kind: 'collected',
      candidate: { digests: [digest('candidate artifact')] },
    })
  })
})
