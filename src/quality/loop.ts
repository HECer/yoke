import { selectRepairFinding, type ReviewVerdict } from '../review/verdict.js'
import { authorizeRepair, type RepairLimits, type ReviewOutcome } from './repair.js'

export type RepairRequest = {
  readonly round: number
  readonly source: 'quality' | 'review'
  readonly finding: ReviewVerdict['findings'][number]
}

export type QualityStage =
  | { readonly kind: 'pass' }
  | { readonly kind: 'lose'; readonly biggestGap: string; readonly evidence: readonly string[]; readonly summary: string }
  | { readonly kind: 'inconsistent'; readonly summary: string }
  | { readonly kind: 'infrastructure'; readonly summary: string }
  | { readonly kind: 'skipped'; readonly summary: string }

export type RepairResult =
  | { readonly kind: 'repaired' }
  | { readonly kind: 'blocked'; readonly summary: string }

export type GateRerunResult =
  | { readonly kind: 'passed' }
  | { readonly kind: 'cancelled'; readonly summary: string }
  | { readonly kind: 'failed'; readonly stage: 'criterion' | 'verify' | 'perf' | 'audit'; readonly summary: string }

type FailedGateRerun = Extract<GateRerunResult, { kind: 'failed' }>

export type QualityRepairLoopResult =
  | { readonly kind: 'approved'; readonly repairs: number }
  | { readonly kind: 'paused'; readonly repairs: number }
  | { readonly kind: 'cancelled'; readonly summary: string; readonly repairs: number }
  | { readonly kind: 'blocked'; readonly reason: 'quality-inconsistent' | 'quality-infrastructure' | 'review-malformed' | 'review-infrastructure' | 'no-actionable-finding' | 'round-budget-exhausted' | 'time-budget-exhausted' | 'repair-failed'; readonly summary?: string; readonly repairs: number }
  | { readonly kind: 'blocked'; readonly reason: 'gate-failed'; readonly stage: FailedGateRerun['stage']; readonly summary: string; readonly repairs: number }

export function runQualityRepairLoop(input: {
  readonly quality?: (round: number) => QualityStage
  readonly review?: () => ReviewOutcome
  readonly repair: (request: RepairRequest) => RepairResult
  readonly rerunGates: () => GateRerunResult
  readonly limits?: RepairLimits
  readonly now?: () => number
  readonly pause?: () => boolean
  readonly onStatus?: (status: { readonly currentRound: number; readonly usedRepairs: number; readonly maxRepairs?: number; readonly unbounded?: true; readonly elapsedMs: number }) => void
}): QualityRepairLoopResult {
  const now = input.now ?? Date.now
  const startedAt = now()
  let usedRepairRounds = 0
  let qualityAssessmentRound = 1
  const emitStatus = (currentRound: number) => {
    const unbounded = input.limits?.unbounded === true
    input.onStatus?.({
      currentRound,
      usedRepairs: usedRepairRounds,
      ...(unbounded ? { unbounded: true } : { maxRepairs: input.limits?.maxRounds ?? 3 }),
      elapsedMs: now() - startedAt,
    })
  }
  for (;;) {
    emitStatus(input.quality ? qualityAssessmentRound : usedRepairRounds + 1)
    if (input.quality) {
      const quality = input.quality(qualityAssessmentRound)
      qualityAssessmentRound += 1
      switch (quality.kind) {
        case 'pass':
        case 'skipped':
          break
        case 'inconsistent':
          return { kind: 'blocked', reason: 'quality-inconsistent', summary: quality.summary, repairs: usedRepairRounds }
        case 'infrastructure':
          return { kind: 'blocked', reason: 'quality-infrastructure', summary: quality.summary, repairs: usedRepairRounds }
        case 'lose': {
          const authorization = authorizeRepair({ usedRounds: usedRepairRounds, elapsedMs: now() - startedAt, limits: input.limits })
            if (authorization.kind === 'blocked') return { kind: 'blocked', reason: authorization.reason, summary: `${quality.biggestGap}; evidence: ${quality.evidence.join(', ')}`, repairs: usedRepairRounds }
           usedRepairRounds = authorization.round
           emitStatus(authorization.round)
           const repair = input.repair({
            round: authorization.round,
            source: 'quality',
            finding: { severity: 'blocking', message: quality.biggestGap, actionable: true, evidence: [...quality.evidence] },
          })
          if (repair.kind === 'blocked') return { kind: 'blocked', reason: 'repair-failed', summary: repair.summary, repairs: usedRepairRounds }
           const gates = input.rerunGates()
            if (gates.kind === 'cancelled') return { kind: 'cancelled', summary: gates.summary, repairs: usedRepairRounds }
            if (gates.kind === 'failed') return { kind: 'blocked', reason: 'gate-failed', stage: gates.stage, summary: gates.summary, repairs: usedRepairRounds }
           if (input.pause?.()) return { kind: 'paused', repairs: usedRepairRounds }
           continue
        }
      }
    }
    if (!input.review) return { kind: 'approved', repairs: usedRepairRounds }
    const review = input.review()
    switch (review.kind) {
      case 'approved':
        return { kind: 'approved', repairs: usedRepairRounds }
      case 'malformed':
        return { kind: 'blocked', reason: 'review-malformed', summary: review.summary, repairs: usedRepairRounds }
      case 'infrastructure':
        return { kind: 'blocked', reason: 'review-infrastructure', summary: review.summary, repairs: usedRepairRounds }
      case 'rejected': {
        const finding = selectRepairFinding(review.verdict)
        if (!finding) return { kind: 'blocked', reason: 'no-actionable-finding', repairs: usedRepairRounds }
        const authorization = authorizeRepair({ usedRounds: usedRepairRounds, elapsedMs: now() - startedAt, limits: input.limits })
        if (authorization.kind === 'blocked') return { kind: 'blocked', reason: authorization.reason, summary: `${finding.message}${finding.evidence?.length ? `; evidence: ${finding.evidence.join(', ')}` : ''}`, repairs: usedRepairRounds }
        usedRepairRounds = authorization.round
        emitStatus(authorization.round)
        const repair = input.repair({ round: authorization.round, source: 'review', finding })
        if (repair.kind === 'blocked') return { kind: 'blocked', reason: 'repair-failed', summary: repair.summary, repairs: usedRepairRounds }
        const gates = input.rerunGates()
        if (gates.kind === 'cancelled') return { kind: 'cancelled', summary: gates.summary, repairs: usedRepairRounds }
        if (gates.kind === 'failed') return { kind: 'blocked', reason: 'gate-failed', stage: gates.stage, summary: gates.summary, repairs: usedRepairRounds }
        if (input.pause?.()) return { kind: 'paused', repairs: usedRepairRounds }
      }
    }
  }
}
