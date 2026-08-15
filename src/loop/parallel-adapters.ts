import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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
  const candidateHead = gitText(input.worktree.path, ['rev-parse', 'HEAD'])
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
    let candidateTree: string
    try {
      execFileSync('git', ['add', '-A'], { cwd: input.worktree.path, stdio: 'pipe' })
      const unstaged = spawnSync('git', ['diff', '--quiet', '--ignore-submodules=none'], { cwd: input.worktree.path, stdio: 'pipe' })
      if (unstaged.error || unstaged.status !== 0) return { kind: 'reopen', reason: 'candidate contains changes Git cannot snapshot' }
      candidateTree = gitText(input.worktree.path, ['write-tree'])
    } catch (error) {
      return { kind: 'reopen', reason: `candidate snapshot failed: ${errorMessage(error)}` }
    }
    const merge = spawnSync('git', ['merge-tree', '--write-tree', '--messages', '--name-only', `--merge-base=${input.worktree.baseCommit}`, currentHead, candidateTree], {
      cwd: input.worktree.path,
      encoding: 'utf8',
    })
    const mergedTree = merge.stdout.trim().split(/\r?\n/u)[0] ?? ''
    if (merge.error || merge.status !== 0 || !/^[0-9a-f]{40,64}$/u.test(mergedTree)) {
      const detail = [merge.stderr, merge.stdout].map(value => value.trim()).filter(Boolean).join(' · ')
      return { kind: 'reopen', reason: `candidate tree merge failed${detail ? `: ${detail}` : ''}` }
    }
    try {
      execFileSync('git', ['reset', '--soft', currentHead], { cwd: input.worktree.path, stdio: 'pipe' })
      execFileSync('git', ['read-tree', '--reset', '-u', mergedTree], { cwd: input.worktree.path, stdio: 'pipe' })
      const unstaged = spawnSync('git', ['diff', '--quiet', '--ignore-submodules=none'], { cwd: input.worktree.path, stdio: 'pipe' })
      if (unstaged.error || unstaged.status !== 0 || gitText(input.worktree.path, ['ls-files', '--unmerged']) || gitText(input.worktree.path, ['write-tree']) !== mergedTree) {
        throw new Error('materialized candidate tree did not match the computed merge')
      }
    } catch (error) {
      try {
        execFileSync('git', ['reset', '--soft', candidateHead], { cwd: input.worktree.path, stdio: 'pipe' })
        execFileSync('git', ['read-tree', '--reset', '-u', candidateTree], { cwd: input.worktree.path, stdio: 'pipe' })
      } catch {}
      return { kind: 'reopen', reason: `candidate tree materialization failed: ${errorMessage(error)}` }
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
