import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { CandidateLifecycle, CandidateOwnership, CandidateWorktreeRequest } from './candidate-contracts.js'
import type { CommitIdentity } from './identity.js'
import { isProviderTreeAlive, reapProviderProcesses } from './cleanup.js'
import { realGitOps, stageImplementation, RUNTIME_EXCLUDES } from './git.js'
import type { GitOps } from './gates.js'
import type { DispatcherGit, DispatcherRebase, DispatcherWorktree, DispatcherWorktrees, DispatcherWorkerInput } from './dispatcher.js'
import { isPidAlive } from './lock.js'
import { storyPathSegment } from './prd.js'
import { killProcessTreeForCleanup } from './watchdog.js'
import { parallelAcceptanceDigest, recoverParallelWorktree, retainParallelWorktree } from './recovery.js'
import { retainRuntimeProof } from './proof-retention.js'
import { writeScopesOverlap } from './scheduler.js'
import { statePath } from '../workspace/state.js'

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
  const acceptanceDigests = new Map<string, string>()
  const ownershipTokens = new Map<string, string>()
  return {
    worktrees: {
      create: input => {
        acceptanceDigests.set(input.story.id, parallelAcceptanceDigest(targetDir))
        const path = worktreePath(targetDir, input)
        const recovered = recoverParallelWorktree(targetDir, recoveryPath(targetDir, input.story.id), input.story.id)
        if (recovered) { owned.add(recovered.path); ownershipTokens.set(recovered.path, recovered.ownerToken); return recovered }
        const baseCommit = gitText(targetDir, ['rev-parse', 'HEAD'])
        preflightWorktreePath(targetDir, path)
        mkdirSync(dirname(path), { recursive: true })
        realGitOps.addWorktree(targetDir, path)
        owned.add(path)
        ownershipTokens.set(path, input.ownerToken)
        return { path, baseCommit }
      },
      cleanupProcess: cleanupProviderProcesses,
      retain: (input, reason, phase = 'integration') => {
        const file = recoveryPath(targetDir, input.story.id)
        // Preserve the path's original ownership identity when a retry is rejected again.
        const ownerToken = ownershipTokens.get(input.worktree.path) ?? input.ownerToken
        retainParallelWorktree(targetDir, file, { storyId: input.story.id, worktree: input.worktree.path, baseCommit: input.worktree.baseCommit, prdHash: acceptanceDigests.get(input.story.id)!, ownerToken, reason, phase })
      },
      remove: input => {
        removeOwnedWorktree(targetDir, input, owned, removed, realGitOps)
        const file = recoveryPath(targetDir, input.story.id)
        if (input.worktree.recovered && existsSync(file)) unlinkSync(file)
      },
    },
    git: {
      isClean: dir => realGitOps.isClean(dir),
      rebase: input => rebaseCandidate(targetDir, input),
      commit: input => {
        const unexpected = unexpectedWrites(input, changedPaths(input.worktree.path, gitText(input.worktree.path, ['rev-parse', 'HEAD'])))
        if (unexpected.length) throw new Error(`Candidate writes outside declared scopes after integrated gates: ${unexpected.join(', ')}`)
        retainRuntimeProof(input.worktree.path, input.story.id, targetDir)
        realGitOps.commitAll(input.worktree.path, `yoke: complete ${input.story.id} ${input.story.title}`, identity)
      },
      integrate: (input, expectedHead) => integrateCandidate(targetDir, input, expectedHead),
    },
    candidates: primary => makeCandidateLifecycle(targetDir, primary, owned, removed, realGitOps, ownershipTokens, acceptanceDigests.get(primary.story.id)),
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
  ownershipTokens?: Map<string, string>,
  acceptanceDigest?: string,
): CandidateLifecycle {
  const retainedRecords = new Map<string, string>()
  return {
    reserve: input => {
      const worktree = input.candidateId === 'candidate-1'
        ? primary.worktree
        : { path: candidateWorktreePath(targetDir, input), baseCommit: primary.worktree.baseCommit }
      if (input.candidateId !== 'candidate-1') ownershipTokens?.set(worktree.path, input.ownerToken)
      writeCandidateStatus(targetDir, input, worktree.path, 'reserved')
      return worktree
    },
    materialize: ownership => {
      if (ownership.worktree.path !== primary.worktree.path) {
        if (git === realGitOps) preflightWorktreePath(targetDir, ownership.worktree.path)
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
    ...(ownershipTokens && acceptanceDigest ? {
      retain: (ownership: CandidateOwnership, reason: string, phase: 'implementation' | 'integration') => {
        // The first retained candidate resumes through the existing dispatcher recovery path.
        // Additional alternatives remain inspectable without creating a second scheduler.
        const ownerToken = ownershipTokens.get(ownership.worktree.path) ?? ownership.ownerToken
        const suffix = createHash('sha256').update(ownerToken).digest('hex').slice(0, 24)
        const file = retainedRecords.get(ownership.worktree.path) ?? (retainedRecords.size === 0
          ? recoveryPath(targetDir, ownership.storyId)
          : statePath(targetDir, 'integration-recovery', `${storyPathSegment(ownership.storyId)}-candidate-${suffix}.json`))
        retainedRecords.set(ownership.worktree.path, file)
        retainParallelWorktree(targetDir, file, {
          storyId: ownership.storyId, worktree: ownership.worktree.path, baseCommit: ownership.worktree.baseCommit,
          prdHash: acceptanceDigest, ownerToken, reason, phase,
        })
        writeCandidateStatus(targetDir, ownership, ownership.worktree.path, 'retained', reason)
      },
    } : {}),
    remove: ownership => {
      removeOwnedWorktree(targetDir, ownership, owned, removed, git)
      writeCandidateStatus(targetDir, ownership, ownership.worktree.path, 'removed')
    },
  }
}

function worktreePath(targetDir: string, input: Pick<DispatcherWorkerInput, 'story' | 'ownerToken'>): string {
  return shortWorktreePath(targetDir, input.story.id, input.ownerToken)
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
  return shortWorktreePath(targetDir, input.storyId, input.ownerToken)
}

function shortWorktreePath(targetDir: string, storyId: string, ownerToken: string): string {
  // 96 bits derived from the complete ownership identity; Git refuses an existing path.
  const name = createHash('sha256').update(JSON.stringify([storyId, ownerToken])).digest('hex').slice(0, 24)
  return join(targetDir, '.yoke', 'worktrees', name)
}

function recoveryPath(targetDir: string, storyId: string): string {
  return statePath(targetDir, 'integration-recovery', `${storyPathSegment(storyId)}.json`)
}

function preflightWorktreePath(targetDir: string, path: string): void {
  if (process.platform !== 'win32') return
  const common = resolve(targetDir, gitText(targetDir, ['rev-parse', '--git-common-dir']))
  const administrativePath = join(common, 'worktrees', basename(path))
  if ([resolve(path, '.git'), administrativePath].some(value => value.length >= 240)) {
    throw new Error(`Parallel worktree path exceeds the Windows Git path budget: ${path}. Move the project to a shorter root and retry; implementation has not started.`)
  }
}

function writeCandidateStatus(
  targetDir: string,
  input: Pick<CandidateOwnership, 'storyId' | 'candidateId'>,
  worktree: string,
  state: 'reserved' | 'materialized' | 'cleaning' | 'removed' | 'retained',
  reason?: string,
): void {
  const file = join(targetDir, '.yoke', 'proof', storyPathSegment(input.storyId), 'candidates', input.candidateId, 'status.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ storyId: input.storyId, candidateId: input.candidateId, worktree, state, ...(reason ? { reason } : {}) }))
}

function rebaseCandidate(targetDir: string, input: DispatcherWorkerInput): DispatcherRebase {
  const currentHead = gitText(targetDir, ['rev-parse', 'HEAD'])
  const actual = changedPaths(input.worktree.path, input.worktree.baseCommit)
  const unexpected = unexpectedWrites(input, actual)
  const siblings = currentHead === input.worktree.baseCommit ? [] : changedPaths(targetDir, input.worktree.baseCommit)
  const collisions = actual.filter(path => writeScopesOverlap([path], siblings))
  if (unexpected.length) return { kind: 'reopen', reason: `Candidate writes outside declared scopes: ${unexpected.join(', ')}${collisions.length ? `; integrated sibling collisions: ${collisions.join(', ')}` : ''}` }
  if (collisions.length) return { kind: 'reopen', reason: `Candidate writes collide with integrated sibling changes: ${collisions.join(', ')}` }
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
      stageImplementation(input.worktree.path)
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

function changedPaths(directory: string, base: string): string[] {
  const read = (args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().split('\0').filter(Boolean)
  return [...new Set([...read(['diff', '--no-renames', '--name-only', '-z', base, '--', '.', ...RUNTIME_EXCLUDES]), ...read(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...RUNTIME_EXCLUDES])])].filter(path => !/^(?:\.yoke\/(?:proof|context)\/|\.yoke\/prd\.(?:yaml|json)$)/u.test(path))
}

function unexpectedWrites(input: DispatcherWorkerInput, paths: readonly string[]): string[] {
  if (input.story.writes === undefined) return []
  const normalize = (value: string) => {
    const path = value.replace(/\\/gu, '/').replace(/\/$/u, '')
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  return paths.filter(path => !input.story.writes!.some(scope => normalize(path) === normalize(scope) || normalize(path).startsWith(`${normalize(scope)}/`)))
}
