import { existsSync, rmSync } from 'node:fs'
import type { Agent } from '../retrofit/config.js'
import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import { createDispatcher, type DispatcherWorkerInput } from './dispatcher.js'
import { consumeDecisionRequest, type DecisionRequest } from './decision.js'
import type { GitOps } from './gates.js'
import type { CommitIdentity } from './identity.js'
import { pauseFilePath } from './loop.js'
import { makeParallelAdapters } from './parallel-adapters.js'
import type { CandidateCoordinatorInput, CandidateOwnership, CandidateWorkerDefinition } from './candidate-contracts.js'
import { loadPrd, progress, type AcceptanceCriterion, type Story } from './prd.js'
import type { LoopPhase, LoopReporter } from './reporter.js'
import { makeAsyncRunner, type AgentContext, type AgentResult, type AgentRunner } from './runner.js'
import { runStoryWorker, type StoryWorkerProvider } from './worker.js'
import type { Verifier } from './verify.js'
import type { QualityCommandHooks } from '../quality/command.js'
import type { ProviderProcessResult } from '../agents/process.js'

export type ParallelCommandInput = {
  readonly targetDir: string
  readonly prdPath: string
  readonly maxConcurrency: number
  readonly maxIterations: number
  readonly runner?: AgentRunner
  readonly runnerAgent: Agent
  readonly idleMs: number
  readonly permissions: PermissionProfile
  readonly selection: ModelSelection
  readonly providers: readonly Omit<StoryWorkerProvider, 'role'>[]
  readonly affinityProviders: readonly Omit<StoryWorkerProvider, 'role'>[]
  readonly onAmbiguity: 'resolve' | 'abort' | 'auto' | 'critical'
  readonly git?: GitOps
  readonly identity?: CommitIdentity
  readonly verify: Verifier
  readonly verifyCriterion: (path: string, story: Story, criterion: AcceptanceCriterion) => ReturnType<Verifier>
  readonly requireCriterionEvidence: boolean
  readonly perf?: Verifier
  readonly audit?: Verifier
  readonly review?: AgentRunner
  readonly reporter: LoopReporter
  readonly completion?: Verifier
  readonly quality?: QualityCommandHooks
  readonly candidateCount?: number
  readonly onCriticalDecision?: (decision: DecisionRequest) => void
}

export async function runParallelLoopCommand(input: ParallelCommandInput): Promise<number> {
  const adapters = makeParallelAdapters(input.targetDir, input.identity, input.git)
  if (!adapters.git.isClean(input.targetDir)) {
    input.reporter.blocked('target working tree is not clean')
    return 1
  }
  let pauseConsumed = false
  const pause = (): boolean => {
    if (pauseConsumed) return true
    const path = pauseFilePath(input.targetDir)
    if (!existsSync(path)) return false
    rmSync(path, { force: true })
    pauseConsumed = true
    return true
  }
  const dispatcher = createDispatcher({
    targetDir: input.targetDir,
    prdPath: input.prdPath,
    stories: loadPrd(input.prdPath),
    maxConcurrency: input.maxConcurrency,
    maxIterations: input.maxIterations,
    providers: input.providers,
    affinityProviders: input.affinityProviders,
    worktrees: adapters.worktrees,
    git: adapters.git,
    ...(input.candidateCount && input.candidateCount > 1 ? {
      candidateCount: input.candidateCount,
      candidateCoordinator: workerInput => candidateCoordinatorInput(input, adapters, workerInput, pause),
    } : {}),
    pause,
    onProgress: status => input.reporter.parallel?.(status),
    gates: {
      verify: input.verify,
      verifyCriterion: input.verifyCriterion,
      requireCriterionEvidence: input.requireCriterionEvidence,
      perf: input.perf,
      audit: input.audit,
      qualityReview: (path, story, worker) => integrationGate(input, path, story, integratorReporter(input.reporter, worker)),
      integrationPhase: (worker, phase) => reportIntegrator(input.reporter, worker, phase),
    },
    worker: workerInput => {
      const runner: WorkerRunner = input.runner ?? asyncRunner(input, workerInput.provider, workerInput.cancellation.signal, workerInput.ownerToken)
      const result = runStoryWorker({
        story: workerInput.story,
        worktree: workerInput.worktree.path,
        baseCommit: workerInput.worktree.baseCommit,
        provider: workerInput.provider,
        runner,
        verify: input.verify,
        verifyCriterion: input.verifyCriterion,
        requireCriterionEvidence: input.requireCriterionEvidence,
        perf: input.perf,
        audit: input.audit,
        qualityPreflight: input.quality?.qualityPreflight,
        qualityStage: input.quality?.qualityStage,
        repair: input.quality?.repair,
        repairLimits: input.quality?.repairLimits,
        qualityMetadata: input.quality?.qualityMetadata,
        qualityEnabled: input.quality?.qualityEnabled,
        review: input.review,
        cancellation: workerInput.cancellation,
        beforeGates: context => {
          const decision = consumeDecisionRequest(context.targetDir, input.targetDir, context.story.id)
          if (!decision) return null
          input.onCriticalDecision?.(decision)
          return decision.question
        },
        pause,
        reporter: workerReporter(input.reporter, workerInput),
      })
      return Promise.resolve(result)
    },
  })
  const result = await dispatcher.run()
  const finalProgress = progress(loadPrd(input.prdPath))
  if (result.status === 'complete' && input.completion) {
    const gate = input.completion(input.targetDir)
    if (!gate.passed) {
      input.reporter.blocked(gate.summary)
      return 1
    }
  }
  if (result.status === 'complete') input.reporter.complete(finalProgress)
  else if (result.status === 'paused') input.reporter.paused(finalProgress)
  else if (result.status === 'cap-reached') input.reporter.capReached(finalProgress)
  else input.reporter.blocked(result.reason ?? `parallel dispatcher ${result.status}`)
  return result.status === 'complete' ? 0 : result.status === 'paused' ? 3 : 1
}

function candidateCoordinatorInput(
  input: ParallelCommandInput,
  adapters: ReturnType<typeof makeParallelAdapters>,
  worker: DispatcherWorkerInput,
  pause: () => boolean,
): CandidateCoordinatorInput {
  const quality = input.quality
  const candidateCount = input.candidateCount
  if (!quality || !candidateCount) throw new Error('candidate dispatch requires quality hooks and a candidate count')
  const candidateIds = Array.from({ length: candidateCount }, (_, index) => `candidate-${index + 1}`)
  const comparison = quality.candidateComparison(worker.story, candidateIds)
  const reporter = workerReporter(input.reporter, worker)
  return {
    story: worker.story,
    baseCommit: worker.worktree.baseCommit,
    maxCandidates: candidateCount,
    candidates: candidateDefinitions(input, worker, candidateCount, pause),
    coordinatorId: `${worker.dispatcherId}:${worker.story.id}:${worker.ownerToken}`,
    ownerToken: candidateId => `${worker.ownerToken}-${candidateId}`,
    lifecycle: adapters.candidates(worker),
    evidence: comparison.evidence,
    stageEvidence: comparison.stageEvidence,
    judgeProvenance: comparison.judgeProvenance,
    onSelecting: () => reporter.phase('selecting-candidate'),
    onLifecycle: (candidate, state, reason) => candidateReporter(input.reporter, worker, candidate, state, reason),
    judge: request => comparison.judge(request),
    recordResult: comparison.recordResult,
    recordElimination: comparison.recordElimination,
    recordSelection: comparison.recordSelection,
    signal: worker.cancellation.signal,
    pause,
  }
}

function candidateDefinitions(input: ParallelCommandInput, worker: DispatcherWorkerInput, candidateCount: number, pause: () => boolean): readonly CandidateWorkerDefinition[] {
  const quality = input.quality
  return Array.from({ length: candidateCount }, (_, index) => {
    const candidateId = `candidate-${index + 1}`
    const qualityRoundBase = (index + 1) * 10_000
    const runner = input.runner ?? asyncRunner(input, worker.provider, undefined, `${worker.ownerToken}-${candidateId}`)
    return {
      id: candidateId,
      worker: {
        provider: worker.provider,
        runner,
        verify: input.verify,
        verifyCriterion: input.verifyCriterion,
        requireCriterionEvidence: input.requireCriterionEvidence,
        perf: input.perf,
        audit: input.audit,
        ...(quality ? {
          qualityPreflight: quality.qualityPreflight,
          qualityStage: (context: AgentContext, round: number, attempt?: 'worker' | 'integration') => quality.qualityStage(context, qualityRoundBase + round, attempt),
          repair: quality.repair,
          repairLimits: quality.repairLimits,
          qualityMetadata: quality.qualityMetadata,
          qualityEnabled: quality.qualityEnabled,
        } : {}),
        review: input.review,
        beforeGates: context => {
          if (pause()) return 'candidate coordination paused'
          const decision = consumeDecisionRequest(context.targetDir, input.targetDir, context.story.id)
          if (!decision) return null
          input.onCriticalDecision?.(decision)
          return decision.question
        },
        pause,
        reporter: workerReporter(input.reporter, worker),
        reporterFor: (candidate: CandidateOwnership) => workerReporter(input.reporter, worker, candidate),
      },
      runnerFor: cancellation => input.runner ?? asyncRunner(input, worker.provider, cancellation.signal, `${worker.ownerToken}-${candidateId}`),
    }
  })
}

type WorkerRunner = (context: AgentContext) => AgentResult | Promise<AgentResult>

function workerReporter(reporter: LoopReporter, worker: DispatcherWorkerInput, candidate?: CandidateOwnership): Pick<LoopReporter, 'phase' | 'quality' | 'addTokens'> {
  const attribution = {
    story: worker.story.id,
    storyTitle: worker.story.title,
    provider: worker.provider.provider,
    ...(worker.provider.model ? { model: worker.provider.model } : {}),
    ...(candidate ? { candidateId: candidate.candidateId, worktree: candidate.worktree.path } : {}),
  }
  return {
    phase: phase => {
      if (reporter.parallelWorker) reporter.parallelWorker({ ...attribution, phase })
      else reporter.phase(phase)
    },
    quality: quality => {
      if (reporter.parallelWorker) reporter.parallelWorker({ ...attribution, quality })
      else reporter.quality(quality)
    },
    addTokens: usage => reporter.addTokens(usage),
  }
}

function candidateReporter(reporter: LoopReporter, worker: DispatcherWorkerInput, candidate: CandidateOwnership, state: import('./candidate-contracts.js').CandidateLifecycleState, reason?: string): void {
  if (!reporter.parallelWorker) return
  reporter.parallelWorker({
    story: worker.story.id,
    storyTitle: worker.story.title,
    provider: candidate.provider.provider,
    ...(candidate.provider.model ? { model: candidate.provider.model } : {}),
    candidateId: candidate.candidateId,
    worktree: candidate.worktree.path,
    lifecycle: state,
    ...(reason ? { reason } : {}),
  })
}

function integratorReporter(reporter: LoopReporter, worker: DispatcherWorkerInput): Pick<LoopReporter, 'phase' | 'quality'> {
  const attribution = {
    story: worker.story.id,
    storyTitle: worker.story.title,
    provider: worker.provider.provider,
    ...(worker.provider.model ? { model: worker.provider.model } : {}),
  }
  return {
    phase: phase => reportIntegrator(reporter, worker, phase),
    quality: quality => {
      if (reporter.parallelIntegrator) reporter.parallelIntegrator({ ...attribution, quality })
      else reporter.quality(quality)
    },
  }
}

function reportIntegrator(reporter: LoopReporter, worker: DispatcherWorkerInput, phase: LoopPhase | undefined): void {
  if (reporter.parallelIntegrator) {
    reporter.parallelIntegrator(phase
      ? { story: worker.story.id, storyTitle: worker.story.title, provider: worker.provider.provider, ...(worker.provider.model ? { model: worker.provider.model } : {}), phase }
      : null)
    return
  }
  if (phase) reporter.phase(phase)
}

function asyncRunner(input: ParallelCommandInput, provider: StoryWorkerProvider, signal: AbortSignal | undefined, workerId: string): WorkerRunner {
  const { model: _globalModel, reasoningEffort: _globalReasoningEffort, ...selection } = input.selection
  const runner = makeAsyncRunner(provider.provider, {
    onAmbiguity: input.onAmbiguity,
    permissions: input.permissions,
    selection: {
      ...selection,
      ...(provider.model ? { model: provider.model } : {}),
      ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
    },
    process: { idleTimeoutMs: input.idleMs, signal, workerId },
  })
  return async context => providerProcessResultToAgentResult(provider.provider, context.story.id, await runner(context).completion)
}

export function providerProcessResultToAgentResult(agent: Agent, storyId: string, result: ProviderProcessResult): AgentResult {
  const tokens = result.telemetry.tokens
  const telemetry = tokens ? { tokens } : {}
  switch (result.kind) {
    case 'succeeded': return { success: true, summary: `${agent} implemented ${storyId}`, ...telemetry }
    case 'cancelled': return { success: false, summary: result.reason, ...telemetry }
    case 'timed-out': return { success: false, summary: result.reason, ...telemetry }
    case 'spawn-failed': return { success: false, summary: result.error, ...telemetry }
    case 'failed': return { success: false, summary: `${agent} exited ${result.exitCode ?? 'without a code'}`, ...telemetry }
    default: return assertNever(result)
  }
}

function reviewGate(review: AgentRunner | undefined, path: string, story: Story): { passed: boolean; summary: string } {
  if (!review) return { passed: true, summary: 'integrated gates passed' }
  const result = review({ targetDir: path, story })
  return { passed: result.success && result.reviewOutcome?.kind !== 'rejected', summary: result.summary }
}

function assertNever(value: never): never { throw new Error(`unexpected provider result: ${String(value)}`) }

function integrationGate(input: ParallelCommandInput, path: string, story: Story, reporter: Pick<LoopReporter, 'phase' | 'quality'>): { passed: boolean; summary: string } {
  const context = { targetDir: path, story }
  const qualityEnabled = input.quality?.qualityEnabled(story) ?? false
  if (qualityEnabled) reporter.phase('comparing')
  const preflight = qualityEnabled ? input.quality?.qualityPreflight(context) : undefined
  if (preflight?.kind === 'blocked') return { passed: false, summary: preflight.summary }
  const quality = qualityEnabled ? input.quality?.qualityStage(context, 10_000, 'integration') : undefined
  if (quality && quality.kind !== 'pass' && quality.kind !== 'skipped') return { passed: false, summary: quality.summary }
  if (input.review) reporter.phase('reviewing')
  return reviewGate(input.review, path, story)
}
