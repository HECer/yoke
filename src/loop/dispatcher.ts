import { observeFailure, clearFailureProgress, type LoopFailure } from './failure.js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appendDecision, contextDir } from '../context/context.js'
import { acquireClaim, heartbeatClaim, releaseClaim, requestClaimCancellation } from './claims.js'
import { coordinateCandidates } from './candidates.js'
import type { CandidateCoordinatorInput, CandidateCoordinatorResult } from './candidate-contracts.js'
import { MergeQueue } from './merge-queue.js'
import { isAcceptanceCriterion, loadPrd, progress, savePrd, type AcceptanceCriterion, type Story } from './prd.js'
import type { LoopPhase } from './reporter.js'
import { readyStories, writeScopesOverlap } from './scheduler.js'
import type { VerifyResult } from './verify.js'
import type { StoryWorkerCancellation, StoryWorkerProvider, StoryWorkerResult } from './worker.js'
import { createWorkerCleanup } from './worker-cleanup.js'
import type { PoolLease, PoolRole, SharedPoolStatus } from './resource-pool.js'
import type { ParallelRecoveryPhase } from './recovery.js'
import { executionFailure, failureObservation, observedError, type FailureObservation } from '../observability/failure.js'

export type DispatcherWorktree = {
  readonly path: string
  readonly baseCommit: string
  readonly recovered?: true
  readonly recovery?: { readonly phase: ParallelRecoveryPhase; readonly feedback: string; readonly observation?: FailureObservation }
}
export type DispatcherWorkerInput = {
  readonly story: Story
  readonly worktree: DispatcherWorktree
  readonly provider: StoryWorkerProvider
  readonly cancellation: StoryWorkerCancellation
  readonly dispatcherId: string
  readonly ownerToken: string
  readonly candidateRace?: true
}
export type DispatcherRebase = { readonly kind: 'rebased'; readonly expectedHead: string } | { readonly kind: 'reopen'; readonly reason: string }
export type DispatcherGate = VerifyResult
export type DispatcherClock = () => Date
export type DispatcherResourceRequest = { readonly story: Story; readonly provider: StoryWorkerProvider; readonly role: PoolRole; readonly units: number; readonly signal: AbortSignal }

export interface DispatcherClaims {
  acquire(input: DispatcherWorkerInput): boolean
  heartbeat(input: DispatcherWorkerInput): void
  release(input: DispatcherWorkerInput): boolean | void
  cancel?(input: DispatcherWorkerInput, reason: string): void
}

export interface DispatcherWorktrees {
  create(input: Pick<DispatcherWorkerInput, 'story' | 'dispatcherId' | 'ownerToken' | 'provider'>): DispatcherWorktree
  remove(input: DispatcherWorkerInput): void
  cleanupProcess?(input: DispatcherWorkerInput): void
  retain?(input: DispatcherWorkerInput, reason: string, phase?: ParallelRecoveryPhase, observation?: FailureObservation): void
}

export type DispatcherRecovery = { readonly reason: string; readonly worktree: string; readonly baseCommit: string; readonly ownerToken: string }

export interface DispatcherGit {
  isClean(targetDir: string): boolean
  rebase(input: DispatcherWorkerInput): DispatcherRebase | Promise<DispatcherRebase>
  commit(input: DispatcherWorkerInput): void | Promise<void>
  integrate(input: DispatcherWorkerInput, expectedHead: string): void | Promise<void>
}

export type DispatcherGates = {
  readonly verifyCriterion?: (path: string, story: Story, criterion: AcceptanceCriterion) => VerifyResult
  readonly requireCriterionEvidence?: boolean
  readonly verify: (path: string, story: Story) => VerifyResult
  readonly design?: (path: string, story: Story) => VerifyResult
  readonly perf?: (path: string, story: Story) => VerifyResult
  readonly audit?: (path: string, story: Story) => VerifyResult
  readonly qualityReview?: (path: string, story: Story, worker: DispatcherWorkerInput) => DispatcherGate
  readonly integrationPhase?: (worker: DispatcherWorkerInput, phase: 'waiting-resource' | 'committing' | undefined) => void
}

export type DispatcherOptions = {
  readonly onFailure?: (observation: FailureObservation, storyId?: string) => void
  readonly targetDir: string
  readonly stories: Story[]
  readonly maxConcurrency: number
  readonly maxIterations: number
  readonly worker: (input: DispatcherWorkerInput) => Promise<StoryWorkerResult>
  readonly candidateCount?: number
  readonly candidateCoordinator?: (input: DispatcherWorkerInput) => CandidateCoordinatorInput
  readonly acquireResource?: (request: DispatcherResourceRequest) => Promise<PoolLease>
  readonly resourceStatus?: () => SharedPoolStatus | undefined
  readonly onIntegrationMetrics?: (input: DispatcherWorkerInput, queueWaitMs: number, integrationMs: number | undefined) => void
  readonly claims?: DispatcherClaims
  readonly worktrees: DispatcherWorktrees
  readonly git: DispatcherGit
  readonly gates: DispatcherGates
  readonly providers?: readonly Omit<StoryWorkerProvider, 'role'>[]
  readonly affinityProviders?: readonly Omit<StoryWorkerProvider, 'role'>[]
  readonly pause?: () => boolean
  readonly prdPath?: string
  readonly dispatcherId?: string
  readonly id?: () => string
  readonly clock?: DispatcherClock
  readonly onAccepted?: (story: Story) => void
  readonly onReopened?: (story: Story, evidence: DispatcherRecovery) => void
  readonly onProgress?: (status: {
    readonly dispatcherId: string
    readonly maxConcurrency: number
    readonly workerUnitsPerStory: number
    readonly activeWorkers: number
    readonly waitingWorkers: number
    readonly queuedCandidates: number
    readonly queuedIntegrations: number
    readonly globalPool?: SharedPoolStatus
    readonly integrated: number
    readonly reopened: number
    readonly iteration: number
    readonly progress: { readonly passed: number; readonly total: number }
    readonly workers: readonly { readonly story: string; readonly storyTitle: string; readonly provider: string; readonly model?: string; readonly phase: LoopPhase }[]
  }) => void
}

export type DispatcherResult = {
  readonly failure?: LoopFailure
  readonly status: 'complete' | 'paused' | 'cancelled' | 'cap-reached' | 'blocked'
  readonly iterations: number
  readonly reason?: string
  readonly integrated: readonly string[]
  readonly reopened: readonly string[]
  readonly failed: readonly string[]
}

type ActiveWorker = { readonly input: DispatcherWorkerInput; readonly controller: AbortController; readonly task: Promise<void>; phase: LoopPhase }

function defaultClaims(targetDir: string, clock: DispatcherClock): DispatcherClaims {
  return {
    acquire: input => acquireClaim(targetDir, input.story.id, input.dispatcherId, {
      dispatcherId: input.dispatcherId,
      ownerToken: input.ownerToken,
      ...(!input.candidateRace ? {
        baseCommit: input.worktree.baseCommit,
        worktree: input.worktree.path,
        provider: input.provider.provider,
        model: input.provider.model,
      } : {}),
      role: 'implementation',
      now: clock(),
    }) !== null,
    heartbeat: input => { heartbeatClaim(targetDir, input.story.id, input.ownerToken, { now: clock() }) },
    release: input => releaseClaim(targetDir, input.story.id, input.ownerToken, { now: clock() }),
    cancel: (input, reason) => { requestClaimCancellation(targetDir, input.story.id, input.ownerToken, reason, { now: clock() }) },
  }
}

async function gateResult(gates: DispatcherGates, path: string, worker: DispatcherWorkerInput): Promise<DispatcherGate> {
  const { story } = worker
  const criteria = story.acceptance.filter(isAcceptanceCriterion)
  if (criteria.length === 0 && gates.requireCriterionEvidence) return { passed: false, summary: 'missing criterion evidence' }
  if (criteria.length > 0 && !gates.verifyCriterion) return { passed: false, summary: 'criterion verifier is not configured' }
  for (const criterion of criteria) {
    const result = withStoryContext(story.id, () => gates.verifyCriterion?.(path, story, criterion))
    if (!result?.passed) return { ...result, passed: false, summary: result?.summary ?? 'criterion verification failed' }
  }
  for (const gate of [gates.verify, gates.design, gates.perf, gates.audit]) {
    if (!gate) continue
    const result = withStoryContext(story.id, () => gate(path, story))
    if (!result.passed) return result
  }
  return withStoryContext(story.id, () => gates.qualityReview?.(path, story, worker)) ?? { passed: true, summary: 'integrated gates passed' }
}

// All gate APIs are synchronous: never leave ambient story context set across an await.
function withStoryContext<T>(storyId: string, gate: () => T): T {
  const previous = process.env.YOKE_STORY
  process.env.YOKE_STORY = storyId
  try { return gate() }
  finally {
    if (previous === undefined) delete process.env.YOKE_STORY
    else process.env.YOKE_STORY = previous
  }
}

export function createDispatcher(options: DispatcherOptions): { readonly run: () => Promise<DispatcherResult>; readonly cancel: (reason: string) => void } {
  const emitFailure = (observation: FailureObservation, storyId?: string) => {
    try { options.onFailure?.(observation, storyId) } catch { /* preserve dispatch and recovery when telemetry fails */ }
  }
  const dispatcherId = options.dispatcherId ?? randomUUID()
  const ids = options.id ?? randomUUID
  const clock = options.clock ?? (() => new Date())
  const claims = options.claims ?? defaultClaims(options.targetDir, clock)
  const queue = new MergeQueue()
  const active = new Map<string, ActiveWorker>()
  const queued = new Map<string, Promise<void>>()
  const integrationControllers = new Map<string, AbortController>()
  const areas = new Set<string>()
  const reservedWrites = new Map<string, readonly string[]>()
  const integrated: string[] = []
  const reopened: string[] = []
  const failed: string[] = []
  const failureReasons = new Map<string, string>()
  const failureDetails = new Map<string, LoopFailure>()
  const integrationBlocks: string[] = []
  let iterations = 0
  let providerIndex = 0
  let paused = false
  let cancellationReason: string | undefined
  const reportProgress = (): void => {
    let globalPool: SharedPoolStatus | undefined
    try { globalPool = options.resourceStatus?.() } catch { /* Resource status is observational; admission remains fail-closed. */ }
    options.onProgress?.({
      dispatcherId,
      maxConcurrency: options.maxConcurrency,
      workerUnitsPerStory: options.candidateCount && options.candidateCount > 1 && options.candidateCoordinator ? options.candidateCount : 1,
      activeWorkers: active.size,
      waitingWorkers: [...active.values()].filter(worker => worker.phase === 'waiting-resource').length,
      queuedCandidates: queued.size,
      queuedIntegrations: queued.size,
      ...(globalPool ? { globalPool } : {}),
      integrated: integrated.length,
      reopened: reopened.length,
      iteration: iterations,
      progress: progress(options.stories),
      workers: [...active.values()].map(worker => ({
        story: worker.input.story.id,
        storyTitle: worker.input.story.title,
        provider: worker.input.provider.provider,
        ...(worker.input.provider.model ? { model: worker.input.provider.model } : {}),
        phase: worker.phase,
      })),
    })
  }

  const providerFor = (story: Story): StoryWorkerProvider => {
    if (story.agent) {
      const configured = options.affinityProviders?.find(provider => provider.provider === story.agent)
        ?? options.providers?.find(provider => provider.provider === story.agent)
      return { ...(configured ?? { provider: story.agent }), provider: story.agent, role: 'implementation' }
    }
    const configured = options.providers?.[providerIndex++ % (options.providers?.length ?? 1)] ?? { provider: 'claude' }
    return { ...configured, role: 'implementation' }
  }
  const cleanupWorker = createWorkerCleanup({
    cleanupProcess: options.worktrees.cleanupProcess,
    removeWorktree: input => options.worktrees.remove(input),
    releaseClaim: input => {
      if (claims.release(input) === false) throw new Error('claim release failed')
    },
  })
  const cleanup = (input: DispatcherWorkerInput): void => {
    reservedWrites.delete(input.story.id)
    if (input.story.area) areas.delete(input.story.area)
    cleanupWorker(input)
  }
  const releaseCandidateClaim = (input: DispatcherWorkerInput): void => {
    reservedWrites.delete(input.story.id)
    if (input.story.area) areas.delete(input.story.area)
    if (claims.release(input) === false) throw new Error('claim release failed')
  }
  const cleanupRetained = createWorkerCleanup({
    cleanupProcess: options.worktrees.cleanupProcess,
    removeWorktree: () => undefined,
    releaseClaim: releaseCandidateClaim,
  })
  const cleanupProcessOnly = createWorkerCleanup({
    cleanupProcess: options.worktrees.cleanupProcess,
    removeWorktree: () => undefined,
    releaseClaim: () => undefined,
  })
  const retainWorker = (input: DispatcherWorkerInput, reason: string, phase: ParallelRecoveryPhase): void => {
    if (!options.worktrees.retain) {
      if (input.worktree.recovered) cleanupRetained(input)
      else cleanup(input)
      return
    }
    let recorded = false
    try {
      // The trusted record must exist before relinquishing this worktree's claim.
      options.worktrees.retain(input, reason, phase, failureDetails.get(input.story.id)?.observation)
      recorded = true
    } finally {
      if (recorded) cleanupRetained(input)
      else cleanupProcessOnly(input)
    }
  }
  const persistPass = (input: DispatcherWorkerInput): void => {
    if (!options.prdPath) return
    const path = join(input.worktree.path, relative(options.targetDir, options.prdPath))
    const next = loadPrd(options.prdPath).map(story => story.id === input.story.id ? { ...story, passes: true } : story)
    savePrd(path, next)
    appendDecision(contextDir(input.worktree.path), { storyId: input.story.id, title: input.story.title, summary: `${input.story.id} integrated` })
  }
  const enqueue = (input: DispatcherWorkerInput, result: Extract<StoryWorkerResult, { readonly kind: 'candidate' }>): void => {
    let reason = 'integrated verification failed'
    let retained = false
    let retentionRecorded = false
    let recoveryBaseCommit = input.worktree.baseCommit
    const integrationQueuedAt = Date.now()
    let integrationStartedAt: number | undefined
    const integrationController = new AbortController()
    integrationControllers.set(input.story.id, integrationController)
    let integrationLease: PoolLease | undefined
    let routingSettled = false
    const settleRouting = (verified: boolean, failureKind?: 'implementation' | 'infrastructure'): void => {
      if (routingSettled) return
      routingSettled = true
      if (failureKind) result.routing.recordOutcome?.(verified, failureKind)
      else result.routing.recordOutcome?.(verified)
    }
    const task = queue.enqueue({
      storyId: input.story.id,
      rebase: async () => {
        if (cancellationReason) throw observedError(cancellationReason, 'cancelled')
        options.onIntegrationMetrics?.(input, Date.now() - integrationQueuedAt, undefined)
        if (options.acquireResource) {
          options.gates.integrationPhase?.(input, 'waiting-resource')
          integrationLease = await options.acquireResource({ story: input.story, provider: input.provider, role: 'integration', units: 1, signal: integrationController.signal })
        }
        integrationStartedAt = Date.now()
        if (cancellationReason) throw observedError(cancellationReason, 'cancelled')
        if (!options.git.isClean(options.targetDir)) throw observedError('target working tree is not clean', 'source-changed')
        const rebase = await options.git.rebase(input)
        if (rebase.kind === 'reopen') { reason = rebase.reason; throw new Error(reason) }
        recoveryBaseCommit = rebase.expectedHead
        return rebase.expectedHead
      },
      verify: async () => {
        if (cancellationReason) { reason = cancellationReason; return false }
        const gate = await gateResult(options.gates, input.worktree.path, input)
        reason = gate.summary
        if (!gate.passed) throw Object.assign(new Error(gate.summary), { failure: gate.failure ?? failureObservation() })
        return true
      },
      integrate: async expectedHead => {
        if (cancellationReason) throw observedError(cancellationReason, 'cancelled')
        options.gates.integrationPhase?.(input, 'committing')
        persistPass(input)
        await options.git.commit(input)
        await options.git.integrate(input, expectedHead)
      },
      postIntegrateVerify: () => {
        if (!options.git.isClean(options.targetDir)) throw observedError('target working tree is not clean after integration', 'source-changed')
      },
    }).then(merge => {
      switch (merge.status) {
        case 'integrated':
          input.story.passes = true
          integrated.push(input.story.id)
          options.onAccepted?.(input.story)
          settleRouting(true)
          clearFailureProgress(options.targetDir, input.story.id)
          return
        case 'integrated-but-blocked':
          { const observation = merge.failure ?? failureObservation()
            failureDetails.set(input.story.id, { kind: 'verification-failed', stage: 'integration', storyId: input.story.id, observation })
            emitFailure(observation, input.story.id) }
          input.story.passes = true
          integrated.push(input.story.id)
          options.onAccepted?.(input.story)
          integrationBlocks.push(merge.reason)
          settleRouting(true)
          clearFailureProgress(options.targetDir, input.story.id)
          return
        case 'reopened':
          reopened.push(input.story.id)
          reason = merge.reason
          const observed = existsSync(input.worktree.path) ? observeFailure({ root: options.targetDir, directory: input.worktree.path, story: input.story, stage: 'integration', summary: reason, observation: merge.failure }) : undefined
          emitFailure(observed?.failure.observation ?? merge.failure ?? failureObservation(), input.story.id)
          if (observed) { failureDetails.set(input.story.id, observed.failure); if (observed.action !== 'retry') reason = observed.feedback }
          if (options.worktrees.retain) {
            // Retain first, then report/release. Recovery evidence must precede cleanup.
            retained = true
            options.worktrees.retain({ ...input, worktree: { ...input.worktree, baseCommit: recoveryBaseCommit } }, reason, observed && observed.action !== 'retry' ? 'implementation' : 'integration', observed?.failure.observation ?? merge.failure)
            retentionRecorded = true
            failed.push(input.story.id)
            failureReasons.set(input.story.id, `${reason}; candidate retained at ${input.worktree.path}`)
          }
          options.onReopened?.(input.story, { reason, worktree: input.worktree.path, baseCommit: recoveryBaseCommit, ownerToken: input.ownerToken })
          settleRouting(false, cancellationReason ? 'infrastructure' : undefined)
          return
        default: {
          const unexpected: never = merge
          throw new Error(`unexpected merge result: ${String(unexpected)}`)
        }
      }
    }).finally(async () => {
      // A thrown gate/retention operation also terminates this measured attempt;
      // recovery retains code, but cannot resurrect an in-memory outcome callback.
      try { settleRouting(false, 'infrastructure') }
      finally {
        queued.delete(input.story.id)
        integrationControllers.delete(input.story.id)
        try {
          options.gates.integrationPhase?.(input, undefined)
          if (integrationLease) await integrationLease.release()
          options.onIntegrationMetrics?.(input, Date.now() - integrationQueuedAt, integrationStartedAt === undefined ? undefined : Date.now() - integrationStartedAt)
        }
        finally {
          if (retained && retentionRecorded) cleanupRetained(input)
          else if (retained) cleanupProcessOnly(input)
          else cleanup(input)
          reportProgress()
        }
      }
    })
    queued.set(input.story.id, task)
    reportProgress()
  }
  const launch = (story: Story): void => {
    const provider = providerFor(story)
    const ownerToken = ids()
    let worktree: DispatcherWorktree
    try { worktree = options.worktrees.create({ story, dispatcherId, ownerToken, provider }) }
    catch (error) {
      failed.push(story.id)
      const observation = executionFailure(error)
      failureDetails.set(story.id, { kind: 'verification-failed', stage: 'integration', storyId: story.id, observation })
      emitFailure(observation, story.id)
      failureReasons.set(story.id, `worktree setup failed: ${error instanceof Error ? error.message : String(error)}`)
      reportProgress()
      return
    }
    if (worktree.recovery?.observation) emitFailure(worktree.recovery.observation, story.id)
    const controller = new AbortController()
    const candidateRace = Boolean(!worktree.recovered && options.candidateCount && options.candidateCount > 1 && options.candidateCoordinator)
    const input: DispatcherWorkerInput = { story, worktree, provider, cancellation: { signal: controller.signal }, dispatcherId, ownerToken, ...(candidateRace ? { candidateRace: true } : {}) }
    if (!claims.acquire(input)) {
      if (!worktree.recovered) options.worktrees.remove(input)
      return
    }
    iterations += 1
    reservedWrites.set(story.id, story.writes ?? [])
    if (story.area) areas.add(story.area)
    const candidateDispatch = candidateRace
    let workerStarted = false
    const activeWorker: ActiveWorker = { input, controller, task: Promise.resolve(), phase: options.acquireResource ? 'waiting-resource' : 'implementing' }
    // Durable admission reporting must succeed before the worker microtask can start.
    active.set(story.id, activeWorker)
    try { reportProgress() }
    catch (error) {
      active.delete(story.id)
      if (worktree.recovered) cleanupRetained(input)
      else cleanup(input)
      throw error
    }
    const task = Promise.resolve().then(async () => {
      const workerLease = options.acquireResource
        ? await options.acquireResource({ story, provider, role: 'implementation', units: candidateRace ? options.candidateCount! : 1, signal: controller.signal })
        : undefined
      activeWorker.phase = 'implementing'
      reportProgress()
      try {
        if (worktree.recovered) options.worktrees.cleanupProcess?.(input)
        if (worktree.recovered && worktree.recovery?.phase !== 'implementation') return { source: 'worker' as const, result: {
          kind: 'candidate' as const, storyId: story.id, worktree: worktree.path, baseCommit: worktree.baseCommit,
          provider, summary: 'retained candidate recovered for independent integration checks', evidence: { criteria: [] }, routing: { outcome: 'pending-integration' as const },
        } }
        workerStarted = true
        return await (candidateDispatch && options.candidateCoordinator
          ? Promise.resolve(options.candidateCoordinator(input)).then(coordinateCandidates).then(result => ({ source: 'candidates' as const, result }))
          : options.worker(input).then(result => ({ source: 'worker' as const, result })))
      } finally {
        if (workerLease) await workerLease.release()
      }
    }).then(async outcome => {
      active.delete(story.id)
      claims.heartbeat(input)
      if (outcome.source === 'candidates') {
        switch (outcome.result.kind) {
          case 'winner': {
            const winnerInput: DispatcherWorkerInput = {
              ...input,
              worktree: outcome.result.winner.worktree,
              provider: outcome.result.winner.provider,
            }
            enqueue(winnerInput, outcome.result.winner.result)
            return
          }
          case 'paused':
            paused = true
            releaseCandidateClaim(input)
            reportProgress()
            return
          case 'cancelled':
            releaseCandidateClaim(input)
            reportProgress()
            return
          case 'blocked':
            failed.push(story.id)
            failureReasons.set(story.id, outcome.result.summary)
            if (outcome.result.reason !== 'cleanup-error' && !outcome.result.recovery?.length) releaseCandidateClaim(input)
            reportProgress()
            return
          default: {
            const unexpected: never = outcome.result
            throw new Error(`unexpected candidate coordinator result: ${String(unexpected)}`)
          }
        }
      }
      const result = outcome.result
      if (result.kind === 'paused') {
        if (result.reason === 'decision') cancel(`critical decision required for story ${input.story.id}: ${result.summary}`)
        else if (result.reason === 'ambiguity') cancel(`ambiguity requires resolution for story ${input.story.id}: ${result.summary}`)
        else paused = true
        retainWorker(input, result.summary, 'implementation')
        reportProgress()
        return
      }
      if (result.kind !== 'candidate') {
        failed.push(story.id)
        failureReasons.set(story.id, result.summary)
        if (result.failure) failureDetails.set(story.id, result.failure)
        retainWorker(input, result.summary, 'implementation')
        reportProgress()
        return
      }
      if (cancellationReason || paused || options.pause?.()) {
        paused = true
        result.routing.recordOutcome?.(false, 'infrastructure')
        retainWorker(input, cancellationReason ?? 'paused after worker checks passed; integration is pending', 'integration')
        reportProgress()
        return
      }
      enqueue(input, result)
    }, error => {
      active.delete(story.id)
      failed.push(story.id)
      failureReasons.set(story.id, error instanceof Error ? error.message : String(error))
      const observation = executionFailure(error)
      failureDetails.set(story.id, { kind: 'verification-failed', stage: 'implementation', storyId: story.id, observation })
      emitFailure(observation, story.id)
      try {
        if (workerStarted && !candidateDispatch) retainWorker(input, error instanceof Error ? error.message : String(error), 'implementation')
        else if (input.worktree.recovered) cleanupRetained(input)
        else cleanup(input)
      } catch (cleanupError) {
        reportProgress()
        throw new AggregateError([error, cleanupError], `worker ${story.id} and cleanup failed`)
      }
      reportProgress()
      if (!(error instanceof Error)) throw error
    })
    Object.assign(activeWorker, { task })
    active.set(story.id, activeWorker)
    reportProgress()
  }
  const cancel = (reason: string): void => {
    if (cancellationReason) return
    cancellationReason = reason
    for (const worker of active.values()) {
      claims.cancel?.(worker.input, reason)
      worker.controller.abort(reason)
    }
    for (const controller of integrationControllers.values()) controller.abort(reason)
  }
  const run = async (): Promise<DispatcherResult> => {
    for (;;) {
      if (options.pause?.()) paused = true
      if (!paused && !cancellationReason && integrationBlocks.length === 0 && iterations < options.maxIterations) {
        const busy = new Set([...active.keys(), ...queued.keys(), ...failed])
        // Implementation slots are reusable while candidates wait for the separate integration lane.
        const slots = Math.max(0, options.maxConcurrency - active.size)
        const ready = readyStories(options.stories, { activeAreas: areas, activeWrites: [...reservedWrites.values()] }).filter(story => !busy.has(story.id))
        let launched = 0
        for (const story of ready) {
          if (launched >= slots || iterations >= options.maxIterations) break
          if ((!story.area || !areas.has(story.area)) && ![...reservedWrites.values()].some(scopes => writeScopesOverlap(story.writes, scopes))) {
            const before = iterations
            launch(story)
            if (iterations > before) launched++
          }
        }
      }
      if (active.size > 0) { await Promise.race([...active.values()].map(worker => worker.task).concat([...queued.values()])); continue }
      if (queued.size > 0) { await Promise.race(queued.values()); continue }
      if (cancellationReason) return { status: 'cancelled', reason: cancellationReason, failure: { kind: 'verification-failed', stage: 'implementation', observation: failureObservation('cancelled') }, iterations, integrated, reopened, failed }
      if (paused) return { status: 'paused', iterations, integrated, reopened, failed }
      if (integrationBlocks.length > 0) return { status: 'blocked', reason: integrationBlocks[0], failure: [...failureDetails.values()].find(detail => integrated.includes(detail.storyId ?? '')), iterations, integrated, reopened, failed }
      if (options.stories.every(story => story.passes)) return { status: 'complete', iterations, integrated, reopened, failed }
      if (failed.length > 0) {
        const storyId = failed[0]
        const detail = storyId ? failureReasons.get(storyId) : undefined
        return { status: 'blocked', ...(storyId && failureDetails.has(storyId) ? { failure: failureDetails.get(storyId) } : {}), ...(storyId && detail ? { reason: `${reopened.includes(storyId) ? `story ${storyId} integration rejected` : `worker ${storyId} failed`}: ${detail}` } : {}), iterations, integrated, reopened, failed }
      }
      if (iterations >= options.maxIterations) return { status: 'cap-reached', iterations, integrated, reopened, failed }
      return { status: 'blocked', iterations, integrated, reopened, failed }
    }
  }
  return { run, cancel }
}
