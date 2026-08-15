import { describe, expect, it } from 'vitest'
import { coordinateCandidates, type CandidateCoordinatorInput, type CandidateLifecycle, type CandidateWorkerDefinition } from '../../src/loop/candidates.js'
import { canonicalWorktreePath } from '../../src/loop/candidate-boundaries.js'

function worker(id: string, passed = false): CandidateWorkerDefinition {
  return { id, worker: { provider: { provider: 'codex', role: 'implementation' }, runner: () => ({ success: true, summary: id }), verify: () => ({ passed, summary: passed ? 'green' : 'red' }) } }
}

function input(lifecycle: CandidateLifecycle, overrides: Partial<CandidateCoordinatorInput> = {}): CandidateCoordinatorInput {
  return {
    story: { id: 'S1', title: 'Lifecycle recovery', priority: 1, acceptance: ['safe'], passes: false },
    baseCommit: 'base', maxCandidates: 2, candidates: [worker('one')], coordinatorId: 'coordinator', ownerToken: id => `owner-${id}`,
    pathPlatform: 'win32',
    lifecycle, evidence: candidate => ({ digest: `digest-${candidate.candidateId}`, artifacts: [] }), stageEvidence: () => undefined,
    judgeProvenance: { provider: 'codex', model: 'judge-model', promptDigest: 'judge-prompt', rubricDigest: 'judge-rubric' }, judge: () => null, ...overrides,
  }
}

describe('candidate lifecycle recovery', () => {
  it('keeps abort handling active while paused cleanup awaits cancellation', async () => {
    const events: string[] = []
    const controller = new AbortController()
    let releaseCancel: (() => void) | undefined
    let signalCancelStarted: (() => void) | undefined
    const cancelStarted = new Promise<void>(resolve => { signalCancelStarted = resolve })
    const blockedCancel = new Promise<void>(resolve => { releaseCancel = resolve })
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: `C:\\work\\${request.candidateId}`, baseCommit: request.baseCommit }),
      materialize: () => undefined,
      cancel: ownership => {
        events.push(`cancel:${ownership.candidateId}`)
        if (ownership.candidateId === 'one') {
          signalCancelStarted?.()
          return blockedCancel
        }
      },
      reap: ownership => { events.push(`reap:${ownership.candidateId}`) },
      remove: ownership => { events.push(`remove:${ownership.candidateId}`) },
    }
    const operation = coordinateCandidates(input(lifecycle, {
      candidates: [worker('one'), worker('two')],
      signal: controller.signal,
      pause: () => true,
    }))
    await cancelStarted

    controller.abort('abort during paused cleanup')
    const beforeRelease = [...events]
    if (!releaseCancel) throw new Error('pause cleanup did not start')
    releaseCancel()
    const outcome = await operation.then(
      result => ({ kind: 'resolved' as const, result }),
      error => ({ kind: 'rejected' as const, error }),
    )

    expect(beforeRelease).toEqual(['cancel:one', 'cancel:two'])
    expect(outcome).toMatchObject({ kind: 'resolved', result: { kind: 'cancelled', summary: 'abort during paused cleanup' } })
    expect(events).toEqual(['cancel:one', 'cancel:two', 'reap:one', 'remove:one', 'reap:two', 'remove:two'])
  })

  it('registers reserved ownership before materialization can partially fail', async () => {
    const events: string[] = []
    const lifecycle: CandidateLifecycle = {
      reserve: request => { events.push(`reserve:${request.candidateId}`); return { path: 'C:\\work\\one', baseCommit: request.baseCommit } },
      materialize: ownership => { events.push(`materialize:${ownership.candidateId}`); throw new Error('partial add failed') },
      cancel: ownership => { events.push(`cancel:${ownership.candidateId}`) },
      reap: ownership => { events.push(`reap:${ownership.candidateId}`) },
      remove: ownership => { events.push(`remove:${ownership.candidateId}`) },
    }

    const result = await coordinateCandidates(input(lifecycle))

    expect(result).toMatchObject({ kind: 'blocked', reason: 'coordinator-error', summary: 'partial add failed' })
    expect(events).toEqual(['reserve:one', 'materialize:one', 'cancel:one', 'reap:one', 'remove:one'])
  })

  it('retains ownership and failed stage metadata when cleanup cannot finish', async () => {
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: 'C:\\work\\one', baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: () => undefined, reap: () => undefined, remove: () => { throw new Error('worktree busy') },
    }

    const result = await coordinateCandidates(input(lifecycle))

    expect(result).toMatchObject({
      kind: 'blocked', reason: 'cleanup-error',
      recovery: [{ ownership: { candidateId: 'one', worktree: { path: 'C:\\work\\one' } }, materialized: true, completedStages: ['cancel', 'reap'], failedStages: [{ stage: 'remove', summary: 'worktree busy' }], pendingStages: [] }],
    })
  })

  it('still reaps and removes every reserved candidate when terminal proof persistence throws', async () => {
    const events: string[] = []
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: `C:\\work\\${request.candidateId}`, baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: ownership => { events.push(`cancel:${ownership.candidateId}`) },
      reap: ownership => { events.push(`reap:${ownership.candidateId}`) },
      remove: ownership => { events.push(`remove:${ownership.candidateId}`) },
    }
    const result = await coordinateCandidates(input(lifecycle, {
      candidates: [worker('one'), worker('two')],
      judge: () => { throw new Error('judge transport failed') },
      recordResult: () => { throw new Error('proof disk full') },
    }))

    expect(result).toMatchObject({ kind: 'blocked', reason: 'cleanup-error', summary: 'candidate terminal proof failed: proof disk full' })
    expect(events).toEqual(['cancel:one', 'reap:one', 'remove:one', 'cancel:two', 'reap:two', 'remove:two'])
  })

  it('does not remove after failed reap and reports the blocked remove stage as pending', async () => {
    const events: string[] = []
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: 'C:\\work\\one', baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: () => { events.push('cancel') },
      reap: () => { events.push('reap'); throw new Error('runner busy') },
      remove: () => { events.push('remove') },
    }

    const result = await coordinateCandidates(input(lifecycle))

    expect(events).toEqual(['cancel', 'reap'])
    expect(result).toMatchObject({
      kind: 'blocked', reason: 'cleanup-error',
      recovery: [{ completedStages: ['cancel'], failedStages: [{ stage: 'reap', summary: 'runner busy' }], pendingStages: ['remove'] }],
    })
  })

  it('resumes at a failed reap stage and removes only after the retry succeeds', async () => {
    const events: string[] = []
    let reapAttempts = 0
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: `C:\\work\\${request.candidateId}`, baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: ownership => { events.push(`cancel:${ownership.candidateId}`) },
      reap: ownership => {
        events.push(`reap:${ownership.candidateId}`)
        if (ownership.candidateId === 'loser' && ++reapAttempts === 1) throw new Error('runner busy')
      },
      remove: ownership => { events.push(`remove:${ownership.candidateId}`) },
    }

    const result = await coordinateCandidates(input(lifecycle, { candidates: [worker('winner', true), worker('loser')] }))

    expect(result).toMatchObject({ kind: 'winner', winner: { candidateId: 'winner' } })
    expect(events).toEqual(['cancel:loser', 'reap:loser', 'reap:loser', 'remove:loser'])
  })

  it('returns a deep-cloned serializable recovery DTO without live coordinator internals', async () => {
    const worktree = { path: 'C:\\work\\one', baseCommit: 'base' }
    const lifecycle: CandidateLifecycle = {
      reserve: () => worktree, materialize: () => undefined, cancel: () => undefined, reap: () => undefined,
      remove: () => { throw new Error('worktree busy') },
    }

    const result = await coordinateCandidates(input(lifecycle))
    const beforeMutation = JSON.stringify(result)
    worktree.path = 'C:\\mutated'

    expect(JSON.stringify(result)).toBe(beforeMutation)
    for (const field of ['controller', 'definition', 'signal', 'runner', 'verify']) expect(beforeMutation).not.toContain(`"${field}"`)
  })

  it('rejects relative paths and Windows aliases before any worker runs', async () => {
    let runs = 0
    const paths = ['C:\\work\\branch\\..\\ONE', 'c:/work/one']
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: paths.shift() ?? 'relative', baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: () => undefined, reap: () => undefined, remove: () => undefined,
    }
    const candidates = ['one', 'two'].map(id => worker(id, false)).map(definition => ({ ...definition, worker: { ...definition.worker, runner: () => { runs += 1; return { success: true, summary: definition.id } } } }))

    const aliased = await coordinateCandidates(input(lifecycle, { candidates }))
    const relative = await coordinateCandidates(input({ ...lifecycle, reserve: request => ({ path: 'relative/path', baseCommit: request.baseCommit }) }))

    expect(aliased).toMatchObject({ kind: 'blocked', reason: 'worktree-invariant' })
    expect(relative).toMatchObject({ kind: 'blocked', reason: 'worktree-invariant' })
    expect(runs).toBe(0)
  })

  it.each([
    ['Windows', ['C:\\work\\one\\', 'c:/work/one']],
    ['POSIX', ['/work/one/', '/work/one']],
  ] as const)('rejects %s trailing-separator aliases', async (_platform, aliases) => {
    const paths = [...aliases]
    const lifecycle: CandidateLifecycle = {
      reserve: request => ({ path: paths.shift() ?? 'relative', baseCommit: request.baseCommit }), materialize: () => undefined,
      cancel: () => undefined, reap: () => undefined, remove: () => undefined,
    }

    const result = await coordinateCandidates(input(lifecycle, { candidates: [worker('one'), worker('two')], pathPlatform: _platform === 'POSIX' ? 'posix' : 'win32' }))

    expect(result).toMatchObject({ kind: 'blocked', reason: 'worktree-invariant' })
  })

  it('preserves Windows and POSIX filesystem roots while canonicalizing separators', () => {
    expect(canonicalWorktreePath('C:\\', 'win32')).toBe('c:\\')
    expect(canonicalWorktreePath('/', 'posix')).toBe('/')
  })

  it('rejects Windows root-relative forms while preserving explicit POSIX absolute semantics', () => {
    expect(canonicalWorktreePath('/candidate/One', 'win32')).toBeNull()
    expect(canonicalWorktreePath('/candidate/one', 'win32')).toBeNull()
    expect(canonicalWorktreePath('\\candidate\\one', 'win32')).toBeNull()
    expect(canonicalWorktreePath('/candidate/One', 'posix')).toBe('/candidate/One')
    expect(canonicalWorktreePath('/candidate/one', 'posix')).toBe('/candidate/one')
  })
})
