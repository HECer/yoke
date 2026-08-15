import { candidateConfigProblem, canonicalWorktreePath } from './candidate-boundaries.js'
import { CandidateCleanup } from './candidate-cleanup.js'
import { selectCandidate } from './candidate-selection.js'
import type { CandidateComparisonRequest, CandidateCoordinatorInput, CandidateCoordinatorResult, CandidateEvidence, CandidateLifecycle, CandidateOwnership, CandidateProvenance, CandidateRecovery, CandidateWinner, CandidateWorkerDefinition, CandidateWorkerOutcome, CandidateWorktree, CandidateWorktreeRequest } from './candidate-contracts.js'
import { runStoryWorker, type StoryWorkerCandidate, type StoryWorkerResult } from './worker.js'

type GreenCandidate = OwnedCandidate & { readonly result: StoryWorkerCandidate }
type OwnedCandidate = CandidateOwnership & { readonly controller: AbortController; readonly definition: CandidateWorkerDefinition }
type CandidateRun = { readonly owned: OwnedCandidate; readonly result: StoryWorkerResult }

export type {
  CandidateComparisonRequest, CandidateCoordinatorInput, CandidateCoordinatorResult, CandidateEvidence,
  CandidateLifecycle, CandidateOwnership, CandidateProvenance, CandidateRecovery, CandidateWinner,
  CandidateWorkerDefinition, CandidateWorkerOutcome, CandidateWorktree, CandidateWorktreeRequest,
} from './candidate-contracts.js'

class CandidateCancellationError extends Error {
  readonly name = 'CandidateCancellationError'
}

export async function coordinateCandidates(input: CandidateCoordinatorInput): Promise<CandidateCoordinatorResult> {
  const configProblem = candidateConfigProblem(input)
  if (configProblem) return { kind: 'blocked', reason: 'invalid-config', summary: configProblem }
  if (input.signal?.aborted) return { kind: 'cancelled', summary: cancellationSummary(input.signal) }

  const definitions = input.candidates.slice(0, input.maxCandidates)
  const pathPlatform = input.pathPlatform ?? (process.platform === 'win32' ? 'win32' : 'posix')
  const owned: OwnedCandidate[] = []
  const outcomes = new Map<string, StoryWorkerResult>()
  const cleanup = new CandidateCleanup(input.lifecycle, input.onLifecycle)
  const terminalize = async (candidate: OwnedCandidate, reason: string): Promise<void> => {
    const result = outcomes.get(candidate.candidateId) ?? {
      kind: 'cancelled' as const, storyId: candidate.storyId, worktree: candidate.worktree.path,
      baseCommit: candidate.worktree.baseCommit, provider: candidate.provider, summary: reason,
      evidence: { criteria: [] },
    }
    await input.recordResult?.({ ...candidate, result })
    await input.recordElimination?.({ ...candidate, result })
  }
  const terminalizeAll = async (reason: string): Promise<void> => {
    for (const candidate of owned) await terminalize(candidate, reason)
  }
  const ensureActive = (): void => {
    if (input.signal?.aborted) throw new CandidateCancellationError(cancellationSummary(input.signal))
  }
  const cancelActive = (): void => cleanup.cancelNow(input.signal ? cancellationSummary(input.signal) : 'candidate coordinator cancelled')
  input.signal?.addEventListener('abort', cancelActive, { once: true })

  const finishPaused = async (): Promise<CandidateCoordinatorResult> => {
    await terminalizeAll('candidate coordination paused')
    await cleanup.cleanupAll('candidate coordination paused')
    ensureActive()
    return cleanup.hasFailures()
      ? blocked(cleanup, 'cleanup-error', 'candidate pause cleanup failed')
      : { kind: 'paused', summary: 'candidate coordination paused' }
  }

  try {
    const paths = new Set<string>()
    for (const definition of definitions) {
      const controller = new AbortController()
      const provenance = provenanceFor(input, definition)
      const worktree = input.lifecycle.reserve({ ...provenance, baseCommit: input.baseCommit })
      const candidate: OwnedCandidate = { ...provenance, worktree, signal: controller.signal, controller, definition }
      owned.push(candidate)
      cleanup.register(candidate)
      input.onLifecycle?.(candidate, 'reserved')
      const canonicalPath = canonicalWorktreePath(worktree.path, pathPlatform)
      if (worktree.baseCommit !== input.baseCommit || canonicalPath === null || paths.has(canonicalPath)) {
        await cleanup.cleanupAll('candidate worktree invariant failed')
        ensureActive()
        return blocked(cleanup, 'worktree-invariant', 'candidate worktrees must be unique absolute paths and share the configured base')
      }
      paths.add(canonicalPath)
    }

    for (const candidate of owned) {
      await input.lifecycle.materialize(candidate)
      cleanup.markMaterialized(candidate.candidateId)
      input.onLifecycle?.(candidate, 'materialized')
      ensureActive()
      if (input.pause?.()) return await finishPaused()
    }

    for (const candidate of owned) input.onLifecycle?.(candidate, 'running')
    const runs = await runCandidates(input, owned)
    for (const run of runs) outcomes.set(run.owned.candidateId, run.result)
    ensureActive()
    if (input.pause?.() || runs.some(run => run.result.kind === 'paused')) {
      return await finishPaused()
    }

    const green: GreenCandidate[] = []
    for (const run of runs) {
      await input.recordResult?.({ ...run.owned, result: run.result })
      switch (run.result.kind) {
        case 'candidate':
          green.push({ ...run.owned, result: run.result })
          break
        case 'cancelled':
        case 'mechanical-failure':
        case 'quality-failure':
        case 'review-failure':
          input.onLifecycle?.(run.owned, 'cleaning', run.result.summary)
          await input.recordElimination?.({ ...run.owned, result: run.result })
          await cleanup.cleanup(run.owned, run.result.summary)
          ensureActive()
          break
        case 'paused':
          throw new Error('paused candidates must be handled before mechanical filtering')
      }
    }
    ensureActive()
    if (input.pause?.()) return await finishPaused()
    if (green.length === 0) return blocked(cleanup, 'zero-green', 'no candidate passed every mechanical gate')

    for (const candidate of green) input.onLifecycle?.(candidate, 'selecting')
    input.onSelecting?.()
    const selection = await selectCandidate({
      candidates: green,
      evidence: input.evidence,
      stageEvidence: input.stageEvidence,
      judgeProvenance: input.judgeProvenance,
      judge: input.judge,
      ...(input.pause ? { pause: input.pause } : {}),
      ensureActive,
      discard: async candidate => {
        await input.recordElimination?.(candidate)
        await cleanup.cleanup(candidate, 'candidate was not selected')
      },
    })
    ensureActive()
    if (selection.kind === 'paused') return await finishPaused()
    if (selection.kind === 'inconsistent') {
      for (const candidate of green) await input.recordElimination?.({ ...candidate, result: candidate.result }, `selection-inconsistent: ${selection.reason}`)
      await cleanup.cleanupAll(`candidate selection was inconsistent: ${selection.reason}`)
      ensureActive()
      if (input.pause?.()) return await finishPaused()
      return blocked(cleanup, 'selection-inconsistent', selection.reason)
    }

    const { controller: _controller, definition: _definition, ...winner } = selection.candidate
    const selectedWinner: CandidateWinner = {
      ...winner,
      digest: selection.evidence.digest,
      artifacts: [...selection.evidence.artifacts],
      comparisons: [...selection.comparisons],
    }
    await input.recordSelection?.(selectedWinner)
    await cleanup.cleanupAll('candidate was not selected', selection.candidate.candidateId)
    ensureActive()
    if (input.pause?.()) return await finishPaused()
    if (cleanup.hasFailures()) {
      await cleanup.cleanup(selection.candidate, 'candidate cleanup failed')
      ensureActive()
      if (input.pause?.()) return await finishPaused()
      return blocked(cleanup, 'cleanup-error', 'candidate loser cleanup failed')
    }

    return {
      kind: 'winner',
      winner: selectedWinner,
    }
  } catch (error) {
    let proofFailure: string | undefined
    try {
      await terminalizeAll(`candidate coordinator failed: ${message(error)}`)
    } catch (proofError) {
      proofFailure = message(proofError)
    }
    await cleanup.cleanupAll('candidate coordinator failed')
    if (proofFailure) return blocked(cleanup, 'cleanup-error', `candidate terminal proof failed: ${proofFailure}`)
    if (input.signal?.aborted) {
      return cleanup.hasFailures()
        ? blocked(cleanup, 'cleanup-error', 'candidate cancellation cleanup failed')
        : { kind: 'cancelled', summary: cancellationSummary(input.signal) }
    }
    if (input.pause?.()) {
      try {
        return await finishPaused()
      } catch (pauseError) {
        if (input.signal?.aborted) {
          return cleanup.hasFailures()
            ? blocked(cleanup, 'cleanup-error', 'candidate cancellation cleanup failed')
            : { kind: 'cancelled', summary: cancellationSummary(input.signal) }
        }
        return blocked(cleanup, 'coordinator-error', message(pauseError))
      }
    }
    return blocked(cleanup, 'coordinator-error', message(error))
  } finally {
    input.signal?.removeEventListener('abort', cancelActive)
  }
}

async function runCandidates(input: CandidateCoordinatorInput, owned: readonly OwnedCandidate[]): Promise<readonly CandidateRun[]> {
  const settled = await Promise.allSettled(owned.map(async candidate => ({
    owned: candidate,
    result: await runStoryWorker({
      ...candidate.definition.worker,
      ...(candidate.definition.runnerFor ? { runner: candidate.definition.runnerFor({ signal: candidate.signal }) } : {}),
      ...(candidate.definition.reporterFor ? { reporter: candidate.definition.reporterFor(candidate) } : {}),
      story: structuredClone(input.story),
      worktree: candidate.worktree.path,
      baseCommit: candidate.worktree.baseCommit,
      cancellation: { signal: candidate.signal },
    }),
  } satisfies CandidateRun)))
  const runs: CandidateRun[] = []
  for (const outcome of settled) {
    if (outcome.status === 'rejected') throw new Error(`candidate worker failed: ${message(outcome.reason)}`)
    runs.push(outcome.value)
  }
  return runs
}

function provenanceFor(input: CandidateCoordinatorInput, definition: CandidateWorkerDefinition): CandidateProvenance {
  return { candidateId: definition.id, coordinatorId: input.coordinatorId, ownerToken: input.ownerToken(definition.id), storyId: input.story.id, provider: definition.worker.provider }
}

function cancellationSummary(signal: AbortSignal): string {
  return typeof signal.reason === 'string' && signal.reason.length > 0 ? signal.reason : 'candidate coordinator cancelled'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function blocked(
  cleanup: CandidateCleanup,
  reason: Extract<CandidateCoordinatorResult, { readonly kind: 'blocked' }>['reason'],
  summary: string,
): Extract<CandidateCoordinatorResult, { readonly kind: 'blocked' }> {
  const recovery = cleanup.recovery()
  return cleanup.hasFailures()
    ? { kind: 'blocked', reason: 'cleanup-error', summary: cleanup.failureSummary(), recovery }
    : { kind: 'blocked', reason, summary }
}
