import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ModelSelection } from '../agents/types.js'
import type { TokenUsage } from '../loop/reporter.js'
import { statePath } from '../workspace/state.js'

const Hash = z.string().regex(/^[a-f0-9]{64}$/u)
const StoryHash = z.string().regex(/^[a-f0-9]{32}$/u)
const ReservationSchema = z.object({
  version: z.literal(1), id: z.string(), contractKey: Hash, storyId: z.string().min(1),
  ordinal: z.number().int().min(1).max(8), startedAt: z.string().datetime(),
  limit: z.number().int().min(1).max(8), executionPolicyKey: z.string().optional(),
  profile: z.string().min(1), provider: z.string().min(1),
  requestedProvider: z.string().optional(), requestedModel: z.string().optional(),
  requestedReasoningEffort: z.string().optional(), requestedVariant: z.string().optional(),
  accountingScope: z.enum(['worker', 'execution-attempt']),
}).strict()
const OutcomeSchema = z.object({
  version: z.literal(1), attemptId: z.string(), finishedAt: z.string().datetime(),
  verificationSuccess: z.boolean(), failureKind: z.enum(['implementation', 'infrastructure']),
  actualModel: z.string().optional(),
}).strict()
const UsageSchema = z.object({
  version: z.literal(1), callId: z.string().min(1), role: z.string().min(1),
  inputTokens: z.number().finite().nonnegative().optional(), outputTokens: z.number().finite().nonnegative().optional(),
  totalCostUsd: z.number().finite().nonnegative().optional(), durationMs: z.number().finite().nonnegative().optional(),
  usageAvailable: z.boolean(), costMeasurementComplete: z.boolean(),
}).strict()
export type RoutingAttemptReservation = z.infer<typeof ReservationSchema>
export type RoutingAttemptOutcome = z.infer<typeof OutcomeSchema>
type AttemptUsage = z.infer<typeof UsageSchema>
export interface RoutingAttemptEntry { reservation: RoutingAttemptReservation; outcome?: RoutingAttemptOutcome }
export interface RoutingAttemptSummary {
  calls: number; usageComplete: boolean; costComplete: boolean; totalCostUsd?: number;
  inputTokens: number; outputTokens: number; durationMs: number;
  accountingScope: 'worker' | 'execution-attempt';
}

const taskHash = (storyId: string) => createHash('sha256').update(storyId).digest('hex').slice(0, 32)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function directory(root: string, story: string, contract: string, create = false): string {
  StoryHash.parse(story); Hash.parse(contract)
  const parts = ['routing-attempts', story, contract]
  for (let count = 0; count <= parts.length; count++) {
    const path = statePath(root, ...parts.slice(0, count))
    if (create && !existsSync(path)) mkdirSync(path)
    if (existsSync(path) && !lstatSync(path).isDirectory()) throw Error('Routing attempt state is not a directory')
  }
  return statePath(root, ...parts)
}

function location(root: string, attemptId: string): { directory: string; ordinal: number } {
  const match = /^([a-f0-9]{32})\.([a-f0-9]{64})\.([1-8])$/u.exec(attemptId)
  if (!match) throw Error('Invalid routing attempt identity')
  return { directory: directory(root, match[1], match[2]), ordinal: Number(match[3]) }
}

function readJson(file: string): unknown {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536) throw Error('Invalid routing attempt state')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Publish complete JSON without replacing another process's reservation. The
 * temporary file is flushed before the exclusive link makes it visible. */
function publishOnce(file: string, value: unknown): boolean {
  // dirname must also support Windows paths.
  const safeTemp = file.replace(/[^\\/]+$/u, `.reservation-${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(safeTemp, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(value))
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    try { linkSync(safeTemp, file); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(safeTemp, { force: true })
  }
}

export function readRoutingAttempts(root: string, storyId: string, contractKey: string): RoutingAttemptEntry[] {
  const dir = directory(root, taskHash(storyId), contractKey)
  if (!existsSync(dir)) return []
  const entries: RoutingAttemptEntry[] = []
  for (const name of readdirSync(dir).filter(name => /^attempt-[1-8]\.json$/u.test(name)).sort()) {
    const reservation = ReservationSchema.parse(readJson(join(dir, name)))
    if (reservation.storyId !== storyId || reservation.contractKey !== contractKey || reservation.id !== `${taskHash(storyId)}.${contractKey}.${reservation.ordinal}`) throw Error('Routing attempt identity does not match its task')
    const outcomeFile = join(dir, `outcome-${reservation.ordinal}.json`)
    const outcome = existsSync(outcomeFile) ? OutcomeSchema.parse(readJson(outcomeFile)) : undefined
    if (outcome && outcome.attemptId !== reservation.id) throw Error('Routing outcome identity changed')
    entries.push({ reservation, ...(outcome ? { outcome } : {}) })
  }
  return entries
}

export function reserveRoutingAttempt(input: {
  root: string; contractKey: string; storyId: string; limit: number; profile: string;
  provider: string; selection?: ModelSelection; startedAt?: string;
  accountingScope?: 'worker' | 'execution-attempt';
  executionPolicyKey?: string;
}): RoutingAttemptReservation {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 8) throw Error('Invalid routing attempt limit')
  // Corrupt state blocks admission; optional analytics never supplies the budget.
  readRoutingAttempts(input.root, input.storyId, input.contractKey)
  const story = taskHash(input.storyId)
  const dir = directory(input.root, story, input.contractKey, true)
  for (let ordinal = 1; ordinal <= input.limit; ordinal++) {
    const reservation = ReservationSchema.parse({
      version: 1, id: `${story}.${input.contractKey}.${ordinal}`, contractKey: input.contractKey,
      storyId: input.storyId, ordinal, startedAt: input.startedAt ?? new Date().toISOString(),
      limit: input.limit, executionPolicyKey: input.executionPolicyKey,
      profile: input.profile, provider: input.provider,
      requestedProvider: input.selection?.provider, requestedModel: input.selection?.model,
      requestedReasoningEffort: input.selection?.reasoningEffort, requestedVariant: input.selection?.variant,
      accountingScope: input.accountingScope ?? 'worker',
    })
    if (publishOnce(join(dir, `attempt-${ordinal}.json`), reservation)) return reservation
  }
  throw Error('Routing attempt budget exhausted; revise the task plan before retrying')
}

export function recordRoutingAttemptUsage(root: string, attemptId: string, usage: TokenUsage): void {
  const point = location(root, attemptId)
  if (!existsSync(join(point.directory, `attempt-${point.ordinal}.json`))) throw Error('Routing usage has no admitted attempt')
  const dir = join(point.directory, `usage-${point.ordinal}`)
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw Error('Invalid routing usage directory')
  if (!existsSync(dir)) mkdirSync(dir)
  const explicitCalls = Boolean(usage.calls?.length)
  const calls = explicitCalls ? usage.calls! : [usage]
  for (const call of calls) {
    const callId = call.callId ?? usage.callId ?? randomUUID()
    const complete = (!('usageAvailable' in call) || call.usageAvailable !== false) && ('measurementComplete' in call ? call.measurementComplete !== false : true)
      && (explicitCalls || usage.measurementComplete !== false)
    const entry: AttemptUsage = UsageSchema.parse({
      version: 1, callId, role: call.role ?? usage.role ?? 'unknown',
      ...(finite(call.inputTokens) ? { inputTokens: call.inputTokens } : {}),
      ...(finite(call.outputTokens) ? { outputTokens: call.outputTokens } : {}),
      ...(finite(call.totalCostUsd) ? { totalCostUsd: call.totalCostUsd } : {}),
      ...(finite(call.durationMs) ? { durationMs: call.durationMs } : {}),
      usageAvailable: complete && finite(call.inputTokens) && finite(call.outputTokens),
      costMeasurementComplete: finite(call.totalCostUsd) && call.costMeasurementComplete !== false && (explicitCalls || usage.costMeasurementComplete !== false),
    })
    publishOnce(join(dir, `${createHash('sha256').update(callId).digest('hex')}.json`), entry)
  }
}

export function markRoutingAttemptUsageIncomplete(root: string, attemptId: string): void {
  const point = location(root, attemptId)
  publishOnce(join(point.directory, `incomplete-${point.ordinal}.json`), { version: 1 })
}

/** Join role usage only when the story has exactly one open execution. Parallel
 * candidates require an explicit attempt id; ambiguity can never look complete. */
export function recordActiveRoutingUsage(root: string, storyId: string, usage: TokenUsage): boolean {
  if (usage.routingAttemptId) { recordRoutingAttemptUsage(root, usage.routingAttemptId, usage); return true }
  const story = taskHash(storyId)
  const base = statePath(root, 'routing-attempts', story)
  if (!existsSync(base)) return false
  if (!lstatSync(base).isDirectory()) throw Error('Invalid routing attempt directory')
  const active: RoutingAttemptReservation[] = []
  const contracts = readdirSync(base).filter(name => /^[a-f0-9]{64}$/u.test(name))
  if (contracts.length > 4096) throw Error('Routing accounting history requires maintenance')
  for (const contract of contracts) {
    for (const entry of readRoutingAttempts(root, storyId, contract)) if (!entry.outcome) active.push(entry.reservation)
  }
  if (active.length !== 1) {
    for (const entry of active) markRoutingAttemptUsageIncomplete(root, entry.id)
    return false
  }
  recordRoutingAttemptUsage(root, active[0].id, usage)
  return true
}

export function markActiveRoutingUsageIncomplete(root: string, storyId: string): void {
  const base = statePath(root, 'routing-attempts', taskHash(storyId))
  if (!existsSync(base)) return
  const contracts = readdirSync(base).filter(name => /^[a-f0-9]{64}$/u.test(name))
  for (const contract of contracts) {
    for (const entry of readRoutingAttempts(root, storyId, contract)) if (!entry.outcome) markRoutingAttemptUsageIncomplete(root, entry.reservation.id)
  }
}

export function routingAttemptSummary(root: string, reservation: RoutingAttemptReservation, finishedAt = new Date().toISOString()): RoutingAttemptSummary {
  const point = location(root, reservation.id)
  const dir = join(point.directory, `usage-${point.ordinal}`)
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw Error('Invalid routing usage directory')
  const names = existsSync(dir) ? readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)) : []
  if (names.length > 10_000) throw Error('Routing call ledger exceeds its limit')
  const calls = names.map(name => UsageSchema.parse(readJson(join(dir, name))))
  const ambiguous = existsSync(join(point.directory, `incomplete-${point.ordinal}.json`))
  return {
    calls: calls.length, usageComplete: !ambiguous && calls.length > 0 && calls.every(call => call.usageAvailable),
    costComplete: !ambiguous && calls.length > 0 && calls.every(call => call.costMeasurementComplete),
    ...(calls.some(call => call.totalCostUsd !== undefined) ? { totalCostUsd: calls.reduce((sum, call) => sum + (call.totalCostUsd ?? 0), 0) } : {}),
    inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0), outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(reservation.startedAt)), accountingScope: reservation.accountingScope,
  }
}

export function finishRoutingAttempt(root: string, reservation: RoutingAttemptReservation, outcome: { verificationSuccess: boolean; failureKind?: 'implementation' | 'infrastructure'; actualModel?: string }): RoutingAttemptSummary {
  const point = location(root, reservation.id)
  const file = join(point.directory, `outcome-${point.ordinal}.json`)
  const result = OutcomeSchema.parse({ version: 1, attemptId: reservation.id, finishedAt: new Date().toISOString(), verificationSuccess: outcome.verificationSuccess, failureKind: outcome.failureKind ?? 'implementation', actualModel: outcome.actualModel })
  publishOnce(file, result)
  const stored = OutcomeSchema.parse(readJson(file))
  return routingAttemptSummary(root, reservation, stored.finishedAt)
}

/** One economic observation covers the whole bounded execution sequence, charged
 * to the starting profile. Escalation/repair spending is never made free by
 * assigning it only to the final successful model. */
export function routingEpisodeSummary(root: string, reservation: RoutingAttemptReservation) {
  const entries = readRoutingAttempts(root, reservation.storyId, reservation.contractKey)
  const initial = entries[0]
  const last = entries.at(-1)!
  const summaries = entries.map(entry => routingAttemptSummary(root, entry.reservation, entry.outcome?.finishedAt))
  const complete = entries.every(entry => Boolean(entry.outcome))
    && (last.outcome?.verificationSuccess === true || entries.length >= last.reservation.limit)
  return {
    id: `${taskHash(reservation.storyId)}.${reservation.contractKey}`,
    initial: initial.reservation, actualInitialModel: initial.outcome?.actualModel,
    complete, success: last.outcome?.verificationSuccess === true,
    infrastructureFailure: entries.some(entry => entry.outcome?.failureKind === 'infrastructure'),
    attempts: entries.length,
    costComplete: complete && summaries.every(summary => summary.costComplete && summary.usageComplete && summary.accountingScope === 'execution-attempt')
      && entries.every(entry => entry.reservation.executionPolicyKey === initial.reservation.executionPolicyKey),
    ...(summaries.some(summary => summary.totalCostUsd !== undefined) ? { totalCostUsd: summaries.reduce((sum, summary) => sum + (summary.totalCostUsd ?? 0), 0) } : {}),
    durationMs: summaries.reduce((sum, summary) => sum + summary.durationMs, 0),
  }
}
