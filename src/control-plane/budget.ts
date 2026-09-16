import { fail, identifier, integer, list, oneOf, record } from './validation.js'

export const RESOURCE_KEYS = ['tokens', 'costMicrousd', 'computeMs'] as const
export type ResourceKey = typeof RESOURCE_KEYS[number]
/** computeMs is summed agent/runtime work, NOT parallel wall-clock duration. */
export type Resources = Readonly<Record<ResourceKey, number>>
export type Usage = Readonly<Record<ResourceKey, number | null>>
export const CALL_ROLES = ['controller', 'worker', 'review', 'repair', 'integration'] as const
export type CallRole = typeof CALL_ROLES[number]
export type BudgetLimits = Resources & { readonly maxActive: number }
export interface Reservation {
  readonly id: string
  readonly taskId: string
  readonly role: CallRole
  readonly requested: Resources
  /** null reservation = in flight; object with null fields = stopped, usage unknown. */
  readonly usage: Usage | null
}
export interface BudgetLedger {
  readonly version: 1
  readonly limits: BudgetLimits
  readonly reservations: readonly Reservation[]
}
export interface BudgetSummary {
  readonly charged: Resources
  readonly active: number
  readonly unknown: readonly ResourceKey[]
  readonly exceeded: readonly ResourceKey[]
}
export function parseResources(value: unknown): Resources {
  const raw = record(value, RESOURCE_KEYS, 'resources')
  return { tokens: integer(raw.tokens, 'tokens'), costMicrousd: integer(raw.costMicrousd, 'costMicrousd'), computeMs: integer(raw.computeMs, 'computeMs') }
}
export function parseUsage(value: unknown): Usage {
  const raw = record(value, RESOURCE_KEYS, 'usage')
  const field = (key: ResourceKey) => raw[key] === null ? null : integer(raw[key], `usage.${key}`)
  return { tokens: field('tokens'), costMicrousd: field('costMicrousd'), computeMs: field('computeMs') }
}
export function parseLimits(value: unknown): BudgetLimits {
  const raw = record(value, [...RESOURCE_KEYS, 'maxActive'], 'limits')
  return { ...parseResources({ tokens: raw.tokens, costMicrousd: raw.costMicrousd, computeMs: raw.computeMs }), maxActive: integer(raw.maxActive, 'maxActive', 1) }
}
export function parseLedger(value: unknown): BudgetLedger {
  const raw = record(value, ['version', 'limits', 'reservations'], 'ledger')
  if (raw.version !== 1) fail('unsupported_version', 'Unsupported budget ledger version')
  const reservations = list(raw.reservations, 'reservations', 10000).map(value => {
    const item = record(value, ['id', 'taskId', 'role', 'requested', 'usage'], 'reservation')
    return { id: identifier(item.id, 'reservation.id'), taskId: identifier(item.taskId, 'taskId'), role: oneOf(item.role, CALL_ROLES, 'role'), requested: parseResources(item.requested), usage: item.usage === null ? null : parseUsage(item.usage) }
  })
  if (new Set(reservations.map(item => item.id)).size !== reservations.length) fail('duplicate_reservation', 'Duplicate reservation id in ledger')
  return { version: 1, limits: parseLimits(raw.limits), reservations }
}
export function createLedger(limits: BudgetLimits): BudgetLedger { return { version: 1, limits: parseLimits(limits), reservations: [] } }
function sum(a: number, b: number): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) fail('resource_overflow', 'Resource total exceeds safe integer range; no further admission')
  return result
}
export function budgetSummary(value: BudgetLedger): BudgetSummary {
  const ledger = parseLedger(value)
  const charged = { tokens: 0, costMicrousd: 0, computeMs: 0 }
  const unknown = new Set<ResourceKey>()
  for (const item of ledger.reservations) for (const key of RESOURCE_KEYS) {
    if (item.usage && item.usage[key] === null) unknown.add(key)
    charged[key] = sum(charged[key], item.usage?.[key] ?? item.requested[key])
  }
  return { charged, active: ledger.reservations.filter(item => item.usage === null).length, unknown: RESOURCE_KEYS.filter(key => unknown.has(key)), exceeded: RESOURCE_KEYS.filter(key => charged[key] > ledger.limits[key]) }
}
export function reserveBudget(value: BudgetLedger, input: { id: string; taskId: string; role: CallRole; requested: Resources }): { ledger: BudgetLedger; disposition: 'created' | 'replayed' } {
  const ledger = parseLedger(value)
  const request: Reservation = { id: identifier(input.id, 'id'), taskId: identifier(input.taskId, 'taskId'), role: oneOf(input.role, CALL_ROLES, 'role'), requested: parseResources(input.requested), usage: null }
  const old = ledger.reservations.find(item => item.id === request.id)
  if (old) {
    if (old.taskId !== request.taskId || old.role !== request.role || RESOURCE_KEYS.some(key => old.requested[key] !== request.requested[key])) fail('idempotency_conflict', 'Reservation id already belongs to a different request')
    // A replay is NOT authority to start another process, even if already settled.
    return { ledger, disposition: 'replayed' }
  }
  if (request.role === 'worker' && ledger.reservations.some(item => item.taskId === request.taskId && item.role === 'worker' && item.usage === null)) fail('task_already_running', 'Another worker attempt for this task is still in flight; do not retry with a new id')
  const summary = budgetSummary(ledger)
  if (summary.unknown.length) fail('usage_unknown', `Reconcile unknown usage before admission: ${summary.unknown.join(', ')}`)
  if (summary.exceeded.length) fail('budget_exceeded', `Observed overspend: ${summary.exceeded.join(', ')}`)
  if (summary.active >= ledger.limits.maxActive) fail('concurrency_exhausted', 'No execution permits remain')
  for (const key of RESOURCE_KEYS) if (request.requested[key] > ledger.limits[key] - summary.charged[key]) fail('budget_exhausted', `Insufficient ${key}`)
  if (ledger.reservations.length >= 10000) fail('ledger_full', 'Archive through a reviewed migration before adding more reservations')
  return { ledger: { ...ledger, reservations: [...ledger.reservations, request] }, disposition: 'created' }
}
/** Caller must confirm process-tree termination. Heartbeat expiry is not confirmation. */
export function settleBudget(value: BudgetLedger, id: string, actual: Usage, terminationConfirmed: boolean): BudgetLedger {
  const ledger = parseLedger(value), usage = parseUsage(actual)
  if (terminationConfirmed !== true) fail('termination_unknown', 'Keep the reservation while termination is unconfirmed')
  const old = ledger.reservations.find(item => item.id === identifier(id, 'id'))
  if (!old) fail('unknown_reservation', `Unknown reservation ${id}`)
  if (old.usage) {
    if (RESOURCE_KEYS.some(key => old.usage![key] !== usage[key])) fail('idempotency_conflict', 'Settlement differs from the recorded measurement')
    return ledger
  }
  // Record overruns instead of discarding them to make the budget appear intact.
  return { ...ledger, reservations: ledger.reservations.map(item => item.id === id ? { ...item, usage } : item) }
}
