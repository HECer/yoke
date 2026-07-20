import { existsSync, unlinkSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadPrd, savePrd, selectNextStory, allPass, progress } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentRunner } from './runner.js'
import type { Verifier } from './verify.js'
import { appendDecision, contextDir } from '../context/context.js'
import { noopReporter, type LoopReporter } from './reporter.js'

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
  maxIterations: number
  isolate?: boolean
  review?: AgentRunner
  reporter?: LoopReporter
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

// Abort channel for an agent that hits genuinely undecidable acceptance criteria
// (only instructed to use it under loop.onAmbiguity: abort). Honoured whenever
// present: without this check, an agent that stopped without changes would sail
// through verify on pre-existing green tests and be falsely marked done.
export function ambiguityFilePath(dir: string): string {
  return join(dir, '.yoke', 'ambiguity.md')
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

export function runLoop(opts: LoopOptions): LoopResult {
  let iterations = 0
  const reporter = opts.reporter ?? noopReporter

  const initial = loadPrd(opts.prdPath)
  if (initial.length === 0) {
    reporter.blocked('PRD has no stories')
    return { status: 'blocked', iterations: 0, reason: 'PRD has no stories', finalProgress: { passed: 0, total: 0 } }
  }

  for (;;) {
    const stories = loadPrd(opts.prdPath)

    if (allPass(stories)) {
      reporter.complete(progress(stories))
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }
    if (iterations >= opts.maxIterations) {
      reporter.capReached(progress(stories))
      return { status: 'cap-reached', iterations, finalProgress: progress(stories) }
    }

    // Story boundary: honour a pause signal before selecting the next story.
    // complete/cap-reached above still win — pausing an already-finished loop is meaningless.
    const pauseFile = pauseFilePath(opts.targetDir)
    if (existsSync(pauseFile)) {
      try { unlinkSync(pauseFile) } catch { /* consumed best-effort — pausing still wins */ }
      reporter.paused(progress(stories))
      return { status: 'paused', iterations, finalProgress: progress(stories) }
    }

    const pre = preDispatchGate(opts.targetDir, opts.git)
    if (!pre.ok) {
      reporter.blocked(pre.reason ?? 'pre-dispatch gate failed')
      return { status: 'blocked', iterations, reason: pre.reason, finalProgress: progress(stories) }
    }

    const story = selectNextStory(stories)
    if (!story) {
      reporter.complete(progress(stories))
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }

    const stl = stopTheLineGate(story)
    if (!stl.ok) {
      reporter.blocked(stl.reason ?? 'stop-the-line gate failed')
      return { status: 'blocked', iterations, reason: stl.reason, finalProgress: progress(stories) }
    }

    reporter.storyStart({ id: story.id, title: story.title }, iterations + 1, progress(stories))

    if (opts.isolate) {
      const wt = join(opts.targetDir, '.yoke', 'worktrees', story.id)
      const wtPrd = join(wt, relative(opts.targetDir, opts.prdPath))
      let landed: { passed: number; total: number } | null = null
      try {
        opts.git.addWorktree(opts.targetDir, wt)
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        if (result.tokens) reporter.addTokens(result.tokens)
        const ambiguity = consumeAmbiguity(wt)
        if (ambiguity) {
          const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
        // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
        reporter.phase('verifying')
        const prevStory = process.env.YOKE_STORY
        process.env.YOKE_STORY = story.id
        let verdict
        try {
          verdict = opts.verify(wt)
        } finally {
          if (prevStory === undefined) delete process.env.YOKE_STORY
          else process.env.YOKE_STORY = prevStory
        }
        if (!verdict.passed) {
          const base = result.success
            ? `story ${story.id} did not verify: ${verdict.summary}`
            : `story ${story.id} runner failed (${result.summary}) and verify is red: ${verdict.summary}`
          const reason = blockReason(base, opts.targetDir, opts.git)
          reporter.blocked(reason)
          return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
        }
        const summary = result.success
          ? result.summary
          : `${result.summary} (runner exited non-zero but verify is green)`
        if (opts.review) {
          reporter.phase('reviewing')
          const reviewResult = opts.review({ targetDir: wt, story })
          if (!reviewResult.success) {
            const reason = blockReason(`story ${story.id} rejected in review: ${reviewResult.summary}`, opts.targetDir, opts.git)
            reporter.blocked(reason)
            return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
          }
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
        opts.git.commitAll(wt, `yoke: complete ${story.id} ${story.title}`)
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

    const ambiguity = consumeAmbiguity(opts.targetDir)
    if (ambiguity) {
      const reason = `story ${story.id} stopped: ambiguous acceptance criteria — ${ambiguity}`
      reporter.blocked(reason)
      return { status: 'blocked', iterations, reason, finalProgress: progress(stories) }
    }

    // Verify is the source of truth — NOT the runner's exit code. A spurious non-zero
    // exit (e.g. a Windows .cmd wrapper ghost) must not block a story whose tests are green.
    reporter.phase('verifying')
    const prevStory = process.env.YOKE_STORY
    process.env.YOKE_STORY = story.id
    let verdict
    try {
      verdict = opts.verify(opts.targetDir)
    } finally {
      if (prevStory === undefined) delete process.env.YOKE_STORY
      else process.env.YOKE_STORY = prevStory
    }
    if (!verdict.passed) {
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
    const summary = result.success
      ? result.summary
      : `${result.summary} (runner exited non-zero but verify is green)`

    if (opts.review) {
      reporter.phase('reviewing')
      const reviewResult = opts.review({ targetDir: opts.targetDir, story })
      if (!reviewResult.success) {
        const reason = blockReason(`story ${story.id} rejected in review: ${reviewResult.summary}`, opts.targetDir, opts.git)
        reporter.blocked(reason)
        return {
          status: 'blocked',
          iterations,
          reason,
          finalProgress: progress(stories),
        }
      }
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
      opts.git.commitAll(opts.targetDir, `yoke: complete ${story.id} ${story.title}`)
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
