import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, saveConfig, defaultConfig, resolveVerifyCommand, type DecisionPolicy } from '../retrofit/config.js'
import { loadPrd, progress } from './prd.js'
import { runLoop } from './loop.js'
import { realGitOps } from './git.js'
import { makeRunner, makeReviewRunner, isAgentAvailable, type AgentRunner, type AmbiguityPolicy } from './runner.js'
import type { Agent } from '../retrofit/config.js'
import type { GitOps } from './gates.js'
import { commandVerifier, retryingVerifier, type Verifier } from './verify.js'
import { readStatus, makeReporter, fmtDuration, type LoopReporter } from './reporter.js'
import { acquireLock, releaseLock } from './lock.js'
import { maybeAutoUpgrade } from '../update/upgrade.js'
import type { PermissionProfile } from '../agents/types.js'
import { resolveCommitIdentity, type CommitIdentity } from './identity.js'
import { runAudit } from '../audit/command.js'
import { detectHostAgent, resolveRunnerAgent } from '../agents/host.js'
import {
  clearDecisionResume, decisionProcessingExists, decisionRequestId, formatPendingDecision,
  readPendingDecision, writeDecisionResume,
} from './decision.js'
import { makeAdaptiveRunner } from '../routing/router.js'

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
  permissions?: PermissionProfile
  allowSelfReview?: boolean
  commitIdentity?: CommitIdentity
  audit?: Verifier
  parallel?: number
  /** Override config.routing.enabled for this invocation. */
  routing?: boolean
}

export function runLoopCommand(targetDir: string, opts: RunLoopCommandOptions): number {
  if ((opts.parallel ?? 1) > 1) {
    console.error('Parallel CLI workers are not enabled yet. The dependency-aware dispatcher and merge queue are available as APIs; use --parallel=1 for the synchronous provider runner.')
    return 2
  }
  const config = loadConfig(targetDir)
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
  let verify = opts.verify
  if (!verify) {
    const command = resolveVerifyCommand(targetDir, config)
    if (!command) {
      console.error('No verify command configured. Set verify.command in .yoke/config.yaml (e.g. "npm test") so the loop can confirm tests pass before marking work done.')
      return 2
    }
    verify = retryingVerifier(commandVerifier(command), config.verify?.retries ?? 1)
  }
  // Optional performance budget gate: same contract as verify (exit 0 = within
  // budget), same flake tolerance (benchmarks are noisy).
  let perf = opts.perf
  if (!perf && config.perf?.command) {
    perf = retryingVerifier(commandVerifier(config.perf.command), config.perf.retries ?? 1)
  }
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
      const result = runAudit(dir, { command: config.audit?.command, suppressions: config.audit?.suppressions })
      return { passed: result.code === 0, summary: result.error ?? (result.findings.map(f => `${f.ruleId} ${f.file}${f.line ? `:${f.line}` : ''}`).join(', ') || 'audit passed') }
    }
  }
  if (commitIdentity) {
    const announce = opts.json ? console.error : console.log
    announce(`Commits: ${commitIdentity.authorName} <${commitIdentity.authorEmail}> · co-authors: ${commitIdentity.allowCoAuthors ? 'allowed' : 'disabled'}`)
  }

  const idleMs = resolveIdleMs(opts.timeoutMinutes, config.loop.timeoutMinutes)
  const permissions = opts.permissions ?? config.runner?.permissions ?? 'safe'
  const routingEnabled = opts.routing ?? config.routing?.enabled ?? false
  if (routingEnabled && (!config.routing || config.routing.workers.length === 0)) {
    console.error('Adaptive routing was requested, but no worker profiles are configured. Run yoke setup . --routing or add routing.workers to .yoke/config.yaml.')
    return 2
  }

  let runner = opts.runner
  if (!runner) {
    if (!available(runnerAgent)) {
      console.error(`Agent CLI "${runnerAgent}" was not found on PATH. Install it, or pick another with --runner=<claude|codex|gemini>.`)
      return 2
    }
    // Token reporting is part of the machine interface: in --json mode a claude
    // runner switches to stream-json so cumulative usage rides on every status.
    const runnerOpts = {
      tokenReport: opts.json === true,
      onAmbiguity: opts.decisionPolicy ?? opts.onAmbiguity ?? config.loop.decisionPolicy ?? config.loop.onAmbiguity ?? 'auto',
      perfCommand: config.perf?.command,
      permissions,
      selection: {
        model: config.runner?.model,
        reasoningEffort: config.runner?.reasoningEffort,
        bare: config.runner?.bare,
        ...((routingEnabled || opts.routing === false) ? { nativeMultiAgent: false } : {}),
      },
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
  try {
    const reporter = opts.reporter ?? makeReporter(targetDir, { json: opts.json })
    const maxIterations = opts.maxIterations ?? Number.POSITIVE_INFINITY
    const result = runLoop({
      prdPath: path,
      targetDir,
      runner,
      git,
      commitIdentity,
      verify,
      perf,
      audit,
      maxIterations,
      isolate: (opts.parallel ?? 1) > 1 ? true : (opts.isolate ?? false),
      review,
      reporter,
    })
    try {
      const pendingDecision = readPendingDecision(targetDir)
      if (pendingDecision) {
        writeDecisionResume(targetDir, {
          version: 1,
          storyId: pendingDecision.storyId,
          requestId: decisionRequestId(pendingDecision),
          answered: false,
          ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
          agent: runnerAgent,
          isolate: opts.isolate ?? false,
          reviewer: opts.reviewer,
          review: opts.review === true || opts.reviewRunner !== undefined,
          allowSelfReview: opts.allowSelfReview ?? false,
          timeoutMinutes: opts.timeoutMinutes ?? config.loop.timeoutMinutes,
          json: opts.json ?? false,
          onAmbiguity: opts.decisionPolicy
            ? undefined
            : opts.onAmbiguity === 'resolve' || opts.onAmbiguity === 'abort'
              ? opts.onAmbiguity
              : (config.loop.decisionPolicy ? undefined : config.loop.onAmbiguity),
          decisionPolicy: opts.decisionPolicy
            ?? (opts.onAmbiguity
              ? (opts.onAmbiguity === 'auto' || opts.onAmbiguity === 'critical' ? opts.onAmbiguity : undefined)
              : config.loop.decisionPolicy),
          permissions,
          parallel: opts.parallel ?? 1,
          routing: routingEnabled,
        })
      } else clearDecisionResume(targetDir)
    } catch (error) {
      const reason = `could not persist trusted decision resume state: ${(error as Error).message}`
      reporter.blocked(reason)
      return 1
    }
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
