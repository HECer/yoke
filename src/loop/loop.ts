import { loadPrd, savePrd, selectNextStory, allPass, progress } from './prd.js'
import { stopTheLineGate, preDispatchGate, type GitOps } from './gates.js'
import type { AgentRunner } from './runner.js'

export interface LoopOptions {
  prdPath: string
  targetDir: string
  runner: AgentRunner
  git: GitOps
  maxIterations: number
}

export interface LoopResult {
  status: 'complete' | 'blocked' | 'cap-reached'
  iterations: number
  reason?: string
  finalProgress: { passed: number; total: number }
}

export function runLoop(opts: LoopOptions): LoopResult {
  let iterations = 0

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

    const updated = stories.map(s => (s.id === story.id ? { ...s, passes: true } : s))
    savePrd(opts.prdPath, updated)
    opts.git.commitAll(opts.targetDir, `forge: complete ${story.id} ${story.title}`)
  }
}
