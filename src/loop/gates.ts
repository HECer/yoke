import { criterionCommandProblem, isAcceptanceCriterion, type Story } from './prd.js'
import type { CommitIdentity } from './identity.js'

export interface GateResult {
  ok: boolean
  reason?: string
}

export interface GitOps {
  isClean(dir: string): boolean
  commitAll(dir: string, message: string, identity?: CommitIdentity): void
  addWorktree(repoDir: string, worktreePath: string): void
  removeWorktree(repoDir: string, worktreePath: string): void
  integrate(repoDir: string, worktreePath: string): void
}

export function stopTheLineGate(story: Story, requireCriterionEvidence = false): GateResult {
  if (story.acceptance.length === 0) {
    return { ok: false, reason: `story ${story.id} has no acceptance criteria (Stop-the-Line)` }
  }
  if (requireCriterionEvidence && story.acceptance.some(criterion => !isAcceptanceCriterion(criterion))) {
    return { ok: false, reason: `story ${story.id} lacks executable criterion evidence (Stop-the-Line)` }
  }
  for (const criterion of story.acceptance.filter(isAcceptanceCriterion)) {
    const problem = criterionCommandProblem(criterion)
    if (problem) return { ok: false, reason: `${problem} (Stop-the-Line)` }
  }
  return { ok: true }
}

export function preDispatchGate(targetDir: string, git: GitOps): GateResult {
  if (!git.isClean(targetDir)) {
    return { ok: false, reason: 'git worktree is dirty — commit or stash before running the loop' }
  }
  return { ok: true }
}
