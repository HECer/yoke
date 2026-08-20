import type { Agent } from '../retrofit/config.js'
import type { AgentContext, AgentResult } from './runner.js'
import type { LoopReporter, TokenUsage } from './reporter.js'
import type { AcceptanceCriterion, Story } from './prd.js'
import type { Verifier, VerifyResult } from './verify.js'
import type { QualityRepairLoopResult, QualityStage, RepairRequest } from '../quality/loop.js'
import type { RepairLimits } from '../quality/repair.js'
import type { QualityStatusMetadata } from '../quality/types.js'

type MaybePromise<T> = T | Promise<T>

export type StoryWorkerProvider = {
  readonly provider: Agent
  readonly model?: string
  readonly reasoningEffort?: string
  readonly role: 'implementation'
}

export type StoryWorkerCancellation = {
  readonly signal?: AbortSignal
  readonly handle?: {
    readonly isCancelled: () => boolean
  }
}

export type WorkerCriterionEvidence = {
  readonly id: string
  readonly passed: boolean
  readonly summary: string
}

export type WorkerGateEvidence = {
  readonly passed: boolean
  readonly summary: string
}

export type StoryWorkerEvidence = {
  readonly criteria: readonly WorkerCriterionEvidence[]
  readonly verify?: WorkerGateEvidence
  readonly design?: WorkerGateEvidence
  readonly perf?: WorkerGateEvidence
  readonly audit?: WorkerGateEvidence
  readonly quality?: QualityRepairLoopResult
}

export type WorkerRouting = {
  readonly outcome: 'pending-integration'
  readonly recordOutcome?: (verified: boolean) => void
}

type WorkerBaseResult = {
  readonly storyId: string
  readonly worktree: string
  readonly baseCommit: string
  readonly provider: StoryWorkerProvider
  readonly summary: string
  readonly evidence: StoryWorkerEvidence
}

export type StoryWorkerCandidate = WorkerBaseResult & {
  readonly kind: 'candidate'
  readonly routing: WorkerRouting
  readonly tokens?: TokenUsage
}

export type StoryWorkerResult =
  | StoryWorkerCandidate
  | (WorkerBaseResult & { readonly kind: 'mechanical-failure'; readonly stage: 'implementation' | 'criterion' | 'verify' | 'design' | 'perf' | 'audit' | 'quality' })
  | (WorkerBaseResult & { readonly kind: 'quality-failure'; readonly reason: 'inconsistent' | 'infrastructure' })
  | (WorkerBaseResult & { readonly kind: 'review-failure'; readonly reason: 'malformed' | 'infrastructure' })
  | (WorkerBaseResult & { readonly kind: 'cancelled' })
  | (WorkerBaseResult & { readonly kind: 'paused'; readonly reason?: 'decision' })

export type StoryWorkerCallbacks = {
  readonly onGate?: (stage: 'criterion' | 'verify' | 'design' | 'perf' | 'audit', result: VerifyResult) => void
  readonly onResult?: (result: StoryWorkerResult) => void
}

export type StoryWorkerInput = {
  readonly story: Story
  readonly worktree: string
  readonly baseCommit: string
  readonly provider: StoryWorkerProvider
  readonly runner: (context: AgentContext) => MaybePromise<AgentResult>
  readonly verifyCriterion?: (targetDir: string, story: Story, criterion: AcceptanceCriterion) => VerifyResult
  readonly requireCriterionEvidence?: boolean
  readonly verify: Verifier
  readonly design?: Verifier
  readonly perf?: Verifier
  readonly audit?: Verifier
  readonly qualityStage?: (context: AgentContext, round: number, attempt?: 'worker' | 'integration') => QualityStage
  readonly qualityPreflight?: (context: AgentContext) => { readonly kind: 'ready' } | { readonly kind: 'blocked'; readonly summary: string } | { readonly kind: 'skipped'; readonly summary: string }
  readonly qualityEnabled?: (story: Story) => boolean
  readonly review?: (context: AgentContext) => AgentResult
  readonly repair?: (context: AgentContext, request: RepairRequest) => AgentResult
  readonly repairLimits?: RepairLimits
  readonly qualityMetadata?: (context: AgentContext) => QualityStatusMetadata | undefined
  readonly cancellation?: StoryWorkerCancellation
  readonly beforeGates?: (context: AgentContext) => string | null
  readonly pause?: () => boolean
  readonly reporter?: Pick<LoopReporter, 'phase' | 'addTokens' | 'quality'>
  readonly callbacks?: StoryWorkerCallbacks
}
