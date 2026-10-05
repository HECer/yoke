import { cacheIsolationProblem } from './cache-isolation.js'
import { retainRuntimeProof } from './proof-retention.js'
import { knownInfrastructureFailure } from "../routing/capability.js"
import { executionFailure, failureObservation, type FailureObservation } from '../observability/failure.js'
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { acceptanceProtectionProblem } from '../check/command.js'
import { join, relative } from 'node:path'
import { isAcceptanceCriterion, loadPrd, savePrd, selectNextStory, allPass, progress, storyPathSegment, type AcceptanceCriterion, type Story } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentContext, AgentResult, AgentRunner } from './runner.js'
import type { Verifier, VerifyResult } from './verify.js'
import { observeFailure, clearFailureProgress, type LoopFailure, type FailureStage } from './failure.js'
import { gateIdentity, snapshotGates, reuseGates, type GateSnapshot } from './gate-snapshot.js'
import { appendDecision, contextDir } from '../context/context.js'
import { noopReporter, type LoopReporter } from './reporter.js'
import type { CommitIdentity } from './identity.js'
import { consumeDecisionRequest } from './decision.js'
import { writeCriterionEvidence } from './evidence.js'
import { runQualityRepairLoop, type QualityStage, type RepairRequest } from '../quality/loop.js'
import type { RepairLimits, ReviewOutcome } from '../quality/repair.js'
import type { QualityStatusMetadata } from '../quality/types.js'
export type { QualityStage } from '../quality/loop.js'

function blockReason(base: string, targetDir: string, git: GitOps): string {
  let dirty = false
  try { dirty = !git.isClean(targetDir) } catch { /* ignore */ }
  return dirty
    ? `${base} (working tree has uncommitted changes from the blocked story — review/clean before re-running)`
    : base
}

export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  feedback?: string
  git: GitOps
  verify: Verifier
  design?: Verifier
  verifyCriterion?: (targetDir: string, story: Story, criterion: AcceptanceCriterion) => ReturnType<Verifier>
  requireCriterionEvidence?: boolean
  /** Optional integrated-system gate, run whenever no open stories remain. */
  completion?: Verifier
  /** Process at most one queued product change at each safe story boundary. */
  intake?: () => { ok: boolean; added: number; summary: string }
  /** Optional performance budget gate — runs after verify; a red benchmark blocks the story. */
  perf?: Verifier
  audit?: Verifier
  maxIterations: number
  isolate?: boolean
  review?: AgentRunner
  repair?: (context: AgentContext, request: RepairRequest) => AgentResult
  repairLimits?: RepairLimits
  qualityPreflight?: (context: AgentContext) => { readonly kind: 'ready' } | { readonly kind: 'blocked'; readonly summary: string } | { readonly kind: 'skipped'; readonly summary: string }
  qualityStage?: (context: AgentContext, round: number) => QualityStage
  qualityEnabled?: (story: Story) => boolean
  qualityMetadata?: (context: AgentContext) => QualityStatusMetadata | undefined
  reporter?: LoopReporter
  commitIdentity?: CommitIdentity
}

function reviewOutcome(result: AgentResult): ReviewOutcome {
  if (result.reviewOutcome) return result.reviewOutcome
  if (result.success) {
    return { kind: 'approved', verdict: { approved: true, summary: result.summary, findings: [] } }
  }
  return { kind: 'malformed', summary: result.summary }
}

function repairBlockReason(
  outcome: ReturnType<typeof runQualityRepairLoop>,
  story: Story,
  targetDir: string,
  git: GitOps,
): string | null {
  if (outcome.kind === 'approved' || outcome.kind === 'paused' || outcome.kind === 'cancelled') return null
  const detail = outcome.summary ? `: ${outcome.summary}` : ''
  const stage = outcome.reason === 'gate-failed' ? ` (${outcome.stage})` : ''
  return blockReason(`story ${story.id} repair blocked${stage}: ${outcome.reason}${detail}`, targetDir, git)
}

function runQualityReview(
  opts: LoopOptions,
  executionDir: string,
  story: Story,
  reporter: LoopReporter,
): (ReturnType<typeof runQualityRepairLoop> & { readonly failure?: LoopFailure }) | null {
  const qualityAssessment = opts.qualityEnabled?.(story) === false ? undefined : opts.qualityStage
  const reviewAssessment = opts.review
  if (!qualityAssessment && !reviewAssessment) return null
  const qualityMetadata = opts.qualityMetadata?.({ targetDir: executionDir, story })
  let failure: LoopFailure | undefined
  const failedRerun = (stage: 'criterion' | 'verify' | 'design' | 'perf' | 'audit', verdict: VerifyResult) => {
    failure = { kind: 'verification-failed', stage, storyId: story.id, observation: verdict.failure ?? failureObservation() }
    return { kind: 'failed' as const, stage, summary: verdict.summary }
  }
  const rerunGates = () => {
    const criteria = runCriterionGates(opts, executionDir, story)
    if (!criteria.passed) return failedRerun('criterion', criteria)
    reporter.phase('verifying')
    const verify = runGate(opts.verify, executionDir, story.id)
    if (!verify.passed) return failedRerun('verify', verify)
    if (opts.design) {
      reporter.phase('design')
      const design = runGate(opts.design, executionDir, story.id)
      if (!design.passed) return failedRerun('design', design)
    }
    if (opts.perf) {
      reporter.phase('perf')
      const perf = runGate(opts.perf, executionDir, story.id)
      if (!perf.passed) return failedRerun('perf', perf)
    }
    if (opts.audit) {
      reporter.phase('audit')
      const audit = runGate(opts.audit, executionDir, story.id)
      if (!audit.passed) return failedRerun('audit', audit)
    }
    return { kind: 'passed' as const }
  }
  const outcome = runQualityRepairLoop({
    quality: qualityAssessment
      ? round => {
        reporter.phase('comparing')
        return qualityAssessment({ targetDir: executionDir, story }, round)
      }
      : undefined,
    review: reviewAssessment
      ? () => {
        reporter.phase('reviewing')
        return reviewOutcome(reviewAssessment({ targetDir: executionDir, story }))
      }
      : undefined,
    repair: request => {
      reporter.phase('repairing')
      if (!opts.repair) return { kind: 'blocked', summary: 'repair callback is not configured' }
      const observed = observeFailure({ root: opts.targetDir, directory: executionDir, story, stage: 'quality', summary: JSON.stringify(request.finding) })
      if (observed.action === 'blocked') { failure = observed.failure; return { kind: 'blocked', summary: observed.feedback } }
      const targetedRequest = observed.action === 'diagnose' ? { ...request, finding: { ...request.finding, message: observed.feedback } } : request
      const result = opts.repair({ targetDir: executionDir, story }, targetedRequest)
      return result.success ? { kind: 'repaired' } : { kind: 'blocked', summary: result.summary }
    },
    rerunGates,
    limits: opts.repairLimits,
    pause: () => consumePause(opts.targetDir),
    onStatus: status => {
      if (qualityMetadata) reporter.quality({ ...status, ...qualityMetadata })
    },
  })
  return { ...outcome, ...(failure ? { failure } : {}) }
}

export interface LoopResult {
  status: 'complete' | 'blocked' | 'cap-reached' | 'paused'
  failure?: LoopFailure
  iterations: number
  reason?: string
  finalProgress: { passed: number; total: number }
}

// Control file a supervisor drops to pause the loop at the next story boundary.
// The loop consumes (deletes) it and stops with state 'paused' — never mid-story.
export function pauseFilePath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.pause')
}

/** Request a pause at the next safe story or exploration boundary. */
export function requestLoopPause(targetDir: string): void {
  const file = pauseFilePath(targetDir)
  mkdirSync(join(targetDir, '.yoke'), { recursive: true })
  try { writeFileSync(file, `${new Date().toISOString()}\n`, { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function consumePause(targetDir: string): boolean {
  const file = pauseFilePath(targetDir)
  if (!existsSync(file)) return false
  try { unlinkSync(file) } catch { /* consumed best-effort — pausing still wins */ }
  return true
}

// Abort channel for an agent that hits genuinely undecidable acceptance criteria
// (only instructed to use it under loop.onAmbiguity: abort). Honoured whenever
// present: without this check, an agent that stopped without changes would sail
// through verify on pre-existing green tests and be falsely marked done.
export function ambiguityFilePath(dir: string): string {
  return join(dir, '.yoke', 'ambiguity.md')
}

// Run a gate command with the story id exposed via YOKE_STORY (restored after),
// so cumulative fixtures and story-aware benchmarks know which story is on trial.
function runGate(gate: Verifier, dir: string, storyId: string) {
  const prev = process.env.YOKE_STORY
  process.env.YOKE_STORY = storyId
  try {
    return gate(dir)
  } finally {
    if (prev === undefined) delete process.env.YOKE_STORY
    else process.env.YOKE_STORY = prev
  }
}

export function consumeAmbiguity(dir: string): string | null {
  const file = ambiguityFilePath(dir)
  if (!existsSync(file)) return null
  let content = ''
  try { content = readFileSync(file, 'utf8') } catch { /* the signal alone still blocks */ }
  try { unlinkSync(file) } catch { /* best-effort consume */ }
  const compact = content.replace(/\s+/g, ' ').trim().slice(0, 500)
  return compact || 'agent reported ambiguous acceptance criteria without details'
}

function runCompletionGate(opts: LoopOptions, stories: Story[]): LoopResult | null {
  if (!opts.completion) return null
  const previous = process.env.YOKE_PHASE
  process.env.YOKE_PHASE = 'completion'
  let reason: string | undefined
  let observation: FailureObservation | undefined
  try {
    const verdict = opts.completion(opts.targetDir)
    if (!verdict.passed) { reason = `integrated system did not verify: ${verdict.summary}`; observation = verdict.failure }
    else if (!opts.git.isClean(opts.targetDir)) reason = 'completion command left source or final assets dirty; preserve changes and move rerun proofs to ignored runtime paths before resuming'
  } catch (error) {
    observation = executionFailure(error)
    reason = `integrated completion gate failed: ${(error as Error).message}`
  } finally {
    if (previous === undefined) delete process.env.YOKE_PHASE
    else process.env.YOKE_PHASE = previous
  }
  if (!reason) { clearFailureProgress(opts.targetDir); return null }
  const observed = observeFailure({ root: opts.targetDir, directory: opts.targetDir, stage: 'completion', summary: reason, observation })
  if (observed.action !== 'retry') reason = observed.feedback
  ;(opts.reporter ?? noopReporter).blocked(reason, observed.failure)
  return { status: 'blocked', iterations: 0, reason, failure: observed.failure, finalProgress: progress(stories) }
}

function runCriterionGates(opts: LoopOptions, executionDir: string, story: Story): VerifyResult {
  const cacheProblem = opts.isolate && executionDir !== opts.targetDir ? cacheIsolationProblem(executionDir) : undefined
  if (cacheProblem) return { passed: false, summary: cacheProblem }
  const protectionProblem = acceptanceProtectionProblem(executionDir, opts.targetDir)
  if (protectionProblem) return { passed: false, summary: protectionProblem }
  const criteria = story.acceptance.filter(isAcceptanceCriterion)
  if (criteria.length === 0) {
    return opts.requireCriterionEvidence
      ? { passed: false, summary: `story ${story.id} lacks executable criterion evidence` }
      : { passed: true, summary: 'legacy acceptance criteria' }
  }
  if (!opts.verifyCriterion) return { passed: false, summary: `story ${story.id} has criteria but no criterion verifier` }
  const evidence = criteria.map(criterion => {
    const problem = opts.isolate && executionDir !== opts.targetDir ? cacheIsolationProblem(executionDir) : undefined
    return { criterion, result: problem ? { passed: false, summary: problem } : opts.verifyCriterion!(executionDir, story, criterion) }
  })
  try {
    writeCriterionEvidence(opts.targetDir, story, evidence)
  } catch (error) {
    return { passed: false, summary: `could not persist criterion evidence: ${(error as Error).message}`, failure: failureObservation('storage') }
  }
  const failed = evidence.find(item => !item.result.passed)
  return failed
    ? { ...failed.result, passed: false, summary: `${failed.criterion.id}: ${failed.result.summary}` }
    : { passed: true, summary: `${evidence.length} acceptance criteria verified` }
}

export function runLoop(opts: LoopOptions): LoopResult {
  if (opts.isolate) for (const name of ['verify', 'design', 'perf', 'audit'] as const) {
    const gate = opts[name]
    if (gate) opts = { ...opts, [name]: (dir: string) => {
      const problem = dir !== opts.targetDir ? cacheIsolationProblem(dir) : undefined
      return problem ? { passed: false, summary: problem } : gate(dir)
    } }
  }
  let iterations = 0
  const reporter = opts.reporter ?? noopReporter

  for (;;) {
    let stories = loadPrd(opts.prdPath)

    if (stories.length === 0) {
      reporter.blocked('PRD has no stories')
      return { status: 'blocked', iterations, reason: 'PRD has no stories', finalProgress: { passed: 0, total: 0 } }
    }
    const capReached = iterations >= opts.maxIterations
    if (capReached && !allPass(stories)) {
      reporter.capReached(progress(stories))
      return { status: 'cap-reached', iterations, finalProgress: progress(stories) }
    }

    // Intake is work at a story boundary. Cap, pause, and clean-tree safety must
    // win before a planner is allowed to edit and commit the PRD.
    if (consumePause(opts.targetDir)) {
      reporter.paused(progress(stories))
      return { status: 'paused', iterations, finalProgress: progress(stories) }
    }

    const pre = preDispatchGate(opts.targetDir, opts.git)
    if (!pre.ok) {
      const reason = opts.intake ? `change intake blocked by dirty worktree: ${pre.reason ?? 'pre-dispatch gate failed'}` : pre.reason
      reporter.blocked(reason ?? 'pre-dispatch gate failed')
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    // A bounded run that finished its final story may report completion, but it
    // must not plan additional queued work after the requested cap.
    if (capReached) {
      const completionFailure = runCompletionGate(opts, stories)
      if (completionFailure) return { ...completionFailure, iterations }
      reporter.complete(progress(stories))
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }

    if (opts.intake) {
      let intake: { ok: boolean; added: number; summary: string }
      try {
        intake = opts.intake()
      } catch (error) {
        const stories = loadPrd(opts.prdPath)
        const reason = `change intake failed: ${(error as Error).message}`
        reporter.blocked(reason, undefined, executionFailure(error))
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      }
      if (!intake.ok) {
        const stories = loadPrd(opts.prdPath)
        const reason = `change intake failed: ${intake.summary}`
        reporter.blocked(reason)
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      }
      if (intake.added > 0) {
        const afterIntake = preDispatchGate(opts.targetDir, opts.git)
        if (!afterIntake.ok) {
          const stories = loadPrd(opts.prdPath)
          const reason = `change intake left a dirty worktree: ${afterIntake.reason ?? 'pre-dispatch gate failed'}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
      }
    }
    stories = loadPrd(opts.prdPath)

    if (stories.length === 0) {
      reporter.blocked('PRD has no stories')
      return { status: 'blocked', iterations, reason: 'PRD has no stories', finalProgress: { passed: 0, total: 0 } }
    }

    if (allPass(stories)) {
      const completionFailure = runCompletionGate(opts, stories)
      if (completionFailure) return { ...completionFailure, iterations }
      reporter.complete(progress(stories))
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }
    const story = selectNextStory(stories)
    if (!story) {
      reporter.complete(progress(stories))
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }

    const stl = stopTheLineGate(story, opts.requireCriterionEvidence)
    if (!stl.ok) {
      reporter.blocked(stl.reason ?? 'stop-the-line gate failed')
      return { status: 'blocked', iterations, reason: stl.reason, finalProgress: progress(stories) }
    }

    reporter.storyStart({ id: story.id, title: story.title }, iterations + 1, progress(stories))

    if (opts.qualityPreflight && opts.qualityEnabled?.(story) !== false) {
      reporter.phase('quality-preflight')
      const preflight = opts.qualityPreflight({ targetDir: opts.targetDir, story })
      if (preflight.kind === 'blocked') {
        const reason = blockReason(`story ${story.id} quality preflight: ${preflight.summary}`, opts.targetDir, opts.git)
        reporter.blocked(reason)
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      }
    }

    if (opts.isolate) {
      const wt = join(opts.targetDir, '.yoke', 'worktrees', storyPathSegment(story.id))
      const wtPrd = join(wt, relative(opts.targetDir, opts.prdPath))
      let landed: { passed: number; total: number } | null = null
      let activeRouting: AgentResult['routing']
      try {
        opts.git.addWorktree(opts.targetDir, wt)
        const implementation = runImplementation(opts, wt, story, reporter)
        const result = implementation.result
        activeRouting = result.routing
        iterations++
        if (result.tokens) reporter.addTokens(result.tokens)
        if (result.infrastructureFailure || result.routing?.blocked) { if (result.infrastructureFailure) result.routing?.recordOutcome(false, "infrastructure"); reporter.blocked(result.summary, implementation.failure, result.failure); return { status: "blocked", iterations, reason: result.summary, ...(implementation.failure ? { failure: implementation.failure } : {}), finalProgress: progress(stories) } }
        let decision
        try { decision = consumeDecisionRequest(wt, opts.targetDir, story.id) } catch (error) {
          result.routing?.recordOutcome(false, 'infrastructure')
          const reason = `invalid critical decision request for story ${story.id}: ${(error as Error).message}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        if (decision) {
          result.routing?.recordOutcome(false, 'infrastructure')
          const reason = `critical decision required for story ${story.id}: ${decision.question}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const ambiguity = consumeAmbiguity(wt)
        if (ambiguity) {
          result.routing?.recordOutcome(false, 'infrastructure')
          const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const verified = reuseGates(wt, story, implementation.gates)
        const criteriaVerdict = verified?.criteria ?? runCriterionGates(opts, wt, story)
        if (!criteriaVerdict.passed) {
          result.routing?.recordOutcome(false)
          const reason = blockReason(`story ${story.id} lacks acceptance evidence: ${criteriaVerdict.summary}`, opts.targetDir, opts.git)
          return blockedMechanicalGate(opts, wt, story, 'criterion', criteriaVerdict.summary, reason, iterations, stories, criteriaVerdict.failure)
        }
        // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
        // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
        reporter.phase('verifying')
        const verdict = verified?.verify ?? runGate(opts.verify, wt, story.id)
        if (!verdict.passed) {
          result.routing?.recordOutcome(false)
          const base = result.success
            ? `story ${story.id} did not verify: ${verdict.summary}`
            : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
          const reason = blockReason(base, opts.targetDir, opts.git)
          return blockedMechanicalGate(opts, wt, story, 'verify', verdict.summary, reason, iterations, stories, verdict.failure)
        }
        if (opts.design) {
          reporter.phase('design')
          const designVerdict = verified?.design ?? runGate(opts.design, wt, story.id)
          if (!designVerdict.passed) {
            result.routing?.recordOutcome(false)
            const reason = blockReason(`story ${story.id} failed its design gate: ${designVerdict.summary}`, opts.targetDir, opts.git)
            return blockedMechanicalGate(opts, wt, story, 'design', designVerdict.summary, reason, iterations, stories, designVerdict.failure)
          }
        }
        if (opts.perf) {
          reporter.phase('perf')
          const perfVerdict = verified?.perf ?? runGate(opts.perf, wt, story.id)
          if (!perfVerdict.passed) {
            result.routing?.recordOutcome(false)
            const reason = blockReason(`story ${story.id} exceeded its performance budget: ${perfVerdict.summary}`, opts.targetDir, opts.git)
            return blockedMechanicalGate(opts, wt, story, 'perf', perfVerdict.summary, reason, iterations, stories, perfVerdict.failure)
          }
        }
        if (opts.audit) {
          reporter.phase('audit')
          const auditVerdict = verified?.audit ?? runGate(opts.audit, wt, story.id)
          if (!auditVerdict.passed) {
            result.routing?.recordOutcome(false)
            const reason = blockReason(`story ${story.id} failed security audit: ${auditVerdict.summary}`, opts.targetDir, opts.git)
            return blockedMechanicalGate(opts, wt, story, 'audit', auditVerdict.summary, reason, iterations, stories, auditVerdict.failure)
          }
        }
        const summary = result.success
          ? result.summary
          : `${result.summary} (runner exited non-zero but verify is green)`
        const repairOutcome = runQualityReview(opts, wt, story, reporter)
        if (repairOutcome) {
          if (repairOutcome.kind === 'paused') {
            result.routing?.recordOutcome(false, 'infrastructure')
            reporter.paused(progress(stories))
            return { status: 'paused', iterations, finalProgress: progress(stories) }
          }
          const reason = repairBlockReason(repairOutcome, story, opts.targetDir, opts.git)
          if (reason) {
            result.routing?.recordOutcome(false)
            reporter.blocked(reason, repairOutcome.failure)
            return { status: 'blocked', iterations, reason, ...(repairOutcome.failure ? { failure: repairOutcome.failure } : {}), finalProgress: progress(stories) }
          }
        }
        const protection = acceptanceProtectionProblem(wt, opts.targetDir)
        if (protection) {
          result.routing?.recordOutcome(false); reporter.blocked(protection)
          return { status: 'blocked', iterations, reason: protection, finalProgress: progress(stories) }
        }
        // The worktree is a checkout of committed HEAD, so the agent above reads
        // context from HEAD's .yoke/context — commit context changes for --isolate
        // to honour them. We write the decision here so `integrate` carries it back.
        reporter.phase('committing')
        appendDecision(contextDir(wt), {
          storyId: story.id,
          title: story.title,
          summary,
        })
        const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
        savePrd(wtPrd, updated)
        retainRuntimeProof(wt, story.id, opts.targetDir)
        opts.git.commitAll(wt, `yoke: complete ${story.id} ${story.title}`, opts.commitIdentity)
        opts.git.integrate(opts.targetDir, wt)
        result.routing?.recordOutcome(true)
        clearFailureProgress(opts.targetDir, story.id)
        landed = progress(updated)
      } catch (e) {
        activeRouting?.recordOutcome(false, 'infrastructure')
        const reason = blockReason(`isolated iteration failed for ${story.id}: ${(e as Error).message}`, opts.targetDir, opts.git)
        reporter.blocked(reason, undefined, executionFailure(e))
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      } finally {
        // Failed or paused work is evidence and may contain the only copy of
        // an implementation. Explicit cleanup owns discarding those trees.
        if (landed) {
          try { opts.git.removeWorktree(opts.targetDir, wt) } catch { /* cleanup is best-effort */ }
        }
      }
      if (landed) reporter.storyDone({ id: story.id, title: story.title }, landed)
      continue
    }

    const implementation = runImplementation(opts, opts.targetDir, story, reporter)
    const result = implementation.result
    iterations++
    if (result.tokens) reporter.addTokens(result.tokens)
        if (result.infrastructureFailure || result.routing?.blocked) { if (result.infrastructureFailure) result.routing?.recordOutcome(false, "infrastructure"); reporter.blocked(result.summary, implementation.failure, result.failure); return { status: "blocked", iterations, reason: result.summary, ...(implementation.failure ? { failure: implementation.failure } : {}), finalProgress: progress(stories) } }

    let decision
    try { decision = consumeDecisionRequest(opts.targetDir, opts.targetDir, story.id) } catch (error) {
      result.routing?.recordOutcome(false, 'infrastructure')
      const reason = `invalid critical decision request for story ${story.id}: ${(error as Error).message}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }
    if (decision) {
      result.routing?.recordOutcome(false, 'infrastructure')
      const reason = `critical decision required for story ${story.id}: ${decision.question}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    const ambiguity = consumeAmbiguity(opts.targetDir)
    if (ambiguity) {
      result.routing?.recordOutcome(false, 'infrastructure')
      const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    const verified = reuseGates(opts.targetDir, story, implementation.gates)
    const criteriaVerdict = verified?.criteria ?? runCriterionGates(opts, opts.targetDir, story)
    if (!criteriaVerdict.passed) {
      result.routing?.recordOutcome(false)
      const reason = blockReason(`story ${story.id} lacks acceptance evidence: ${criteriaVerdict.summary}`, opts.targetDir, opts.git)
      return blockedMechanicalGate(opts, opts.targetDir, story, 'criterion', criteriaVerdict.summary, reason, iterations, stories, criteriaVerdict.failure)
    }

    // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
    // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
    reporter.phase('verifying')
    const verdict = verified?.verify ?? runGate(opts.verify, opts.targetDir, story.id)
    if (!verdict.passed) {
      result.routing?.recordOutcome(false)
      const base = result.success
        ? `story ${story.id} did not verify: ${verdict.summary}`
        : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
      const reason = blockReason(base, opts.targetDir, opts.git)
      return blockedMechanicalGate(opts, opts.targetDir, story, 'verify', verdict.summary, reason, iterations, stories, verdict.failure)
    }
    if (opts.design) {
      reporter.phase('design')
      const designVerdict = verified?.design ?? runGate(opts.design, opts.targetDir, story.id)
      if (!designVerdict.passed) {
        result.routing?.recordOutcome(false)
        const reason = blockReason(`story ${story.id} failed its design gate: ${designVerdict.summary}`, opts.targetDir, opts.git)
        return blockedMechanicalGate(opts, opts.targetDir, story, 'design', designVerdict.summary, reason, iterations, stories, designVerdict.failure)
      }
    }
    if (opts.perf) {
      reporter.phase('perf')
      const perfVerdict = verified?.perf ?? runGate(opts.perf, opts.targetDir, story.id)
      if (!perfVerdict.passed) {
        result.routing?.recordOutcome(false)
        const reason = blockReason(`story ${story.id} exceeded its performance budget: ${perfVerdict.summary}`, opts.targetDir, opts.git)
        return blockedMechanicalGate(opts, opts.targetDir, story, 'perf', perfVerdict.summary, reason, iterations, stories, perfVerdict.failure)
      }
    }
    if (opts.audit) {
      reporter.phase('audit')
      const auditVerdict = verified?.audit ?? runGate(opts.audit, opts.targetDir, story.id)
      if (!auditVerdict.passed) {
        result.routing?.recordOutcome(false)
        const reason = blockReason(`story ${story.id} failed security audit: ${auditVerdict.summary}`, opts.targetDir, opts.git)
        return blockedMechanicalGate(opts, opts.targetDir, story, 'audit', auditVerdict.summary, reason, iterations, stories, auditVerdict.failure)
      }
    }
    const summary = result.success
      ? result.summary
      : `${result.summary} (runner exited non-zero but verify is green)`

    const repairOutcome = runQualityReview(opts, opts.targetDir, story, reporter)
    if (repairOutcome) {
      if (repairOutcome.kind === 'paused') {
        result.routing?.recordOutcome(false, 'infrastructure')
        reporter.paused(progress(stories))
        return { status: 'paused', iterations, finalProgress: progress(stories) }
      }
      const reason = repairBlockReason(repairOutcome, story, opts.targetDir, opts.git)
      if (reason) {
        result.routing?.recordOutcome(false)
        reporter.blocked(reason, repairOutcome.failure)
        return {
          status: 'blocked',
          iterations,
          reason,
          ...(repairOutcome.failure ? { failure: repairOutcome.failure } : {}),
          finalProgress: progress(stories),
        }
      }
    }

    const protection = acceptanceProtectionProblem(opts.targetDir)
    if (protection) {
      result.routing?.recordOutcome(false); reporter.blocked(protection)
      return { status: 'blocked', iterations, reason: protection, finalProgress: progress(stories) }
    }
    reporter.phase('committing')
    const dec = appendDecision(contextDir(opts.targetDir), {
      storyId: story.id,
      title: story.title,
      summary,
    })
    // Re-read the PRD from disk before persisting passes:true — a story injected
    // mid-iteration (hot-reload) must survive this save, not be clobbered by the
    // stale top-of-iteration copy.
    const onDisk = loadPrd(opts.prdPath)
    const updated = onDisk.map(s => (s.id === story.id ? { ...s, passes: true } : s))
    savePrd(opts.prdPath, updated)
    try {
      opts.git.commitAll(opts.targetDir, `yoke: complete ${story.id} ${story.title}`, opts.commitIdentity)
    } catch (e) {
      result.routing?.recordOutcome(false, 'infrastructure')
      savePrd(opts.prdPath, onDisk) // revert — never persist passes:true without a commit
      dec.rollback()                 // and never leave an orphan decision
      const reason = blockReason(`commit failed for ${story.id}: ${(e as Error).message}`, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return {
        status: 'blocked',
        iterations,
        reason,
        finalProgress: progress(stories),
      }
    }
    result.routing?.recordOutcome(true)
    clearFailureProgress(opts.targetDir, story.id)
    reporter.storyDone({ id: story.id, title: story.title }, progress(updated))
  }
}

function blockedMechanicalGate(opts: LoopOptions, directory: string, story: Story, stage: FailureStage, summary: string, reason: string, iterations: number, stories: Story[], observation?: FailureObservation): LoopResult {
  const observed = observeFailure({ root: opts.targetDir, directory, story, stage, summary, observation })
  const detail = observed.action === 'retry' ? reason : `${reason}\n${observed.feedback}`
  ;(opts.reporter ?? noopReporter).blocked(detail, observed.failure)
  return { status: 'blocked', iterations, reason: detail, failure: observed.failure, finalProgress: progress(stories) }
}

interface LocalMechanicalEvidence {
  readonly criteria: VerifyResult
  readonly verify?: VerifyResult
  readonly design?: VerifyResult
  readonly perf?: VerifyResult
  readonly audit?: VerifyResult
}

interface ImplementationOutcome {
  readonly result: AgentResult
  readonly gates?: GateSnapshot<LocalMechanicalEvidence>
  readonly failure?: LoopFailure
}

function runImplementation(opts: LoopOptions, dir: string, story: Story, reporter: LoopReporter): ImplementationOutcome {
  let feedback: string | undefined = opts.feedback
  for (let attempt = 0; ; attempt++) {
    const result = opts.runner({ targetDir: dir, story, feedback })
    const cacheProblem = opts.isolate && dir !== opts.targetDir ? cacheIsolationProblem(dir) : undefined
    if (cacheProblem) return { result: { ...result, success: false, infrastructureFailure: true, summary: cacheProblem } }
    if (!result.routing?.canRetry || result.routing.blocked || attempt >= 7) return { result }
    if (["decision-request.yaml", "ambiguity.md", "loop.pause"].some(name => existsSync(join(dir, ".yoke", name))) || existsSync(pauseFilePath(opts.targetDir))) return { result }
    const protection = acceptanceProtectionProblem(dir, opts.targetDir)
    if (protection) return { result }
    const before = gateIdentity(dir, story)
    const criteria = runCriterionGates(opts, dir, story)
    const evidence: { criteria: VerifyResult; verify?: VerifyResult; design?: VerifyResult; perf?: VerifyResult; audit?: VerifyResult } = { criteria }
    let verdict = criteria
    let failedStage: FailureStage = 'criterion'
    if (verdict.passed) for (const name of ['verify', 'design', 'perf', 'audit'] as const) {
      const gate = opts[name]
      if (!gate) continue
      verdict = runGate(gate, dir, story.id)
      failedStage = name
      evidence[name] = verdict
      if (!verdict.passed) break
    }
    if (verdict.passed) return { result, gates: snapshotGates(dir, story, before, evidence) }
    if (knownInfrastructureFailure(verdict.failure)) {
      result.routing.recordOutcome(false, 'infrastructure')
      const observation = verdict.failure ?? failureObservation()
      return { result: { ...result, success: false, infrastructureFailure: true, failure: observation, summary: verdict.summary, routing: { ...result.routing, blocked: true, canRetry: false } },
        failure: { kind: 'verification-failed', stage: failedStage, storyId: story.id, observation } }
    }
    result.routing.recordOutcome(false)
    const observed = observeFailure({ root: opts.targetDir, directory: dir, story, stage: failedStage, summary: verdict.summary, observation: verdict.failure })
    try { reporter.failure?.(observed.failure.observation!, story.id) } catch { /* telemetry must preserve routing and the original gate outcome */ }
    if (observed.action === 'blocked') return { result: { ...result, success: false, summary: observed.feedback, routing: { ...result.routing, blocked: true, canRetry: false } }, failure: observed.failure }
    if (result.tokens) reporter.addTokens(result.tokens)
    feedback = observed.feedback
  }
}
