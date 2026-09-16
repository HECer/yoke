import { digest, fail, identifier, list, oneOf, record, strings } from './validation.js'

export interface EvidenceBinding {
  readonly taskId: string
  readonly attemptId: string
  readonly dispatchId: string
  readonly snapshot: string
  readonly acceptance: string
  readonly policy: string
  readonly environment: string
}
export interface VerificationEvidence {
  readonly version: 1
  readonly stage: 'candidate' | 'integrated'
  readonly binding: EvidenceBinding
  readonly checks: readonly { readonly id: string; readonly status: 'passed' | 'failed' | 'unverified' }[]
}
export type EvidenceAssessment = { readonly status: 'passed' | 'failed' | 'unverified'; readonly reasons: readonly string[] }
const BINDING_KEYS = ['taskId', 'attemptId', 'dispatchId', 'snapshot', 'acceptance', 'policy', 'environment'] as const
export function parseBinding(value: unknown): EvidenceBinding {
  const raw = record(value, BINDING_KEYS, 'binding')
  return { taskId: identifier(raw.taskId, 'taskId'), attemptId: identifier(raw.attemptId, 'attemptId'), dispatchId: identifier(raw.dispatchId, 'dispatchId'), snapshot: digest(raw.snapshot, 'snapshot'), acceptance: digest(raw.acceptance, 'acceptance'), policy: digest(raw.policy, 'policy'), environment: digest(raw.environment, 'environment') }
}
export function parseEvidence(value: unknown): VerificationEvidence {
  const raw = record(value, ['version', 'stage', 'binding', 'checks'], 'evidence')
  if (raw.version !== 1) fail('unsupported_version', 'Unsupported evidence version')
  const checks = list(raw.checks, 'checks', 1000).map(value => {
    const item = record(value, ['id', 'status'], 'check')
    return { id: identifier(item.id, 'check.id'), status: oneOf(item.status, ['passed', 'failed', 'unverified'], 'check.status') }
  })
  if (new Set(checks.map(check => check.id)).size !== checks.length) fail('duplicate_check', 'Duplicate evidence check id')
  return { version: 1, stage: oneOf(raw.stage, ['candidate', 'integrated'], 'stage'), binding: parseBinding(raw.binding), checks }
}
/**
 * Called by a trusted verification adapter, never with an agent's JSON as authority.
 * This validates a receipt; it does NOT execute checks, authenticate their producer,
 * or mutate legacy Story.passes. Those remain the existing integration gate's job.
 */
export function assessEvidence(value: VerificationEvidence, expected: EvidenceBinding, requiredCheckIds: readonly string[]): EvidenceAssessment {
  const evidence = parseEvidence(value), binding = parseBinding(expected)
  const required = strings(requiredCheckIds, 'requiredCheckIds').map(id => identifier(id, 'required check'))
  if (!required.length) return { status: 'unverified', reasons: ['no_required_checks'] }
  const stale = BINDING_KEYS.filter(key => evidence.binding[key] !== binding[key])
  if (stale.length) return { status: 'unverified', reasons: stale.map(key => `binding_mismatch:${key}`) }
  if (evidence.stage !== 'integrated') return { status: 'unverified', reasons: ['candidate_is_not_integration'] }
  const failures = evidence.checks.filter(check => check.status === 'failed')
  if (failures.length) return { status: 'failed', reasons: failures.map(check => `failed:${check.id}`) }
  const missing = required.filter(id => !evidence.checks.some(check => check.id === id && check.status === 'passed'))
  if (missing.length) return { status: 'unverified', reasons: missing.map(id => `missing_or_unverified:${id}`) }
  if (evidence.checks.some(check => check.status === 'unverified')) return { status: 'unverified', reasons: ['additional_check_unverified'] }
  return { status: 'passed', reasons: [] }
}
