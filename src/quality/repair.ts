import type { ReviewDecision } from '../review/verdict.js'

export type ReviewOutcome =
  | { readonly kind: 'approved'; readonly verdict: ReviewDecision }
  | { readonly kind: 'rejected'; readonly verdict: ReviewDecision }
  | { readonly kind: 'malformed'; readonly summary: string }
  | { readonly kind: 'infrastructure'; readonly summary: string }

export type RepairLimits = {
  readonly maxRounds?: number
  readonly maxMinutes?: number
  readonly unbounded?: boolean
}

export type RepairAuthorization =
  | { readonly kind: 'authorized'; readonly round: number }
  | { readonly kind: 'blocked'; readonly reason: 'round-budget-exhausted' | 'time-budget-exhausted' }

export function authorizeRepair(input: {
  readonly usedRounds: number
  readonly elapsedMs: number
  readonly limits?: RepairLimits
}): RepairAuthorization {
  if (input.limits?.unbounded) return { kind: 'authorized', round: input.usedRounds + 1 }
  const maxRounds = input.limits?.maxRounds ?? 3
  const maxMinutes = input.limits?.maxMinutes ?? 60
  if (input.usedRounds >= maxRounds) return { kind: 'blocked', reason: 'round-budget-exhausted' }
  if (input.elapsedMs >= maxMinutes * 60 * 1000) return { kind: 'blocked', reason: 'time-budget-exhausted' }
  return { kind: 'authorized', round: input.usedRounds + 1 }
}
