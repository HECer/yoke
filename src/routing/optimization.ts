import { createHash } from 'node:crypto'
import type { RoutingWorker } from '../retrofit/config.js'
import type { TaskAssessment } from './assessment.js'
import type { RoutingObservation } from './registry.js'

export interface RoutingOptimization { version: 1; objective: 'cost' | 'speed' | 'balanced'; minSamples?: number }

export function assessmentSignature(assessment: TaskAssessment): string {
  const { taskClass, difficulty, uncertainty, risk, scope, testability } = assessment
  return createHash('sha256').update(JSON.stringify({ taskClass, difficulty, uncertainty, risk, scope, testability })).digest('hex')
}

interface Evidence { samples: number; accepted: number; costPerAccepted: number; durationPerAccepted: number }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Compare completed, fully measured execution sequences, including failures and
 * escalation, attributed to the initial profile. No benchmark probability, tier
 * price estimate or incomplete successful-only sample is substituted for data. */
export function optimizeCapability(input: {
  workers: RoutingWorker[]; observations: RoutingObservation[]; assessment: TaskAssessment;
  settings?: RoutingOptimization; executionPolicyKey?: string; role: string;
}): { worker?: RoutingWorker; reason: string } {
  const baseline = input.workers[0]
  if (!baseline || !input.settings) return { worker: baseline, reason: '' }
  if (input.role !== 'implementation') return { worker: baseline, reason: 'economic selection unchanged: independent role-quality evidence is unavailable' }
  if (!input.executionPolicyKey) return { worker: baseline, reason: 'economic selection unchanged: comparable execution-policy evidence is unavailable' }
  const required = Math.max(10, input.settings.minSamples ?? 20)
  const signature = assessmentSignature(input.assessment)
  const evidence = new Map<string, Evidence>()
  for (const worker of input.workers) {
    const bySequence = new Map<string, NonNullable<RoutingObservation['economicEpisode']>>()
    for (const event of input.observations) {
      const episode = event.economicEpisode
      if (!episode || !episode.initial || typeof episode.id !== 'string' || episode.assessmentSignature !== signature || episode.initial.executionPolicyKey !== input.executionPolicyKey) continue
      const initial = episode.initial
      if (initial.profile !== worker.id || initial.provider !== worker.agent || initial.requestedProvider !== worker.provider
        || initial.requestedModel !== worker.model || initial.requestedReasoningEffort !== worker.reasoningEffort || initial.requestedVariant !== worker.variant) continue
      // Registry records are chronological; a later completion replaces the
      // earlier open sequence instead of double-counting its repair attempts.
      bySequence.delete(episode.id)
      bySequence.set(episode.id, episode)
    }
    const rows = [...bySequence.values()]
    const actual = rows.filter(row => row.actualInitialModel).at(-1)?.actualInitialModel
    const latest = rows.filter(row => !row.actualInitialModel || row.actualInitialModel === actual).slice(-required)
    if (latest.length < required || latest.some(row => !row.complete || !row.costComplete || row.infrastructureFailure || !row.actualInitialModel
      || row.initial.accountingScope !== 'execution-attempt' || !finite(row.totalCostUsd) || !finite(row.durationMs))) continue
    const accepted = latest.filter(row => row.success).length
    if (!accepted) continue
    evidence.set(worker.id, { samples: latest.length, accepted,
      costPerAccepted: latest.reduce((sum, row) => sum + row.totalCostUsd!, 0) / accepted,
      durationPerAccepted: latest.reduce((sum, row) => sum + row.durationMs, 0) / accepted,
    })
  }
  const initial = evidence.get(baseline.id)
  if (!initial) return { worker: baseline, reason: `economic selection unchanged: need ${required} recent complete comparable execution sequences for the baseline; incomplete costs and unknown models are excluded from decisions` }
  let selected = baseline, best = initial
  for (const worker of input.workers.slice(1)) {
    const candidate = evidence.get(worker.id)
    // Equal sample windows make the accepted counts comparable. Optimization may
    // not trade away even the observed completion rate to obtain a lower bill.
    if (!candidate || candidate.accepted < initial.accepted) continue
    const improves = input.settings.objective === 'cost'
      ? candidate.costPerAccepted < best.costPerAccepted
      : input.settings.objective === 'speed'
        ? candidate.durationPerAccepted < best.durationPerAccepted
        : candidate.costPerAccepted <= best.costPerAccepted && candidate.durationPerAccepted <= best.durationPerAccepted
          && (candidate.costPerAccepted < best.costPerAccepted || candidate.durationPerAccepted < best.durationPerAccepted)
    if (improves) { selected = worker; best = candidate }
  }
  return { worker: selected,
    reason: `economic ${input.settings.objective}: ${selected.id}; ${best.samples} fully measured comparable execution sequences, ${best.accepted}/${best.samples} accepted; observed $${best.costPerAccepted.toFixed(4)} and ${(best.durationPerAccepted / 1000).toFixed(1)}s per accepted sequence including failed attempts and escalation; observational evidence, not a calibrated forecast`,
  }
}
