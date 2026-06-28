import { join, relative } from 'node:path'
import { loadPrd, savePrd, selectNextStory, allPass, progress } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentRunner } from './runner.js'
import type { Verifier } from './verify.js'

export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  verify: Verifier
  maxIterations: number
  isolate?: boolean
  review?: AgentRunner
}

export interface LoopResult {
  status: 'complete' | 'blocked' | 'cap-reached'
  iterations: number
  reason?: string
  finalProgress: { passed: number; total: number }
}

export function runLoop(opts: LoopOptions): LoopResult {
  let iterations = 0

  const initial = loadPrd(opts.prdPath)
  if (initial.length === 0) {
    return { status: 'blocked', iterations: 0, reason: 'PRD has no stories', finalProgress: { passed: 0, total: 0 } }
  }

  for (;;) {
    const stories = loadPrd(opts.prdPath)

    if (allPass(stories)) {
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }
    if (iterations >= opts.maxIterations) {
      return { status: 'cap-reached', iterations, finalProgress: progress(stories) }
    }

    const pre = preDispatchGate(opts.targetDir, opts.git)
    if (!pre.ok) {
      return { status: 'blocked', iterations, reason: pre.reason, finalProgress: progress(stories) }
    }

    const story = selectNextStory(stories)
    if (!story) {
      return { status: 'complete', iterations, finalProgress: progress(stories) }
    }

    const stl = stopTheLineGate(story)
    if (!stl.ok) {
      return { status: 'blocked', iterations, reason: stl.reason, finalProgress: progress(stories) }
    }

    if (opts.isolate) {
      const wt = join(opts.targetDir, '.yoke', 'worktrees', story.id)
      const wtPrd = join(wt, relative(opts.targetDir, opts.prdPath))
      try {
        opts.git.addWorktree(opts.targetDir, wt)
        const result = opts.runner({ targetDir: wt, story })
        iterations++
        if (!result.success) {
          return { status: 'blocked', iterations, reason: `story ${story.id} failed: ${result.summary}`, finalProgress: progress(stories) }
        }
        const verdict = opts.verify(wt)
        if (!verdict.passed) {
          return { status: 'blocked', iterations, reason: `story ${story.id} did not verify: ${verdict.summary}`, finalProgress: progress(stories) }
        }
        if (opts.review) {
          const reviewResult = opts.review({ targetDir: wt, story })
          if (!reviewResult.success) {
            return { status: 'blocked', iterations, reason: `story ${story.id} rejected in review: ${reviewResult.summary}`, finalProgress: progress(stories) }
          }
        }
        const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
        savePrd(wtPrd, updated)
        opts.git.commitAll(wt, `yoke: complete ${story.id} ${story.title}`)
        opts.git.integrate(opts.targetDir, wt)
      } catch (e) {
        return { status: 'blocked', iterations, reason: `isolated iteration failed for ${story.id}: ${(e as Error).message}`, finalProgress: progress(stories) }
      } finally {
        try { opts.git.removeWorktree(opts.targetDir, wt) } catch { /* cleanup is best-effort */ }
      }
      continue
    }

    const result = opts.runner({ targetDir: opts.targetDir, story })
    iterations++

    if (!result.success) {
      return {
        status: 'blocked',
        iterations,
        reason: `story ${story.id} failed: ${result.summary}`,
        finalProgress: progress(stories),
      }
    }

    const verdict = opts.verify(opts.targetDir)
    if (!verdict.passed) {
      return {
        status: 'blocked',
        iterations,
        reason: `story ${story.id} did not verify: ${verdict.summary}`,
        finalProgress: progress(stories),
      }
    }

    if (opts.review) {
      const reviewResult = opts.review({ targetDir: opts.targetDir, story })
      if (!reviewResult.success) {
        return {
          status: 'blocked',
          iterations,
          reason: `story ${story.id} rejected in review: ${reviewResult.summary}`,
          finalProgress: progress(stories),
        }
      }
    }

    try {
      const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
      savePrd(opts.prdPath, updated)
      opts.git.commitAll(opts.targetDir, `yoke: complete ${story.id} ${story.title}`)
    } catch (e) {
      savePrd(opts.prdPath, stories) // revert — never persist passes:true without a commit
      return {
        status: 'blocked',
        iterations,
        reason: `commit failed for ${story.id}: ${(e as Error).message}`,
        finalProgress: progress(stories),
      }
    }
  }
}
