import type { Story } from './prd.js'

export interface GateResult {
  ok: boolean
  reason?: string
}

export interface GitOps {
  isClean(dir: string): boolean
  commitAll(dir: string, message: string): void
}

export function stopTheLineGate(story: Story): GateResult {
  if (story.acceptance.length === 0) {
    return { ok: false, reason: `story ${story.id} has no acceptance criteria (Stop-the-Line)` }
  }
  return { ok: true }
}

export function preDispatchGate(targetDir: string, git: GitOps): GateResult {
  if (!git.isClean(targetDir)) {
    return { ok: false, reason: 'git worktree is dirty — commit or stash before running the loop' }
  }
  return { ok: true }
}
