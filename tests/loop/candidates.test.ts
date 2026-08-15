import { describe, expect, it } from 'vitest'
import {
  coordinateCandidates,
  type CandidateComparisonRequest,
  type CandidateCoordinatorInput,
  type CandidateLifecycle,
  type CandidateWorkerDefinition,
} from '../../src/loop/candidates.js'
import type { Story } from '../../src/loop/prd.js'

const story = (): Story => ({
  id: 'S1',
  title: 'Choose the strongest candidate',
  priority: 1,
  acceptance: ['all mechanical gates pass'],
  passes: false,
})

const worker = (
  id: string,
  verify: () => { readonly passed: boolean; readonly summary: string } = () => ({ passed: true, summary: 'green' }),
  runner: CandidateWorkerDefinition['worker']['runner'] = () => ({ success: true, summary: `${id} implemented` }),
): CandidateWorkerDefinition => ({
  id,
  worker: {
    provider: { provider: 'codex', model: `model-${id}`, role: 'implementation' },
    runner,
    verify,
  },
})

type Harness = {
  readonly input: Omit<CandidateCoordinatorInput, 'candidates'>
  readonly created: Array<{ readonly id: string; readonly baseCommit: string }>
  readonly cleanup: string[]
  readonly requests: CandidateComparisonRequest[]
}

function selectionVerdict(request: CandidateComparisonRequest, options: {
  readonly winner?: 'left' | 'right'
  readonly attemptId?: string
  readonly confidence?: 'high' | 'medium' | 'low'
  readonly left?: { readonly label?: 'A' | 'B'; readonly digest?: string }
  readonly right?: { readonly label?: 'A' | 'B'; readonly digest?: string }
} = {}): unknown {
  const left = { label: options.left?.label ?? request.left.label, digest: options.left?.digest ?? request.left.digest }
  const right = { label: options.right?.label ?? request.right.label, digest: options.right?.digest ?? request.right.digest }
  const selected = options.winner === 'right' ? right.label : left.label
  return {
    schemaVersion: 1,
    attemptId: options.attemptId ?? request.attemptId,
    winner: selected,
    evidence: ['candidate evidence differs'],
    confidence: options.confidence ?? 'high',
    left,
    right,
    provenance: { leftDigest: left.digest, rightDigest: right.digest, provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' },
  }
}

function harness(overrides: Partial<CandidateCoordinatorInput> = {}): Harness {
  const created: Array<{ readonly id: string; readonly baseCommit: string }> = []
  const cleanup: string[] = []
  const requests: CandidateComparisonRequest[] = []
  const trustedByHandle = new Map<string, string>()
  const lifecycle: CandidateLifecycle = {
    reserve: input => {
      created.push({ id: input.candidateId, baseCommit: input.baseCommit })
      return { path: `/candidate/${input.candidateId}`, baseCommit: input.baseCommit }
    },
    materialize: () => undefined,
    cancel: input => cleanup.push(`cancel:${input.candidateId}`),
    reap: input => cleanup.push(`reap:${input.candidateId}`),
    remove: input => cleanup.push(`remove:${input.candidateId}`),
  }
  return {
    created,
    cleanup,
    requests,
    input: {
      story: story(),
      baseCommit: 'base-123',
      maxCandidates: 2,
      coordinatorId: 'coordinator-1',
      ownerToken: id => `owner-${id}`,
      pathPlatform: 'posix',
      lifecycle,
      evidence: candidate => ({ digest: `digest-${candidate.candidateId}`, artifacts: [`artifact-${candidate.candidateId}`] }),
      stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) },
      judgeProvenance: { provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' },
      judge: request => {
        requests.push(request)
        return selectionVerdict(request, { winner: trustedByHandle.get(request.left.digest) === 'digest-one' ? 'left' : 'right' })
      },
      ...overrides,
    },
  }
}

describe('coordinateCandidates', () => {
  it('fans out only the configured maximum from one base into independent worktrees', async () => {
    const target = story()
    const seen: string[] = []
    const test = harness({ story: target })

    const result = await coordinateCandidates({
      ...test.input,
      candidates: ['one', 'two', 'three'].map(id => worker(id, () => ({ passed: false, summary: 'red' }), context => {
        seen.push(context.targetDir)
        context.story.passes = true
        return { success: true, summary: id }
      })),
    })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'zero-green' })
    expect(test.created).toEqual([{ id: 'one', baseCommit: 'base-123' }, { id: 'two', baseCommit: 'base-123' }])
    expect(seen).toEqual(['/candidate/one', '/candidate/two'])
    expect(new Set(seen).size).toBe(2)
    expect(target.passes).toBe(false)
  })

  it('blocks a worktree that is not owned from the common base before running candidates', async () => {
    let runs = 0
    const test = harness({
      lifecycle: {
        ...harness().input.lifecycle,
        reserve: input => ({ path: `/candidate/${input.candidateId}`, baseCommit: 'other-base' }),
      },
    })

    const result = await coordinateCandidates({
      ...test.input,
      candidates: [worker('one', undefined, () => { runs += 1; return { success: true, summary: 'unexpected' } })],
    })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'worktree-invariant' })
    expect(runs).toBe(0)
  })

  it('mechanically filters every red result and blocks when no green candidate remains', async () => {
    const test = harness()

    const result = await coordinateCandidates({
      ...test.input,
      candidates: [worker('one', () => ({ passed: false, summary: 'red' })), worker('two', () => ({ passed: false, summary: 'red' }))],
    })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'zero-green' })
    expect(test.requests).toHaveLength(0)
    expect(test.cleanup).toEqual(['cancel:one', 'reap:one', 'remove:one', 'cancel:two', 'reap:two', 'remove:two'])
  })

  it('returns the sole green candidate with integration provenance and cleans only losers', async () => {
    const test = harness()

    const result = await coordinateCandidates({
      ...test.input,
      candidates: [worker('winner'), worker('loser', () => ({ passed: false, summary: 'red' }))],
    })

    expect(result).toMatchObject({
      kind: 'winner',
      winner: { candidateId: 'winner', coordinatorId: 'coordinator-1', ownerToken: 'owner-winner', worktree: { path: '/candidate/winner', baseCommit: 'base-123' }, digest: 'digest-winner' },
    })
    expect(test.cleanup).toEqual(['cancel:loser', 'reap:loser', 'remove:loser'])
    expect(Object.hasOwn(result, 'candidates')).toBe(false)
  })

  it('selects between green candidates only through read-only swapped digest-bound judgments', async () => {
    const test = harness()

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'one' } })
    expect(test.requests).toHaveLength(2)
    expect(test.requests.map(request => request.permissions)).toEqual(['read-only', 'read-only'])
    expect(test.requests.map(request => [request.left.label, request.right.label])).toEqual([['A', 'B'], ['A', 'B']])
    const digestPairs = test.requests.map(request => [request.left.digest, request.right.digest])
    expect(digestPairs[1]).toEqual([digestPairs[0][1], digestPairs[0][0]])
    expect(digestPairs.flat().some(digest => digest.startsWith('digest-'))).toBe(false)
    expect(test.cleanup).toEqual(['cancel:two', 'reap:two', 'remove:two'])
  })

  it('blocks inconsistent swapped selection and cleans every candidate exactly once', async () => {
    const test = harness({ judge: request => selectionVerdict(request, { winner: 'left' }) })

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent' })
    expect(test.cleanup).toEqual(['cancel:one', 'reap:one', 'remove:one', 'cancel:two', 'reap:two', 'remove:two'])
  })

  it('blocks distinct replayed attempt ids that do not match the issued requests', async () => {
    let calls = 0
    const test = harness({ judge: request => selectionVerdict(request, { attemptId: `replayed-${calls++}` }) })

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent' })
  })

  it.each(['labels', 'digests'] as const)('blocks responses whose %s differ from the issued request', async mismatch => {
    const test = harness({ judge: request => selectionVerdict(request, mismatch === 'labels'
      ? { left: { label: request.right.label }, right: { label: request.left.label } }
      : { left: { digest: 'fabricated-left' }, right: { digest: 'fabricated-right' } }) })

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent' })
  })

  it('blocks a low-confidence pair even when both verdicts select the same candidate', async () => {
    const test = harness({ judge: request => selectionVerdict(request, { confidence: 'low' }) })

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'blocked', reason: 'selection-inconsistent' })
  })

  it('preserves the right-hand challenger when both bound comparisons select it', async () => {
    const trustedByHandle = new Map<string, string>()
    const test = harness({ judge: request => selectionVerdict(request, {
      winner: trustedByHandle.get(request.left.digest) === 'digest-two' ? 'left' : 'right',
    }), stageEvidence: stage => { trustedByHandle.set(stage.handle.digest, stage.trusted.digest) } })

    const result = await coordinateCandidates({ ...test.input, candidates: [worker('one'), worker('two')] })

    expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'two', digest: 'digest-two' } })
    expect(test.cleanup).toEqual(['cancel:one', 'reap:one', 'remove:one'])
  })

  it('cancels pending runners immediately but reaps and removes only after they settle', async () => {
    const controller = new AbortController()
    let resolveRunner: ((result: Awaited<ReturnType<CandidateWorkerDefinition['worker']['runner']>>) => void) | undefined
    let signalStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { signalStarted = resolve })
    const pending = new Promise<Awaited<ReturnType<CandidateWorkerDefinition['worker']['runner']>>>(resolve => { resolveRunner = resolve })
    const test = harness({ signal: controller.signal })
    const operation = coordinateCandidates({
      ...test.input,
      candidates: [worker('one', undefined, () => { signalStarted?.(); return pending }), worker('two')],
    })
    await started

    controller.abort('stop pending candidates')
    const beforeSettlement = [...test.cleanup]
    if (!resolveRunner) throw new Error('pending runner did not start')
    resolveRunner({ success: true, summary: 'settled after cancellation' })
    const result = await operation

    expect(beforeSettlement).toEqual(['cancel:one', 'cancel:two'])
    expect(test.cleanup).toEqual(['cancel:one', 'cancel:two', 'reap:one', 'remove:one', 'reap:two', 'remove:two'])
    expect(result).toMatchObject({ kind: 'cancelled', summary: 'stop pending candidates' })
  })

  it('returns failed cleanup ownership and retries stages that did not complete', async () => {
    const events: string[] = []
    const base = harness()
    const test = harness({ lifecycle: {
      ...base.input.lifecycle,
      cancel: input => { events.push(`cancel:${input.candidateId}`) },
      reap: input => { events.push(`reap:${input.candidateId}`) },
      remove: input => {
        events.push(`remove:${input.candidateId}`)
        if (input.candidateId === 'loser') throw new Error('remove failed')
      },
    } })

    const result = await coordinateCandidates({
      ...test.input,
      candidates: [worker('winner'), worker('loser', () => ({ passed: false, summary: 'red' }))],
    })

    expect(result).toMatchObject({
      kind: 'blocked',
      reason: 'cleanup-error',
      recovery: [{ ownership: { candidateId: 'loser' }, completedStages: ['cancel', 'reap'], failedStages: [{ stage: 'remove', summary: 'remove failed' }] }],
    })
    expect(events).toEqual(['cancel:loser', 'reap:loser', 'remove:loser', 'remove:loser', 'cancel:winner', 'reap:winner', 'remove:winner'])
  })

  it.each(['cancelled', 'paused', 'error'] as const)('cleans every owned worktree exactly once on the %s path', async path => {
    const controller = new AbortController()
    const test = harness({
      ...(path === 'cancelled' ? { signal: controller.signal } : {}),
      ...(path === 'paused' ? { pause: () => true } : {}),
      ...(path === 'error' ? { judge: () => { throw new Error('judge offline') } } : {}),
    })
    const candidates = [worker('one', undefined, () => {
      if (path === 'cancelled') controller.abort('stop')
      return { success: true, summary: 'one' }
    }), worker('two')]

    const result = await coordinateCandidates({ ...test.input, candidates })

    expect(result.kind).toBe(path === 'paused' ? 'paused' : path === 'cancelled' ? 'cancelled' : 'blocked')
    expect(test.cleanup).toEqual(path === 'cancelled'
      ? ['cancel:one', 'cancel:two', 'reap:one', 'remove:one', 'reap:two', 'remove:two']
      : ['cancel:one', 'reap:one', 'remove:one', 'cancel:two', 'reap:two', 'remove:two'])
  })
})
