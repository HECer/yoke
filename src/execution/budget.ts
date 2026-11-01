import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentInvocation } from '../agents/types.js'
import { parseProviderTelemetry } from '../agents/telemetry.js'
import { acquireClaimOperation, releaseClaimOperation } from '../loop/claim-lease.js'
import { isPidAlive } from '../loop/lock.js'
import type { TokenUsage } from '../loop/reporter.js'
import { observedError, safeFailure } from '../observability/failure.js'
import { providerTelemetryUsage } from '../observability/usage.js'
import { loadConfig, type Agent, type ExecutionBudgetSettings } from '../retrofit/config.js'
import { hostProjectStatePath } from '../workspace/host-state.js'

const number = z.number().finite().nonnegative()
const UsageSchema = z.object({ inputTokens: number.optional(), outputTokens: number.optional(), cachedInputTokens: number.optional(), cacheWriteInputTokens: number.optional(), totalCostUsd: number.optional(), complete: z.boolean(), costComplete: z.boolean() }).strict()
const CallSchema = z.object({
  id: z.string().uuid(), role: z.string().min(1).max(120), provider: z.string().min(1).max(120), storyId: z.string().max(1_000).optional(),
  pid: z.number().int().positive(), startedAt: z.string().datetime(), promptBytes: number, promptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  finishedAt: z.string().datetime().optional(), durationMs: number.optional(), outcome: z.enum(['pending', 'succeeded', 'failed']), usage: UsageSchema.optional(),
}).strict()
const MAX_CALLS_PER_EPOCH = 10_000
const StateSchema = z.object({ version: z.literal(1), id: z.string().min(1), project: z.string().min(1), epoch: z.string().uuid(), startedAt: z.string().datetime(), calls: z.array(CallSchema).max(MAX_CALLS_PER_EPOCH) }).strict()
type State = z.infer<typeof StateSchema>
type Call = z.infer<typeof CallSchema>
export interface ExecutionBudgetCall { root: string; provider: string; role: string; prompt: string; storyId?: string; dispatch?: boolean }
export interface BudgetTicket { readonly file: string; readonly epoch: string; readonly callId: string; readonly startedAt: number; readonly root: string; readonly provider: string; readonly promptSha256: string }
const context = new AsyncLocalStorage<BudgetTicket>()
const command = new AsyncLocalStorage<{ root: string; settings: Readonly<ExecutionBudgetSettings> | undefined }>()
const active = new WeakSet<BudgetTicket>()
const dispatched = new WeakSet<BudgetTicket>()
const waitCell = new Int32Array(new SharedArrayBuffer(4))
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function canonicalRoot(root: string): string {
  try { return realpathSync(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(root); throw error }
}
function settingsFor(root: string): ExecutionBudgetSettings | undefined {
  const frozen = command.getStore()
  return frozen?.root === root ? frozen.settings : loadConfig(root)?.executionBudget
}

/** Capture host policy once, before any worker can edit the project's configuration. */
export function withExecutionBudgetScope<T>(root: string, operation: () => T): T {
  const canonical = canonicalRoot(root)
  if (command.getStore()?.root === canonical) return operation()
  const configured = loadConfig(canonical)?.executionBudget
  return command.run({ root: canonical, settings: configured ? Object.freeze({ ...configured }) : undefined }, operation)
}

function regularFile(path: string, maximum = 32_000_000): string | undefined {
  let stat
  try { stat = lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw observedError('Invalid execution budget storage; admission blocked', 'storage', 'not-started')
  return readFileSync(path, 'utf8')
}

/** External host state cannot be reset by replacing a worker's project files. */
export function executionBudgetPath(root: string, id: string): string {
  return hostProjectStatePath(root, 'execution-budgets', [hash(id), 'state.json'], true)
}

function writeState(file: string, state: State): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, file)
  } finally { rmSync(temporary, { force: true }) }
}

function locked<T>(file: string, operation: () => T): T {
  for (const suffix of ['', '.operation', '.operation.recovery']) regularFile(file + suffix)
  const until = Date.now() + 2_000
  let token: string | null = null
  do {
    token = acquireClaimOperation(file, { now: new Date(), staleMs: 0, isAlive: isPidAlive })
    if (!token) Atomics.wait(waitCell, 0, 0, 10)
  } while (!token && Date.now() < until)
  if (!token) throw observedError('Execution budget state is busy; retry after the current admission completes', 'storage', 'not-started')
  try { return operation() } finally { releaseClaimOperation(file, token) }
}

function readState(file: string, root: string, id: string): State {
  const source = regularFile(file)
  const state = source ? StateSchema.parse(JSON.parse(source)) : { version: 1 as const, id, project: root, epoch: randomUUID(), startedAt: new Date().toISOString(), calls: [] }
  if (state.id !== id || state.project !== root) throw observedError('Execution budget identity changed; admission blocked', 'storage', 'not-started')
  return state
}

function totals(state: State, now = Date.now()) {
  let knownTokens = 0, knownCostUsd = 0, durationMs = 0, unknownTokenCalls = 0, unknownCostCalls = 0, unresolvedCalls = 0
  const pending = state.calls.filter(call => call.outcome === 'pending')
  for (const call of state.calls) {
    const usage = call.usage
    // Claude's input counter excludes its separate cache counters; other
    // supported adapters report inclusive input or unknown cache semantics.
    knownTokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
      + (call.provider === 'claude' ? (usage?.cachedInputTokens ?? 0) + (usage?.cacheWriteInputTokens ?? 0) : 0)
    knownCostUsd += usage?.totalCostUsd ?? 0
    if (!usage?.complete) unknownTokenCalls++
    if (!usage?.costComplete) unknownCostCalls++
    if (call.outcome === 'pending') {
      durationMs += Math.max(0, now - Date.parse(call.startedAt))
      if (!isPidAlive(call.pid)) unresolvedCalls++
    } else durationMs += call.durationMs ?? 0
  }
  return { admittedCalls: state.calls.length, completedCalls: state.calls.length - pending.length, pendingCalls: pending.length, unresolvedCalls, knownTokens, unknownTokenCalls, knownCostUsd, unknownCostCalls, durationMs, durationComplete: unresolvedCalls === 0 }
}

function admit(root: string, settings: ExecutionBudgetSettings, input: ExecutionBudgetCall): BudgetTicket {
  const promptBytes = Buffer.byteLength(input.prompt)
  if (settings.maxPromptBytes !== undefined && promptBytes > settings.maxPromptBytes) throw observedError(`Execution budget: prompt is ${promptBytes} bytes, above maxPromptBytes=${settings.maxPromptBytes}; condense or explicitly raise the mandatory-contract limit (nothing was truncated)`, 'preflight', 'not-started')
  const file = executionBudgetPath(root, settings.id)
  return locked(file, () => {
    const state = readState(file, root, settings.id), used = totals(state)
    if (used.admittedCalls >= MAX_CALLS_PER_EPOCH) throw observedError('Execution budget journal is full; inspect and explicitly reset this budget epoch', 'storage', 'not-started')
    if (settings.maxCalls !== undefined && used.admittedCalls >= settings.maxCalls) throw observedError(`Execution budget ${settings.id}: call limit ${settings.maxCalls} exhausted; inspect yoke budget status before an explicit reset`, 'preflight', 'not-started')
    if (settings.maxMinutes !== undefined && (used.durationMs >= settings.maxMinutes * 60_000 || used.unresolvedCalls > 0)) throw observedError(`Execution budget ${settings.id}: aggregate agent-time limit exhausted or an interrupted call remains unresolved`, 'preflight', 'not-started')
    const unknownCompleted = state.calls.some(call => call.outcome !== 'pending' && !call.usage?.complete)
    if (settings.maxTokens !== undefined && (used.knownTokens >= settings.maxTokens || unknownCompleted || used.unresolvedCalls > 0)) throw observedError(`Execution budget ${settings.id}: token limit exhausted or prior usage is incomplete; unknown usage is not free`, 'preflight', 'not-started')
    const startedAt = Date.now(), callId = randomUUID()
    const call = CallSchema.parse({ id: callId, provider: input.provider, role: input.role, ...(input.storyId ? { storyId: input.storyId } : {}), pid: process.pid, startedAt: new Date(startedAt).toISOString(), promptBytes, promptSha256: hash(input.prompt), outcome: 'pending' })
    state.calls.push(call)
    writeState(file, state)
    const ticket = { file, epoch: state.epoch, callId, startedAt, root, provider: input.provider, promptSha256: call.promptSha256 }
    active.add(ticket)
    return ticket
  })
}

function measured(usage: TokenUsage | undefined, notStarted = false, provider?: string): z.infer<typeof UsageSchema> {
  if (notStarted && !usage) return { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, complete: true, costComplete: true }
  const missing = new Set(usage?.usageMissingFields ?? [])
  const partial = new Set(usage?.usagePartialFields ?? [])
  const known = (key: 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'totalCostUsd') => finite(usage?.[key]) && !missing.has(key) ? { [key]: usage![key] } : {}
  const completeCounter = (key: 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'totalCostUsd') => finite(usage?.[key]) && !missing.has(key) && !partial.has(key)
  const provenZero = notStarted && ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'totalCostUsd'].every(key => !finite(usage?.[key as keyof TokenUsage]) || usage?.[key as keyof TokenUsage] === 0)
  const cacheComplete = provider !== 'claude' || provenZero || completeCounter('cachedInputTokens') && completeCounter('cacheWriteInputTokens')
  return UsageSchema.parse({ ...known('inputTokens'), ...known('outputTokens'), ...known('cachedInputTokens'), ...known('cacheWriteInputTokens'), ...known('totalCostUsd'),
    complete: Boolean(usage && usage.measurementComplete !== false && completeCounter('inputTokens') && completeCounter('outputTokens') && cacheComplete),
    costComplete: Boolean(usage && usage.costMeasurementComplete !== false && completeCounter('totalCostUsd')),
  })
}

/** Counters are cumulative within a call; preserve streamed lower bounds on failure. */
function mergeUsage(prior: Call['usage'], next: NonNullable<Call['usage']>): NonNullable<Call['usage']> {
  let decreased = false
  const merged = { ...next }
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'totalCostUsd'] as const) {
    if (prior?.[key] !== undefined) {
      if (next[key] !== undefined && next[key]! < prior[key]!) decreased = true
      merged[key] = Math.max(prior[key]!, next[key] ?? 0)
    }
  }
  if (decreased) { merged.complete = false; merged.costComplete = false }
  return merged
}

/** Native streaming calls can checkpoint cumulative usage before an interruption. */
export function updateExecutionBudgetUsage(usage: TokenUsage): void {
  const ticket = context.getStore()
  if (!ticket || !active.has(ticket)) return
  locked(ticket.file, () => {
    const source = regularFile(ticket.file)
    if (!source) throw Error('Execution budget reservation disappeared')
    const state = StateSchema.parse(JSON.parse(source))
    const call = state.calls.find(candidate => candidate.id === ticket.callId)
    if (state.epoch !== ticket.epoch || !call || call.outcome !== 'pending') throw Error('Execution budget reservation changed during native execution')
    call.usage = mergeUsage(call.usage, { ...measured(usage, false, call.provider), complete: false, costComplete: false })
    writeState(ticket.file, state)
  })
}

export function finishBudgetCall(ticket: BudgetTicket | undefined, result: { tokens?: TokenUsage; success: boolean; notStarted?: boolean }): void {
  if (!ticket || !active.has(ticket)) return
  locked(ticket.file, () => {
    const source = regularFile(ticket.file)
    if (!source) throw Error('Execution budget reservation disappeared')
    const state = StateSchema.parse(JSON.parse(source))
    if (state.epoch !== ticket.epoch) throw Error('Execution budget was reset during an active call')
    const call = state.calls.find(candidate => candidate.id === ticket.callId)
    if (!call || call.outcome !== 'pending') throw Error('Execution budget reservation is missing or already completed')
    Object.assign(call, { outcome: result.success ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - ticket.startedAt), usage: mergeUsage(call.usage, measured(result.tokens, result.notStarted, call.provider)) })
    writeState(ticket.file, state)
  })
  active.delete(ticket)
}

/** Return only a newly owned reservation; nested adapters reuse the outer call. */
export function beginBudgetCall(input: ExecutionBudgetCall): BudgetTicket | undefined {
  try {
  const root = canonicalRoot(input.root)
  const inherited = context.getStore()
  if (inherited && inherited.root === root && inherited.provider === input.provider && inherited.promptSha256 === hash(input.prompt) && active.has(inherited)) {
    if (!input.dispatch) return undefined
    // A lower-level adapter may consume its logical caller's admission once.
    // Sibling launches, even identical ones, require their own reservation.
    if (!dispatched.has(inherited)) { dispatched.add(inherited); return inherited }
  }
  const settings = settingsFor(root)
  if (!settings) return undefined
  const ticket = admit(root, settings, input)
  if (input.dispatch) dispatched.add(ticket)
  return ticket
  } catch (error) {
    if (safeFailure((error as { failure?: unknown })?.failure)) throw error
    throw observedError(`Execution budget admission blocked: ${(error as Error).message}`, 'storage', 'not-started')
  }
}

function errorUsage(provider: string, error: unknown): TokenUsage | undefined {
  try {
    const value = error as { tokens?: TokenUsage; stdout?: unknown } | undefined
    if (value?.tokens) return value.tokens
    if (value?.stdout !== undefined) return providerTelemetryUsage(parseProviderTelemetry(provider as Agent, String(value.stdout).split(/\r?\n/u)), provider as Agent)
  } catch { /* Preserve the provider failure and leave unavailable usage unknown. */ }
  return undefined
}

/** Admits before sync/async work, accounts failures, and deduplicates inner CLI wrappers. */
export function withExecutionBudget<T>(input: ExecutionBudgetCall, operation: () => T, usage?: (result: Awaited<T>) => TokenUsage | undefined, dispatch = input.dispatch ?? false): T {
  const ticket = beginBudgetCall({ ...input, dispatch })
  const finish = (result: Awaited<T>): Awaited<T> => {
    const value = result as { tokens?: TokenUsage; success?: boolean; failure?: unknown }
    finishBudgetCall(ticket, { tokens: usage ? usage(result) : value?.tokens, success: value?.success !== false, notStarted: safeFailure(value?.failure)?.modelExecution === 'not-started' })
    return result
  }
  const failed = (error: unknown): never => {
    if (!ticket) throw error
    try { finishBudgetCall(ticket, { tokens: errorUsage(input.provider, error), success: false, notStarted: safeFailure((error as { failure?: unknown })?.failure)?.modelExecution === 'not-started' }) }
    catch (accounting) { throw observedError(`${error instanceof Error ? error.message : String(error)}; execution budget accounting failed: ${(accounting as Error).message}`, 'storage') }
    throw error
  }
  try {
    const result = ticket ? context.run(ticket, operation) : operation()
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') return Promise.resolve(result).then(finish, failed) as T
    return finish(result as Awaited<T>) as T
  } catch (error) { return failed(error) }
}

export function budgetedInvocation<T extends AgentInvocation, R>(provider: Agent, invocation: T, execute: (invocation: T) => R, usage?: (result: Awaited<R>) => TokenUsage | undefined, dispatch = false): R {
  return withExecutionBudget({ root: invocation.execution?.root ?? invocation.cwd, provider, role: invocation.execution?.role ?? 'agent', storyId: invocation.execution?.storyId, prompt: invocation.input }, () => execute(invocation), usage, dispatch)
}

export function executionBudgetStatus(root: string) {
  const canonical = realpathSync(root), settings = settingsFor(canonical)
  if (!settings) return { configured: false as const, summary: 'No project execution budget is configured' }
  const file = executionBudgetPath(canonical, settings.id)
  return locked(file, () => {
    const state = readState(file, canonical, settings.id)
    return { configured: true as const, id: state.id, epoch: state.epoch, limits: settings, ...totals(state), calls: state.calls,
      summary: 'Admission limits cover submitted calls; already admitted calls can overshoot time or tokens. Unknown usage remains charged. Prompt bytes describe submitted input, not provider-managed context.' }
  })
}

export function resetExecutionBudget(root: string) {
  const canonical = realpathSync(root), settings = settingsFor(canonical)
  if (!settings) throw Error('No execution budget configured; configure executionBudget before resetting it')
  const file = executionBudgetPath(canonical, settings.id)
  locked(file, () => {
    const prior = readState(file, canonical, settings.id)
    if (prior.calls.some(call => call.outcome === 'pending' && isPidAlive(call.pid))) throw Error('Cannot reset execution budget while admitted calls may still be running')
    if (prior.calls.length) writeState(join(dirname(file), `epoch-${prior.epoch}.json`), prior)
    writeState(file, { ...prior, epoch: randomUUID(), startedAt: new Date().toISOString(), calls: [] })
  })
  return executionBudgetStatus(root)
}
