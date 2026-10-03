import { roleSelection } from "../routing/capability.js"
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig, resolveOutputPolicy, resolveVerifyCommand, type DecisionPolicy } from '../retrofit/config.js'
import { allPass, loadPrd, progress, selectNextStory, storyPathSegment } from './prd.js'
import { pauseFilePath, requestLoopPause, runLoop } from './loop.js'
import { commitPaths, realGitOps } from './git.js'
import { makeRunner, makeReviewRunner, isAgentAvailable, type AgentRunner, type AmbiguityPolicy } from './runner.js'
import type { Agent } from '../retrofit/config.js'
import type { GitOps } from './gates.js'
import { commandVerifier, commandsVerifier, retryingVerifier, type Verifier } from './verify.js'
import { readStatus, makeReporter, fmtDuration, type LoopReporter } from './reporter.js'
import { acquireLock, releaseLock, readLock } from './lock.js'
import { statePath } from '../workspace/state.js'
import { accountRunIterations, createLoopRun, readRunState, writeRunState, type SavedRunState } from './run-state.js'
import { maybeAutoUpgrade } from '../update/upgrade.js'
import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import { resolveCommitIdentity, type CommitIdentity } from './identity.js'
import { runAudit } from '../audit/command.js'
import { detectHostAgent, resolveRunnerAgent } from '../agents/host.js'
import {
  buildTrustedDecisionResumeState, clearDecisionResume, decisionProcessingExists, decisionRequestId, formatPendingDecision,
  readPendingDecision, writeDecisionResume,
} from './decision.js'
import { makeAdaptiveRunner } from '../routing/router.js'
import { makeActionRunner } from '../execution/actions.js'
import { runChangeApply } from '../change/inbox.js'
import { resolvePlanner } from '../routing/planning.js'
import { createQualityCommandHooks, type QualityCommandRuntime } from '../quality/command.js'
import { resolveQualityPolicy, type QualityPolicy, type QualityRunOverrides } from '../quality/types.js'
import { runParallelLoopCommand } from './parallel-command.js'
import { detectUiProject } from '../retrofit/ui-detect.js'
import { designVerifier } from '../scan/gate.js'
import { prepareIsolatedWorktree } from './recovery.js'
import { AGENT_LIST, SUPPORTED_AGENTS } from '../agents/catalog.js'
import type { StoryWorkerProvider } from './worker.js'
import { MAX_PROJECT_WORKERS, sharedPoolStatus, withSharedWorkerSync } from './resource-pool.js'
import { runPrdExplore } from '../prd/explore.js'

export const DEFAULT_IDLE_MINUTES = 20
const STALE_MINUTES = 20  // a running status older than this likely means the loop died

export function relativeTime(fromIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(fromIso))
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function prdPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'prd.yaml')
}

export function setLoopEnabled(targetDir: string, enabled: boolean): void {
  // TODO(C2): resolve bundled canon version instead of placeholder
  const config = loadConfig(targetDir) ?? defaultConfig('0.0.0')
  config.loop = { ...config.loop, enabled }
  saveConfig(targetDir, config)
}

export function loopStatus(targetDir: string, now: () => Date = () => new Date(), opts?: { compact?: boolean }): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  const st = readStatus(targetDir)
  if (opts?.compact) {
    if (!st) return `state=${enabled ? 'enabled' : 'disabled'} prd="${prog}"`
    return `state=${st.state} story=${st.story ?? 'none'} progress=${st.progress.passed}/${st.progress.total} phase=${st.phase} updated=${relativeTime(st.updatedAt, now())}`
  }
  const sharedPoolLine = (): string => {
    try {
      const pool = sharedPoolStatus()
      return `Shared pool: ${pool.activeUnits}/${pool.limit} units · ${pool.activeByRole.implementation} implementation · ${pool.activeByRole.integration} integration · ${pool.waitingWorkers} waiting${pool.oldestWaitMs ? ` · oldest wait ${fmtDuration(pool.oldestWaitMs)}` : ''}`
    } catch (error) { return `Shared pool unavailable: ${(error as Error).message}` }
  }
  if (!st) return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}\n${sharedPoolLine()}`
  const head = `Loop: ${st.state.toUpperCase()}${st.story ? ` on ${st.story}${st.storyTitle ? ` "${st.storyTitle}"` : ''}` : ''}`
  const pct = st.percent !== undefined ? ` (${st.percent}%)` : ''
  const meta = [st.phase, `iteration ${st.iteration}`, `backlog ${st.progress.passed}/${st.progress.total}${pct}`, `updated ${relativeTime(st.updatedAt, now())}`]
    .filter(Boolean).join(' · ')
  const lines = [head, `  ${meta}`]
  lines.push(`  ${sharedPoolLine()}`)
  for (const process of st.supervision ?? []) {
    lines.push(`  provider PID ${process.childPid ?? 'not started'}: ${process.state} · attempt ${process.retry + 1} · identity/liveness ${process.liveness ?? 'unknown'} · supervisor heartbeat ${relativeTime(process.heartbeatAt, now())} · last output ${process.lastOutputAt ? relativeTime(process.lastOutputAt, now()) : 'none'} · last successful tool/edit ${process.lastProgressAt ? relativeTime(process.lastProgressAt, now()) : 'none'}${process.reason ? ' · ' + process.reason : ''}`)
  }
  if (st.state === 'running' && st.eta && st.eta.remainingStories > 0) {
    lines.push(`  ~${fmtDuration(st.eta.etaMs)} remaining (Ø ${fmtDuration(st.eta.avgStoryMs)}/story)`)
  }
  if (st.reason) lines.push(`  reason: ${st.reason}`)
  if (st.quality) lines.push(`  quality: round ${st.quality.currentRound} · ${st.quality.usedRepairs}${st.quality.unbounded ? ' unbounded repairs' : `/${st.quality.maxRepairs ?? 0} repairs`} · ${st.quality.policy}`)
  if (st.parallel) lines.push(`  parallel ${st.parallel.dispatcherId}: ${st.parallel.activeWorkers}/${st.parallel.maxConcurrency} workers (local; ${st.parallel.waitingWorkers ?? 0} waiting) · ${st.parallel.queuedIntegrations ?? st.parallel.queuedCandidates} queued for integration · ${st.parallel.integrated} integrated · ${st.parallel.reopened} reopened`)
  const integrator = st.parallel?.integrator
  if (integrator) {
    const quality = integrator.quality
      ? ` · quality round ${integrator.quality.currentRound} · ${integrator.quality.usedRepairs}${integrator.quality.unbounded ? ' unbounded repairs' : `/${integrator.quality.maxRepairs ?? 0} repairs`}`
      : ''
    lines.push(`  integrator ${integrator.story} "${integrator.storyTitle}" (${integrator.provider}${integrator.model ? `/${integrator.model}` : ''}) · ${integrator.phase ?? 'working'}${quality}`)
  }
  for (const worker of st.parallel?.workers ?? []) {
    const quality = worker.quality
      ? ` · quality round ${worker.quality.currentRound} · ${worker.quality.usedRepairs}${worker.quality.unbounded ? ' unbounded repairs' : `/${worker.quality.maxRepairs ?? 0} repairs`}`
      : ''
    const candidate = worker.candidateId ? ` candidate ${worker.candidateId} · ${worker.worktree ?? 'worktree unknown'} · ${worker.lifecycle ?? 'working'}` : ''
    lines.push(`  worker ${worker.story} "${worker.storyTitle}" (${worker.provider}${worker.model ? `/${worker.model}` : ''})${candidate} · ${worker.phase ?? 'working'}${quality}`)
  }
  const nowMs = now().getTime()
  const ageMs = nowMs - Date.parse(st.updatedAt)
  const providerProgressMs = Math.max(0, ...((st.supervision ?? [])
    .filter(process => process.liveness === 'alive' && process.lastProgressAt)
    .map(process => Date.parse(process.lastProgressAt!))
    .filter(Number.isFinite)))
  if (st.state === 'running' && ageMs > STALE_MINUTES * 60_000 && nowMs - providerProgressMs > STALE_MINUTES * 60_000) {
    lines.push(`  ⚠ possibly stuck — no update in ${relativeTime(st.updatedAt, now())}`)
  }
  return lines.join('\n')
}

export function resolveIdleMs(flagMinutes: number | undefined, configMinutes: number | undefined): number {
  const minutes = flagMinutes ?? configMinutes ?? DEFAULT_IDLE_MINUTES
  return minutes > 0 ? minutes * 60_000 : 0
}

export interface RunLoopCommandOptions {
  /** Internal runtime ownership; never serialized. */
  ownedLockToken?: string
  savedRun?: SavedRunState
  selection?: ModelSelection
  explorationPlanner?: { agent: Agent; selection: ModelSelection }
  /** Optional story batch limit. Omitted means run until every story passes or a gate blocks. */
  maxIterations?: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
  resumeWorktree?: boolean
  reviewRunner?: AgentRunner
  reviewer?: Agent
  review?: boolean
  reporter?: LoopReporter
  timeoutMinutes?: number
  /** Emit NDJSON status lines on stdout instead of the human narrative (machine consumers own stdout). */
  json?: boolean
  /** Ambiguous-criteria handling; flag beats config.loop.onAmbiguity; default 'resolve' (never stop). */
  onAmbiguity?: AmbiguityPolicy
  decisionPolicy?: DecisionPolicy
  /** Test seam for the performance budget gate (production builds it from config.perf). */
  perf?: Verifier
  /** Test seam for the design gate (production builds it from config.design). */
  design?: Verifier
  permissions?: PermissionProfile
  allowSelfReview?: boolean
  commitIdentity?: CommitIdentity
  audit?: Verifier
  parallel?: number
  parallelAuto?: boolean
  /** Override config.routing.enabled for this invocation. */
  routing?: boolean
  /** Test seam; production consumes the append-only change inbox. */
  intake?: () => { ok: boolean; added: number; summary: string }
  qualityRuntime?: QualityCommandRuntime
  quality?: boolean
  qualityRounds?: number
  qualityMinutes?: number
  qualityPolicy?: QualityPolicy
  qualityUnbounded?: true
  candidates?: number
  /** Keep discovering and implementing verified work after the current PRD drains. */
  explore?: boolean
  /** Minutes between read-only exploration passes that find no suitable work. */
  exploreIntervalMinutes?: number
  /** Optional supervisor runtime. Omitted means the exploration loop is unbounded. */
  exploreLimitMs?: number
  /** Internal supervisor flags used to keep one concise output stream. */
  quiet?: boolean
  explorationSupervisor?: boolean
}

const DEFAULT_EXPLORE_INTERVAL_MINUTES = 30
const EXPLORE_RETRY_BASE_MS = 30_000
const EXPLORE_RETRY_MAX_MS = 15 * 60_000

function consumeExplorePause(targetDir: string): boolean {
  const path = pauseFilePath(targetDir)
  if (!existsSync(path)) return false
  try { unlinkSync(path) } catch { /* a pause request still wins if cleanup fails */ }
  return true
}

function currentProgress(targetDir: string): ReturnType<typeof progress> {
  try { return progress(loadPrd(prdPath(targetDir))) }
  catch { return { passed: 0, total: 0 } }
}

function allCurrentStoriesPass(targetDir: string): boolean {
  try { return allPass(loadPrd(prdPath(targetDir))) }
  catch { return false }
}

async function waitForExplorePause(targetDir: string, durationMs: number, heartbeat?: () => void, limitDeadline?: number): Promise<boolean> {
  const waitDeadline = Date.now() + durationMs
  let nextHeartbeat = Date.now() + 5 * 60_000
  while (Date.now() < waitDeadline && (limitDeadline === undefined || Date.now() < limitDeadline)) {
    if (consumeExplorePause(targetDir)) return true
    if (Date.now() >= nextHeartbeat) {
      heartbeat?.()
      nextHeartbeat = Date.now() + 5 * 60_000
    }
    const untilWaitEnds = waitDeadline - Date.now()
    const untilLimit = limitDeadline === undefined ? untilWaitEnds : limitDeadline - Date.now()
    await new Promise<void>(resolve => setTimeout(resolve, Math.max(1, Math.min(1_000, untilWaitEnds, untilLimit))))
  }
  return consumeExplorePause(targetDir)
}

function retryProviders(targetDir: string, preferred?: Agent, available: (agent: Agent) => boolean = isAgentAvailable): Agent[] {
  let config: ReturnType<typeof loadConfig>
  try { config = loadConfig(targetDir) } catch { config = null }
  const primary = resolveRunnerAgent(config, preferred, detectHostAgent())
  return [...new Set([primary, ...(config?.agents ?? [])])].filter(agent => available(agent))
}

function retryReviewers(preferred: Agent | undefined, implementer: Agent, available: (agent: Agent) => boolean): Agent[] {
  return [...new Set([...(preferred ? [preferred] : []), ...SUPPORTED_AGENTS])].filter(agent => agent !== implementer && available(agent))
}

function nextProvider(providers: readonly Agent[], current?: Agent): Agent | undefined {
  if (!providers.length) return current
  const index = current ? providers.indexOf(current) : -1
  return providers[(index + 1 + providers.length) % providers.length]
}

function retryDelay(failures: number): number {
  return Math.min(EXPLORE_RETRY_MAX_MS, EXPLORE_RETRY_BASE_MS * 2 ** Math.min(10, Math.max(0, failures - 1)))
}

function scheduleExploreLimitPause(targetDir: string, deadline: number | undefined): () => void {
  if (deadline === undefined) return () => {}
  let timer: NodeJS.Timeout | undefined
  const check = (): void => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      requestLoopPause(targetDir)
      return
    }
    timer = setTimeout(check, Math.min(remaining, 2_147_483_647))
    timer.unref?.()
  }
  check()
  return () => { if (timer) clearTimeout(timer) }
}

function reportExploration(targetDir: string, summary: string, json: boolean, nextStep?: string): void {
  const say = json ? (line: string) => console.error(line) : (line: string) => console.log(line)
  let next = nextStep
  try {
    if (!next) {
      const story = selectNextStory(loadPrd(prdPath(targetDir)))
      if (story) next = `${story.id}: ${story.title}`
    }
  } catch { /* the persistent loop status keeps the parse failure visible */ }
  say(`Exploration: ${summary}`)
  say(`Next: ${next ?? 'scan the project again for evidenced improvements'}`)
}

async function runContinuousExploration(targetDir: string, options: RunLoopCommandOptions): Promise<number> {
  if (options.isolate === false) {
    console.error('--explore requires isolated story worktrees so failed work can be resumed safely.')
    return 2
  }
  const intervalMinutes = options.exploreIntervalMinutes ?? DEFAULT_EXPLORE_INTERVAL_MINUTES
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1_440) {
    console.error('--explore-interval must be an integer from 1 to 1440 minutes')
    return 2
  }
  if (options.exploreLimitMs !== undefined && (!Number.isSafeInteger(options.exploreLimitMs) || options.exploreLimitMs <= 0 || Date.now() + options.exploreLimitMs > 8_640_000_000_000_000)) {
    console.error('--explore-limit must be a positive, supported duration')
    return 2
  }
  const limitDeadline = options.savedRun?.exploreDeadline ?? (options.exploreLimitMs === undefined ? undefined : Date.now() + options.exploreLimitMs)
  const reporter = options.reporter ?? makeReporter(targetDir, { json: options.json, quiet: true })
  let config: ReturnType<typeof loadConfig>
  try { config = loadConfig(targetDir) } catch { config = null }
  const defaultImplementationAgent = options.agent ?? resolveRunnerAgent(config, undefined, detectHostAgent())
  const defaultExplorer = options.explorationPlanner?.agent ?? options.agent ?? config?.planning?.agent ?? defaultImplementationAgent
  const available = options.isAvailable ?? isAgentAvailable
  const reviewRequested = !options.reviewRunner && Boolean(options.review || options.reviewer)
  const innerOptions: RunLoopCommandOptions = { ...options, isolate: true, explore: true, explorationSupervisor: true, reporter, quiet: true }
  let usedIterations = options.savedRun?.consumedIterations ?? 0
  let retryCount = 0
  let explorationFailures = 0
  let noActionScans = 0
  let implementationAgent = defaultImplementationAgent
  let reviewerAgent = options.reviewer ?? (reviewRequested ? SUPPORTED_AGENTS.find(agent => agent !== defaultImplementationAgent && available(agent)) : undefined)
  let explorationAgent = defaultExplorer
  let retryWorktree = false
  const safeBatchSize = (): number => {
    if (retryWorktree) return 1
    const parallelSetting = options.parallelAuto ? 'auto' : options.parallel ?? config?.loop.parallel ?? 'auto'
    if (parallelSetting !== 'auto') return Math.max(1, parallelSetting)
    try {
      const pending = loadPrd(prdPath(targetDir)).filter(story => !story.passes)
      if (!config?.actions?.length && pending.length > 1 && pending.every(story => story.writes?.length)) {
        return Math.min(sharedPoolStatus().limit, pending.length)
      }
    } catch { /* the inner command reports the underlying configuration or PRD error */ }
    return 1
  }
  const say = options.json ? (line: string) => console.error(line) : (line: string) => console.log(line)
  reporter.phase('exploring', 'continuous exploration supervisor started', currentProgress(targetDir))
  const limitReached = (): boolean => limitDeadline !== undefined && Date.now() >= limitDeadline
  const stopForTimeLimit = (): number => {
    consumeExplorePause(targetDir)
    const reason = 'the configured exploration time limit elapsed; stopped at a safe boundary'
    reporter.paused(currentProgress(targetDir), reason)
    say('Exploration time limit elapsed; the loop stopped at a safe boundary. Next: yoke loop run --explore .')
    return 3
  }

  const scanForWork = async (focus?: string): Promise<'continue' | 'paused' | 'limit'> => {
    if (limitReached()) return 'limit'
    const explorer = retryProviders(targetDir, explorationAgent, available)
    const result = runPrdExplore(targetDir, {
      ownedLockToken: options.ownedLockToken,
      ...(explorationAgent === options.explorationPlanner?.agent ? { selection: options.explorationPlanner.selection } : {}),
      runner: explorationAgent,
      timeoutMinutes: options.timeoutMinutes,
      isAvailable: options.isAvailable ?? isAgentAvailable,
      onUsage: usage => reporter.addTokens(usage),
      pause: () => consumeExplorePause(targetDir) || limitReached(),
      ...(focus ? { focus } : {}),
    })
    if (result.kind === 'paused') {
      if (limitReached()) return 'limit'
      reporter.paused(currentProgress(targetDir))
      say('Exploration paused at a safe boundary.')
      return 'paused'
    }
    if (result.kind === 'added') {
      explorationFailures = 0
      noActionScans = 0
      explorationAgent = defaultExplorer
      const titles = result.tasks.map(task => `${task.id}: ${task.title}`).join('; ')
      reporter.phase('exploring', `accepted tasks are committed; implementation is next: ${titles}`, currentProgress(targetDir))
      reportExploration(targetDir, `added ${titles}`, options.json ?? false)
      return 'continue'
    }
    if (result.kind === 'none') {
      explorationFailures = 0
      noActionScans++
      if (noActionScans % 3 === 0) explorationAgent = nextProvider(explorer, explorationAgent) ?? defaultExplorer
      const wait = intervalMinutes * 60_000
      const waitingReason = `${focus ? `${focus}; ` : ''}${result.summary}; scanning again in ${intervalMinutes} minute(s)`
      reporter.phase('waiting-exploration', waitingReason, currentProgress(targetDir))
      reportExploration(targetDir, 'no new task met the evidence and quality gates', options.json ?? false, `scan again in ${intervalMinutes} minute(s)`)
      return await waitForExplorePause(targetDir, wait, () => reporter.phase('waiting-exploration', waitingReason, currentProgress(targetDir)), limitDeadline) ? 'paused' : 'continue'
    }
    explorationFailures++
    explorationAgent = nextProvider(explorer, result.provider ?? explorationAgent) ?? defaultExplorer
    const wait = retryDelay(explorationFailures)
    const waitingReason = `${focus ? `${focus}; ` : ''}${result.summary}; retrying exploration in ${Math.ceil(wait / 1_000)} seconds`
    reporter.phase('waiting-recovery', waitingReason, currentProgress(targetDir))
    reportExploration(targetDir, 'the explorer could not produce an admissible task', options.json ?? false, `retry in ${Math.ceil(wait / 1_000)} seconds`)
    return await waitForExplorePause(targetDir, wait, () => reporter.phase('waiting-recovery', waitingReason, currentProgress(targetDir)), limitDeadline) ? 'paused' : 'continue'
  }

  const advanceRecoveryProviders = (): void => {
    implementationAgent = nextProvider(retryProviders(targetDir, implementationAgent, available), implementationAgent) ?? implementationAgent
    if (reviewRequested) reviewerAgent = nextProvider(retryReviewers(reviewerAgent, implementationAgent, available), reviewerAgent) ?? reviewerAgent
  }

  for (;;) {
    if (consumeExplorePause(targetDir)) {
      reporter.paused(currentProgress(targetDir))
      say(`Exploration paused. Next: yoke loop run --explore .`)
      return 3
    }
    if (limitReached()) return stopForTimeLimit()

    const beforeStatus = readStatus(targetDir)
    const priorProgress = currentProgress(targetDir)
    const remaining = options.maxIterations === undefined ? undefined : Math.max(0, options.maxIterations - usedIterations)
    if (remaining === 0) {
      reporter.capReached(currentProgress(targetDir))
      say(`Exploration reached --max=${options.maxIterations}. Next: yoke loop run --explore .`)
      return 1
    }
    let resultCode: number
    let unexpectedFailure: string | undefined
    const batchSize = limitDeadline === undefined ? undefined : safeBatchSize()
    const batchLimit = batchSize === undefined ? remaining : Math.min(remaining ?? batchSize, batchSize)
    const cancelTimePause = scheduleExploreLimitPause(targetDir, limitDeadline)
    try {
      resultCode = await Promise.resolve(runLoopCommand(targetDir, {
        ...innerOptions,
        agent: implementationAgent,
        ...(reviewRequested && reviewerAgent ? { reviewer: reviewerAgent } : {}),
        ...(batchLimit !== undefined ? { maxIterations: batchLimit } : {}),
        ...(retryWorktree ? { resumeWorktree: true, parallel: 1, candidates: 1 } : {}),
      }))
    } catch (error) {
      resultCode = 1
      unexpectedFailure = error instanceof Error ? error.message : String(error)
    } finally {
      cancelTimePause()
    }
    const afterStatus = readStatus(targetDir)
    const changedStatus = afterStatus?.updatedAt !== beforeStatus?.updatedAt
    if (options.savedRun) usedIterations = options.savedRun.consumedIterations ?? usedIterations
    else if (changedStatus && priorProgress.passed < priorProgress.total) usedIterations += Math.max(0, afterStatus?.iteration ?? 0)

    if (unexpectedFailure) {
      retryCount++
      advanceRecoveryProviders()
      const wait = retryDelay(retryCount)
      const reason = `the loop stopped unexpectedly: ${unexpectedFailure}; retrying with ${implementationAgent} in ${Math.ceil(wait / 1_000)} seconds`
      reporter.phase('waiting-recovery', reason, currentProgress(targetDir))
      say(`The loop stopped unexpectedly. Next: retry with ${implementationAgent} in ${Math.ceil(wait / 1_000)} seconds or pause with yoke loop pause .`)
      if (await waitForExplorePause(targetDir, wait, () => reporter.phase('waiting-recovery', reason, currentProgress(targetDir)), limitDeadline)) {
        reporter.paused(currentProgress(targetDir))
        return 3
      }
      continue
    }

    if (resultCode === 3) {
      if (limitReached()) return stopForTimeLimit()
      say('Exploration paused. Next: yoke loop run --explore .')
      return 3
    }
    if (limitReached()) return stopForTimeLimit()
    if (options.maxIterations !== undefined && usedIterations >= options.maxIterations) {
      if (resultCode === 0) {
        reporter.complete(currentProgress(targetDir))
        say(`Current backlog complete; --max=${options.maxIterations} stopped further exploration. Next: yoke loop run --explore .`)
        return 0
      }
      reporter.capReached(currentProgress(targetDir))
      say(`Exploration reached --max=${options.maxIterations} with work remaining. Next: yoke loop run --explore .`)
      return 1
    }
    if (resultCode === 0) {
      retryCount = 0
      retryWorktree = false
      const availableProviders = retryProviders(targetDir, defaultImplementationAgent, options.isAvailable ?? isAgentAvailable)
      implementationAgent = availableProviders.includes(defaultImplementationAgent) ? defaultImplementationAgent : availableProviders[0] ?? defaultImplementationAgent
      reporter.phase('exploring', 'the current accepted backlog is complete; scanning for the next verified improvement', currentProgress(targetDir))
      const scan = await scanForWork()
      if (scan === 'paused') return 3
      if (scan === 'limit') return stopForTimeLimit()
      continue
    }

    if (afterStatus?.state === 'cap-reached') {
      if (limitDeadline !== undefined) {
        retryCount = 0
        retryWorktree = false
        reporter.phase('exploring', 'the current safe task batch is complete; continuing the accepted backlog', currentProgress(targetDir))
        continue
      }
      say(`The current backlog is incomplete at the requested iteration cap. Next: yoke loop run --explore .`)
      return 1
    }
    let pendingDecision = false
    try { pendingDecision = Boolean(readPendingDecision(targetDir)) }
    catch { pendingDecision = true }
    if (pendingDecision || afterStatus?.reason?.includes('ambiguous acceptance criteria')) {
      retryWorktree = false
      const wait = Math.min(intervalMinutes * 60_000, 60_000)
      reporter.phase('waiting-recovery', `story ${afterStatus?.story ?? 'unknown'} needs a human decision before it can continue`, currentProgress(targetDir))
      say(`Story ${afterStatus?.story ?? 'unknown'} is waiting for a human decision. Next: answer it or run yoke loop pause .`)
      if (await waitForExplorePause(targetDir, wait, undefined, limitDeadline)) {
        reporter.paused(currentProgress(targetDir))
        return 3
      }
      continue
    }
    if (afterStatus?.reason?.startsWith('integrated completion gate failed') && allCurrentStoriesPass(targetDir)) {
      retryWorktree = false
      reporter.phase('exploring', `all planned tasks pass, but ${afterStatus.reason}; looking for work that can resolve the completion gate`, currentProgress(targetDir))
      const scan = await scanForWork(`The integrated completion gate is still failing: ${afterStatus.reason}`)
      if (scan === 'paused') return 3
      if (scan === 'limit') return stopForTimeLimit()
      continue
    }
    if (resultCode === 2) {
      retryCount++
      advanceRecoveryProviders()
      const wait = retryDelay(retryCount)
      reporter.phase('waiting-recovery', `the loop could not start; retrying with ${implementationAgent}${reviewerAgent ? ` and reviewer ${reviewerAgent}` : ''} in ${Math.ceil(wait / 1_000)} seconds`, currentProgress(targetDir))
      say(`The unfinished loop could not start. Next: retry with ${implementationAgent}${reviewerAgent ? ` and reviewer ${reviewerAgent}` : ''} in ${Math.ceil(wait / 1_000)} seconds or pause with yoke loop pause .`)
      if (await waitForExplorePause(targetDir, wait, undefined, limitDeadline)) {
        reporter.paused(currentProgress(targetDir))
        return 3
      }
      continue
    }

    retryCount++
    advanceRecoveryProviders()
    retryWorktree = (afterStatus?.parallel?.reopened ?? 0) === 0
    const wait = retryDelay(retryCount)
    reporter.phase('waiting-recovery', `story ${afterStatus?.story ?? 'unknown'} remains incomplete: ${afterStatus?.reason ?? 'no passing completion status'}; retrying with ${implementationAgent ?? 'the configured runner'} in ${Math.ceil(wait / 1_000)} seconds`, currentProgress(targetDir))
    say(`The current task remains unfinished; its isolated work is retained. Next: retry with ${implementationAgent ?? 'the configured runner'} in ${Math.ceil(wait / 1_000)} seconds.`)
    if (await waitForExplorePause(targetDir, wait, undefined, limitDeadline)) {
      reporter.paused(currentProgress(targetDir))
      return 3
    }
  }
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number | Promise<number> {
  if (opts.explore && !opts.explorationSupervisor) return startContinuousExploration(targetDir, opts)
  let parallel = opts.parallel ?? 1
  const candidates = opts.candidates ?? 1
  if (opts.resumeWorktree && (opts.isolate === false || parallel !== 1 || candidates !== 1)) {
    console.error('--resume-worktree requires --isolate --parallel=1 --candidates=1')
    return 2
  }
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > MAX_PROJECT_WORKERS) {
    console.error(`--parallel must be an integer from 1 to ${MAX_PROJECT_WORKERS}`)
    return 2
  }
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 5) {
    console.error('--candidates must be an integer from 1 to 5')
    return 2
  }
  const config = loadConfig(targetDir)
  const maxParallelCandidates = config?.quality?.maxParallelCandidates ?? 1
  if (candidates > maxParallelCandidates) {
    console.error(`--candidates=${candidates} exceeds quality.maxParallelCandidates=${maxParallelCandidates}`)
    return 2
  }
  const qualityDisabled = opts.quality === false || (!config?.quality?.enabled && opts.quality !== true && opts.qualityUnbounded !== true)
  if (candidates > 1 && qualityDisabled) {
    console.error(`--candidates=${candidates} requires quality; quality cannot be disabled for candidate dispatch.`)
    return 2
  }
  if (!config?.loop.enabled) {
    console.error('Loop is disabled. Enable it with: yoke loop on')
    return 2
  }
  if (decisionProcessingExists(targetDir)) {
    console.error(`A critical decision answer needs recovery. Run: yoke loop answer ${targetDir} --choice=<id>`)
    return 1
  }
  try {
    if (readPendingDecision(targetDir)) {
      console.error(`${formatPendingDecision(targetDir)}\nAnswer it with: yoke loop answer ${targetDir} --choice=<id>`)
      return 1
    }
  } catch (error) {
    console.error(`Invalid pending Yoke decision: ${(error as Error).message}`)
    return 1
  }
  const path = prdPath(targetDir)
  if (!existsSync(path)) {
    console.error(`No PRD found at ${path}. Create one (see canon loop/prd.schema.md).`)
    return 2
  }
  let sharedLimit: number
  try { sharedLimit = sharedPoolStatus().limit }
  catch (error) {
    console.error(`Cannot read the shared Yoke worker pool: ${(error as Error).message}`)
    return 2
  }
  const parallelSetting = opts.parallelAuto ? 'auto' : opts.parallel ?? config.loop.parallel ?? 'auto'
  if (parallelSetting === 'auto') {
    const stories = loadPrd(path)
    const pending = stories.filter(story => !story.passes)
    if (!opts.resumeWorktree && !config.actions?.length && pending.length > 1 && pending.every(story => story.writes?.length)) {
      parallel = Math.min(sharedLimit, pending.length)
    } else parallel = 1
  } else parallel = parallelSetting
  if (candidates > sharedLimit) {
    console.error(`--candidates=${candidates} exceeds the shared worker-pool limit (${sharedLimit}); raise YOKE_MAX_PARALLEL_WORKERS (maximum ${MAX_PROJECT_WORKERS}) or lower --candidates`)
    return 2
  }
  const isolate = opts.isolate ?? config.loop.isolate ?? true
  const retainedParallel = opts.explorationSupervisor && loadPrd(path).some(story => !story.passes && existsSync(statePath(targetDir, 'integration-recovery', `${storyPathSegment(story.id)}.json`)))
  const useParallelDispatcher = parallel > 1 || candidates > 1 || retainedParallel === true
  if (opts.resumeWorktree && (!isolate || parallel !== 1)) {
    console.error('--resume-worktree requires isolation and one worker')
    return 2
  }
  if (candidates > 1) {
    const missingQuality = loadPrd(path).find(story => !story.passes && !story.quality)
    if (missingQuality) {
      console.error(`Story ${missingQuality.id} needs a quality declaration before --candidates=${candidates} can dispatch.`)
      return 2
    }
  }
  const outputPolicy = resolveOutputPolicy(config)
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .yoke/config.yaml (e.g. "npm test") so the loop can confirm tests pass before marking work done.')
      return 2
    }
    verify = retryingVerifier(commandVerifier(command, { phase: 'verify', policy: outputPolicy }), config.verify?.retries ?? 1)
  }
  let design = opts.design
  if (!design && config.design) {
    const enabled = config.design.mode === 'on'
      || (config.design.mode === 'auto' && detectUiProject(targetDir).detected)
    if (enabled) design = designVerifier(config.design.max, { policy: outputPolicy })
  }
  // Optional performance budget gate: same contract as verify (exit 0 = within
  // budget), same flake tolerance (benchmarks are noisy).
  let perf = opts.perf
  if (!perf && config.perf?.command) {
    perf = retryingVerifier(commandVerifier(config.perf.command, { phase: 'perf', policy: outputPolicy }), config.perf.retries ?? 1)
  }
  const completion = config.completion?.command
    ? retryingVerifier(commandVerifier(config.completion.command, { phase: 'completion', policy: outputPolicy }), config.completion.retries ?? 1)
    : undefined
  // Opt-in self-update, loop START only — this run keeps executing the version
  // it started with; a fetched upgrade applies from the next invocation.
  maybeAutoUpgrade(config.update?.auto)

  const available = opts.isAvailable ?? isAgentAvailable
  const runnerAgent: Agent = resolveRunnerAgent(config, opts.agent, detectHostAgent())
  const git = opts.git ?? {
    ...realGitOps,
    addWorktree: (repo: string, worktree: string) => prepareIsolatedWorktree(repo, worktree, opts.resumeWorktree === true),
  }
  let commitIdentity = opts.commitIdentity
  if (!commitIdentity && !opts.git) {
    try {
      commitIdentity = resolveCommitIdentity(targetDir, config.commit)
    } catch (error) {
      console.error((error as Error).message)
      return 2
    }
  }
  let audit = opts.audit
  if (!audit && config.audit?.enabled) {
    audit = (dir) => {
      const result = runAudit(dir, {
        command: config.audit?.command,
        suppressions: config.audit?.suppressions,
        commandRunner: (command, commandDir) => commandVerifier(command, { phase: 'audit', policy: outputPolicy })(commandDir),
      })
      return { passed: result.code === 0, summary: result.error ?? (result.findings.map(f => `${f.ruleId} ${f.file}${f.line ? `:${f.line}` : ''}: ${f.message}`).join('\n') || 'audit passed') }
    }
  }
  if (commitIdentity) {
    const announce = opts.json ? console.error : console.log
    if (!opts.quiet) announce(`Commits: ${commitIdentity.authorName} <${commitIdentity.authorEmail}> · co-authors: ${commitIdentity.allowCoAuthors ? 'allowed' : 'disabled'}`)
  }

  const idleMs = resolveIdleMs(opts.timeoutMinutes, config.loop.timeoutMinutes)
  const qualityOverrides: QualityRunOverrides = {
    ...(opts.qualityUnbounded ? { quality: true, qualityUnbounded: true } : opts.quality !== undefined ? { quality: opts.quality } : {}),
    ...(opts.qualityRounds !== undefined ? { qualityRounds: opts.qualityRounds } : {}),
    ...(opts.qualityMinutes !== undefined ? { qualityMinutes: opts.qualityMinutes } : {}),
    ...(opts.qualityPolicy ? { qualityPolicy: opts.qualityPolicy } : {}),
    ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
  }
  if (qualityOverrides.qualityUnbounded) {
    if (!opts.quiet) console.error('WARNING: Quality repair limits are unbounded for this invocation. Mechanical gates, watchdog, isolation, and commit safety remain active.')
  }
  const configuredCriticAgent = config.quality?.critic?.agent ?? config.quality?.criticAgent ?? config.agents.find(agent => agent !== runnerAgent) ?? runnerAgent
  const configuredCriticModel = config.quality?.critic?.model ?? config.quality?.criticModel ?? (configuredCriticAgent === runnerAgent ? config.runner?.model : undefined)
  if (candidates > 1 && !configuredCriticModel) {
    console.error('Quality candidate selection requires quality.critic.model (or legacy quality.criticModel) before any runner or worktree is started.')
    return 2
  }
  let executionReporter: LoopReporter | undefined
  const quality = createQualityCommandHooks({
    targetDir,
    config: opts.routing === false ? { ...config, routing: undefined } : config,
    runnerAgent,
    idleMs,
    onUsage: usage => executionReporter?.addTokens(usage),
    policy: qualityOverrides,
    ...(opts.qualityRuntime ? { runtime: opts.qualityRuntime } : {}),
  })
  if (quality) {
    const resolved = resolveQualityPolicy({ defaults: config.quality, overrides: qualityOverrides })
    const criticAgent = configuredCriticAgent
    const repairAgent = config.quality?.repair?.agent ?? config.quality?.repairAgent ?? runnerAgent
    const limit = resolved.limits.unbounded ? 'unbounded' : `${resolved.limits.maxRounds ?? 3} rounds/${resolved.limits.maxMinutes ?? 60} minutes`
    const announce = opts.json ? console.error : console.log
    if (!opts.quiet) announce(`Quality: ${resolved.policy} · critic: ${criticAgent}${configuredCriticModel ? `/${configuredCriticModel}` : '/provider-default'} · repair: ${repairAgent}${config.quality?.repair?.model ?? config.quality?.repairModel ? `/${config.quality?.repair?.model ?? config.quality?.repairModel}` : '/provider-default'} · permissions: read-only critic/safe repair · budget: ${limit}`)
  }
  const permissions = opts.permissions ?? config.runner?.permissions ?? 'safe'
  const routingRequested = opts.routing ?? config.routing?.enabled ?? true
  const routingEnabled = routingRequested && Boolean(config.routing && (config.routing.workers.length || config.routing.fallback === 'block' || config.routing.maxTier || config.routing.assessmentPolicy === 'prepared'))
  const runnerSelection: ModelSelection = {
    ...(opts.selection ?? {
      provider: config.runner?.provider,
      model: config.runner?.model,
      reasoningEffort: config.runner?.reasoningEffort,
      variant: config.runner?.variant,
      bare: config.runner?.bare,
    }),
    nativeMultiAgent: false,
  }
  const parallelProviders: readonly Omit<StoryWorkerProvider, 'role'>[] = [{
    provider: runnerAgent,
    ...(runnerSelection.provider ? { providerModel: runnerSelection.provider } : {}),
    ...(runnerSelection.model ? { model: runnerSelection.model } : {}),
    ...(runnerSelection.reasoningEffort ? { reasoningEffort: runnerSelection.reasoningEffort } : {}),
    ...(runnerSelection.variant ? { variant: runnerSelection.variant } : {}),
  }]
  const parallelAffinityProviders: readonly Omit<StoryWorkerProvider, 'role'>[] = config.routing?.strategy === 'capability'
    ? config.agents.map(agent => agent === runnerAgent
      ? {
          provider: agent,
          ...(runnerSelection.provider ? { providerModel: runnerSelection.provider } : {}),
          ...(runnerSelection.model ? { model: runnerSelection.model } : {}),
          ...(runnerSelection.reasoningEffort ? { reasoningEffort: runnerSelection.reasoningEffort } : {}),
          ...(runnerSelection.variant ? { variant: runnerSelection.variant } : {}),
        }
      : { provider: agent })
    : (config.routing?.workers ?? []).map(worker => ({
        provider: worker.agent,
        ...(worker.provider ? { providerModel: worker.provider } : {}),
        ...(worker.model ? { model: worker.model } : {}),
        ...(worker.reasoningEffort ? { reasoningEffort: worker.reasoningEffort } : {}),
        ...(worker.variant ? { variant: worker.variant } : {}),
      }))
  const parallelStories = parallel > 1 || candidates > 1 ? loadPrd(path).filter(story => !story.passes) : []
  const ambiguousAffinityProvider = [...new Set(parallelStories.flatMap(story => story.agent ? [story.agent] : []))]
    .find(agent => parallelAffinityProviders.filter(provider => provider.provider === agent).length > 1)
  if (ambiguousAffinityProvider) {
    console.error(`Parallel affinity provider "${ambiguousAffinityProvider}" has multiple profiles. Configure exactly one profile for each story agent.`)
    return 2
  }
  if (opts.runner) {
    const mismatchedAffinity = parallelStories.find(story => {
      if (!story.agent) return false
      const provider = parallelAffinityProviders.find(candidate => candidate.provider === story.agent)
        ?? parallelProviders.find(candidate => candidate.provider === story.agent)
      return !provider
        || provider.provider !== runnerAgent
        || provider.providerModel !== runnerSelection.provider
        || provider.model !== runnerSelection.model
        || provider.reasoningEffort !== runnerSelection.reasoningEffort
        || provider.variant !== runnerSelection.variant
    })
    if (mismatchedAffinity) {
      console.error(`Injected runner cannot truthfully execute affinity provider for story ${mismatchedAffinity.id}. Remove the affinity or use the configured provider runner.`)
      return 2
    }
  }
  const ambiguityPolicy = opts.decisionPolicy ?? opts.onAmbiguity ?? config.loop.decisionPolicy ?? config.loop.onAmbiguity ?? 'auto'
  if (opts.routing === true && (!config.routing || config.routing.workers.length === 0)) {
    console.error('Adaptive routing was requested, but no worker profiles are configured. Run yoke setup . --routing or add routing.workers to .yoke/config.yaml.')
    return 2
  }
  const intake = opts.intake ?? (() => runChangeApply(targetDir, {
    runner: runnerAgent,
    reviewer: opts.reviewer ?? runnerAgent,
    timeoutMs: idleMs,
    isAvailable: available,
    permissions,
    selection: runnerSelection,
    commit: (_path, request) => commitPaths(targetDir, ['.yoke/prd.yaml'], `yoke: plan change ${request.id}`, commitIdentity),
  }))

  let runner = opts.runner
  if (!runner) {
    const requiredProviders = useParallelDispatcher
      ? [...new Set(loadPrd(path).filter(story => !story.passes).map(story => story.agent ?? runnerAgent))]
      : loadPrd(path).filter(story => !story.passes).every(story => config.actions?.some(action => action.storyId === story.id)) ? [] : [runnerAgent]
    const unavailableProvider = requiredProviders.find(agent => !available(agent))
    if (unavailableProvider) {
      console.error(`Agent CLI "${unavailableProvider}" was not found on PATH. Install it, or pick another with --runner=<${AGENT_LIST}>.`)
      return 2
    }
    // Token reporting is part of the machine interface: in --json mode a claude
    // runner switches to stream-json so cumulative usage rides on every status.
    const runnerOpts = {
      onStart: (agent: Agent, selection: import('../agents/types.js').ModelSelection) => executionReporter?.execution?.(agent, selection.model),
      tokenReport: opts.json === true,
      onAmbiguity: ambiguityPolicy,
      perfCommand: config.perf?.command,
      permissions,
      selection: runnerSelection,
    }
    runner = routingEnabled && config.routing
      ? makeAdaptiveRunner({
          parent: runnerAgent,
          projectRoot: targetDir,
          parentSelection: runnerOpts.selection,
          orchestratorSelection: config.routing.orchestrator ?? runnerOpts.selection,
          workers: config.routing.workers,
          rules: config.routing.rules,
          strategy: config.routing.strategy,
          maxCandidates: config.routing.maxCandidates,
          maxAttempts: config.routing.maxAttempts,
          planner: resolvePlanner(config, runnerAgent, runnerSelection),
          assessmentPolicy: config.routing.assessmentPolicy,
          fallback: config.routing.fallback,
          maxTier: config.routing.maxTier,
          onDecision: (id, decision) => executionReporter?.routingDecision?.(id, decision),
          idleTimeoutMs: idleMs,
          permissions,
          runnerOpts,
          isAvailable: available,
        })
      : makeRunner(runnerAgent, idleMs, runnerOpts)
    const announce = opts.json ? console.error : console.log
    if (!opts.quiet) announce(`Runner: ${runnerAgent} · permissions: ${permissions} · routing: ${routingEnabled ? 'on' : routingRequested ? 'auto (parent; no worker profiles)' : 'off'} · workers: ${parallel} local / ${sharedLimit} shared maximum · isolation: ${isolate || parallel > 1 ? 'on' : 'off'} · cwd: ${targetDir}`)
  }

  if (config.actions?.length) {
    if (parallel > 1 || candidates > 1) { console.error('Configured tool actions currently require --parallel=1 --candidates=1'); return 2 }
    runner = makeActionRunner(config.actions, runner)
  }
  let review = opts.reviewRunner
  let reviewProvider: string = 'unknown'
  if (!review && (opts.review || opts.reviewer)) {
    const reviewerAgent = opts.reviewer ?? SUPPORTED_AGENTS.find(agent => agent !== runnerAgent && available(agent))
    if (!reviewerAgent) {
      if (!opts.allowSelfReview) {
        console.error('No independent reviewer CLI is available. Install or select a second agent, or pass --allow-self-review explicitly.')
        return 2
      }
    }
    const resolvedReviewer = reviewerAgent ?? runnerAgent
    reviewProvider = resolvedReviewer
    if (resolvedReviewer === runnerAgent && !opts.allowSelfReview) {
      console.error(`Reviewer "${resolvedReviewer}" is also the implementer. Pick another agent or pass --allow-self-review explicitly.`)
      return 2
    }
    if (!available(resolvedReviewer)) {
      console.error(`Reviewer agent CLI "${resolvedReviewer}" was not found on PATH. Install it, or pick another with --reviewer=<${AGENT_LIST}>.`)
      return 2
    }
    review = context => {
      const implementer = readStatus(targetDir)?.routingDecisions?.[context.story.id]?.provider ?? runnerAgent
      const selectedReviewer = !opts.reviewer && resolvedReviewer === implementer
        ? SUPPORTED_AGENTS.find(agent => agent !== implementer && available(agent)) ?? resolvedReviewer : resolvedReviewer
      if (selectedReviewer === implementer && !opts.allowSelfReview) return { success: false, summary: "Independent review requires a provider distinct from the routed implementer", reviewOutcome: { kind: "infrastructure", summary: "Routed implementation and reviewer share a provider" } }
      reviewProvider = selectedReviewer
      return makeReviewRunner(selectedReviewer, idleMs, undefined, routingEnabled ? roleSelection(targetDir, config, context.story, selectedReviewer, "reviewer") : undefined)(context)
    }
  }

  if (review) {
    const reviewRunner = review
    review = context => {
      const started = Date.now()
      let result: import('./runner.js').AgentResult | undefined
      try { result = reviewRunner(context); return result }
      finally { executionReporter?.addTokens({ inputTokens: 0, outputTokens: 0, measurementComplete: result?.tokens !== undefined, ...result?.tokens, provider: reviewProvider, role: 'reviewer', storyId: context.story.id, durationMs: Date.now() - started }) }
    }
  }
  if (!useParallelDispatcher) {
    if (runner) {
      const unpooled = runner
      runner = context => withSharedWorkerSync({ targetDir, storyId: context.story.id, provider: runnerAgent, role: 'implementation', onWait: waitMs => executionReporter?.resourceWait?.({ id: context.story.id, title: context.story.title }, 'implementation', 1, waitMs, runnerAgent) }, () => unpooled(context))
    }
    if (review) {
      const unpooledReview = review
      const provider = SUPPORTED_AGENTS.includes(reviewProvider as Agent) ? reviewProvider as Agent : runnerAgent
      review = context => withSharedWorkerSync({ targetDir, storyId: context.story.id, provider, role: 'integration', onWait: waitMs => executionReporter?.resourceWait?.({ id: context.story.id, title: context.story.title }, 'integration', 1, waitMs, provider) }, () => unpooledReview(context))
    }
  }
  let lock: ReturnType<typeof acquireLock>
  try {
    statePath(targetDir, 'loop.lock')
    if (opts.ownedLockToken) {
      if (readLock(targetDir)?.ownerToken !== opts.ownedLockToken) throw new Error('Invalid borrowed loop lock')
      lock = { acquired: true, ownerToken: opts.ownedLockToken }
    } else lock = acquireLock(targetDir)
  } catch (error) {
    console.error(`Cannot acquire the Yoke loop lock: ${(error as Error).message}`)
    return 2
  }
  if (!lock.acquired) {
    console.error(`Another loop is already running here (pid ${lock.holderPid}). If that is wrong, run: yoke loop cleanup`)
    return 2
  }
  if (lock.stalePid !== undefined) {
    console.warn(`Took over a stale loop lock (pid ${lock.stalePid} is gone).`)
  }
  let reporter = opts.reporter ?? makeReporter(targetDir, { json: opts.json, quiet: opts.quiet })
  executionReporter = reporter
  try {
    const saved = opts.savedRun ?? createLoopRun({ ...opts, agent: runnerAgent, selection: runnerSelection, parallel, isolate, routing: routingEnabled, timeoutMinutes: opts.timeoutMinutes ?? config.loop.timeoutMinutes })
    if (opts.savedRun && readRunState(targetDir)?.runId !== opts.savedRun.runId) throw new Error('Saved run changed before resume')
    writeRunState(targetDir, saved, lock.ownerToken)
    reporter = accountRunIterations(targetDir, saved, lock.ownerToken, reporter)
    executionReporter = reporter
  } catch (error) {
    if (!opts.ownedLockToken) releaseLock(targetDir, lock.ownerToken)
    reporter.blocked(`could not persist loop run: ${(error as Error).message}`)
    return 1
  }
  const buildResume = (storyId: string, requestId: string) => buildTrustedDecisionResumeState({
    storyId,
    requestId,
    ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    agent: runnerAgent,
    isolate: parallel > 1 || candidates > 1 || isolate,
    reviewer: opts.reviewer,
    review: opts.review === true || opts.reviewRunner !== undefined,
    allowSelfReview: opts.allowSelfReview ?? false,
    timeoutMinutes: opts.timeoutMinutes ?? config.loop.timeoutMinutes,
    json: opts.json ?? false,
    onAmbiguity: opts.decisionPolicy ? undefined : opts.onAmbiguity === 'resolve' || opts.onAmbiguity === 'abort' ? opts.onAmbiguity : (config.loop.decisionPolicy ? undefined : config.loop.onAmbiguity),
    decisionPolicy: opts.decisionPolicy ?? (opts.onAmbiguity ? (opts.onAmbiguity === 'auto' || opts.onAmbiguity === 'critical' ? opts.onAmbiguity : undefined) : config.loop.decisionPolicy),
    permissions,
    parallel,
    routing: routingEnabled,
    ...(qualityOverrides.quality !== undefined ? { quality: qualityOverrides.quality } : {}),
    ...(opts.qualityRounds !== undefined ? { qualityRounds: opts.qualityRounds } : {}),
    ...(opts.qualityMinutes !== undefined ? { qualityMinutes: opts.qualityMinutes } : {}),
    ...(opts.qualityPolicy ? { qualityPolicy: opts.qualityPolicy } : {}),
    ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
  })
  const reconcileDecisionResume = (): number | undefined => {
    try {
      const pendingDecision = readPendingDecision(targetDir)
      if (pendingDecision) {
        writeDecisionResume(targetDir, buildResume(pendingDecision.storyId, decisionRequestId(pendingDecision)))
      } else {
        clearDecisionResume(targetDir)
      }
      return undefined
    } catch (error) {
      reporter.blocked(`could not persist trusted decision resume state: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }
  if (useParallelDispatcher) {
    return runParallelLoopCommand({
      targetDir,
      prdPath: path,
      maxConcurrency: parallel,
      candidateCount: candidates,
      maxIterations: opts.maxIterations ?? Number.POSITIVE_INFINITY,
      runner: opts.runner,
      runnerAgent,
      idleMs,
      permissions,
      selection: runnerSelection,
      providers: parallelProviders,
      affinityProviders: parallelAffinityProviders,
      routing: routingEnabled ? config.routing : undefined,
      planning: config.planning,
      isAvailable: available,
      onAmbiguity: ambiguityPolicy,
      git: opts.git,
      identity: commitIdentity,
      verify,
      verifyCriterion: (dir, _story, criterion) => commandsVerifier(criterion.verify, { phase: 'criterion', policy: outputPolicy })(dir),
      requireCriterionEvidence: config.verify?.requireCriteria ?? false,
      design,
      perf,
      audit,
      review,
      reporter,
      completion,
      quality,
      onCriticalDecision: decision => writeDecisionResume(targetDir, buildResume(decision.storyId, decisionRequestId(decision))),
    }).then(code => reconcileDecisionResume() ?? code).finally(() => { if (!opts.ownedLockToken) releaseLock(targetDir, lock.ownerToken) })
  }
  try {
    const maxIterations = opts.maxIterations ?? Number.POSITIVE_INFINITY
    const result = runLoop({
      prdPath: path,
      targetDir,
      runner,
      git,
      commitIdentity,
      verify,
      verifyCriterion: (dir, _story, criterion) => commandsVerifier(criterion.verify, { phase: 'criterion', policy: outputPolicy })(dir),
      requireCriterionEvidence: config.verify?.requireCriteria ?? false,
      completion,
      intake,
      design,
      perf,
      audit,
      maxIterations,
      isolate,
      review,
      reporter,
      ...(quality ?? {}),
      ...(quality ? { qualityEnabled: quality.qualityEnabled, qualityMetadata: quality.qualityMetadata } : {}),
    })
    const resumeCode = reconcileDecisionResume()
    if (resumeCode !== undefined) return resumeCode
    // In json mode stdout belongs to the NDJSON stream — route the narrative summary to stderr.
    const say = opts.json ? (line: string) => console.error(line) : (line: string) => console.log(line)
    if (!opts.quiet) {
      say(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
      if (result.reason) say(`Reason: ${result.reason}`)
      if (result.reason && /api key|please run \/login|not logged in|auth/i.test(result.reason)) {
        say('Hint: the agent CLI has no credentials in this environment. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY, or log the agent in for headless use.')
      }
    }
    // Exit codes: 0 complete · 1 blocked/cap-reached · 2 config error (handled above) · 3 paused (loop.pause consumed at a story boundary)
    if (result.status === 'complete') return 0
    if (result.status === 'paused') return 3
    return 1
  } finally {
    if (!opts.ownedLockToken) releaseLock(targetDir, lock.ownerToken)
  }
}

async function startContinuousExploration(targetDir: string, options: RunLoopCommandOptions): Promise<number> {
  let lock: ReturnType<typeof acquireLock> | undefined
  try {
    if (options.isolate === false) throw new Error('--explore requires isolated story worktrees')
    if (options.exploreLimitMs !== undefined && (!Number.isSafeInteger(options.exploreLimitMs) || options.exploreLimitMs <= 0 || Date.now() + options.exploreLimitMs > 8_640_000_000_000_000)) throw new Error('--explore-limit must be a positive, supported duration')
    statePath(targetDir, 'loop.lock')
    lock = acquireLock(targetDir)
    if (!lock.acquired) { console.error('Another loop is already running here'); return 2 }
    const config = loadConfig(targetDir)
    const implementationAgent = options.agent ?? resolveRunnerAgent(config, undefined, detectHostAgent())
    const implementationSelection = options.selection ?? config?.runner ?? {}
    const explorationPlanner = options.explorationPlanner ?? resolvePlanner(config, implementationAgent, implementationSelection, options.agent)
    const run = options.savedRun ?? createLoopRun({ ...options, agent: implementationAgent, selection: implementationSelection, explorationPlanner, timeoutMinutes: options.timeoutMinutes ?? config?.loop.timeoutMinutes, ...(options.parallel === undefined && !options.parallelAuto ? typeof config?.loop.parallel === 'number' ? { parallel: config.loop.parallel } : { parallelAuto: true } : {}) })
    if (options.savedRun && readRunState(targetDir)?.runId !== run.runId) throw new Error('Saved run changed before resume')
    writeRunState(targetDir, run, lock.ownerToken)
    return await runContinuousExploration(targetDir, { ...options, selection: run.options.selection, explorationPlanner: run.options.explorationPlanner ?? explorationPlanner, savedRun: run, ownedLockToken: lock.ownerToken })
  } catch (error) { console.error(`Cannot start exploration: ${(error as Error).message}`); return 2 }
  finally { if (lock?.acquired) releaseLock(targetDir, lock.ownerToken) }
}

/** Resume the saved execution identity without extending its exploration deadline. */
export function resumeLoopCommand(targetDir: string): number | Promise<number> {
  const run = readRunState(targetDir)
  if (!run || run.mode === 'goal') throw new Error('No saved loop run to resume')
  const { native: _native, ...options } = run.options
  return runLoopCommand(targetDir, { ...options, ...(run.mode === 'loop' && options.maxIterations !== undefined ? { maxIterations: Math.max(0, options.maxIterations - (run.consumedIterations ?? 0)) } : {}), explore: run.mode === 'explore', savedRun: run, permissions: 'safe' })
}
