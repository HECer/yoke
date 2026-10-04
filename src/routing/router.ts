import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import { randomUUID } from 'node:crypto'
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
import { finishRoutingAttempt, markRoutingAttemptUsageIncomplete, readRoutingAttempts, recordRoutingAttemptUsage, reserveRoutingAttempt, routingEpisodeSummary, type RoutingAttemptReservation } from './attempts.js'
import { assessmentSignature } from './optimization.js'

export interface RouteDecision {
  worker: 'SELF' | string
  reason: string
}

export interface RoutingCallRequest {
  callId: string; storyId: string; role: ModelCallUsage['role']; provider: Agent; selection: ModelSelection
}
export interface RoutingCallUsage extends RoutingCallRequest { durationMs: number; usage: TokenUsage }

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
  contractKind?: 'prd' | 'goal'
  optimization?: { version: 1; objective: 'cost' | 'speed' | 'balanced'; minSamples?: number }
  accountingScope?: 'execution-attempt'
  executionPolicyKey?: string
  admitCall?: (request: RoutingCallRequest) => string | undefined
  onCallUsage?: (event: RoutingCallUsage) => void
  fallback?: 'parent' | 'block'
  maxTier?: CapabilityTier
  onDecision?: (storyId: string, decision: { profile: string; provider: Agent; model?: string; reasoningEffort?: string; variant?: string; providerModel?: string; reason: string; next: string; assessment?: import('./assessment.js').TaskAssessment }) => void
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

export function buildAssessmentPrompt(root: string, ctx: AgentContext): string {
  return [assessmentInstructions, 'Use the supplied task contract and project context to produce a bounded plan. Do not implement or change files.',
    'Approved planning brief:', readPlanningFile(root, '.yoke/plan.md', 80_000) ?? '',
    contextBlockFor(ctx.targetDir, ctx.story), JSON.stringify(ctx.story), 'Return exactly one line: YOKE_ASSESS {"taskClass":"implementation","difficulty":"medium","uncertainty":"low","risk":"low","scope":"low","testability":"high","reason":"evidence","approach":"steps and tests"}'].join('\n')
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
    ...(selection.provider ? { requestedProvider: selection.provider } : {}),
    ...(selection.model ? { requestedModel: selection.model } : {}),
    ...(selection.reasoningEffort ? { requestedReasoningEffort: selection.reasoningEffort } : {}),
    ...(selection.variant ? { requestedVariant: selection.variant } : {}),
    ...(tokens?.model ? { actualModel: tokens.model } : {}),
    usageMissingFields: tokens?.usageMissingFields ?? (!tokens ? ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens', 'totalCostUsd'] : []),
    ...(tokens?.usagePartialFields ? { usagePartialFields: tokens.usagePartialFields } : {}),
    inputTokens: tokens?.inputTokens ?? 0,
    ...(tokens?.cachedInputTokens !== undefined ? { cachedInputTokens: tokens.cachedInputTokens } : {}),
    ...(tokens?.cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens: tokens.cacheWriteInputTokens } : {}),
    outputTokens: tokens?.outputTokens ?? 0,
    usageAvailable: tokens !== undefined && tokens.measurementComplete !== false,
    ...(tokens?.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: tokens.reasoningOutputTokens } : {}),
    ...(tokens?.totalCostUsd !== undefined ? { totalCostUsd: tokens.totalCostUsd } : {}),
    costMeasurementComplete: tokens?.totalCostUsd !== undefined && tokens.costMeasurementComplete !== false,
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
    while (!next.done) {
      let result: CapturedAgentRun & AgentResult
      try { result = next.value() as CapturedAgentRun & AgentResult }
      catch (error) { next = steps.throw(error); continue }
      next = steps.next(result)
    }
    return next.value
  }
}

export function makeAsyncAdaptiveRunner(options: AsyncAdaptiveRunnerOptions): (ctx: AgentContext) => Promise<AgentResult> {
  const run = routingSteps(options)
  return async ctx => {
    const steps = run(ctx)
    let next = steps.next()
    while (!next.done) {
      let result: CapturedAgentRun & AgentResult
      try { result = await next.value() as CapturedAgentRun & AgentResult }
      catch (error) { next = steps.throw(error); continue }
      next = steps.next(result)
    }
    return next.value
  }
}

function routingSteps(options: AdaptiveRunnerOptions | AsyncAdaptiveRunnerOptions) {
  const now = options.now ?? Date.now
  const available = options.isAvailable ?? (() => true)
  const eligibleWorkers = options.workers.filter(worker => available(worker.agent))
  const failedStories = new Set<string>()
  const makeWorker = options.makeWorker ?? ((agent, selection) => makeRunner(agent, options.idleTimeoutMs ?? 0, {
    ...options.runnerOpts, permissions: options.permissions ?? 'safe', selection,
  }))
  type RunValue = CapturedAgentRun & AgentResult
  type Work = () => CapturedAgentRun | AgentResult | Promise<CapturedAgentRun | AgentResult>
  type Step = Generator<Work, { result?: RunValue; blocked?: string }, RunValue>

  return function* (ctx: AgentContext): Generator<Work, AgentResult, RunValue> {
    const root = options.projectRoot ?? ctx.targetDir
    const calls: ModelCallUsage[] = []
    let reservation: RoutingAttemptReservation | undefined
    const routeStartedAt = new Date().toISOString()
    const blocked = (summary: string): AgentResult => ({ success: false, summary,
      ...(calls.length ? { tokens: { ...aggregateCalls(calls), storyId: ctx.story.id, ...(reservation ? { routingAttemptId: reservation.id } : {}) } } : {}),
      routing: { blocked: true, recordOutcome: () => undefined },
    })
    function* perform(role: ModelCallUsage['role'], provider: Agent, selection: ModelSelection, work: Work, profile?: string, beforeInvoke?: () => void): Step {
      const request: RoutingCallRequest = { callId: randomUUID(), storyId: ctx.story.id, role, provider, selection: { ...selection } }
      try {
        if (!available(provider)) return { blocked: `Configured ${role} provider is unavailable` }
        const refusal = options.admitCall?.(request)
        if (refusal) return { blocked: refusal }
        beforeInvoke?.()
      } catch (error) { return { blocked: `Call admission failed: ${(error as Error).message}` } }
      const started = now()
      let result: RunValue
      try { result = yield work }
      catch (error) {
        const reported = error && typeof error === 'object' ? (error as { tokens?: TokenUsage }).tokens : undefined
        result = { success: false, infrastructureFailure: true, summary: (error as Error)?.message ?? String(error), output: '', ...(reported ? { tokens: reported } : {}) }
      }
      const durationMs = Math.max(0, now() - started)
      const callId = result.tokens?.callId ?? (result.tokens?.calls?.length === 1 ? result.tokens.calls[0].callId : undefined) ?? request.callId
      const call = { ...callUsage(role, provider, selection, result.tokens, durationMs, profile), callId,
        ...(reservation ? { routingAttemptId: reservation.id } : {}) }
      calls.push(call)
      const usage: TokenUsage = { ...aggregateCalls([call]), callId, storyId: ctx.story.id,
        ...(reservation ? { routingAttemptId: reservation.id } : {}) }
      let accountingError: unknown
      try {
        // Earlier planning calls acquire the same execution identity once a worker
        // has actually been admitted. Stable call IDs make reporter joins idempotent.
        if (reservation) recordRoutingAttemptUsage(root, reservation.id, { ...aggregateCalls(calls), routingAttemptId: reservation.id })
      } catch (error) { accountingError = error }
      // A failed optional join must never suppress delivery of already paid
      // usage to the caller's own durable budget account.
      try { options.onCallUsage?.({ ...request, callId, durationMs, usage }) }
      catch (error) { accountingError ??= error }
      if (accountingError) {
        if (reservation) {
          try { markRoutingAttemptUsageIncomplete(root, reservation.id) } catch { /* unreadable state cannot provide a complete sample */ }
          try { finishRoutingAttempt(root, reservation, { verificationSuccess: false, failureKind: 'infrastructure', actualModel: result.tokens?.model }) } catch { /* reservation remains charged and unresolved */ }
        }
        return { blocked: `Call accounting failed: ${(accountingError as Error).message}` }
      }
      return { result }
    }
    const capture = (provider: Agent, prompt: string, selection: ModelSelection): Work => () => options.captureRoute
      ? options.captureRoute(provider, ctx, prompt, selection)
      : runCapturedAgent(provider, buildWatchdogInvocation(runnerInvocation(provider, prompt, ctx.targetDir, true, 'read-only', selection), options.idleTimeoutMs ?? 0))
    const reserveWorker = (provider: Agent, selection: ModelSelection, profile: string, limit: number) => {
      reservation = reserveRoutingAttempt({ root, storyId: ctx.story.id, contractKey: routingAssessmentKey(root, ctx.story), limit,
        provider, profile, selection, startedAt: routeStartedAt, accountingScope: options.accountingScope,
        executionPolicyKey: options.executionPolicyKey })
    }
    if (options.strategy === 'capability' && options.assessmentPolicy === 'prepared') {
      try {
        const criteria = ctx.story.acceptance, goal = options.contractKind === 'goal'
        if (criteria.length < (goal ? 1 : 2) || (!goal && criteria.length > 5) || criteria.some(c => !isAcceptanceCriterion(c) || (!goal && criterionCommandProblem(c)) || (goal && (!c.verify.length || c.verify.some(command => !command.trim()))))) return blocked(goal ? 'Prepared goal routing requires bound executable acceptance criteria' : 'Prepared routing requires 2-5 executable acceptance criteria')
        if (!readAssessment(root, ctx.story, true)) return blocked(`Task assessment is missing or stale. Run yoke ${goal ? 'goal' : 'prd'} assess before execution.`)
      } catch (error) { return blocked(`Cannot read prepared assessment: ${(error as Error).message}`) }
    }
    if (options.strategy === 'capability' && !options.rules?.some(rule => (!rule.area || rule.area === ctx.story.area) && (!rule.storyId || rule.storyId === ctx.story.id))) {
      let assessment
      try { assessment = readAssessment(root, ctx.story, options.assessmentPolicy === 'prepared') }
      catch (error) { return blocked(`Cannot read assessment: ${(error as Error).message}`) }
      if (!assessment) {
        const planner = options.planner?.agent ?? options.parent
        const selection = { ...(options.planner?.selection ?? options.parentSelection), nativeMultiAgent: false }
        let inputKey: string, prompt: string
        try { inputKey = routingAssessmentKey(root, ctx.story); prompt = buildAssessmentPrompt(root, ctx) }
        catch (error) { return blocked(`Cannot prepare assessment: ${(error as Error).message}`) }
        const planningCall = yield* perform('orchestrator', planner, selection, capture(planner, prompt, selection))
        if (planningCall.blocked) return blocked(planningCall.blocked)
        const planning = planningCall.result!
        try {
          if (routingAssessmentKey(root, ctx.story) !== inputKey) return blocked('Planning inputs changed during assessment; retry planning with the current contract')
          assessment = planning.success ? parseAssessment(planning.output) : undefined
          if (assessment) saveAssessment(root, ctx.story, assessment, { provider: planner, model: planning.tokens?.model ?? selection.model })
        } catch (error) { return blocked(`Cannot persist current assessment: ${(error as Error).message}`) }
      }
      if (!assessment) return blocked('Routing assessment unavailable or invalid; implementation was not started')
      let choice: ReturnType<typeof chooseCapability>
      try {
        choice = chooseCapability({ root, story: ctx.story, assessment, workers: eligibleWorkers, parent: options.parent, parentSelection: options.parentSelection,
          maxAttempts: options.maxAttempts, fallback: options.fallback, maxTier: options.maxTier,
          optimization: options.optimization, executionPolicyKey: options.executionPolicyKey })
      } catch (error) { return blocked(`Cannot admit routing attempt: ${(error as Error).message}`) }
      options.onDecision?.(ctx.story.id, { profile: choice.worker?.id ?? 'SELF', provider: choice.provider, model: choice.selection.model, reasoningEffort: choice.selection.reasoningEffort, variant: choice.selection.variant, providerModel: choice.selection.provider, reason: choice.reason, next: choice.next, assessment })
      if (choice.blocked) return blocked(choice.reason)
      if (choice.exhausted) return blocked('Routing attempt budget exhausted; replan this task before retrying')
      let runner: ReturnType<typeof makeWorker>
      const implementation = yield* perform(choice.worker ? 'worker' : 'parent', choice.provider, choice.selection,
        () => runner({ ...ctx, attempt: reservation!.ordinal, story: { ...ctx.story, assessment } }), choice.worker?.id ?? 'SELF',
        () => { runner = makeWorker(choice.provider, choice.selection); reserveWorker(choice.provider, choice.selection, choice.worker?.id ?? 'SELF', choice.attemptLimit) })
      if (implementation.blocked) return blocked(implementation.blocked)
      const result = implementation.result!
      let recorded = false
      const infrastructureFailure = result.infrastructureFailure || (!result.success && knownInfrastructureFailure(result.summary))
      const recordOutcome = (verified: boolean, failureKind?: 'implementation' | 'infrastructure'): void => {
        if (recorded) return
        const kind = infrastructureFailure ? 'infrastructure' : failureKind ?? 'implementation'
        const measured = finishRoutingAttempt(root, reservation!, { verificationSuccess: infrastructureFailure ? false : verified, failureKind: kind, actualModel: result.tokens?.model })
        const episode = routingEpisodeSummary(root, reservation!)
        recorded = true
        recordRoutingObservation({ projectHash: projectHash(root), storyHash: storyHash(projectHash(root), ctx.story.id), assessmentKey: reservation!.contractKey, taskClass: assessment!.taskClass, requiredTier: choice.requiredTier,
          role: 'implementation', strategy: 'capability', selected: choice.worker?.id ?? 'SELF', provider: choice.provider,
          requestedProvider: choice.selection.provider, requestedModel: choice.selection.model, requestedReasoningEffort: choice.selection.reasoningEffort, requestedVariant: choice.selection.variant,
          actualModel: result.tokens?.model, orchestratorProvider: options.planner?.agent ?? options.parent, orchestratorModel: (options.planner?.selection ?? options.parentSelection)?.model,
          orchestratorDurationMs: calls.filter(c => c.role === 'orchestrator').reduce((sum, call) => sum + call.durationMs, 0), workerDurationMs: calls.at(-1)!.durationMs,
          processSuccess: result.success, verificationSuccess: infrastructureFailure ? false : verified, failureKind: kind,
          usageAvailable: measured.usageComplete, inputTokens: measured.inputTokens, outputTokens: measured.outputTokens,
          totalCostUsd: measured.totalCostUsd, costMeasurementComplete: measured.costComplete, accountingScope: measured.accountingScope,
          totalDurationMs: measured.durationMs, executionPolicyKey: options.executionPolicyKey,
          economicEpisode: { ...episode, assessmentSignature: assessmentSignature(assessment!) },
        })
      }
      if (infrastructureFailure) recordOutcome(false, 'infrastructure')
      return { ...result, summary: `route=${choice.worker?.id ?? 'SELF'} (${choice.reason}); ${result.summary}`,
        ...(infrastructureFailure ? { success: false, infrastructureFailure: true } : {}),
        tokens: { ...aggregateCalls(calls), storyId: ctx.story.id, routingAttemptId: reservation!.id, escalated: choice.failures > 1 },
        routing: { blocked: infrastructureFailure || undefined, canRetry: !infrastructureFailure && reservation!.ordinal < choice.attemptLimit, recordOutcome } }
    }
    const rule = options.rules?.find(rule => (!rule.area || rule.area === ctx.story.area) && (!rule.storyId || rule.storyId === ctx.story.id) && (rule.area || rule.storyId))
    const bounded = options.strategy === 'capability' || options.maxAttempts !== undefined
    let priorAttempts: ReturnType<typeof readRoutingAttempts> = []
    let failureKey = ctx.story.id
    if (bounded) {
      try {
        failureKey = routingAssessmentKey(root, ctx.story)
        priorAttempts = readRoutingAttempts(root, ctx.story.id, failureKey)
        if (priorAttempts.length >= (options.maxAttempts ?? 5)) return blocked('Routing attempt budget exhausted; replan this task before retrying')
      } catch (error) { return blocked(`Cannot read routing attempt state: ${(error as Error).message}`) }
    }
    if (rule) {
      const project = projectHash(root)
      try {
        const prior = bounded ? priorAttempts.filter(entry => entry.outcome?.failureKind !== 'infrastructure').at(-1)?.outcome
          : readRoutingObservations().reverse().find(event => event.projectHash === project && event.storyHash === storyHash(project, ctx.story.id) && typeof event.verificationSuccess === 'boolean')
        if (prior?.verificationSuccess === false) failedStories.add(failureKey)
      } catch (error) { return blocked(`Cannot read routing attempt state: ${(error as Error).message}`) }
    }
    const ruleWorker = rule && failedStories.has(failureKey) ? rule.escalateTo ?? 'SELF' : rule?.worker
    const candidates = rule ? eligibleWorkers : rankWorkers(eligibleWorkers, options.strategy, options.maxCandidates)
    if (candidates.length === 0) {
      if (options.fallback === 'block' || options.maxTier) return blocked('No eligible routing profiles; parent fallback is disabled')
      let runner: ReturnType<typeof makeWorker>
      const selection = options.parentSelection ?? {}
      options.onDecision?.(ctx.story.id, { profile: 'SELF', provider: options.parent, model: selection.model, providerModel: selection.provider,
        reasoningEffort: selection.reasoningEffort, variant: selection.variant, reason: 'No eligible profile; configured parent fallback', next: 'independent gate verification' })
      const execution = yield* perform('parent', options.parent, selection, () => runner(ctx), 'SELF', () => {
        runner = makeWorker(options.parent, selection)
        if (bounded) reserveWorker(options.parent, selection, 'SELF', options.maxAttempts ?? 5)
      })
      if (execution.blocked) return blocked(execution.blocked)
      const result = execution.result!
      const infrastructureFailure = result.infrastructureFailure || (!result.success && knownInfrastructureFailure(result.summary))
      let recorded = false
      const recordOutcome = (verified: boolean, failureKind?: 'implementation' | 'infrastructure'): void => {
        if (recorded) return
        const kind = infrastructureFailure ? 'infrastructure' : failureKind ?? 'implementation'
        if (reservation) finishRoutingAttempt(root, reservation, { verificationSuccess: infrastructureFailure ? false : verified, failureKind: kind, actualModel: result.tokens?.model })
        recorded = true
      }
      if (infrastructureFailure) recordOutcome(false, 'infrastructure')
      return { ...result, ...(infrastructureFailure ? { success: false, infrastructureFailure: true } : {}),
        tokens: { ...aggregateCalls(calls), storyId: ctx.story.id, ...(reservation ? { routingAttemptId: reservation.id } : {}) },
        routing: { recordOutcome, ...(infrastructureFailure ? { blocked: true } : {}), ...(bounded ? { canRetry: !infrastructureFailure && reservation!.ordinal < (options.maxAttempts ?? 5) } : {}) } }
    }
    const orchestratorSelection = { ...(options.parentSelection ?? {}), ...(options.orchestratorSelection ?? {}), nativeMultiAgent: false }
    let routeRun: RunValue = { success: true, summary: 'Explicit rule', output: '' }
    if (!rule) {
      const routed = yield* perform('orchestrator', options.parent, orchestratorSelection, capture(options.parent, buildRoutingPrompt(ctx, candidates, options.strategy), orchestratorSelection))
      if (routed.blocked) return blocked(routed.blocked)
      routeRun = routed.result!
    }
    const decision = rule
      ? { worker: ruleWorker === 'SELF' || candidates.some(w => w.id === ruleWorker) ? ruleWorker! : 'SELF', reason: failedStories.has(failureKey) ? 'gate failure escalated by project rule' : 'explicit project routing rule' }
      : routeRun.success ? parseRouteDecision(routeRun.output, candidates.map(worker => worker.id)) : null
    const selected = decision?.worker ?? 'SELF'
    const worker = selected === 'SELF' ? undefined : candidates.find(candidate => candidate.id === selected)
    if ((!worker && (options.fallback === 'block' || options.maxTier)) || (options.maxTier && (!worker?.tier || tiers.indexOf(worker.tier) > tiers.indexOf(options.maxTier)))) return blocked('Selected routing profile exceeds configured limits; execution blocked')
    const provider = worker?.agent ?? options.parent
    const selection: ModelSelection = worker
      ? { provider: worker.provider, model: worker.model, reasoningEffort: worker.reasoningEffort, variant: worker.variant, nativeMultiAgent: false, ...(provider !== 'gemini' && provider !== 'qwen' && provider !== 'pi' && provider !== 'hermes' ? { bare: options.parentSelection?.bare } : {}) }
      : { ...(options.parentSelection ?? {}), nativeMultiAgent: false }
    options.onDecision?.(ctx.story.id, { profile: selected, provider, model: selection.model, providerModel: selection.provider,
      reasoningEffort: selection.reasoningEffort, variant: selection.variant, reason: decision?.reason ?? 'Invalid controller response; configured parent fallback',
      next: rule?.escalateTo ?? 'independent gate verification', ...(ctx.story.assessment ? { assessment: ctx.story.assessment } : {}) })
    let runner: ReturnType<typeof makeWorker>
    const execution = yield* perform(worker ? 'worker' : 'parent', provider, selection, () => runner(ctx), selected, () => {
      runner = makeWorker(provider, selection)
      if (bounded) reserveWorker(provider, selection, selected, options.maxAttempts ?? 5)
    })
    if (execution.blocked) return blocked(execution.blocked)
    const result = execution.result!
    const tokens = { ...aggregateCalls(calls), storyId: ctx.story.id, escalated: Boolean(rule && failedStories.has(failureKey)), ...(reservation ? { routingAttemptId: reservation.id } : {}) }
    let recorded = false
    const recordOutcome = (verificationSuccess: boolean, failureKind?: 'implementation' | 'infrastructure'): void => {
      if (recorded) return
      if (reservation) finishRoutingAttempt(root, reservation, { verificationSuccess, failureKind, actualModel: result.tokens?.model })
      recorded = true
      if (!verificationSuccess && failureKind !== 'infrastructure') failedStories.add(failureKey); else if (verificationSuccess) failedStories.delete(failureKey)
      const project = projectHash(root)
      recordRoutingObservation({ projectHash: project, storyHash: storyHash(project, ctx.story.id), strategy: options.strategy, selected, provider,
        requestedModel: selection.model, requestedReasoningEffort: selection.reasoningEffort, requestedProvider: selection.provider, requestedVariant: selection.variant,
        actualModel: result.tokens?.model, orchestratorProvider: options.parent, orchestratorModel: orchestratorSelection.model,
        orchestratorDurationMs: calls.filter(call => call.role === 'orchestrator').reduce((sum, call) => sum + call.durationMs, 0), workerDurationMs: calls.at(-1)!.durationMs,
        processSuccess: result.success, verificationSuccess, failureKind,
        inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, usageAvailable: tokens.measurementComplete,
        totalCostUsd: tokens.totalCostUsd, costMeasurementComplete: tokens.costMeasurementComplete,
      })
    }
    if (result.infrastructureFailure) recordOutcome(false, 'infrastructure')
    const routeSummary = decision ? `route=${selected} (${decision.reason})` : `route=SELF (${routeRun.success ? 'invalid routing response' : 'orchestrator failed'})`
    return { ...result, summary: `${routeSummary}; ${result.summary}`, tokens, routing: { recordOutcome, ...(result.infrastructureFailure ? { blocked: true } : {}),
      ...(bounded ? { canRetry: !result.infrastructureFailure && reservation!.ordinal < (options.maxAttempts ?? 5) } : {}) } }
  }
}

function aggregateCalls(calls: ModelCallUsage[]): TokenUsage {
  const optional: Partial<TokenUsage> = {}
  for (const field of ['cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'totalCostUsd'] as const) {
    if (calls.some(call => call[field] !== undefined)) optional[field] = calls.reduce((sum, call) => sum + (call[field] ?? 0), 0)
  }
  const model = calls.at(-1)?.actualModel
  return { inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0), outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    ...optional, ...(model ? { model } : {}), calls,
    measurementComplete: calls.every(call => call.usageAvailable !== false),
    costMeasurementComplete: calls.every(call => call.totalCostUsd !== undefined && call.costMeasurementComplete !== false) }
}
