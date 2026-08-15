import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'
import { appendDecision, contextDir } from '../context/context.js'
import { acquireClaim, heartbeatClaim, releaseClaim, requestClaimCancellation } from './claims.js'
import { coordinateCandidates } from './candidates.js'
import type { CandidateCoordinatorInput, CandidateCoordinatorResult } from './candidate-contracts.js'
import { MergeQueue } from './merge-queue.js'
import { isAcceptanceCriterion, loadPrd, progress, savePrd, type AcceptanceCriterion, type Story } from './prd.js'
import type { LoopPhase } from './reporter.js'
import { readyStories } from './scheduler.js'
import type { VerifyResult } from './verify.js'
import type { StoryWorkerCancellation, StoryWorkerProvider, StoryWorkerResult } from './worker.js'
import { createWorkerCleanup } from './worker-cleanup.js'

export type DispatcherWorktree = { readonly path: string; readonly baseCommit: string }
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
export type DispatcherGate = { readonly passed: boolean; readonly summary: string }
export type DispatcherClock = () => Date

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
}

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
  readonly perf?: (path: string, story: Story) => VerifyResult
  readonly audit?: (path: string, story: Story) => VerifyResult
  readonly qualityReview?: (path: string, story: Story, worker: DispatcherWorkerInput) => DispatcherGate
  readonly integrationPhase?: (worker: DispatcherWorkerInput, phase: 'committing' | undefined) => void
}

export type DispatcherOptions = {
  readonly targetDir: string
  readonly stories: Story[]
  readonly maxConcurrency: number
  readonly maxIterations: number
  readonly worker: (input: DispatcherWorkerInput) => Promise<StoryWorkerResult>
  readonly candidateCount?: number
  readonly candidateCoordinator?: (input: DispatcherWorkerInput) => CandidateCoordinatorInput
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
  readonly onProgress?: (status: {
    readonly dispatcherId: string
    readonly maxConcurrency: number
    readonly activeWorkers: number
    readonly queuedCandidates: number
    readonly integrated: number
    readonly reopened: number
    readonly iteration: number
    readonly progress: { readonly passed: number; readonly total: number }
    readonly workers: readonly { readonly story: string; readonly storyTitle: string; readonly provider: string; readonly model?: string; readonly phase: LoopPhase }[]
  }) => void
}

export type DispatcherResult = {
  readonly status: 'complete' | 'paused' | 'cancelled' | 'cap-reached' | 'blocked'
  readonly iterations: number
  readonly reason?: string
  readonly integrated: readonly string[]
  readonly reopened: readonly string[]
  readonly failed: readonly string[]
}

type ActiveWorker = { readonly input: DispatcherWorkerInput; readonly controller: AbortController; readonly task: Promise<void> }

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
    const result = gates.verifyCriterion?.(path, story, criterion)
    if (!result?.passed) return { passed: false, summary: result?.summary ?? 'criterion verification failed' }
  }
  for (const gate of [gates.verify, gates.perf, gates.audit]) {
    if (!gate) continue
    const result = gate(path, story)
    if (!result.passed) return result
  }
  return gates.qualityReview?.(path, story, worker) ?? { passed: true, summary: 'integrated gates passed' }
}

export function createDispatcher(options: DispatcherOptions): { readonly run: () => Promise<DispatcherResult>; readonly cancel: (reason: string) => void } {
  const dispatcherId = options.dispatcherId ?? randomUUID()
  const ids = options.id ?? randomUUID
  const clock = options.clock ?? (() => new Date())
  const claims = options.claims ?? defaultClaims(options.targetDir, clock)
  const queue = new MergeQueue()
  const active = new Map<string, ActiveWorker>()
  const queued = new Map<string, Promise<void>>()
  const areas = new Set<string>()
  const integrated: string[] = []
  const reopened: string[] = []
  const failed: string[] = []
  const failureReasons = new Map<string, string>()
  const integrationBlocks: string[] = []
  let iterations = 0
  let providerIndex = 0
  let paused = false
  let cancellationReason: string | undefined
  const reportProgress = (): void => options.onProgress?.({
    dispatcherId,
    maxConcurrency: options.maxConcurrency,
    activeWorkers: active.size,
    queuedCandidates: queued.size,
    integrated: integrated.length,
    reopened: reopened.length,
    iteration: iterations,
    progress: progress(options.stories),
    workers: [...active.values()].map(worker => ({
      story: worker.input.story.id,
      storyTitle: worker.input.story.title,
      provider: worker.input.provider.provider,
      ...(worker.input.provider.model ? { model: worker.input.provider.model } : {}),
      phase: 'implementing',
    })),
  })

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
    if (input.story.area) areas.delete(input.story.area)
    cleanupWorker(input)
  }
  const releaseCandidateClaim = (input: DispatcherWorkerInput): void => {
    if (input.story.area) areas.delete(input.story.area)
    if (claims.release(input) === false) throw new Error('claim release failed')
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
    const task = queue.enqueue({
      storyId: input.story.id,
      rebase: async () => {
        if (cancellationReason) throw new Error(cancellationReason)
        if (!options.git.isClean(options.targetDir)) throw new Error('target working tree is not clean')
        const rebase = await options.git.rebase(input)
        if (rebase.kind === 'reopen') { reason = rebase.reason; throw new Error(reason) }
        return rebase.expectedHead
      },
      verify: async () => {
        if (cancellationReason) { reason = cancellationReason; return false }
        const gate = await gateResult(options.gates, input.worktree.path, input)
        reason = gate.summary
        return gate.passed
      },
      integrate: async expectedHead => {
        if (cancellationReason) throw new Error(cancellationReason)
        options.gates.integrationPhase?.(input, 'committing')
        persistPass(input)
        await options.git.commit(input)
        await options.git.integrate(input, expectedHead)
      },
      postIntegrateVerify: () => {
        if (!options.git.isClean(options.targetDir)) throw new Error('target working tree is not clean after integration')
      },
    }).then(merge => {
      switch (merge.status) {
        case 'integrated':
          input.story.passes = true
          integrated.push(input.story.id)
          result.routing.recordOutcome?.(true)
          return
        case 'integrated-but-blocked':
          input.story.passes = true
          integrated.push(input.story.id)
          integrationBlocks.push(merge.reason)
          result.routing.recordOutcome?.(true)
          return
        case 'reopened':
          reopened.push(input.story.id)
          result.routing.recordOutcome?.(false)
          return
        default: {
          const unexpected: never = merge
          throw new Error(`unexpected merge result: ${String(unexpected)}`)
        }
      }
    }).finally(() => {
      queued.delete(input.story.id)
      options.gates.integrationPhase?.(input, undefined)
      cleanup(input)
      reportProgress()
    })
    queued.set(input.story.id, task)
    reportProgress()
  }
  const launch = (story: Story): void => {
    const provider = providerFor(story)
    const ownerToken = ids()
    const worktree = options.worktrees.create({ story, dispatcherId, ownerToken, provider })
    const controller = new AbortController()
    const candidateRace = Boolean(options.candidateCount && options.candidateCount > 1 && options.candidateCoordinator)
    const input: DispatcherWorkerInput = { story, worktree, provider, cancellation: { signal: controller.signal }, dispatcherId, ownerToken, ...(candidateRace ? { candidateRace: true } : {}) }
    if (!claims.acquire(input)) { options.worktrees.remove(input); return }
    iterations += 1
    if (story.area) areas.add(story.area)
    const candidateDispatch = candidateRace
    const task = (candidateDispatch && options.candidateCoordinator
      ? Promise.resolve(options.candidateCoordinator(input)).then(coordinateCandidates).then(result => ({ source: 'candidates' as const, result }))
      : options.worker(input).then(result => ({ source: 'worker' as const, result }))
    ).then(async outcome => {
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
        else paused = true
        cleanup(input)
        reportProgress()
        return
      }
      if (result.kind !== 'candidate') {
        failed.push(story.id)
        failureReasons.set(story.id, result.summary)
        cleanup(input)
        reportProgress()
        return
      }
      if (cancellationReason || paused || options.pause?.()) {
        paused = true
        result.routing.recordOutcome?.(false)
        cleanup(input)
        reportProgress()
        return
      }
      enqueue(input, result)
    }, error => {
      active.delete(story.id)
      failed.push(story.id)
      failureReasons.set(story.id, error instanceof Error ? error.message : String(error))
      try {
        cleanup(input)
      } catch (cleanupError) {
        reportProgress()
        throw new AggregateError([error, cleanupError], `worker ${story.id} and cleanup failed`)
      }
      reportProgress()
      if (!(error instanceof Error)) throw error
    })
    active.set(story.id, { input, controller, task })
    reportProgress()
  }
  const cancel = (reason: string): void => {
    if (cancellationReason) return
    cancellationReason = reason
    for (const worker of active.values()) {
      claims.cancel?.(worker.input, reason)
      worker.controller.abort(reason)
    }
  }
  const run = async (): Promise<DispatcherResult> => {
    for (;;) {
      if (options.pause?.()) paused = true
      if (!paused && !cancellationReason && integrationBlocks.length === 0 && iterations < options.maxIterations) {
        const busy = new Set([...active.keys(), ...queued.keys(), ...failed])
        const slots = Math.max(0, options.maxConcurrency - active.size)
        const ready = readyStories(options.stories, { activeAreas: areas }).filter(story => !busy.has(story.id)).slice(0, slots)
        for (const story of ready) {
          if (!story.area || !areas.has(story.area)) launch(story)
        }
      }
      if (active.size > 0) { await Promise.race([...active.values()].map(worker => worker.task)); continue }
      if (queued.size > 0) { await Promise.race(queued.values()); continue }
      if (cancellationReason) return { status: 'cancelled', reason: cancellationReason, iterations, integrated, reopened, failed }
      if (paused) return { status: 'paused', iterations, integrated, reopened, failed }
      if (integrationBlocks.length > 0) return { status: 'blocked', reason: integrationBlocks[0], iterations, integrated, reopened, failed }
      if (options.stories.every(story => story.passes)) return { status: 'complete', iterations, integrated, reopened, failed }
      if (failed.length > 0) {
        const storyId = failed[0]
        const detail = storyId ? failureReasons.get(storyId) : undefined
        return { status: 'blocked', ...(storyId && detail ? { reason: `worker ${storyId} failed: ${detail}` } : {}), iterations, integrated, reopened, failed }
      }
      if (iterations >= options.maxIterations) return { status: 'cap-reached', iterations, integrated, reopened, failed }
      return { status: 'blocked', iterations, integrated, reopened, failed }
    }
  }
  return { run, cancel }
}
