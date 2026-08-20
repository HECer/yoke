import { isAcceptanceCriterion } from './prd.js'
import type { AgentContext, AgentResult } from './runner.js'
import type { Verifier, VerifyResult } from './verify.js'
import { runQualityRepairLoop, type QualityRepairLoopResult, type QualityStage, type RepairRequest } from '../quality/loop.js'
import type { ReviewOutcome } from '../quality/repair.js'
import type { StoryWorkerCancellation, StoryWorkerEvidence, StoryWorkerInput, StoryWorkerResult, WorkerCriterionEvidence, WorkerGateEvidence } from './worker-contracts.js'

export type {
  StoryWorkerCallbacks,
  StoryWorkerCandidate,
  StoryWorkerCancellation,
  StoryWorkerEvidence,
  StoryWorkerInput,
  StoryWorkerProvider,
  StoryWorkerResult,
  WorkerCriterionEvidence,
  WorkerGateEvidence,
  WorkerRouting,
} from './worker-contracts.js'

type WorkerBaseResult = Omit<Extract<StoryWorkerResult, { readonly kind: 'candidate' }>, 'kind' | 'routing' | 'tokens'>

type MechanicalGateResult =
  | { readonly kind: 'passed' }
  | { readonly kind: 'failed'; readonly stage: 'criterion' | 'verify' | 'design' | 'perf' | 'audit'; readonly summary: string }
  | { readonly kind: 'cancelled'; readonly summary: string }

type MutableWorkerEvidence = {
  criteria: WorkerCriterionEvidence[]
  verify?: WorkerGateEvidence
  design?: WorkerGateEvidence
  perf?: WorkerGateEvidence
  audit?: WorkerGateEvidence
  quality?: QualityRepairLoopResult
}

function emptyEvidence(): MutableWorkerEvidence { return { criteria: [] } }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertNever(value: never): never {
  throw new Error(`Unexpected worker result: ${String(value)}`)
}

function cancellationReason(cancellation: StoryWorkerCancellation | undefined): string | null {
  if (cancellation?.signal?.aborted) {
    return typeof cancellation.signal.reason === 'string' && cancellation.signal.reason.length > 0
      ? cancellation.signal.reason
      : 'worker cancellation requested'
  }
  return cancellation?.handle?.isCancelled() ? 'worker cancellation requested' : null
}

function runGate(gate: Verifier, worktree: string, storyId: string): VerifyResult {
  const previous = process.env.YOKE_STORY
  process.env.YOKE_STORY = storyId
  try {
    return gate(worktree)
  } finally {
    if (previous === undefined) delete process.env.YOKE_STORY
    else process.env.YOKE_STORY = previous
  }
}

function reviewOutcome(result: AgentResult): ReviewOutcome {
  if (result.reviewOutcome) return result.reviewOutcome
  if (result.success) return { kind: 'approved', verdict: { approved: true, summary: result.summary, findings: [] } }
  return { kind: 'malformed', summary: result.summary }
}

function runMechanicalGates(input: StoryWorkerInput, context: AgentContext, evidence: MutableWorkerEvidence): MechanicalGateResult {
  const criteria = context.story.acceptance.filter(isAcceptanceCriterion)
  if (criteria.length === 0) {
    if (input.requireCriterionEvidence) return { kind: 'failed', stage: 'criterion', summary: `story ${context.story.id} lacks executable criterion evidence` }
  } else {
    if (!input.verifyCriterion) return { kind: 'failed', stage: 'criterion', summary: `story ${context.story.id} has criteria but no criterion verifier` }
    for (const criterion of criteria) {
      const cancelled = cancellationReason(input.cancellation)
      if (cancelled) return { kind: 'cancelled', summary: cancelled }
      const result = input.verifyCriterion(context.targetDir, context.story, criterion)
      const criteriaEvidence = [...evidence.criteria, { id: criterion.id, passed: result.passed, summary: result.summary }]
      evidence.criteria = criteriaEvidence
      input.callbacks?.onGate?.('criterion', result)
      if (!result.passed) return { kind: 'failed', stage: 'criterion', summary: result.summary }
    }
  }

  const cancelled = cancellationReason(input.cancellation)
  if (cancelled) return { kind: 'cancelled', summary: cancelled }
  input.reporter?.phase('verifying')
  const verify = runGate(input.verify, context.targetDir, context.story.id)
  evidence.verify = verify
  input.callbacks?.onGate?.('verify', verify)
  if (!verify.passed) return { kind: 'failed', stage: 'verify', summary: verify.summary }
  const afterVerifyCancellation = cancellationReason(input.cancellation)
  if (afterVerifyCancellation) return { kind: 'cancelled', summary: afterVerifyCancellation }

  if (input.design) {
    input.reporter?.phase('design')
    const design = runGate(input.design, context.targetDir, context.story.id)
    evidence.design = design
    input.callbacks?.onGate?.('design', design)
    if (!design.passed) return { kind: 'failed', stage: 'design', summary: design.summary }
    const afterDesignCancellation = cancellationReason(input.cancellation)
    if (afterDesignCancellation) return { kind: 'cancelled', summary: afterDesignCancellation }
  }

  if (input.perf) {
    input.reporter?.phase('perf')
    const perf = runGate(input.perf, context.targetDir, context.story.id)
    evidence.perf = perf
    input.callbacks?.onGate?.('perf', perf)
    if (!perf.passed) return { kind: 'failed', stage: 'perf', summary: perf.summary }
    const afterPerfCancellation = cancellationReason(input.cancellation)
    if (afterPerfCancellation) return { kind: 'cancelled', summary: afterPerfCancellation }
  }

  if (input.audit) {
    input.reporter?.phase('audit')
    const audit = runGate(input.audit, context.targetDir, context.story.id)
    evidence.audit = audit
    input.callbacks?.onGate?.('audit', audit)
    if (!audit.passed) return { kind: 'failed', stage: 'audit', summary: audit.summary }
    const afterAuditCancellation = cancellationReason(input.cancellation)
    if (afterAuditCancellation) return { kind: 'cancelled', summary: afterAuditCancellation }
  }

  return { kind: 'passed' }
}

function finalResult(input: StoryWorkerInput, result: StoryWorkerResult): StoryWorkerResult {
  input.callbacks?.onResult?.(result)
  return result
}

function baseResult(input: StoryWorkerInput, evidence: StoryWorkerEvidence, summary: string): WorkerBaseResult {
  return {
    storyId: input.story.id,
    worktree: input.worktree,
    baseCommit: input.baseCommit,
    provider: input.provider,
    summary,
    evidence,
  }
}

function resultFromQuality(input: StoryWorkerInput, evidence: StoryWorkerEvidence, summary: string, outcome: QualityRepairLoopResult): StoryWorkerResult {
  switch (outcome.kind) {
    case 'approved':
      return {
        ...baseResult(input, evidence, summary),
        kind: 'candidate',
        routing: { outcome: 'pending-integration' },
      }
    case 'paused':
      return { ...baseResult(input, evidence, summary), kind: 'paused' }
    case 'cancelled':
      return { ...baseResult(input, evidence, outcome.summary), kind: 'cancelled' }
    case 'blocked':
      switch (outcome.reason) {
        case 'quality-inconsistent':
          return { ...baseResult(input, evidence, outcome.summary ?? outcome.reason), kind: 'quality-failure', reason: 'inconsistent' }
        case 'quality-infrastructure':
          return { ...baseResult(input, evidence, outcome.summary ?? outcome.reason), kind: 'quality-failure', reason: 'infrastructure' }
        case 'review-malformed':
          return { ...baseResult(input, evidence, outcome.summary ?? outcome.reason), kind: 'review-failure', reason: 'malformed' }
        case 'review-infrastructure':
          return { ...baseResult(input, evidence, outcome.summary ?? outcome.reason), kind: 'review-failure', reason: 'infrastructure' }
        case 'gate-failed':
          return { ...baseResult(input, evidence, outcome.summary), kind: 'mechanical-failure', stage: outcome.stage }
        case 'no-actionable-finding':
        case 'round-budget-exhausted':
        case 'time-budget-exhausted':
        case 'repair-failed':
          return { ...baseResult(input, evidence, outcome.summary ?? outcome.reason), kind: 'mechanical-failure', stage: 'quality' }
        default:
          return assertNever(outcome)
      }
    default:
      return assertNever(outcome)
  }
}

export async function runStoryWorker(input: StoryWorkerInput): Promise<StoryWorkerResult> {
  const evidence = emptyEvidence()
  const cancelled = cancellationReason(input.cancellation)
  if (cancelled) return finalResult(input, { ...baseResult(input, evidence, cancelled), kind: 'cancelled' })

  const workerStory = structuredClone(input.story)
  const context: AgentContext = { targetDir: input.worktree, story: workerStory }
  const qualityEnabled = input.qualityEnabled?.(workerStory) ?? input.qualityStage !== undefined
  const preflight = qualityEnabled ? input.qualityPreflight?.(context) : undefined
  if (preflight?.kind === 'blocked') {
    return finalResult(input, { ...baseResult(input, evidence, preflight.summary), kind: 'mechanical-failure', stage: 'quality' })
  }
  let implementation: AgentResult
  try {
    implementation = await input.runner(context)
  } catch (error) {
    return finalResult(input, {
      ...baseResult(input, evidence, `worker implementation failed: ${errorMessage(error)}`),
      kind: 'mechanical-failure',
      stage: 'implementation',
    })
  }
  if (implementation.tokens) input.reporter?.addTokens(implementation.tokens)

  const afterImplementationCancellation = cancellationReason(input.cancellation)
  if (afterImplementationCancellation) {
    return finalResult(input, { ...baseResult(input, evidence, afterImplementationCancellation), kind: 'cancelled' })
  }
  const decision = input.beforeGates?.(context)
  if (decision) {
    return finalResult(input, { ...baseResult(input, evidence, decision), kind: 'paused', reason: 'decision' })
  }

  const gates = runMechanicalGates(input, context, evidence)
  if (gates.kind === 'cancelled') {
    return finalResult(input, { ...baseResult(input, evidence, gates.summary), kind: 'cancelled' })
  }
  if (gates.kind === 'failed') {
    implementation.routing?.recordOutcome(false)
    return finalResult(input, { ...baseResult(input, evidence, gates.summary), kind: 'mechanical-failure', stage: gates.stage })
  }

  const summary = implementation.success
    ? implementation.summary
    : `${implementation.summary} (runner exited non-zero but verify is green)`
  if (!qualityEnabled && !input.review) {
    return finalResult(input, {
      ...baseResult(input, evidence, summary),
      kind: 'candidate',
      routing: { outcome: 'pending-integration', ...(implementation.routing ? { recordOutcome: implementation.routing.recordOutcome } : {}) },
      ...(implementation.tokens ? { tokens: implementation.tokens } : {}),
    })
  }

  const beforeQualityCancellation = cancellationReason(input.cancellation)
  if (beforeQualityCancellation) {
    return finalResult(input, { ...baseResult(input, evidence, beforeQualityCancellation), kind: 'cancelled' })
  }

  const qualityStage = qualityEnabled ? input.qualityStage : undefined
  const review = input.review
  const quality = runQualityRepairLoop({
    ...(qualityStage
      ? { quality: (round: number) => {
        input.reporter?.phase('comparing')
        return qualityStage(context, round)
      } }
      : {}),
    ...(review
      ? { review: () => {
        input.reporter?.phase('reviewing')
        return reviewOutcome(review(context))
      } }
      : {}),
    repair: request => {
      if (!input.repair) return { kind: 'blocked', summary: 'repair callback is not configured' }
      input.reporter?.phase('repairing')
      const repair = input.repair(context, request)
      return repair.success ? { kind: 'repaired' } : { kind: 'blocked', summary: repair.summary }
    },
    rerunGates: () => {
      const rerun = runMechanicalGates(input, context, evidence)
      if (rerun.kind === 'passed') return { kind: 'passed' }
      if (rerun.kind === 'cancelled') return rerun
      return { kind: 'failed', stage: rerun.stage, summary: rerun.summary }
    },
    ...(input.repairLimits ? { limits: input.repairLimits } : {}),
    pause: input.pause,
    onStatus: status => {
      const metadata = input.qualityMetadata?.(context)
      input.reporter?.quality({ ...status, ...(metadata ?? { policy: 'blocking' }) })
    },
  })
  evidence.quality = quality
  const afterQualityCancellation = cancellationReason(input.cancellation)
  if (afterQualityCancellation) {
    return finalResult(input, { ...baseResult(input, evidence, afterQualityCancellation), kind: 'cancelled' })
  }
  const result = resultFromQuality(input, evidence, summary, quality)
  if (result.kind !== 'candidate' && result.kind !== 'paused') implementation.routing?.recordOutcome(false)
  if (result.kind === 'candidate') {
    return finalResult(input, {
      ...result,
      routing: { outcome: 'pending-integration', ...(implementation.routing ? { recordOutcome: implementation.routing.recordOutcome } : {}) },
      ...(implementation.tokens ? { tokens: implementation.tokens } : {}),
    })
  }
  return finalResult(input, result)
}
