import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CandidateLifecycle, CandidateOwnership, CandidateWorktreeRequest } from './candidate-contracts.js'
import type { CommitIdentity } from './identity.js'
import { isProviderTreeAlive, reapProviderProcesses } from './cleanup.js'
import { realGitOps } from './git.js'
import type { GitOps } from './gates.js'
import type { DispatcherGit, DispatcherRebase, DispatcherWorktree, DispatcherWorktrees, DispatcherWorkerInput } from './dispatcher.js'
import { isPidAlive } from './lock.js'
import { storyPathSegment } from './prd.js'
import { killProcessTreeForCleanup } from './watchdog.js'

export type ParallelAdapters = {
  readonly worktrees: DispatcherWorktrees
  readonly git: DispatcherGit
  readonly candidates: (primary: DispatcherWorkerInput) => CandidateLifecycle
}

export function makeParallelAdapters(targetDir: string, identity: CommitIdentity | undefined, injectedGit?: GitOps): ParallelAdapters {
  return injectedGit
    ? injectedAdapters(targetDir, identity, injectedGit)
    : productionAdapters(targetDir, identity)
}

function injectedAdapters(targetDir: string, identity: CommitIdentity | undefined, git: GitOps): ParallelAdapters {
  const owned = new Set<string>()
  const removed = new Set<string>()
  return {
    worktrees: {
      create: input => {
        const path = worktreePath(targetDir, input)
        git.addWorktree(targetDir, path)
        owned.add(path)
        return { path, baseCommit: 'injected-base' }
      },
      cleanupProcess: cleanupProviderProcesses,
      remove: input => removeOwnedWorktree(targetDir, input, owned, removed, git),
    },
    git: {
      isClean: dir => git.isClean(dir),
      rebase: input => ({ kind: 'rebased', expectedHead: input.worktree.baseCommit }),
      commit: input => git.commitAll(input.worktree.path, `yoke: complete ${input.story.id} ${input.story.title}`, identity),
      integrate: input => git.integrate(targetDir, input.worktree.path),
    },
    candidates: primary => makeCandidateLifecycle(targetDir, primary, owned, removed, git),
  }
}

function productionAdapters(targetDir: string, identity: CommitIdentity | undefined): ParallelAdapters {
  const owned = new Set<string>()
  const removed = new Set<string>()
  return {
    worktrees: {
      create: input => {
        const path = worktreePath(targetDir, input)
        const baseCommit = gitText(targetDir, ['rev-parse', 'HEAD'])
        mkdirSync(dirname(path), { recursive: true })
        realGitOps.addWorktree(targetDir, path)
        owned.add(path)
        return { path, baseCommit }
      },
      cleanupProcess: cleanupProviderProcesses,
      remove: input => removeOwnedWorktree(targetDir, input, owned, removed, realGitOps),
    },
    git: {
      isClean: dir => realGitOps.isClean(dir),
      rebase: input => rebaseCandidate(targetDir, input),
      commit: input => realGitOps.commitAll(input.worktree.path, `yoke: complete ${input.story.id} ${input.story.title}`, identity),
      integrate: (input, expectedHead) => integrateCandidate(targetDir, input, expectedHead),
    },
    candidates: primary => makeCandidateLifecycle(targetDir, primary, owned, removed, realGitOps),
  }
}

function cleanupProviderProcesses(input: DispatcherWorkerInput): void {
  reapProviderProcesses(input.worktree.path, isPidAlive, isProviderTreeAlive, killProcessTreeForCleanup)
}

function makeCandidateLifecycle(
  targetDir: string,
  primary: DispatcherWorkerInput,
  owned: Set<string>,
  removed: Set<string>,
  git: Pick<GitOps, 'addWorktree' | 'removeWorktree'>,
): CandidateLifecycle {
  return {
    reserve: input => {
      const worktree = input.candidateId === 'candidate-1'
        ? primary.worktree
        : { path: candidateWorktreePath(targetDir, input), baseCommit: primary.worktree.baseCommit }
      writeCandidateStatus(targetDir, input, worktree.path, 'reserved')
      return worktree
    },
    materialize: ownership => {
      if (ownership.worktree.path !== primary.worktree.path) {
        mkdirSync(dirname(ownership.worktree.path), { recursive: true })
        git.addWorktree(targetDir, ownership.worktree.path)
        owned.add(ownership.worktree.path)
      }
      writeCandidateStatus(targetDir, ownership, ownership.worktree.path, 'materialized')
    },
    cancel: (ownership, reason) => {
      writeCandidateStatus(targetDir, ownership, ownership.worktree.path, 'cleaning', reason)
    },
    reap: ownership => {
      reapProviderProcesses(ownership.worktree.path, isPidAlive, isProviderTreeAlive, killProcessTreeForCleanup)
    },
    remove: ownership => {
      removeOwnedWorktree(targetDir, ownership, owned, removed, git)
      writeCandidateStatus(targetDir, ownership, ownership.worktree.path, 'removed')
    },
  }
}

function worktreePath(targetDir: string, input: Pick<DispatcherWorkerInput, 'story' | 'ownerToken'>): string {
  return join(targetDir, '.yoke', 'worktrees', `${storyPathSegment(input.story.id)}-${input.ownerToken}`)
}

function removeOwnedWorktree(targetDir: string, input: { readonly worktree: DispatcherWorktree }, owned: Set<string>, removed: Set<string>, git: Pick<GitOps, 'removeWorktree'>): void {
  if (removed.has(input.worktree.path)) return
  if (!owned.has(input.worktree.path)) {
    throw new Error(`refusing to remove a worktree not created by this dispatcher: ${input.worktree.path}`)
  }
  git.removeWorktree(targetDir, input.worktree.path)
  owned.delete(input.worktree.path)
  removed.add(input.worktree.path)
}

function candidateWorktreePath(targetDir: string, input: CandidateWorktreeRequest): string {
  return join(targetDir, '.yoke', 'worktrees', `${storyPathSegment(input.storyId)}-${input.ownerToken}`)
}

function writeCandidateStatus(
  targetDir: string,
  input: Pick<CandidateOwnership, 'storyId' | 'candidateId'>,
  worktree: string,
  state: 'reserved' | 'materialized' | 'cleaning' | 'removed',
  reason?: string,
): void {
  const file = join(targetDir, '.yoke', 'proof', storyPathSegment(input.storyId), 'candidates', input.candidateId, 'status.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ storyId: input.storyId, candidateId: input.candidateId, worktree, state, ...(reason ? { reason } : {}) }))
}

function rebaseCandidate(targetDir: string, input: DispatcherWorkerInput): DispatcherRebase {
  const currentHead = gitText(targetDir, ['rev-parse', 'HEAD'])
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', input.worktree.baseCommit, 'HEAD'], { cwd: input.worktree.path, stdio: 'pipe' })
  } catch {
    return { kind: 'reopen', reason: `candidate history no longer descends from base ${input.worktree.baseCommit}` }
  }
  if (currentHead !== input.worktree.baseCommit) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', input.worktree.baseCommit, currentHead], { cwd: targetDir, stdio: 'pipe' })
    } catch {
      return { kind: 'reopen', reason: `candidate base ${input.worktree.baseCommit} is stale against target ${currentHead}` }
    }
    const emptyHooks = mkdtempSync(join(tmpdir(), 'yoke-empty-hooks-'))
    const mechanics = [
      '-c', `core.hooksPath=${emptyHooks}`,
      '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Yoke Temporary',
      '-c', 'user.email=yoke@localhost',
    ]
    try {
      if (gitText(input.worktree.path, ['status', '--porcelain=v1', '--untracked-files=all'])) {
        execFileSync('git', ['add', '-A'], { cwd: input.worktree.path, stdio: 'pipe' })
        if (gitText(input.worktree.path, ['diff', '--cached', '--name-only'])) {
          execFileSync('git', [...mechanics, 'commit', '--no-verify', '-m', 'yoke: temporary candidate snapshot'], { cwd: input.worktree.path, stdio: 'pipe' })
        }
        if (gitText(input.worktree.path, ['status', '--porcelain=v1', '--untracked-files=all'])) {
          return { kind: 'reopen', reason: 'candidate contains changes Git cannot snapshot' }
        }
      }
      execFileSync('git', [...mechanics, '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', 'rebase', '--no-verify', currentHead], { cwd: input.worktree.path, stdio: 'pipe' })
    } catch (error) {
      try { execFileSync('git', [...mechanics, 'rebase', '--abort'], { cwd: input.worktree.path, stdio: 'pipe' }) } catch {}
      return { kind: 'reopen', reason: `candidate rebase failed: ${errorMessage(error)}` }
    } finally {
      rmSync(emptyHooks, { recursive: true, force: true })
    }
  }
  // Preserve the worker's candidate tree, but return commit authority to the dispatcher.
  execFileSync('git', ['reset', '--soft', currentHead], { cwd: input.worktree.path, stdio: 'pipe' })
  return { kind: 'rebased', expectedHead: currentHead }
}

function integrateCandidate(targetDir: string, input: DispatcherWorkerInput, expectedHead: string): void {
  if (!realGitOps.isClean(targetDir)) throw new Error('target working tree is not clean before integration')
  const currentHead = gitText(targetDir, ['rev-parse', 'HEAD'])
  if (currentHead !== expectedHead) throw new Error(`target HEAD changed from ${expectedHead} to ${currentHead} during integrated gates`)
  realGitOps.integrate(targetDir, input.worktree.path)
}

function gitText(dir: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
