import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCandidateComparison } from '../../src/quality/candidate-comparison.js'
import { reduceCandidatePairComparisons } from '../../src/quality/verdict.js'
import type { CandidateEvidenceInput } from '../../src/loop/candidate-contracts.js'
import type { StoryQualityDeclaration } from '../../src/quality/types.js'

const projects: string[] = []
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const PairRequestSchema = z.object({
  schemaVersion: z.literal(1),
  role: z.literal('opaque-comparison-critic'),
  permissions: z.literal('read-only'),
  attemptId: z.string(),
  promptDigest: z.string(),
  rubricDigest: z.string(),
  trustedJudgeProvenance: z.object({ provider: z.string(), model: z.string() }).strict(),
  rubric: z.string(),
  output: z.string(),
  left: z.object({ label: z.enum(['A', 'B']), digest: z.string(), artifacts: z.array(z.string()).min(1) }),
  right: z.object({ label: z.enum(['A', 'B']), digest: z.string(), artifacts: z.array(z.string()).min(1) }),
}).strict()
const PairVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: z.string(),
  winner: z.enum(['A', 'B']),
  evidence: z.array(z.string()).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  left: z.object({ label: z.enum(['A', 'B']), digest: z.string() }),
  right: z.object({ label: z.enum(['A', 'B']), digest: z.string() }),
  provenance: z.object({
    leftDigest: z.string(),
    rightDigest: z.string(),
    provider: z.string(),
    model: z.string(),
    promptDigest: z.string(),
    rubricDigest: z.string(),
  }),
})

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

describe('candidate comparison staging', () => {
  it('judges actual anonymous staged bytes from an isolated comparison directory', () => {
    const project = mkdtempSync(join(tmpdir(), 'yoke-candidate-comparison-'))
    projects.push(project)
    const left = join(project, 'left-worktree')
    const right = join(project, 'right-worktree')
    const candidates = [
      { dir: left, contents: 'weaker bytes' },
      { dir: right, contents: 'intended winner bytes' },
    ]
    for (const candidate of candidates) {
      mkdirSync(candidate.dir, { recursive: true })
      writeFileSync(join(candidate.dir, 'artifact.txt'), candidate.contents)
    }
    const declaration = {
      reference: { name: 'reference', source: 'reference.txt', kind: 'file', digest: `sha256:${digest('reference')}` },
      candidate: { kind: 'files', paths: ['artifact.txt'] },
      rubric: 'Choose the more complete artifact.',
    } satisfies StoryQualityDeclaration
    let reads = 0
    let judgeRoot = ''
    const requests: z.infer<typeof PairRequestSchema>[] = []
    const comparison = createCandidateComparison({
      targetDir: project,
      storyId: 'S1',
      candidateIds: ['candidate-left', 'candidate-right'],
      declaration,
      artifacts: () => ({
        readFile: path => {
          reads += 1
          return existsSync(path) ? readFileSync(path) : null
        },
        commandOutput: () => new Uint8Array(),
        benchmark: () => new Uint8Array(),
      }),
      agent: 'codex',
      model: 'critic-model',
      idleMs: 0,
      invoke: (_agent, invocation) => {
        expect(invocation.args).toContain('--skip-git-repo-check')
        expect(invocation.input).not.toContain('candidate-left')
        expect(invocation.input).not.toContain('candidate-right')
        expect(invocation.input).not.toContain(JSON.stringify(project).slice(1, -1))
        expect(invocation.input).not.toContain(JSON.stringify(left).slice(1, -1))
        expect(invocation.input).not.toContain(JSON.stringify(right).slice(1, -1))
        const payload: unknown = JSON.parse(invocation.input)
        const request = PairRequestSchema.parse(payload)
        requests.push(request)
        judgeRoot = invocation.cwd
        expect(relative(project, invocation.cwd)).not.toBe('')
        expect(resolve(invocation.cwd).startsWith(resolve(project))).toBe(false)
        expect(JSON.stringify(request)).not.toContain('candidate-')
        expect(request.trustedJudgeProvenance).toEqual({ provider: 'codex', model: 'critic-model' })
        expect(readdirSync(invocation.cwd).sort()).toEqual([...request.left.artifacts, ...request.right.artifacts].sort())
        const leftBytes = readFileSync(join(invocation.cwd, request.left.artifacts[0] ?? ''), 'utf8')
        const rightBytes = readFileSync(join(invocation.cwd, request.right.artifacts[0] ?? ''), 'utf8')
        const winner = rightBytes === 'intended winner bytes' && leftBytes === 'weaker bytes' ? request.right : request.left
        const verdict = JSON.stringify({
            schemaVersion: 1,
            attemptId: request.attemptId,
            winner: winner.label,
            evidence: ['selected staged bytes'],
            confidence: 'high',
            left: { label: request.left.label, digest: request.left.digest },
            right: { label: request.right.label, digest: request.right.digest },
            provenance: {
              leftDigest: request.left.digest,
              rightDigest: request.right.digest,
              provider: request.trustedJudgeProvenance.provider,
              model: request.trustedJudgeProvenance.model,
              promptDigest: request.promptDigest,
              rubricDigest: request.rubricDigest,
            },
          })
        return {
          success: true,
          output: [
            JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
            JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: verdict } }),
            JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 4 } }),
          ].join('\n'),
          summary: 'selected by staged bytes',
          tokens: { inputTokens: 10, outputTokens: 4, model: 'provider-canonical-model' },
        }
      },
    })
    const leftEvidence = comparison.evidence(candidate('candidate-left', left))
    const rightEvidence = comparison.evidence(candidate('candidate-right', right))
    comparison.stageEvidence({ handle: { digest: 'opaque-left', artifacts: ['opaque-left.bin'] }, trusted: leftEvidence })
    comparison.stageEvidence({ handle: { digest: 'opaque-right', artifacts: ['opaque-right.bin'] }, trusted: rightEvidence })

    const normalRequest = {
      permissions: 'read-only',
      attemptId: 'comparison-1',
      left: { label: 'A', digest: 'opaque-left', artifacts: ['opaque-left.bin'] },
      right: { label: 'B', digest: 'opaque-right', artifacts: ['opaque-right.bin'] },
    } as const
    const swappedRequest = {
      permissions: 'read-only',
      attemptId: 'comparison-2',
      left: { label: 'A', digest: 'opaque-right', artifacts: ['opaque-right.bin'] },
      right: { label: 'B', digest: 'opaque-left', artifacts: ['opaque-left.bin'] },
    } as const
    const normal = PairVerdictSchema.parse(comparison.judge(normalRequest))
    const swapped = PairVerdictSchema.parse(comparison.judge(swappedRequest))
    const expected = {
      normal: {
        request: normalRequest,
        candidateIds: { left: 'candidate-left', right: 'candidate-right' },
        provenance: comparison.judgeProvenance,
      },
      swapped: {
        request: swappedRequest,
        candidateIds: { left: 'candidate-right', right: 'candidate-left' },
        provenance: comparison.judgeProvenance,
      },
    } as const

    expect(requests).toHaveLength(2)
    expect(normal).toMatchObject({ winner: 'B' })
    expect(swapped).toMatchObject({ winner: 'A' })
    expect(reduceCandidatePairComparisons({ expected, normal, swapped })).toMatchObject({
      kind: 'selected',
      winnerCandidateId: 'candidate-right',
      winnerDigest: 'opaque-right',
    })
    const tampered = { ...normal, provenance: { ...normal.provenance, model: 'tampered-model' } }
    expect(reduceCandidatePairComparisons({ expected, normal: tampered, swapped })).toEqual({
      kind: 'inconsistent',
      reason: 'provenance-mismatch',
    })
    expect(existsSync(judgeRoot)).toBe(false)
    expect(reads).toBe(2)
  })
})

function candidate(candidateId: string, worktree: string): CandidateEvidenceInput {
  return {
    candidateId,
    coordinatorId: 'coordinator',
    ownerToken: `owner-${candidateId}`,
    storyId: 'S1',
    provider: { provider: 'codex', role: 'implementation' },
    worktree: { path: worktree, baseCommit: 'base' },
    signal: new AbortController().signal,
    result: {
      kind: 'candidate',
      storyId: 'S1',
      worktree,
      baseCommit: 'base',
      provider: { provider: 'codex', role: 'implementation' },
      summary: 'green',
      evidence: { criteria: [] },
      routing: { outcome: 'pending-integration' },
    },
  }
}
