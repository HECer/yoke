import { z } from 'zod'
import { AgentSchema } from '../agents/contracts.js'
import type { ModelCallUsage, TokenUsage } from '../loop/reporter.js'

export const GoalUsageCallSchema = z.object({
  id: z.string().uuid(),
  attempt: z.number().int().positive(),
  provider: AgentSchema,
  model: z.string().optional(),
  requestedProvider: z.string().optional(),
  requestedModel: z.string().optional(),
  requestedReasoningEffort: z.string().optional(),
  requestedVariant: z.string().optional(),
  role: z.enum(['planning', 'implementation']),
  modelRole: z.enum(['orchestrator', 'worker', 'parent']).optional(),
  startedAt: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(['pending', 'completed', 'interrupted']),
  inputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  cachedInputTokens: z.number().int().nonnegative().safe().optional(),
  cacheWriteInputTokens: z.number().int().nonnegative().safe().optional(),
  reasoningOutputTokens: z.number().int().nonnegative().safe().optional(),
  totalCostUsd: z.number().nonnegative().finite().optional(),
  costMeasurementComplete: z.boolean().optional(),
  usageComplete: z.boolean(),
  usageEventRecorded: z.boolean().optional(),
}).strict()

export const GoalUsageLedgerSchema = z.object({
  // Earlier versions stored only attempt totals. Retain their contribution once,
  // while all newly admitted calls are journaled independently of attempts.
  legacyAttemptCount: z.number().int().nonnegative(),
  calls: z.array(GoalUsageCallSchema),
}).strict()

export type GoalUsageCall = z.infer<typeof GoalUsageCallSchema>
export type GoalUsageLedger = z.infer<typeof GoalUsageLedgerSchema>
export interface GoalUsageTotals { inputTokens: number; outputTokens: number; complete: boolean }
type AttemptUsage = { inputTokens?: number; outputTokens?: number }
type GoalUsageState = { attempts: AttemptUsage[]; usageLedger?: GoalUsageLedger }
const tokenCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export function reportedGoalUsage(result: { tokens?: TokenUsage; inputTokens?: number; outputTokens?: number }): GoalUsageTotals & { hasInput: boolean; hasOutput: boolean } {
  const usage = result.tokens
  const input = usage?.inputTokens ?? result.inputTokens
  const output = usage?.outputTokens ?? result.outputTokens
  const hasInput = tokenCount(input), hasOutput = tokenCount(output)
  return {
    inputTokens: hasInput ? input : 0, outputTokens: hasOutput ? output : 0, hasInput, hasOutput,
    complete: hasInput && hasOutput && usage?.measurementComplete !== false && !usage?.calls?.some(call => !call.usageAvailable),
  }
}

function sumUsage(entries: Array<AttemptUsage & { usageComplete?: boolean }>): GoalUsageTotals {
  return entries.reduce<GoalUsageTotals>((sum, entry) => ({
    inputTokens: sum.inputTokens + (tokenCount(entry.inputTokens) ? entry.inputTokens : 0),
    outputTokens: sum.outputTokens + (tokenCount(entry.outputTokens) ? entry.outputTokens : 0),
    complete: sum.complete && entry.usageComplete !== false && tokenCount(entry.inputTokens) && tokenCount(entry.outputTokens),
  }), { inputTokens: 0, outputTokens: 0, complete: true })
}

/** One durable call becomes one usage event. Numeric unknowns are lower bounds;
 * coverage flags keep consumers from treating them as measured zeroes. */
export function goalCallTokenUsage(call: GoalUsageCall): TokenUsage {
  const measurementComplete = call.status === 'completed' && call.usageComplete
  const modelCall: ModelCallUsage = {
    callId: call.id, role: call.modelRole ?? (call.role === 'planning' ? 'orchestrator' : 'parent'),
    provider: call.provider, requestedProvider: call.requestedProvider, requestedModel: call.requestedModel,
    requestedReasoningEffort: call.requestedReasoningEffort, requestedVariant: call.requestedVariant,
    actualModel: call.model, durationMs: call.durationMs ?? 0, usageAvailable: measurementComplete,
    inputTokens: call.inputTokens ?? 0, outputTokens: call.outputTokens ?? 0,
    cachedInputTokens: call.cachedInputTokens, cacheWriteInputTokens: call.cacheWriteInputTokens,
    reasoningOutputTokens: call.reasoningOutputTokens, totalCostUsd: call.totalCostUsd,
    costMeasurementComplete: call.costMeasurementComplete ?? false,
  }
  return { ...modelCall, model: call.model, measurementComplete, calls: [modelCall] }
}

/** Known totals are a lower bound whenever complete is false. */
export function goalTokenUsage(goal: GoalUsageState): GoalUsageTotals {
  if (!goal.usageLedger) return sumUsage(goal.attempts)
  const legacy = goal.attempts.slice(0, goal.usageLedger.legacyAttemptCount)
  return sumUsage([...legacy, ...goal.usageLedger.calls.map(call => ({ ...call, usageComplete: call.status === 'completed' && call.usageComplete }))])
}

export function goalAttemptUsage(ledger: GoalUsageLedger, attempt: number): GoalUsageTotals {
  return sumUsage(ledger.calls.filter(call => call.attempt === attempt).map(call => ({ ...call, usageComplete: call.status === 'completed' && call.usageComplete })))
}

export function goalBudgetProblem(goal: GoalUsageState & { tokenBudget?: number }, beforeCall = false): string | undefined {
  if (goal.tokenBudget === undefined) return undefined
  const usage = goalTokenUsage(goal)
  if (!usage.complete) return 'Token usage unknown; cannot safely start further budgeted work'
  const spent = usage.inputTokens + usage.outputTokens
  if (spent > goal.tokenBudget || (beforeCall && spent === goal.tokenBudget)) return 'Token budget exhausted; work and measured consumption retained'
  return undefined
}
