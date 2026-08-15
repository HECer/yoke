import { existsSync, unlinkSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isAcceptanceCriterion, loadPrd, savePrd, selectNextStory, allPass, progress, storyPathSegment, type AcceptanceCriterion, type Story } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentContext, AgentResult, AgentRunner } from './runner.js'
import type { Verifier } from './verify.js'
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
  git: GitOps
  verify: Verifier
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
): ReturnType<typeof runQualityRepairLoop> | null {
  const qualityAssessment = opts.qualityEnabled?.(story) === false ? undefined : opts.qualityStage
  const reviewAssessment = opts.review
  if (!qualityAssessment && !reviewAssessment) return null
  const qualityMetadata = opts.qualityMetadata?.({ targetDir: executionDir, story })
  const rerunGates = () => {
    const criteria = runCriterionGates(opts, executionDir, story)
    if (!criteria.passed) return { kind: 'failed' as const, stage: 'criterion' as const, summary: criteria.summary }
    reporter.phase('verifying')
    const verify = runGate(opts.verify, executionDir, story.id)
    if (!verify.passed) return { kind: 'failed' as const, stage: 'verify' as const, summary: verify.summary }
    if (opts.perf) {
      reporter.phase('perf')
      const perf = runGate(opts.perf, executionDir, story.id)
      if (!perf.passed) return { kind: 'failed' as const, stage: 'perf' as const, summary: perf.summary }
    }
    if (opts.audit) {
      reporter.phase('audit')
      const audit = runGate(opts.audit, executionDir, story.id)
      if (!audit.passed) return { kind: 'failed' as const, stage: 'audit' as const, summary: audit.summary }
    }
    return { kind: 'passed' as const }
  }
  return runQualityRepairLoop({
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
      const result = opts.repair({ targetDir: executionDir, story }, request)
      return result.success ? { kind: 'repaired' } : { kind: 'blocked', summary: result.summary }
    },
    rerunGates,
    limits: opts.repairLimits,
    pause: () => consumePause(opts.targetDir),
    onStatus: status => {
      if (qualityMetadata) reporter.quality({ ...status, ...qualityMetadata })
    },
  })
}

export interface LoopResult {
  status: 'complete' | 'blocked' | 'cap-reached' | 'paused'
  iterations: number
  reason?: string
  finalProgress: { passed: number; total: number }
}

// Control file a supervisor drops to pause the loop at the next story boundary.
// The loop consumes (deletes) it and stops with state 'paused' — never mid-story.
export function pauseFilePath(targetDir: string): string {
  return join(targetDir, '.yoke', 'loop.pause')
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

function consumeAmbiguity(dir: string): string | null {
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
  let verdict
  try {
    verdict = opts.completion(opts.targetDir)
  } catch (error) {
    const reason = `integrated completion gate failed: ${(error as Error).message}`
    ;(opts.reporter ?? noopReporter).blocked(reason)
    return { status: 'blocked', iterations: 0, reason, finalProgress: progress(stories) }
  } finally {
    if (previous === undefined) delete process.env.YOKE_PHASE
    else process.env.YOKE_PHASE = previous
  }
  if (verdict.passed) return null
  const reason = `integrated system did not verify: ${verdict.summary}`
  ;(opts.reporter ?? noopReporter).blocked(reason)
  return { status: 'blocked', iterations: 0, reason, finalProgress: progress(stories) }
}

function runCriterionGates(opts: LoopOptions, executionDir: string, story: Story): { passed: boolean; summary: string } {
  const criteria = story.acceptance.filter(isAcceptanceCriterion)
  if (criteria.length === 0) {
    return opts.requireCriterionEvidence
      ? { passed: false, summary: `story ${story.id} lacks executable criterion evidence` }
      : { passed: true, summary: 'legacy acceptance criteria' }
  }
  if (!opts.verifyCriterion) return { passed: false, summary: `story ${story.id} has criteria but no criterion verifier` }
  const evidence = criteria.map(criterion => ({
    criterion,
    result: opts.verifyCriterion!(executionDir, story, criterion),
  }))
  try {
    writeCriterionEvidence(opts.targetDir, story, evidence)
  } catch (error) {
    return { passed: false, summary: `could not persist criterion evidence: ${(error as Error).message}` }
  }
  const failed = evidence.find(item => !item.result.passed)
  return failed
    ? { passed: false, summary: `${failed.criterion.id}: ${failed.result.summary}` }
    : { passed: true, summary: `${evidence.length} acceptance criteria verified` }
}

export function runLoop(opts: LoopOptions): LoopResult {
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
        reporter.blocked(reason)
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
      try {
        opts.git.addWorktree(opts.targetDir, wt)
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        if (result.tokens) reporter.addTokens(result.tokens)
        let decision
        try { decision = consumeDecisionRequest(wt, opts.targetDir, story.id) } catch (error) {
          const reason = `invalid critical decision request for story ${story.id}: ${(error as Error).message}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        if (decision) {
          const reason = `critical decision required for story ${story.id}: ${decision.question}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const ambiguity = consumeAmbiguity(wt)
        if (ambiguity) {
          const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const criteriaVerdict = runCriterionGates(opts, wt, story)
        if (!criteriaVerdict.passed) {
          result.routing?.recordOutcome(false)
          const reason = blockReason(`story ${story.id} lacks acceptance evidence: ${criteriaVerdict.summary}`, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
        // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
        reporter.phase('verifying')
        const verdict = runGate(opts.verify, wt, story.id)
        if (!verdict.passed) {
          result.routing?.recordOutcome(false)
          const base = result.success
            ? `story ${story.id} did not verify: ${verdict.summary}`
            : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
          const reason = blockReason(base, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        if (opts.perf) {
          reporter.phase('perf')
          const perfVerdict = runGate(opts.perf, wt, story.id)
          if (!perfVerdict.passed) {
            result.routing?.recordOutcome(false)
            const reason = blockReason(`story ${story.id} exceeded its performance budget: ${perfVerdict.summary}`, opts.targetDir, opts.git)
            reporter.blocked(reason)
            return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
          }
        }
        if (opts.audit) {
          reporter.phase('audit')
          const auditVerdict = runGate(opts.audit, wt, story.id)
          if (!auditVerdict.passed) {
            result.routing?.recordOutcome(false)
            const reason = blockReason(`story ${story.id} failed security audit: ${auditVerdict.summary}`, opts.targetDir, opts.git)
            reporter.blocked(reason)
            return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
          }
        }
        const summary = result.success
          ? result.summary
          : `${result.summary} (runner exited non-zero but verify is green)`
        const repairOutcome = runQualityReview(opts, wt, story, reporter)
        if (repairOutcome) {
          if (repairOutcome.kind === 'paused') {
            reporter.paused(progress(stories))
            return { status: 'paused', iterations, finalProgress: progress(stories) }
          }
          const reason = repairBlockReason(repairOutcome, story, opts.targetDir, opts.git)
          if (reason) {
            result.routing?.recordOutcome(false)
            reporter.blocked(reason)
            return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
          }
        }
        result.routing?.recordOutcome(true)
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
        opts.git.commitAll(wt, `yoke: complete ${story.id} ${story.title}`, opts.commitIdentity)
        opts.git.integrate(opts.targetDir, wt)
        landed = progress(updated)
      } catch (e) {
        const reason = blockReason(`isolated iteration failed for ${story.id}: ${(e as Error).message}`, opts.targetDir, opts.git)
        reporter.blocked(reason)
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      } finally {
        try { opts.git.removeWorktree(opts.targetDir, wt) } catch { /* cleanup is best-effort */ }
      }
      if (landed) reporter.storyDone({ id: story.id, title: story.title }, landed)
      continue
    }

    const result = opts.runner({ targetDir: opts.targetDir, story })
    iterations++
    if (result.tokens) reporter.addTokens(result.tokens)

    let decision
    try { decision = consumeDecisionRequest(opts.targetDir, opts.targetDir, story.id) } catch (error) {
      const reason = `invalid critical decision request for story ${story.id}: ${(error as Error).message}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }
    if (decision) {
      const reason = `critical decision required for story ${story.id}: ${decision.question}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    const ambiguity = consumeAmbiguity(opts.targetDir)
    if (ambiguity) {
      const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    const criteriaVerdict = runCriterionGates(opts, opts.targetDir, story)
    if (!criteriaVerdict.passed) {
      result.routing?.recordOutcome(false)
      const reason = blockReason(`story ${story.id} lacks acceptance evidence: ${criteriaVerdict.summary}`, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
    // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
    reporter.phase('verifying')
    const verdict = runGate(opts.verify, opts.targetDir, story.id)
    if (!verdict.passed) {
      result.routing?.recordOutcome(false)
      const base = result.success
        ? `story ${story.id} did not verify: ${verdict.summary}`
        : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
      const reason = blockReason(base, opts.targetDir, opts.git)
      reporter.blocked(reason)
      return {
        status: 'blocked',
        iterations,
        reason,
        finalProgress: progress(stories),
      }
    }
    if (opts.perf) {
      reporter.phase('perf')
      const perfVerdict = runGate(opts.perf, opts.targetDir, story.id)
      if (!perfVerdict.passed) {
        result.routing?.recordOutcome(false)
        const reason = blockReason(`story ${story.id} exceeded its performance budget: ${perfVerdict.summary}`, opts.targetDir, opts.git)
        reporter.blocked(reason)
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      }
    }
    if (opts.audit) {
      reporter.phase('audit')
      const auditVerdict = runGate(opts.audit, opts.targetDir, story.id)
      if (!auditVerdict.passed) {
        result.routing?.recordOutcome(false)
        const reason = blockReason(`story ${story.id} failed security audit: ${auditVerdict.summary}`, opts.targetDir, opts.git)
        reporter.blocked(reason)
        return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
      }
    }
    const summary = result.success
      ? result.summary
      : `${result.summary} (runner exited non-zero but verify is green)`

    const repairOutcome = runQualityReview(opts, opts.targetDir, story, reporter)
    if (repairOutcome) {
      if (repairOutcome.kind === 'paused') {
        reporter.paused(progress(stories))
        return { status: 'paused', iterations, finalProgress: progress(stories) }
      }
      const reason = repairBlockReason(repairOutcome, story, opts.targetDir, opts.git)
      if (reason) {
        result.routing?.recordOutcome(false)
        reporter.blocked(reason)
        return {
          status: 'blocked',
          iterations,
          reason,
          finalProgress: progress(stories),
        }
      }
    }

    result.routing?.recordOutcome(true)
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
    reporter.storyDone({ id: story.id, title: story.title }, progress(updated))
  }
}
