import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import type { Agent, RoutingRule, RoutingStrategy, RoutingWorker } from '../retrofit/config.js'
import type { AgentContext, AgentResult, AgentRunner, CapturedAgentRun, RunnerOpts } from '../loop/runner.js'
import {
  buildWatchdogInvocation,
  makeRunner,
  runCapturedAgent,
  runnerInvocation,
  contextBlockFor,
} from '../loop/runner.js'
import type { ModelCallUsage, TokenUsage } from '../loop/reporter.js'
import { isAcceptanceCriterion, criterionCommandProblem } from '../loop/prd.js'
import { historyForWorkers, projectHash, readRoutingObservations, recordRoutingObservation, storyHash } from './registry.js'
import { assessmentInstructions, parseAssessment, tiers, type CapabilityTier } from './assessment.js'
import { chooseCapability, readAssessment, saveAssessment, routingAssessmentKey, knownInfrastructureFailure } from './capability.js'
import { readPlanningFile } from './contracts.js'

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
  maxAttempts?: number
  planner?: { agent: Agent; selection: ModelSelection }
  assessmentPolicy?: 'on-demand' | 'prepared'
  fallback?: 'parent' | 'block'
  maxTier?: CapabilityTier
  onDecision?: (storyId: string, decision: { profile: string; provider: Agent; model?: string; reasoningEffort?: string; reason: string; next: string; assessment?: import('./assessment.js').TaskAssessment }) => void
  rules?: RoutingRule[]
  idleTimeoutMs?: number
  permissions?: PermissionProfile
  runnerOpts?: RunnerOpts
  isAvailable?: (agent: Agent) => boolean
  captureRoute?: (agent: Agent, ctx: AgentContext, prompt: string, selection: ModelSelection) => CapturedAgentRun
  makeWorker?: (agent: Agent, selection: ModelSelection) => AgentRunner
  now?: () => number
  /** Stable project identity when execution occurs in disposable worktrees. */
  projectRoot?: string
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
    ...ctx.story.acceptance.map(item => isAcceptanceCriterion(item)
      ? `- [${item.id}] ${item.text} (proof: ${item.verify.join(' && ')})`
      : `- ${item}`),
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
    usageAvailable: tokens !== undefined && tokens.measurementComplete !== false,
    ...(tokens?.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: tokens.reasoningOutputTokens } : {}),
    ...(tokens?.totalCostUsd !== undefined ? { totalCostUsd: tokens.totalCostUsd } : {}),
    durationMs,
  }
}

export interface AsyncAdaptiveRunnerOptions extends Omit<AdaptiveRunnerOptions, 'makeWorker' | 'captureRoute'> {
  makeWorker: (agent: Agent, selection: ModelSelection) => (ctx: AgentContext) => Promise<AgentResult>
  captureRoute: (agent: Agent, ctx: AgentContext, prompt: string, selection: ModelSelection) => Promise<CapturedAgentRun>
}

export function makeAdaptiveRunner(options: AdaptiveRunnerOptions): AgentRunner {
  const run = routingSteps(options)
  return ctx => {
    const steps = run(ctx)
    let next = steps.next()
    while (!next.done) next = steps.next(next.value() as CapturedAgentRun & AgentResult)
    return next.value
  }
}

export function makeAsyncAdaptiveRunner(options: AsyncAdaptiveRunnerOptions): (ctx: AgentContext) => Promise<AgentResult> {
  const run = routingSteps(options)
  return async ctx => {
    const steps = run(ctx)
    let next = steps.next()
    while (!next.done) next = steps.next(await next.value() as CapturedAgentRun & AgentResult)
    return next.value
  }
}

function routingSteps(options: AdaptiveRunnerOptions | AsyncAdaptiveRunnerOptions) {
  const now = options.now ?? Date.now
  const available = options.isAvailable ?? (() => true)
  const eligibleWorkers = options.workers.filter(worker => available(worker.agent))
  const failedStories = new Set<string>()
  const makeWorker = options.makeWorker ?? ((agent, selection) => makeRunner(agent, options.idleTimeoutMs ?? 0, {
    ...options.runnerOpts,
    permissions: options.permissions ?? 'safe',
    selection,
  }))

  return function* (ctx: AgentContext): Generator<() => CapturedAgentRun | AgentResult | Promise<CapturedAgentRun | AgentResult>, AgentResult, CapturedAgentRun & AgentResult> {
    const blocked = (summary: string): AgentResult => ({ success: false, summary, routing: { blocked: true, recordOutcome: () => undefined } })
    if (options.strategy === 'capability' && options.assessmentPolicy === 'prepared') {
      try {
        const criteria = ctx.story.acceptance
        if (criteria.length < 2 || criteria.length > 5 || criteria.some(c => !isAcceptanceCriterion(c) || criterionCommandProblem(c))) return blocked('Prepared routing requires 2-5 executable acceptance criteria')
        if (!readAssessment(options.projectRoot ?? ctx.targetDir, ctx.story, true)) return blocked('Task assessment is missing or stale. Run yoke prd assess before execution.')
      } catch (error) { return blocked(`Cannot read prepared assessment: ${(error as Error).message}`) }
    }
    if (options.strategy === 'capability' && !options.rules?.some(rule => (!rule.area || rule.area === ctx.story.area) && (!rule.storyId || rule.storyId === ctx.story.id))) {
      const root = options.projectRoot ?? ctx.targetDir
      let assessment
      try { assessment = readAssessment(root, ctx.story, options.assessmentPolicy === 'prepared') }
      catch (error) { return blocked(`Cannot read assessment: ${(error as Error).message}`) }
      let planning: CapturedAgentRun | undefined
      const calls: ModelCallUsage[] = []
      if (!assessment) {
        const inputKey = routingAssessmentKey(root, ctx.story)
        const prompt = [assessmentInstructions, 'Use the supplied task contract and project context to produce a bounded plan. Do not implement or change files.',
          'Approved planning brief:', readPlanningFile(root, '.yoke/plan.md', 80_000) ?? '',
          contextBlockFor(ctx.targetDir, ctx.story), JSON.stringify(ctx.story), 'Return exactly one line: YOKE_ASSESS {"taskClass":"implementation","difficulty":"medium","uncertainty":"low","risk":"low","scope":"low","testability":"high","reason":"evidence","approach":"steps and tests"}'].join('\n')
        const planner = options.planner?.agent ?? options.parent
        if (!available(planner)) return blocked('Configured planning provider is unavailable')
        const selection = { ...(options.planner?.selection ?? options.parentSelection), nativeMultiAgent: false }
        const started = now()
        planning = yield () => options.captureRoute ? options.captureRoute(planner, ctx, prompt, selection)
          : runCapturedAgent(planner, buildWatchdogInvocation(runnerInvocation(planner, prompt, ctx.targetDir, true, 'read-only', selection), options.idleTimeoutMs ?? 0))
        calls.push(callUsage('orchestrator', planner, selection, planning.tokens, now() - started))
        if (routingAssessmentKey(root, ctx.story) !== inputKey) return { ...blocked('Planning inputs changed during assessment; retry planning with the current contract'), tokens: aggregateCalls(calls) }
        assessment = planning.success ? parseAssessment(planning.output) : undefined
        if (assessment) saveAssessment(root, ctx.story, assessment, { provider: planner, model: planning.tokens?.model ?? selection.model })
      }
      if (!assessment) return { success: false, summary: 'Routing assessment unavailable or invalid; implementation was not started', tokens: aggregateCalls(calls), routing: { recordOutcome: () => undefined, blocked: true } }
      const choice = chooseCapability({ root, story: ctx.story, assessment, workers: eligibleWorkers, parent: options.parent, parentSelection: options.parentSelection, maxAttempts: options.maxAttempts, fallback: options.fallback, maxTier: options.maxTier })
      options.onDecision?.(ctx.story.id, { profile: choice.worker?.id ?? 'SELF', provider: choice.provider, model: choice.selection.model, reasoningEffort: choice.selection.reasoningEffort, reason: choice.reason, next: choice.next, assessment })
      if (choice.blocked) return { ...blocked(choice.reason), tokens: aggregateCalls(calls) }
      if (choice.exhausted) return { success: false, summary: 'Routing attempt budget exhausted; replan this task before retrying', tokens: aggregateCalls(calls), routing: { recordOutcome: () => undefined, blocked: true } }
      const started = now()
      const result = yield () => makeWorker(choice.provider, choice.selection)({ ...ctx, attempt: choice.failures + 1, story: { ...ctx.story, assessment } })
      calls.push(callUsage(choice.worker ? 'worker' : 'parent', choice.provider, choice.selection, result.tokens, now() - started, choice.worker?.id ?? 'SELF'))
      let recorded = false
      const infrastructureFailure = result.infrastructureFailure || (!result.success && knownInfrastructureFailure(result.summary))
      return { ...result, summary: `route=${choice.worker?.id ?? 'SELF'} (${choice.reason}); ${result.summary}`,
        ...(infrastructureFailure ? { success: false, infrastructureFailure: true } : {}),
        tokens: { ...aggregateCalls(calls), storyId: ctx.story.id, escalated: choice.failures > 1 },
        routing: { blocked: infrastructureFailure || undefined, canRetry: !infrastructureFailure && choice.failures + 1 < (options.maxAttempts ?? 5), recordOutcome: (verified, failureKind) => {
          if (recorded) return
          recorded = true
          recordRoutingObservation({ projectHash: projectHash(root), storyHash: storyHash(projectHash(root), ctx.story.id), assessmentKey: routingAssessmentKey(root, ctx.story), taskClass: assessment!.taskClass, requiredTier: choice.requiredTier,
            role: 'implementation', strategy: 'capability', selected: choice.worker?.id ?? 'SELF', provider: choice.provider, requestedModel: choice.selection.model, requestedReasoningEffort: choice.selection.reasoningEffort,
            actualModel: result.tokens?.model, orchestratorProvider: options.planner?.agent ?? options.parent, orchestratorModel: (options.planner?.selection ?? options.parentSelection)?.model, orchestratorDurationMs: calls.filter(c => c.role === 'orchestrator').reduce((s,c) => s+c.durationMs,0), workerDurationMs: calls[calls.length-1].durationMs,
            processSuccess: result.success, verificationSuccess: infrastructureFailure ? false : verified, failureKind: infrastructureFailure ? 'infrastructure' : failureKind ?? 'implementation', usageAvailable: result.tokens !== undefined && result.tokens.measurementComplete !== false,
            inputTokens: result.tokens?.inputTokens ?? 0, outputTokens: result.tokens?.outputTokens ?? 0, totalCostUsd: result.tokens?.totalCostUsd })
        } } }
    }
    // Re-rank per story so a long-running loop can use gate outcomes learned by
    // earlier stories without rebuilding the runner.
    const rule = options.rules?.find(rule => (!rule.area || rule.area === ctx.story.area) && (!rule.storyId || rule.storyId === ctx.story.id) && (rule.area || rule.storyId))
    if (rule) {
      const project = projectHash(options.projectRoot ?? ctx.targetDir)
      const prior = readRoutingObservations().reverse().find(event => event.projectHash === project && event.storyHash === storyHash(project, ctx.story.id) && typeof event.verificationSuccess === 'boolean')
      if (prior?.verificationSuccess === false) failedStories.add(ctx.story.id)
    }
    const ruleWorker = rule && failedStories.has(ctx.story.id) ? rule.escalateTo ?? 'SELF' : rule?.worker
    const candidates = rule ? eligibleWorkers : rankWorkers(eligibleWorkers, options.strategy, options.maxCandidates)
    if (candidates.length === 0) {
      if (options.fallback === 'block' || options.maxTier) return blocked('No eligible routing profiles; parent fallback is disabled')
      return yield () => makeWorker(options.parent, options.parentSelection ?? {})(ctx)
    }

    const prompt = buildRoutingPrompt(ctx, candidates, options.strategy)
    const orchestratorSelection = { ...(options.parentSelection ?? {}), ...(options.orchestratorSelection ?? {}), nativeMultiAgent: false }
    const orchestratorStarted = now()
    const routeRun: CapturedAgentRun = rule ? { success: true, summary: 'Explicit rule', output: '', tokens: { inputTokens: 0, outputTokens: 0 } } : yield () => options.captureRoute
      ? options.captureRoute(options.parent, ctx, prompt, orchestratorSelection)
      : runCapturedAgent(
          options.parent,
          buildWatchdogInvocation(
            runnerInvocation(options.parent, prompt, ctx.targetDir, true, 'read-only', orchestratorSelection),
            options.idleTimeoutMs ?? 0,
          ),
        )
    const orchestratorDurationMs = Math.max(0, now() - orchestratorStarted)
    const decision = rule
      ? { worker: ruleWorker === 'SELF' || candidates.some(w => w.id === ruleWorker) ? ruleWorker! : 'SELF', reason: failedStories.has(ctx.story.id) ? 'gate failure escalated by project rule' : 'explicit project routing rule' }
      : routeRun.success ? parseRouteDecision(routeRun.output, candidates.map(worker => worker.id)) : null
    const selected = decision?.worker ?? 'SELF'
    const worker = selected === 'SELF' ? undefined : candidates.find(candidate => candidate.id === selected)
    if ((!worker && (options.fallback === 'block' || options.maxTier)) || (options.maxTier && (!worker?.tier || tiers.indexOf(worker.tier) > tiers.indexOf(options.maxTier)))) return blocked('Selected routing profile exceeds configured limits; execution blocked')
    const provider = worker?.agent ?? options.parent
    const selection: ModelSelection = worker
      ? { model: worker.model, reasoningEffort: worker.reasoningEffort, nativeMultiAgent: false, ...(provider !== 'gemini' ? { bare: options.parentSelection?.bare } : {}) }
      : { ...(options.parentSelection ?? {}), nativeMultiAgent: false }

    const workerStarted = now()
    const result = yield () => makeWorker(provider, selection)(ctx)
    const workerDurationMs = Math.max(0, now() - workerStarted)
    const calls = [
      ...(!rule ? [callUsage('orchestrator', options.parent, orchestratorSelection, routeRun.tokens, orchestratorDurationMs)] : []),
      callUsage(worker ? 'worker' : 'parent', provider, selection, result.tokens, workerDurationMs, selected),
    ]
    const tokens: TokenUsage = {
      storyId: ctx.story.id,
      escalated: Boolean(rule && failedStories.has(ctx.story.id)),
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
      measurementComplete: calls.every(call => call.usageAvailable),
      costMeasurementComplete: calls.every(call => call.totalCostUsd !== undefined),
    }

    let recorded = false
    const recordOutcome = (verificationSuccess: boolean): void => {
      if (recorded) return
      recorded = true
      if (!verificationSuccess) failedStories.add(ctx.story.id)
      else failedStories.delete(ctx.story.id)
      const project = projectHash(options.projectRoot ?? ctx.targetDir)
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

function aggregateCalls(calls: ModelCallUsage[]): TokenUsage {
  return { inputTokens: calls.reduce((n,c) => n+c.inputTokens,0), outputTokens: calls.reduce((n,c) => n+c.outputTokens,0),
    cachedInputTokens: calls.reduce((n,c) => n+(c.cachedInputTokens ?? 0),0), cacheWriteInputTokens: calls.reduce((n,c) => n+(c.cacheWriteInputTokens ?? 0),0),
    ...(calls.some(c => c.totalCostUsd !== undefined) ? { totalCostUsd: calls.reduce((n,c) => n+(c.totalCostUsd ?? 0),0) } : {}),
    calls, measurementComplete: calls.every(c => c.usageAvailable), costMeasurementComplete: calls.every(c => c.totalCostUsd !== undefined) }
}
