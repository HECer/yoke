import { describe, expect, it } from 'vitest'
import {
  coordinateCandidates,
  type CandidateComparisonRequest,
  type CandidateWorkerDefinition,
} from '../../src/loop/candidates.js'

function worker(id: string): CandidateWorkerDefinition {
  return {
    id,
    worker: {
      provider: { provider: 'codex', role: 'implementation' },
      runner: () => ({ success: true, summary: `${id} implemented` }),
      verify: () => ({ passed: true, summary: 'green' }),
    },
  }
}

function verdict(request: CandidateComparisonRequest): unknown {
  return {
    schemaVersion: 1,
    attemptId: request.attemptId,
    winner: request.left.label,
    evidence: ['left candidate is stronger'],
    confidence: 'high',
    left: { label: request.left.label, digest: request.left.digest },
    right: { label: request.right.label, digest: request.right.digest },
    provenance: { leftDigest: request.left.digest, rightDigest: request.right.digest, provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' },
  }
}

describe('candidate judge cancellation', () => {
  it('cancels immediately during a pending comparison and destroys worktrees only after the judge settles', async () => {
    const events: string[] = []
    const controller = new AbortController()
    let resolveJudge: ((value: unknown) => void) | undefined
    let pendingRequest: CandidateComparisonRequest | undefined
    let signalStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { signalStarted = resolve })
    const pending = new Promise<unknown>(resolve => { resolveJudge = resolve })
    let judgeCalls = 0
    const operation = coordinateCandidates({
      story: { id: 'S1', title: 'Pending comparison', priority: 1, acceptance: ['green'], passes: false },
      baseCommit: 'base-123',
      maxCandidates: 2,
      candidates: [worker('one'), worker('two')],
      coordinatorId: 'coordinator-1',
      ownerToken: id => `owner-${id}`,
      pathPlatform: 'posix',
      lifecycle: {
        reserve: input => ({ path: `/candidate/${input.candidateId}`, baseCommit: input.baseCommit }),
        materialize: () => undefined,
        cancel: input => { events.push(`cancel:${input.candidateId}`) },
        reap: input => { events.push(`reap:${input.candidateId}`) },
        remove: input => { events.push(`remove:${input.candidateId}`) },
      },
      evidence: candidate => ({ digest: `digest-${candidate.candidateId}`, artifacts: [`artifact-${candidate.candidateId}`] }),
      stageEvidence: () => undefined,
      judgeProvenance: { provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' },
      judge: request => {
        judgeCalls += 1
        if (judgeCalls > 1) return verdict(request)
        pendingRequest = request
        signalStarted?.()
        return pending
      },
      signal: controller.signal,
    })
    await started

    controller.abort('stop pending judge')
    const beforeSettlement = [...events]
    if (!resolveJudge || !pendingRequest) throw new Error('judge did not start')
    resolveJudge(verdict(pendingRequest))
    const result = await operation

    expect(beforeSettlement).toEqual(['cancel:one', 'cancel:two'])
    expect(result).toMatchObject({ kind: 'cancelled', summary: 'stop pending judge' })
    expect(events).toEqual(['cancel:one', 'cancel:two', 'reap:one', 'remove:one', 'reap:two', 'remove:two'])
  })
})
