import { execFileSync } from 'node:child_process'
import type { GitOps } from './gates.js'
import { sanitizeCommitMessage, type CommitIdentity } from './identity.js'

const OUTPUT_ARTIFACT_EXCLUDE = ':(exclude).yoke/artifacts/**'

export const realGitOps: GitOps = {
  isClean(dir: string): boolean {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', OUTPUT_ARTIFACT_EXCLUDE], { cwd: dir }).toString()
    return out.trim() === ''
  },
  commitAll(dir: string, message: string, identity?: CommitIdentity): void {
    execFileSync('git', ['reset', '--quiet', '--', '.yoke/artifacts'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['add', '-A', '--', '.', OUTPUT_ARTIFACT_EXCLUDE], { cwd: dir, stdio: 'pipe' })
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString().trim()
    if (staged === '') {
      throw new Error('nothing to commit after agent run')
    }
    const identityArgs = identity
      ? ['-c', `user.name=${identity.authorName}`, '-c', `user.email=${identity.authorEmail}`]
      : []
    const authorArgs = identity ? ['--author', `${identity.authorName} <${identity.authorEmail}>`] : []
    const cleanMessage = sanitizeCommitMessage(message, identity?.allowCoAuthors ?? false)
    execFileSync('git', [...identityArgs, '-c', 'commit.gpgsign=false', 'commit', ...authorArgs, '-m', cleanMessage], { cwd: dir, stdio: 'pipe' })
  },
  addWorktree(repoDir: string, worktreePath: string): void {
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], { cwd: repoDir, stdio: 'pipe' })
  },
  removeWorktree(repoDir: string, worktreePath: string): void {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoDir, stdio: 'pipe' })
  },
  integrate(repoDir: string, worktreePath: string): void {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath }).toString().trim()
    execFileSync('git', ['merge', '--ff-only', sha], { cwd: repoDir, stdio: 'pipe' })
  },
}

export function commitPaths(dir: string, paths: string[], message: string, identity?: CommitIdentity): void {
  if (paths.length === 0) throw new Error('no commit paths supplied')
  const identityArgs = identity
    ? ['-c', `user.name=${identity.authorName}`, '-c', `user.email=${identity.authorEmail}`]
    : []
  const authorArgs = identity ? ['--author', `${identity.authorName} <${identity.authorEmail}>`] : []
  const cleanMessage = sanitizeCommitMessage(message, identity?.allowCoAuthors ?? false)
  execFileSync('git', ['add', '--', ...paths], { cwd: dir, stdio: 'pipe' })
  try {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--', ...paths], { cwd: dir, stdio: 'pipe' }).toString().trim()
    if (!staged) throw new Error('nothing to commit for selected paths')
    execFileSync('git', [...identityArgs, '-c', 'commit.gpgsign=false', 'commit', '--only', ...authorArgs, '-m', cleanMessage, '--', ...paths], { cwd: dir, stdio: 'pipe' })
  } catch (error) {
    try { execFileSync('git', ['reset', '--quiet', '--', ...paths], { cwd: dir, stdio: 'pipe' }) } catch { /* best effort */ }
    throw error
  }
}
