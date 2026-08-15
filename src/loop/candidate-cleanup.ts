import type { CandidateCleanupStage, CandidateLifecycle, CandidateOwnership, CandidateRecovery } from './candidate-contracts.js'

type ManagedCandidate = CandidateOwnership & { readonly controller: AbortController }
type CleanupState = {
  readonly ownership: ManagedCandidate
  materialized: boolean
  readonly completed: Set<CandidateCleanupStage>
  readonly failed: Map<CandidateCleanupStage, string>
  readonly pending: Map<CandidateCleanupStage, Promise<void>>
}

const stageOrder = ['cancel', 'reap', 'remove'] as const

export class CandidateCleanup {
  readonly #states = new Map<string, CleanupState>()

  constructor(readonly lifecycle: CandidateLifecycle, readonly onLifecycle?: (candidate: CandidateOwnership, state: 'cleaning' | 'removed', reason?: string) => void) {}

  register(ownership: ManagedCandidate): void {
    this.#states.set(ownership.candidateId, { ownership, materialized: false, completed: new Set(), failed: new Map(), pending: new Map() })
  }

  markMaterialized(candidateId: string): void {
    const state = this.#states.get(candidateId)
    if (state) state.materialized = true
  }

  cancelNow(reason: string): void {
    for (const state of this.#states.values()) {
      state.ownership.controller.abort(reason)
      this.onLifecycle?.(state.ownership, 'cleaning', reason)
      void this.#runStage(state, 'cancel', () => this.lifecycle.cancel(state.ownership, reason))
    }
  }

  async cleanup(ownership: ManagedCandidate, reason: string): Promise<void> {
    const state = this.#states.get(ownership.candidateId)
    if (!state) return
    ownership.controller.abort(reason)
    this.onLifecycle?.(ownership, 'cleaning', reason)
    if (!await this.#runStage(state, 'cancel', () => this.lifecycle.cancel(ownership, reason))) return
    if (!await this.#runStage(state, 'reap', () => this.lifecycle.reap(ownership))) return
    if (await this.#runStage(state, 'remove', () => this.lifecycle.remove(ownership))) this.onLifecycle?.(ownership, 'removed', reason)
  }

  async cleanupAll(reason: string, keepCandidateId?: string): Promise<void> {
    for (const state of this.#states.values()) {
      if (state.ownership.candidateId !== keepCandidateId) await this.cleanup(state.ownership, reason)
    }
  }

  hasFailures(): boolean {
    return [...this.#states.values()].some(state => state.failed.size > 0)
  }

  failureSummary(): string {
    return this.recovery().flatMap(item => item.failedStages.map(failure => `${item.ownership.candidateId}:${failure.stage}: ${failure.summary}`)).join('; ')
  }

  recovery(): readonly CandidateRecovery[] {
    return [...this.#states.values()].filter(state => state.failed.size > 0).map(state => ({
      ownership: {
        candidateId: state.ownership.candidateId,
        coordinatorId: state.ownership.coordinatorId,
        ownerToken: state.ownership.ownerToken,
        storyId: state.ownership.storyId,
        provider: { ...state.ownership.provider },
        worktree: { ...state.ownership.worktree },
      },
      materialized: state.materialized,
      completedStages: stageOrder.filter(stage => state.completed.has(stage)),
      failedStages: stageOrder.flatMap(stage => {
        const summary = state.failed.get(stage)
        return summary ? [{ stage, summary }] : []
      }),
      pendingStages: stageOrder.filter(stage => !state.completed.has(stage) && !state.failed.has(stage)),
    }))
  }

  #runStage(state: CleanupState, stage: CandidateCleanupStage, operation: () => void | Promise<void>): Promise<boolean> {
    if (state.completed.has(stage)) return Promise.resolve(true)
    const pending = state.pending.get(stage)
    if (pending) return pending.then(() => state.completed.has(stage))
    try {
      const result = operation()
      if (!(result instanceof Promise)) {
        state.completed.add(stage)
        state.failed.delete(stage)
        return Promise.resolve(true)
      }
      const task = result.then(() => {
        state.completed.add(stage)
        state.failed.delete(stage)
      }).catch(error => {
        state.failed.set(stage, error instanceof Error ? error.message : String(error))
      }).finally(() => {
        state.pending.delete(stage)
      })
      state.pending.set(stage, task)
      return task.then(() => state.completed.has(stage))
    } catch (error) {
      state.failed.set(stage, error instanceof Error ? error.message : String(error))
      return Promise.resolve(false)
    }
  }
}
