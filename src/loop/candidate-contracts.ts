import type { CandidatePairVerdict, QualityLabel } from '../quality/verdict.js'
import type { Story } from './prd.js'
import type { StoryWorkerCandidate, StoryWorkerCancellation, StoryWorkerInput, StoryWorkerProvider, StoryWorkerResult } from './worker.js'
import type { LoopReporter } from './reporter.js'

type MaybePromise<T> = T | Promise<T>
export type WorktreePathPlatform = 'win32' | 'posix'

export type CandidateWorkerDefinition = {
  readonly id: string
  readonly worker: Omit<StoryWorkerInput, 'story' | 'worktree' | 'baseCommit' | 'cancellation'>
  readonly runnerFor?: (cancellation: StoryWorkerCancellation) => StoryWorkerInput['runner']
  readonly reporterFor?: (ownership: CandidateOwnership) => Pick<LoopReporter, 'phase' | 'quality' | 'addTokens'>
}

export type CandidateWorktree = { readonly path: string; readonly baseCommit: string }
export type CandidateProvenance = {
  readonly candidateId: string
  readonly coordinatorId: string
  readonly ownerToken: string
  readonly storyId: string
  readonly provider: StoryWorkerProvider
}
export type CandidateWorktreeRequest = CandidateProvenance & { readonly baseCommit: string }
export type CandidateOwnership = CandidateProvenance & { readonly worktree: CandidateWorktree; readonly signal: AbortSignal }
export type CandidateLifecycle = {
  readonly reserve: (input: CandidateWorktreeRequest) => CandidateWorktree
  readonly materialize: (input: CandidateOwnership) => MaybePromise<void>
  readonly cancel: (input: CandidateOwnership, reason: string) => MaybePromise<void>
  readonly reap: (input: CandidateOwnership) => MaybePromise<void>
  readonly remove: (input: CandidateOwnership) => MaybePromise<void>
}

export type CandidateEvidence = { readonly digest: string; readonly artifacts: readonly string[] }
export type CandidateEvidenceStage = { readonly handle: CandidateEvidence; readonly trusted: CandidateEvidence }
export type CandidateJudgeProvenance = { readonly provider: string; readonly model: string; readonly promptDigest: string; readonly rubricDigest: string }
export type CandidateComparisonRequest = {
  readonly permissions: 'read-only'
  readonly attemptId: string
  readonly left: CandidateEvidence & { readonly label: QualityLabel }
  readonly right: CandidateEvidence & { readonly label: QualityLabel }
}
export type CandidateEvidenceInput = CandidateOwnership & { readonly result: StoryWorkerCandidate }
export type CandidateWorkerOutcome = CandidateOwnership & { readonly result: StoryWorkerResult }
export type CandidateComparisonTrail = {
  readonly normal: { readonly request: CandidateComparisonRequest; readonly verdict: CandidatePairVerdict }
  readonly swapped: { readonly request: CandidateComparisonRequest; readonly verdict: CandidatePairVerdict }
  readonly selectedCandidateId: string
  readonly selectedDigest: string
}
export type CandidateWinner = CandidateEvidenceInput & CandidateEvidence & { readonly comparisons: readonly CandidateComparisonTrail[] }
export type CandidateCleanupStage = 'cancel' | 'reap' | 'remove'
export type CandidateLifecycleState = 'reserved' | 'materialized' | 'running' | 'selecting' | 'cleaning' | 'removed'
export type CandidateRecoveryOwnership = CandidateProvenance & { readonly worktree: CandidateWorktree }
export type CandidateRecovery = {
  readonly ownership: CandidateRecoveryOwnership
  readonly materialized: boolean
  readonly completedStages: readonly CandidateCleanupStage[]
  readonly failedStages: readonly { readonly stage: CandidateCleanupStage; readonly summary: string }[]
  readonly pendingStages: readonly CandidateCleanupStage[]
}
export type CandidateCoordinatorResult =
  | { readonly kind: 'winner'; readonly winner: CandidateWinner }
  | { readonly kind: 'blocked'; readonly reason: 'invalid-config' | 'worktree-invariant' | 'zero-green' | 'selection-inconsistent' | 'coordinator-error' | 'cleanup-error'; readonly summary: string; readonly recovery?: readonly CandidateRecovery[] }
  | { readonly kind: 'cancelled'; readonly summary: string }
  | { readonly kind: 'paused'; readonly summary: string }

export type CandidateCoordinatorInput = {
  readonly story: Story
  readonly baseCommit: string
  readonly maxCandidates: number
  readonly candidates: readonly CandidateWorkerDefinition[]
  readonly coordinatorId: string
  readonly ownerToken: (candidateId: string) => string
  readonly lifecycle: CandidateLifecycle
  readonly evidence: (candidate: CandidateEvidenceInput) => unknown
  readonly stageEvidence: (stage: CandidateEvidenceStage) => MaybePromise<void>
  readonly judgeProvenance: CandidateJudgeProvenance
  readonly judge: (request: CandidateComparisonRequest) => MaybePromise<unknown>
  readonly onSelecting?: () => void
  readonly onLifecycle?: (candidate: CandidateOwnership, state: CandidateLifecycleState, reason?: string) => void
  readonly recordResult?: (candidate: CandidateWorkerOutcome) => MaybePromise<void>
  readonly recordElimination?: (candidate: CandidateWorkerOutcome, reason?: string) => MaybePromise<void>
  readonly recordSelection?: (winner: CandidateWinner) => MaybePromise<void>
  readonly pathPlatform?: WorktreePathPlatform
  readonly signal?: AbortSignal
  readonly pause?: () => boolean
}
