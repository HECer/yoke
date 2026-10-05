import { randomUUID } from 'node:crypto'

const categories = {
  timeout: 'infrastructure', spawn: 'infrastructure', capture: 'infrastructure', storage: 'infrastructure',
  'invalid-cwd': 'infrastructure', 'missing-executable': 'infrastructure', preflight: 'infrastructure',
  'invalid-evidence': 'observer', 'source-changed': 'observer', 'head-changed': 'observer',
  assertion: 'product', cancelled: 'cancellation', unknown: 'unknown',
} as const
export type FailureCause = keyof typeof categories
export interface FailureObservation {
  readonly failureId: string
  readonly failureCategory: typeof categories[FailureCause]
  readonly failureCause: FailureCause
  readonly modelExecution?: 'not-started' | 'started' | 'unknown'
}
export function failureObservation(cause: FailureCause = 'unknown', modelExecution?: FailureObservation['modelExecution']): FailureObservation {
  return { failureId: randomUUID(), failureCategory: categories[cause], failureCause: cause, ...(modelExecution ? { modelExecution } : {}) }
}
/** Only the bounded structured contract is retained, never diagnostics or arbitrary codes. */
export function safeFailure(value: unknown): FailureObservation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.failureCause !== 'string' || !Object.hasOwn(categories, raw.failureCause)) return undefined
  const cause = raw.failureCause as FailureCause
  if (raw.failureCategory !== categories[cause] || typeof raw.failureId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(raw.failureId)) return undefined
  return { failureId: raw.failureId, failureCategory: categories[cause], failureCause: cause,
    ...(typeof raw.modelExecution === 'string' && ['not-started', 'started', 'unknown'].includes(raw.modelExecution) ? { modelExecution: raw.modelExecution as FailureObservation['modelExecution'] } : {}) }
}
/** Node execution codes and adapter metadata; arbitrary exits/throws remain unknown. */
export function executionFailure(error: unknown): FailureObservation {
  const raw = error && typeof error === 'object' ? error as { code?: unknown; failure?: unknown } : {}
  return safeFailure(raw.failure) ?? failureObservation(raw.code === 'ERR_ASSERTION' ? 'assertion' : raw.code === 'ETIMEDOUT' ? 'timeout'
    : raw.code === 'ENOBUFS' ? 'capture' : raw.code === 'ENOENT' || raw.code === 'EACCES' ? 'spawn' : 'unknown')
}
/** Tag the original exception, preserving its identity and diagnostics for the caller. */
export function observedError(message: string, cause: FailureCause, modelExecution?: FailureObservation['modelExecution']): Error & { failure: FailureObservation } {
  return Object.assign(new Error(message), { failure: failureObservation(cause, modelExecution) })
}
