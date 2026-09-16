import { type BudgetLedger, type Resources, parseLedger, parseResources, reserveBudget } from './budget.js'
import { ControlPlaneError, fail, identifier, list, oneOf, record, strings, text } from './validation.js'

export const CAPABILITIES = ['isolated-workspace', 'structured-result', 'confirmed-cancellation', 'usage-reporting', 'read-only-enforcement'] as const
export type Capability = typeof CAPABILITIES[number]
export interface RuntimeCapabilities {
  readonly id: string
  readonly status: 'available' | 'unavailable' | 'unknown'
  readonly capabilities: Readonly<Partial<Record<Capability, 'supported' | 'unsupported' | 'unknown'>>>
}
/** An identity is separate from its model and engine. These scopes do not create an OS sandbox. */
export interface AgentProfile { readonly id: string; readonly role: string; readonly engine: string; readonly model?: string; readonly writeScopes: readonly string[] }
export interface PlannedTask { readonly id: string; readonly profileId: string; readonly dependsOn: readonly string[]; readonly writeScopes: readonly string[]; readonly requires: readonly Capability[]; readonly reservationId: string; readonly requested: Resources }
export interface AdmissionInput {
  readonly version: 1
  readonly runtime: RuntimeCapabilities
  readonly ledger: BudgetLedger
  readonly profiles: readonly AgentProfile[]
  readonly tasks: readonly PlannedTask[]
  readonly accepted: readonly string[]
  readonly activeWrites: readonly string[]
  readonly protectedScopes: readonly string[]
}
export interface AdmissionDecision { readonly taskId: string; readonly status: 'admitted' | 'blocked' | 'already-accepted' | 'already-reserved'; readonly reason: string }
/** Deliberately conservative across Windows/POSIX; lexical planning, not filesystem authorization. */
export function normalizeScope(value: unknown): string {
  const scope = text(value, 'scope', 1024)
  if (scope !== scope.trim() || scope.startsWith('/') || /[\\:*?\[\]{}]/u.test(scope)) fail('invalid_scope', `Use literal repository-relative scopes, not absolute paths or globs: ${scope}`)
  const parts = scope.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' '))) fail('invalid_scope', `Unsafe path scope: ${scope}`)
  return parts.join('/').toLowerCase()
}
export function scopesOverlap(a: string, b: string): boolean {
  const left = normalizeScope(a), right = normalizeScope(b)
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}
function scopes(value: unknown, name: string): string[] {
  const result = strings(value, name, 200).map(normalizeScope)
  if (new Set(result).size !== result.length) fail('invalid_scope', `${name} contains equivalent scopes`)
  return result
}
export function parseAdmissionInput(value: unknown): AdmissionInput {
  const raw = record(value, ['version', 'runtime', 'ledger', 'profiles', 'tasks', 'accepted', 'activeWrites', 'protectedScopes'], 'admission')
  if (raw.version !== 1) fail('unsupported_version', 'Unsupported admission protocol version')
  const runtime = record(raw.runtime, ['id', 'status', 'capabilities'], 'runtime')
  const capabilities = record(runtime.capabilities, CAPABILITIES, 'capabilities')
  const normalizedCapabilities: Partial<Record<Capability, 'supported' | 'unsupported' | 'unknown'>> = {}
  for (const key of CAPABILITIES) if (Object.hasOwn(capabilities, key)) normalizedCapabilities[key] = oneOf(capabilities[key], ['supported', 'unsupported', 'unknown'], key)
  const profiles = list(raw.profiles, 'profiles', 100).map(value => {
    const item = record(value, ['id', 'role', 'engine', 'model', 'writeScopes'], 'profile')
    return { id: identifier(item.id, 'profile.id'), role: text(item.role, 'role'), engine: identifier(item.engine, 'engine'), ...(item.model !== undefined ? { model: text(item.model, 'model') } : {}), writeScopes: scopes(item.writeScopes, 'profile.writeScopes') }
  })
  const tasks = list(raw.tasks, 'tasks', 1000).map(value => {
    const item = record(value, ['id', 'profileId', 'dependsOn', 'writeScopes', 'requires', 'reservationId', 'requested'], 'task')
    return { id: identifier(item.id, 'task.id'), profileId: identifier(item.profileId, 'profileId'), dependsOn: strings(item.dependsOn, 'dependsOn').map(value => identifier(value, 'dependency')), writeScopes: scopes(item.writeScopes, 'task.writeScopes'), requires: strings(item.requires, 'requires', CAPABILITIES.length).map(value => oneOf(value, CAPABILITIES, 'capability')), reservationId: identifier(item.reservationId, 'reservationId'), requested: parseResources(item.requested) }
  })
  for (const [name, values] of [['profiles', profiles.map(item => item.id)], ['tasks', tasks.map(item => item.id)], ['reservationIds', tasks.map(item => item.reservationId)]] as const) if (new Set(values).size !== values.length) fail('duplicate_id', `Duplicate ${name}`)
  const known = new Set(tasks.map(item => item.id))
  for (const task of tasks) {
    if (!profiles.some(profile => profile.id === task.profileId)) fail('unknown_profile', `Unknown profile for ${task.id}`)
    if (task.dependsOn.some(id => !known.has(id))) fail('unknown_dependency', `Unknown dependency for ${task.id}`)
  }
  const visited = new Set<string>(), visiting = new Set<string>()
  const byId = new Map(tasks.map(item => [item.id, item]))
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('dependency_cycle', `Dependency cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id); for (const dependency of byId.get(id)!.dependsOn) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const task of tasks) visit(task.id)
  const accepted = strings(raw.accepted, 'accepted').map(value => identifier(value, 'accepted task'))
  if (accepted.some(id => !known.has(id))) fail('unknown_task', 'Accepted set contains an unknown task')
  for (const task of tasks) if (accepted.includes(task.id) && task.dependsOn.some(id => !accepted.includes(id))) fail('invalid_acceptance', 'An accepted task has an unaccepted dependency')
  return { version: 1, runtime: { id: identifier(runtime.id, 'runtime.id'), status: oneOf(runtime.status, ['available', 'unavailable', 'unknown'], 'runtime.status'), capabilities: normalizedCapabilities }, ledger: parseLedger(raw.ledger), profiles, tasks, accepted, activeWrites: scopes(raw.activeWrites, 'activeWrites'), protectedScopes: scopes(raw.protectedScopes, 'protectedScopes') }
}
/** One deterministic admission wave, NOT a replacement scheduler or a process launcher. */
export function planAdmission(value: AdmissionInput): { decisions: AdmissionDecision[]; ledger: BudgetLedger } {
  const input = parseAdmissionInput(value)
  let ledger = input.ledger
  const writes = [...input.activeWrites], decisions: AdmissionDecision[] = []
  // Preserve operator order; never infer priority from an identifier or model name.
  for (const task of input.tasks) {
    const profile = input.profiles.find(profile => profile.id === task.profileId)!
    const blocked = (reason: string) => decisions.push({ taskId: task.id, status: 'blocked', reason })
    if (input.accepted.includes(task.id)) { decisions.push({ taskId: task.id, status: 'already-accepted', reason: 'Accepted in supplied snapshot; not dispatched again' }); continue }
    if (task.dependsOn.some(id => !input.accepted.includes(id))) { blocked('dependency_not_accepted'); continue }
    if (input.runtime.status !== 'available') { blocked('runtime_not_available'); continue }
    if (task.requires.some(key => input.runtime.capabilities[key] !== 'supported')) { blocked('capability_not_confirmed'); continue }
    if (task.writeScopes.some(scope => !profile.writeScopes.some(grant => { const normalized = normalizeScope(grant); return scope === normalized || scope.startsWith(`${normalized}/`) }))) { blocked('scope_not_granted'); continue }
    if (task.writeScopes.some(scope => ['.git', '.yoke', ...input.protectedScopes].some(protectedScope => scopesOverlap(scope, protectedScope)))) { blocked('protected_scope'); continue }
    if (task.writeScopes.some(scope => writes.some(active => scopesOverlap(scope, active)))) { blocked('write_conflict'); continue }
    try {
      const result = reserveBudget(ledger, { id: task.reservationId, taskId: task.id, role: 'worker', requested: task.requested })
      ledger = result.ledger
      decisions.push({ taskId: task.id, status: result.disposition === 'created' ? 'admitted' : 'already-reserved', reason: result.disposition === 'created' ? 'Preview only: reservation fits declared constraints' : 'Idempotent replay; do not launch another process' })
      writes.push(...task.writeScopes)
    } catch (error) { if (!(error instanceof ControlPlaneError)) throw error; blocked(error.code) }
  }
  return { decisions, ledger }
}
