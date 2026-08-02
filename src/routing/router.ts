import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import type { Agent, RoutingStrategy, RoutingWorker } from '../retrofit/config.js'
import type { AgentContext, AgentResult, AgentRunner, CapturedAgentRun, RunnerOpts } from '../loop/runner.js'
import {
  buildWatchdogInvocation,
  makeRunner,
  runCapturedAgent,
  runnerInvocation,
} from '../loop/runner.js'
import type { ModelCallUsage, TokenUsage } from '../loop/reporter.js'
import { historyForWorkers, projectHash, recordRoutingObservation, storyHash } from './registry.js'

export interface RouteDecision {
  worker: 'SELF' | string
  reason: string
}

export interface AdaptiveRunnerOptions {
  parent: Agent
  parentSelection?: ModelSelection
  orchestratorSelection?: ModelSelection
  workers: RoutingWorker[]
  strategy: RoutingStrategy
  maxCandidates: number
  idleTimeoutMs?: number
  permissions?: PermissionProfile
  runnerOpts?: RunnerOpts
  isAvailable?: (agent: Agent) => boolean
  captureRoute?: (agent: Agent, ctx: AgentContext, prompt: string, selection: ModelSelection) => CapturedAgentRun
  makeWorker?: (agent: Agent, selection: ModelSelection) => AgentRunner
  now?: () => number
}

const costRank = { low: 0, medium: 1, high: 2 } as const

export function rankWorkers(workers: RoutingWorker[], strategy: RoutingStrategy, maxCandidates: number): RoutingWorker[] {
  const history = historyForWorkers(workers)
  const ranked = [...workers].sort((a, b) => {
    const ah = history.get(a.id)
    const bh = history.get(b.id)
    if (strategy === 'quality') {
      const aq = ah?.successRate ?? 0.5
      const bq = bh?.successRate ?? 0.5
      return bq - aq || costRank[b.costTier] - costRank[a.costTier] || a.id.localeCompare(b.id)
    }
    if (strategy === 'speed') {
      const ad = ah?.averageDurationMs ?? costRank[a.costTier] * 1_000_000
      const bd = bh?.averageDurationMs ?? costRank[b.costTier] * 1_000_000
      return ad - bd || costRank[a.costTier] - costRank[b.costTier] || a.id.localeCompare(b.id)
    }
    if (strategy === 'cost') return costRank[a.costTier] - costRank[b.costTier] || a.id.localeCompare(b.id)
    const as = (ah?.successRate ?? 0.75) * 10 - costRank[a.costTier]
    const bs = (bh?.successRate ?? 0.75) * 10 - costRank[b.costTier]
    return bs - as || a.id.localeCompare(b.id)
  })
  return ranked.slice(0, Math.max(1, maxCandidates))
}

export function buildRoutingPrompt(ctx: AgentContext, workers: RoutingWorker[], strategy: RoutingStrategy): string {
  const history = historyForWorkers(workers)
  const candidates = workers.map(worker => {
    const observed = history.get(worker.id)
    const evidence = observed
      ? `observed=${observed.successes}/${observed.runs} gate-verified avg=${observed.averageDurationMs}ms`
      : 'observed=unproven'
    return `- ${worker.id}: provider=${worker.agent}; cost=${worker.costTier}; capabilities=${worker.capabilities.join(',') || 'general'}; ${evidence}`
  })
  return [
    'You are Yoke\'s routing controller. Choose who should execute one bounded coding story.',
    'Do not inspect files, use tools, implement code, or explain your reasoning at length.',
    `Optimization strategy: ${strategy}. SELF is the strong parent and is appropriate when risk or ambiguity outweighs savings.`,
    '',
    `Story ${ctx.story.id}: ${ctx.story.title}`,
    'Acceptance criteria:',
    ...ctx.story.acceptance.map(item => `- ${item}`),
    '',
    'Allowed candidates:',
    '- SELF: strong parent; highest confidence; highest expected cost',
    ...candidates,
    '',
    'Return exactly one line and nothing else:',
    'YOKE_ROUTE {"worker":"SELF-or-candidate-id","reason":"max 100 characters"}',
  ].join('\n')
}

function allStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') { out.push(value); return }
  if (Array.isArray(value)) { for (const item of value) allStrings(item, out); return }
  if (value && typeof value === 'object') for (const item of Object.values(value as Record<string, unknown>)) allStrings(item, out)
}

export function parseRouteDecision(output: string, allowedWorkerIds: string[]): RouteDecision | null {
  const strings = [output]
  for (const line of output.split(/\r?\n/)) {
    try { allStrings(JSON.parse(line), strings) } catch { /* raw provider output is also searched */ }
  }
  const allowed = new Set(['SELF', ...allowedWorkerIds])
  for (const text of strings.reverse()) {
    const match = text.match(/YOKE_ROUTE\s*(\{[^\r\n]*\})/)
    if (!match) continue
    try {
      const value = JSON.parse(match[1]) as { worker?: unknown; reason?: unknown }
      if (typeof value.worker !== 'string' || !allowed.has(value.worker)) continue
      return {
        worker: value.worker,
        reason: typeof value.reason === 'string' ? value.reason.slice(0, 100) : 'selected by orchestrator',
      }
    } catch { /* try an earlier provider string */ }
  }
  return null
}

function callUsage(role: ModelCallUsage['role'], provider: Agent, selection: ModelSelection, tokens: TokenUsage | undefined, durationMs: number, profile?: string): ModelCallUsage {
  return {
    role,
    provider,
    ...(profile ? { profile } : {}),
    ...(selection.model ? { requestedModel: selection.model } : {}),
    ...(selection.reasoningEffort ? { requestedReasoningEffort: selection.reasoningEffort } : {}),
    ...(tokens?.model ? { actualModel: tokens.model } : {}),
    inputTokens: tokens?.inputTokens ?? 0,
    ...(tokens?.cachedInputTokens !== undefined ? { cachedInputTokens: tokens.cachedInputTokens } : {}),
    ...(tokens?.cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens: tokens.cacheWriteInputTokens } : {}),
    outputTokens: tokens?.outputTokens ?? 0,
    ...(tokens?.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: tokens.reasoningOutputTokens } : {}),
    ...(tokens?.totalCostUsd !== undefined ? { totalCostUsd: tokens.totalCostUsd } : {}),
    durationMs,
  }
}

export function makeAdaptiveRunner(options: AdaptiveRunnerOptions): AgentRunner {
  const now = options.now ?? Date.now
  const available = options.isAvailable ?? (() => true)
  const eligibleWorkers = options.workers.filter(worker => available(worker.agent))
  const makeWorker = options.makeWorker ?? ((agent, selection) => makeRunner(agent, options.idleTimeoutMs ?? 0, {
    ...options.runnerOpts,
    permissions: options.permissions ?? 'safe',
    selection,
  }))

  return (ctx): AgentResult => {
    // Re-rank per story so a long-running loop can use gate outcomes learned by
    // earlier stories without rebuilding the runner.
    const candidates = rankWorkers(eligibleWorkers, options.strategy, options.maxCandidates)
    if (candidates.length === 0) {
      return makeWorker(options.parent, options.parentSelection ?? {})(ctx)
    }

    const prompt = buildRoutingPrompt(ctx, candidates, options.strategy)
    const orchestratorSelection = { ...(options.parentSelection ?? {}), ...(options.orchestratorSelection ?? {}), nativeMultiAgent: false }
    const orchestratorStarted = now()
    const routeRun = options.captureRoute
      ? options.captureRoute(options.parent, ctx, prompt, orchestratorSelection)
      : runCapturedAgent(
          options.parent,
          buildWatchdogInvocation(
            runnerInvocation(options.parent, prompt, ctx.targetDir, true, 'read-only', orchestratorSelection),
            options.idleTimeoutMs ?? 0,
          ),
        )
    const orchestratorDurationMs = Math.max(0, now() - orchestratorStarted)
    const decision = routeRun.success ? parseRouteDecision(routeRun.output, candidates.map(worker => worker.id)) : null
    const selected = decision?.worker ?? 'SELF'
    const worker = selected === 'SELF' ? undefined : candidates.find(candidate => candidate.id === selected)
    const provider = worker?.agent ?? options.parent
    const selection: ModelSelection = worker
      ? { model: worker.model, reasoningEffort: worker.reasoningEffort, nativeMultiAgent: false, bare: options.parentSelection?.bare }
      : { ...(options.parentSelection ?? {}), nativeMultiAgent: false }

    const workerStarted = now()
    const result = makeWorker(provider, selection)(ctx)
    const workerDurationMs = Math.max(0, now() - workerStarted)
    const calls = [
      callUsage('orchestrator', options.parent, orchestratorSelection, routeRun.tokens, orchestratorDurationMs),
      callUsage(worker ? 'worker' : 'parent', provider, selection, result.tokens, workerDurationMs, selected),
    ]
    const tokens: TokenUsage = {
      inputTokens: (routeRun.tokens?.inputTokens ?? 0) + (result.tokens?.inputTokens ?? 0),
      ...((routeRun.tokens?.cachedInputTokens !== undefined || result.tokens?.cachedInputTokens !== undefined)
        ? { cachedInputTokens: (routeRun.tokens?.cachedInputTokens ?? 0) + (result.tokens?.cachedInputTokens ?? 0) }
        : {}),
      ...((routeRun.tokens?.cacheWriteInputTokens !== undefined || result.tokens?.cacheWriteInputTokens !== undefined)
        ? { cacheWriteInputTokens: (routeRun.tokens?.cacheWriteInputTokens ?? 0) + (result.tokens?.cacheWriteInputTokens ?? 0) }
        : {}),
      outputTokens: (routeRun.tokens?.outputTokens ?? 0) + (result.tokens?.outputTokens ?? 0),
      ...((routeRun.tokens?.reasoningOutputTokens !== undefined || result.tokens?.reasoningOutputTokens !== undefined)
        ? { reasoningOutputTokens: (routeRun.tokens?.reasoningOutputTokens ?? 0) + (result.tokens?.reasoningOutputTokens ?? 0) }
        : {}),
      ...((routeRun.tokens?.totalCostUsd !== undefined || result.tokens?.totalCostUsd !== undefined)
        ? { totalCostUsd: (routeRun.tokens?.totalCostUsd ?? 0) + (result.tokens?.totalCostUsd ?? 0) }
        : {}),
      ...(result.tokens?.model ? { model: result.tokens.model } : routeRun.tokens?.model ? { model: routeRun.tokens.model } : {}),
      calls,
    }

    let recorded = false
    const recordOutcome = (verificationSuccess: boolean): void => {
      if (recorded) return
      recorded = true
      const project = projectHash(ctx.targetDir)
      recordRoutingObservation({
        projectHash: project,
        storyHash: storyHash(project, ctx.story.id),
        strategy: options.strategy,
        selected,
        provider,
        ...(selection.model ? { requestedModel: selection.model } : {}),
        ...(selection.reasoningEffort ? { requestedReasoningEffort: selection.reasoningEffort } : {}),
        ...(result.tokens?.model ? { actualModel: result.tokens.model } : {}),
        orchestratorProvider: options.parent,
        ...(orchestratorSelection.model ? { orchestratorModel: orchestratorSelection.model } : {}),
        orchestratorDurationMs,
        workerDurationMs,
        processSuccess: result.success,
        verificationSuccess,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
      })
    }

    const routeSummary = decision
      ? `route=${selected} (${decision.reason})`
      : `route=SELF (${routeRun.success ? 'invalid routing response' : 'orchestrator failed'})`
    return { ...result, summary: `${routeSummary}; ${result.summary}`, tokens, routing: { recordOutcome } }
  }
}
