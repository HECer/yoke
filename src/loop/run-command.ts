import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig, resolveOutputPolicy, resolveVerifyCommand, type DecisionPolicy } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { commitPaths, realGitOps } from './git.js'
import { makeRunner, makeReviewRunner, isAgentAvailable, type AgentRunner, type AmbiguityPolicy } from './runner.js'
import type { Agent } from '../retrofit/config.js'
import type { GitOps } from './gates.js'
import { commandVerifier, commandsVerifier, retryingVerifier, type Verifier } from './verify.js'
import { readStatus, makeReporter, fmtDuration, type LoopReporter } from './reporter.js'
import { acquireLock, releaseLock } from './lock.js'
import { maybeAutoUpgrade } from '../update/upgrade.js'
import type { PermissionProfile } from '../agents/types.js'
import { resolveCommitIdentity, type CommitIdentity } from './identity.js'
import { runAudit } from '../audit/command.js'
import { detectHostAgent, resolveRunnerAgent } from '../agents/host.js'
import {
  buildTrustedDecisionResumeState, clearDecisionResume, decisionProcessingExists, decisionRequestId, formatPendingDecision,
  readPendingDecision, writeDecisionResume,
} from './decision.js'
import { makeAdaptiveRunner } from '../routing/router.js'
import { runChangeApply } from '../change/inbox.js'
import { createQualityCommandHooks, type QualityCommandRuntime } from '../quality/command.js'
import { resolveQualityPolicy, type QualityPolicy, type QualityRunOverrides } from '../quality/types.js'
import { runParallelLoopCommand } from './parallel-command.js'
import { detectUiProject } from '../retrofit/ui-detect.js'
import { designVerifier } from '../scan/gate.js'

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

export function loopStatus(targetDir: string, now: () => Date = () => new Date()): string {
  const config = loadConfig(targetDir)
  const enabled = config?.loop.enabled ?? false
  const path = prdPath(targetDir)
  let prog = 'no PRD'
  if (existsSync(path)) {
    const p = progress(loadPrd(path))
    prog = `${p.passed}/${p.total} stories pass`
  }
  const st = readStatus(targetDir)
  if (!st) return `Loop: ${enabled ? 'enabled' : 'disabled'}\nPRD: ${prog}`
  const head = `Loop: ${st.state.toUpperCase()}${st.story ? ` on ${st.story}${st.storyTitle ? ` "${st.storyTitle}"` : ''}` : ''}`
  const pct = st.percent !== undefined ? ` (${st.percent}%)` : ''
  const meta = [st.phase, `iteration ${st.iteration}`, `${st.progress.passed}/${st.progress.total}${pct}`, `updated ${relativeTime(st.updatedAt, now())}`]
    .filter(Boolean).join(' · ')
  const lines = [head, `  ${meta}`]
  if (st.state === 'running' && st.eta && st.eta.remainingStories > 0) {
    lines.push(`  ~${fmtDuration(st.eta.etaMs)} remaining (Ø ${fmtDuration(st.eta.avgStoryMs)}/story)`)
  }
  if (st.reason) lines.push(`  reason: ${st.reason}`)
  if (st.quality) lines.push(`  quality: round ${st.quality.currentRound} · ${st.quality.usedRepairs}${st.quality.unbounded ? ' unbounded repairs' : `/${st.quality.maxRepairs ?? 0} repairs`} · ${st.quality.policy}`)
  if (st.parallel) lines.push(`  parallel ${st.parallel.dispatcherId}: ${st.parallel.activeWorkers}/${st.parallel.maxConcurrency} workers · ${st.parallel.queuedCandidates} queued · ${st.parallel.integrated} integrated · ${st.parallel.reopened} reopened`)
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
  const ageMs = now().getTime() - Date.parse(st.updatedAt)
  if (st.state === 'running' && ageMs > STALE_MINUTES * 60_000) {
    lines.push(`  ⚠ possibly stuck — no update in ${relativeTime(st.updatedAt, now())}`)
  }
  return lines.join('\n')
}

export function resolveIdleMs(flagMinutes: number | undefined, configMinutes: number | undefined): number {
  const minutes = flagMinutes ?? configMinutes ?? DEFAULT_IDLE_MINUTES
  return minutes > 0 ? minutes * 60_000 : 0
}

export interface RunLoopCommandOptions {
  /** Optional story batch limit. Omitted means run until every story passes or a gate blocks. */
  maxIterations?: number
  runner?: AgentRunner
  git?: GitOps
  verify?: Verifier
  agent?: Agent
  isAvailable?: (agent: Agent) => boolean
  isolate?: boolean
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
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number | Promise<number> {
  const parallel = opts.parallel ?? 1
  const candidates = opts.candidates ?? 1
  if (!Number.isInteger(parallel) || parallel < 1) {
    console.error('--parallel must be a positive integer')
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
  const git = opts.git ?? realGitOps
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
    announce(`Commits: ${commitIdentity.authorName} <${commitIdentity.authorEmail}> · co-authors: ${commitIdentity.allowCoAuthors ? 'allowed' : 'disabled'}`)
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
    console.error('WARNING: Quality repair limits are unbounded for this invocation. Mechanical gates, watchdog, isolation, and commit safety remain active.')
  }
  const configuredCriticAgent = config.quality?.critic?.agent ?? config.quality?.criticAgent ?? config.agents.find(agent => agent !== runnerAgent) ?? runnerAgent
  const configuredCriticModel = config.quality?.critic?.model ?? config.quality?.criticModel ?? (configuredCriticAgent === runnerAgent ? config.runner?.model : undefined)
  if (candidates > 1 && !configuredCriticModel) {
    console.error('Quality candidate selection requires quality.critic.model (or legacy quality.criticModel) before any runner or worktree is started.')
    return 2
  }
  const quality = createQualityCommandHooks({
    targetDir,
    config,
    runnerAgent,
    idleMs,
    policy: qualityOverrides,
    ...(opts.qualityRuntime ? { runtime: opts.qualityRuntime } : {}),
  })
  if (quality) {
    const resolved = resolveQualityPolicy({ defaults: config.quality, overrides: qualityOverrides })
    const criticAgent = configuredCriticAgent
    const repairAgent = config.quality?.repair?.agent ?? config.quality?.repairAgent ?? runnerAgent
    const limit = resolved.limits.unbounded ? 'unbounded' : `${resolved.limits.maxRounds ?? 3} rounds/${resolved.limits.maxMinutes ?? 60} minutes`
    const announce = opts.json ? console.error : console.log
    announce(`Quality: ${resolved.policy} · critic: ${criticAgent}${configuredCriticModel ? `/${configuredCriticModel}` : '/provider-default'} · repair: ${repairAgent}${config.quality?.repair?.model ?? config.quality?.repairModel ? `/${config.quality?.repair?.model ?? config.quality?.repairModel}` : '/provider-default'} · permissions: read-only critic/safe repair · budget: ${limit}`)
  }
  const permissions = opts.permissions ?? config.runner?.permissions ?? 'safe'
  const routingEnabled = opts.routing ?? config.routing?.enabled ?? false
  const runnerSelection = {
    model: config.runner?.model,
    reasoningEffort: config.runner?.reasoningEffort,
    bare: config.runner?.bare,
    ...((routingEnabled || opts.routing === false) ? { nativeMultiAgent: false } : {}),
  }
  if ((parallel > 1 || candidates > 1) && routingEnabled) {
    console.error('Adaptive routing is not available with parallel workers or quality candidates. Run with --parallel=1 --candidates=1 or disable routing.')
    return 2
  }
  const parallelProviders = [{
    provider: runnerAgent,
    ...(runnerSelection.model ? { model: runnerSelection.model } : {}),
    ...(runnerSelection.reasoningEffort ? { reasoningEffort: runnerSelection.reasoningEffort } : {}),
  }]
  const parallelAffinityProviders = (config.routing?.workers ?? []).map(worker => ({
    provider: worker.agent,
    ...(worker.model ? { model: worker.model } : {}),
    ...(worker.reasoningEffort ? { reasoningEffort: worker.reasoningEffort } : {}),
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
        || provider.model !== runnerSelection.model
        || provider.reasoningEffort !== runnerSelection.reasoningEffort
    })
    if (mismatchedAffinity) {
      console.error(`Injected runner cannot truthfully execute affinity provider for story ${mismatchedAffinity.id}. Remove the affinity or use the configured provider runner.`)
      return 2
    }
  }
  const ambiguityPolicy = opts.decisionPolicy ?? opts.onAmbiguity ?? config.loop.decisionPolicy ?? config.loop.onAmbiguity ?? 'auto'
  if (routingEnabled && (!config.routing || config.routing.workers.length === 0)) {
    console.error('Adaptive routing was requested, but no worker profiles are configured. Run yoke setup . --routing or add routing.workers to .yoke/config.yaml.')
    return 2
  }
  const intake = opts.intake ?? (() => runChangeApply(targetDir, {
    runner: runnerAgent,
    reviewer: opts.reviewer ?? runnerAgent,
    timeoutMs: idleMs,
    isAvailable: available,
    permissions,
    selection: {
      model: config.runner?.model,
      reasoningEffort: config.runner?.reasoningEffort,
      bare: config.runner?.bare,
    },
    commit: (_path, request) => commitPaths(targetDir, ['.yoke/prd.yaml'], `yoke: plan change ${request.id}`, commitIdentity),
  }))

  let runner = opts.runner
  if (!runner) {
    const requiredProviders = parallel > 1 || candidates > 1
      ? [...new Set(loadPrd(path).filter(story => !story.passes).map(story => story.agent ?? runnerAgent))]
      : [runnerAgent]
    const unavailableProvider = requiredProviders.find(agent => !available(agent))
    if (unavailableProvider) {
      console.error(`Agent CLI "${unavailableProvider}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    // Token reporting is part of the machine interface: in --json mode a claude
    // runner switches to stream-json so cumulative usage rides on every status.
    const runnerOpts = {
      tokenReport: opts.json === true,
      onAmbiguity: ambiguityPolicy,
      perfCommand: config.perf?.command,
      permissions,
      selection: runnerSelection,
    }
    runner = routingEnabled && config.routing
      ? makeAdaptiveRunner({
          parent: runnerAgent,
          parentSelection: runnerOpts.selection,
          orchestratorSelection: config.routing.orchestrator ?? runnerOpts.selection,
          workers: config.routing.workers,
          strategy: config.routing.strategy,
          maxCandidates: config.routing.maxCandidates,
          idleTimeoutMs: idleMs,
          permissions,
          runnerOpts,
          isAvailable: available,
        })
      : makeRunner(runnerAgent, idleMs, runnerOpts)
    const announce = opts.json ? console.error : console.log
    announce(`Runner: ${runnerAgent} · permissions: ${permissions} · routing: ${routingEnabled ? 'on' : 'off'} · cwd: ${targetDir}`)
  }

  let review = opts.reviewRunner
  if (!review && (opts.review || opts.reviewer)) {
    const reviewerAgent = opts.reviewer ?? (['codex', 'gemini', 'claude'] as Agent[]).find(agent => agent !== runnerAgent && available(agent))
    if (!reviewerAgent) {
      if (!opts.allowSelfReview) {
        console.error('No independent reviewer CLI is available. Install or select a second agent, or pass --allow-self-review explicitly.')
        return 2
      }
    }
    const resolvedReviewer = reviewerAgent ?? runnerAgent
    if (resolvedReviewer === runnerAgent && !opts.allowSelfReview) {
      console.error(`Reviewer "${resolvedReviewer}" is also the implementer. Pick another agent or pass --allow-self-review explicitly.`)
      return 2
    }
    if (!available(resolvedReviewer)) {
      console.error(`Reviewer agent CLI "${resolvedReviewer}" was not found on PATH. Install it, or pick another with --reviewer=<claude|codex|gemini>.`)
      return 2
    }
    review = makeReviewRunner(resolvedReviewer, idleMs)
  }

  let lock: ReturnType<typeof acquireLock>
  try { lock = acquireLock(targetDir) } catch (error) {
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
  const reporter = opts.reporter ?? makeReporter(targetDir, { json: opts.json })
  const buildResume = (storyId: string, requestId: string) => buildTrustedDecisionResumeState({
    storyId,
    requestId,
    ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    agent: runnerAgent,
    isolate: parallel > 1 || candidates > 1 || (opts.isolate ?? false),
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
  if (parallel > 1 || candidates > 1) {
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
    }).then(code => reconcileDecisionResume() ?? code).finally(() => releaseLock(targetDir, lock.ownerToken))
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
      isolate: (opts.parallel ?? 1) > 1 ? true : (opts.isolate ?? false),
      review,
      reporter,
      ...(quality ?? {}),
      ...(quality ? { qualityEnabled: quality.qualityEnabled, qualityMetadata: quality.qualityMetadata } : {}),
    })
    const resumeCode = reconcileDecisionResume()
    if (resumeCode !== undefined) return resumeCode
    // In json mode stdout belongs to the NDJSON stream — route the narrative summary to stderr.
    const say = opts.json ? (line: string) => console.error(line) : (line: string) => console.log(line)
    say(`Loop ${result.status} after ${result.iterations} iteration(s): ${result.finalProgress.passed}/${result.finalProgress.total} stories pass`)
    if (result.reason) say(`Reason: ${result.reason}`)
    if (result.reason && /api key|please run \/login|not logged in|auth/i.test(result.reason)) {
      say('Hint: the agent CLI has no credentials in this environment. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY, or log the agent in for headless use.')
    }
    // Exit codes: 0 complete · 1 blocked/cap-reached · 2 config error (handled above) · 3 paused (loop.pause consumed at a story boundary)
    if (result.status === 'complete') return 0
    if (result.status === 'paused') return 3
    return 1
  } finally {
    releaseLock(targetDir, lock.ownerToken)
  }
}
