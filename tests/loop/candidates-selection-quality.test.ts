import { describe, expect, it } from 'vitest'
import { coordinateCandidates, type CandidateComparisonRequest, type CandidateCoordinatorInput, type CandidateEvidence, type CandidateLifecycle, type CandidateWorkerDefinition } from '../../src/loop/candidates.js'

type EvidenceStage = { readonly handle: CandidateEvidence; readonly trusted: CandidateEvidence }
type FutureInput = CandidateCoordinatorInput & {
  readonly stageEvidence: (stage: EvidenceStage) => void | Promise<void>
  readonly judgeProvenance: { readonly provider: string; readonly model: string; readonly promptDigest: string; readonly rubricDigest: string }
}

const lifecycle = (events: string[] = []): CandidateLifecycle => ({
  reserve: request => ({ path: `C:\\work\\${request.candidateId}`, baseCommit: request.baseCommit }),
  materialize: ownership => { events.push(`materialize:${ownership.candidateId}`) },
  cancel: ownership => { events.push(`cancel:${ownership.candidateId}`) },
  reap: ownership => { events.push(`reap:${ownership.candidateId}`) },
  remove: ownership => { events.push(`remove:${ownership.candidateId}`) },
})

function worker(id: string): CandidateWorkerDefinition {
  return { id, worker: { provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: id }), verify: () => ({ passed: true, summary: 'green' }) } }
}

function verdict(request: CandidateComparisonRequest, selectedDigest: string, provenance: Partial<FutureInput['judgeProvenance']> = {}) {
  const selected = request.left.digest === selectedDigest ? request.left : request.right
  return {
    schemaVersion: 1, attemptId: request.attemptId, winner: selected.label, evidence: [`selected ${selectedDigest}`], confidence: 'high',
    left: { label: request.left.label, digest: request.left.digest }, right: { label: request.right.label, digest: request.right.digest },
    provenance: { leftDigest: request.left.digest, rightDigest: request.right.digest, provider: provenance.provider ?? 'codex', model: provenance.model ?? 'judge-model', promptDigest: provenance.promptDigest ?? 'judge-prompt', rubricDigest: provenance.rubricDigest ?? 'judge-rubric' },
  }
}

function input(candidates: readonly CandidateWorkerDefinition[], judge: CandidateCoordinatorInput['judge'], overrides: Partial<FutureInput> = {}): FutureInput {
  return {
    story: { id: 'S1', title: 'Selection contracts', priority: 1, acceptance: ['fair'], passes: false }, baseCommit: 'base', maxCandidates: candidates.length,
    candidates, coordinatorId: 'coordinator', ownerToken: id => `owner-${id}`, lifecycle: lifecycle(),
    pathPlatform: 'win32',
    evidence: candidate => ({ digest: `digest-${candidate.candidateId}`, artifacts: [`artifact-${candidate.candidateId}`] }),
    stageEvidence: () => undefined,
    judgeProvenance: { provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' },
    judge, ...overrides,
  }
}

function selectingJudge(trustedDigest: string): { readonly judge: CandidateCoordinatorInput['judge']; readonly stageEvidence: FutureInput['stageEvidence'] } {
  const trustedByHandle = new Map<string, string>()
  return {
    stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) },
    judge: request => {
      const selected = trustedByHandle.get(request.left.digest) === trustedDigest ? request.left : request.right
      return verdict(request, selected.digest)
    },
  }
}

describe('candidate selection quality contracts', () => {
  it.each([
    ['abort', 'first'],
    ['pause', 'first'],
    ['abort', 'challenger'],
    ['pause', 'challenger'],
  ] as const)('stops after deferred %s during %s evidence staging before judging or further staging', async (stop, phase) => {
    const events: string[] = []
    const controller = new AbortController()
    let paused = false
    let releaseStage: (() => void) | undefined
    let signalStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { signalStarted = resolve })
    const deferred = new Promise<void>(resolve => { releaseStage = resolve })
    const targetStage = phase === 'first' ? 1 : 2
    let stageCalls = 0
    let judgeCalls = 0
    const operation = coordinateCandidates(input(['one', 'two'].map(worker), () => {
      judgeCalls += 1
      return null
    }, {
      lifecycle: lifecycle(events),
      signal: controller.signal,
      pause: () => paused,
      stageEvidence: async () => {
        stageCalls += 1
        if (stageCalls === targetStage) {
          signalStarted?.()
          await deferred
        }
      },
    }))
    await started

    if (stop === 'abort') controller.abort('stop staging')
    else paused = true
    if (!releaseStage) throw new Error('staging did not start')
    releaseStage()
    const result = await operation

    expect(result).toMatchObject({ kind: stop === 'abort' ? 'cancelled' : 'paused' })
    expect(stageCalls).toBe(targetStage)
    expect(judgeCalls).toBe(0)
    expect(events.filter(event => event.startsWith('remove:'))).toHaveLength(2)
  })

  it('physically swaps blind evidence and selects the same digest across three-candidate permutations', async () => {
    const runs: CandidateComparisonRequest[][] = []
    for (const ids of [['one', 'two', 'three'], ['three', 'two', 'one']] as const) {
      const requests: CandidateComparisonRequest[] = []
      const adapter = selectingJudge('digest-two')
      const result = await coordinateCandidates(input(ids.map(worker), request => { requests.push(request); return adapter.judge(request) }, { stageEvidence: adapter.stageEvidence }))
      expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'two', comparisons: [{ selectedCandidateId: 'two' }, { selectedCandidateId: 'two' }] } })
      runs.push(requests)
    }
    for (const requests of runs) {
      for (let index = 0; index < requests.length; index += 2) {
        const normal = requests[index]
        const swapped = requests[index + 1]
        expect(normal && swapped && [normal.left.digest, normal.right.digest]).toEqual(swapped && [swapped.right.digest, swapped.left.digest])
      }
    }
  })

  it('rejects a judge that always favors the left position', async () => {
    let calls = 0
    const result = await coordinateCandidates(input(['one', 'two', 'three'].map(worker), request => { calls += 1; return verdict(request, request.left.digest) }))
    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent' })
    expect(calls).toBe(2)
  })

  it('stops after a pending normal judge when pause arrives and cleans every candidate', async () => {
    const events: string[] = []
    let paused = false
    let resolveJudge: ((value: unknown) => void) | undefined
    let pendingRequest: CandidateComparisonRequest | undefined
    let startedJudge: (() => void) | undefined
    const started = new Promise<void>(resolve => { startedJudge = resolve })
    const pending = new Promise<unknown>(resolve => { resolveJudge = resolve })
    let calls = 0
    const operation = coordinateCandidates(input(['one', 'two', 'three'].map(worker), request => {
      calls += 1
      pendingRequest = request
      startedJudge?.()
      return pending
    }, { lifecycle: lifecycle(events), pause: () => paused }))
    await started

    paused = true
    if (!resolveJudge || !pendingRequest) throw new Error('judge did not start')
    resolveJudge(verdict(pendingRequest, 'digest-one'))
    const result = await operation

    expect(result).toMatchObject({ kind: 'paused' })
    expect(calls).toBe(1)
    expect(events.filter(event => event.startsWith('remove:'))).toHaveLength(3)
  })

  it('picks and clones evidence without allowing excess fields to replace winner ownership', async () => {
    const artifacts = ['trusted-artifact']
    const untrusted = { digest: 'trusted-digest', artifacts, candidateId: 'forged', ownerToken: 'forged-owner', result: { kind: 'forged' } }
    const result = await coordinateCandidates(input([worker('trusted')], () => null, { evidence: () => untrusted }))
    artifacts.push('mutated-after-return')

    expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'trusted', ownerToken: 'owner-trusted', digest: 'trusted-digest', artifacts: ['trusted-artifact'], comparisons: [] } })
  })

  it('exposes only blind evidence in serialized judge requests', async () => {
    const requests: CandidateComparisonRequest[] = []
    const evidence = new Map<string, CandidateEvidence>([
      ['secret-one', { digest: 'secret-one C:\\work\\one codex model-one owner-one', artifacts: ['C:\\work\\one\\provider-codex'] }],
      ['secret-two', { digest: 'secret-two C:\\work\\two gemini model-two owner-two', artifacts: ['C:\\work\\two\\provider-gemini'] }],
    ])
    const adapter = selectingJudge('secret-one C:\\work\\one codex model-one owner-one')
    const result = await coordinateCandidates(input(['secret-one', 'secret-two'].map(worker), request => {
      requests.push(request)
      return adapter.judge(request)
    }, { evidence: candidate => evidence.get(candidate.candidateId), stageEvidence: adapter.stageEvidence }))

    const serialized = JSON.stringify(requests)
    expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'secret-one', digest: 'secret-one C:\\work\\one codex model-one owner-one', artifacts: ['C:\\work\\one\\provider-codex'] } })
    for (const identity of ['secret-one', 'secret-two', 'C:\\work', 'codex', 'gemini', 'model-one', 'model-two', 'owner-one', 'owner-two']) expect(serialized).not.toContain(identity)
    for (const field of ['candidateId', 'provider', 'model', 'ownerToken', 'worktree', 'coordinatorId', 'storyId']) {
      expect(serialized).not.toContain(`"${field}"`)
    }
  })

  it('deep-snapshots validated requests and verdicts in the winner audit trail', async () => {
    const retainedRequests: CandidateComparisonRequest[] = []
    const retainedVerdicts: Array<ReturnType<typeof verdict>> = []
    const trustedByHandle = new Map<string, string>()
    const result = await coordinateCandidates(input(['one', 'two'].map(worker), request => {
      retainedRequests.push(request)
      const selected = trustedByHandle.get(request.left.digest) === 'digest-one' ? request.left : request.right
      const response = verdict(request, selected.digest)
      retainedVerdicts.push(response)
      return response
    }, { stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) } }))
    if (result.kind !== 'winner') throw new Error('winner expected')
    const auditBeforeMutation = JSON.stringify(result.winner.comparisons)

    for (const request of retainedRequests) Reflect.set(request.left, 'digest', 'mutated-request')
    for (const response of retainedVerdicts) {
      response.left.digest = 'mutated-verdict'
      response.evidence.push('mutated-evidence')
    }

    expect(JSON.stringify(result.winner.comparisons)).toBe(auditBeforeMutation)
  })

  it('records the private issued request when the judge mutates its callback request', async () => {
    const trustedByHandle = new Map<string, string>()
    const issuedRequests: CandidateComparisonRequest[] = []
    const result = await coordinateCandidates(input(['one', 'two'].map(worker), request => {
      const issued = structuredClone(request)
      issuedRequests.push(issued)
      const selected = trustedByHandle.get(issued.left.digest) === 'digest-one' ? issued.left : issued.right
      Reflect.set(request, 'attemptId', 'mutated-attempt')
      Reflect.set(request.left, 'digest', 'mutated-digest')
      return verdict(issued, selected.digest)
    }, { stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) } }))
    if (result.kind !== 'winner') throw new Error('winner expected')

    expect(result.winner.comparisons.map(comparison => comparison.normal.request)).toEqual([issuedRequests[0]])
    expect(JSON.stringify(result.winner.comparisons)).not.toContain('mutated-')
  })

  it('rejects foreign candidate-pair judge provenance', async () => {
    const trustedByHandle = new Map<string, string>()
    const result = await coordinateCandidates(input(['one', 'two'].map(worker), request => {
      const selected = trustedByHandle.get(request.left.digest) === 'digest-one' ? request.left : request.right
      return verdict(request, selected.digest, { provider: 'foreign-provider' })
    }, { stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) } }))

    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent', summary: 'provenance-mismatch' })
  })

  it('rejects invalid evidence and invalid candidate boundaries', async () => {
    const invalidEvidence = await coordinateCandidates(input([worker('one')], () => null, { evidence: () => ({ digest: '', artifacts: [] }) }))
    expect(invalidEvidence).toMatchObject({ kind: 'blocked', reason: 'coordinator-error' })

    for (const candidates of [[], [worker('')], [worker('../escape')], [worker('a/b')], [worker('same'), worker('same')]]) {
      const result = await coordinateCandidates(input(candidates, () => null, { maxCandidates: Math.max(1, candidates.length) }))
      expect(result).toMatchObject({ kind: 'blocked', reason: 'invalid-config' })
    }

    const six = Array.from({ length: 6 }, (_, index) => worker(`candidate-${index}`))
    expect(await coordinateCandidates(input(six, () => null))).toMatchObject({ kind: 'blocked', reason: 'invalid-config' })
  })
})
