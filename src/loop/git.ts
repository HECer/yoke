import { execFileSync } from 'node:child_process'
import type { GitOps } from './gates.js'

export const realGitOps: GitOps = {
  isClean(dir: string): boolean {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()
    return out.trim() === ''
  },
  commitAll(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().trim()
    if (status === '') {
      throw new Error('nothing to commit after agent run')
    }
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', message], { cwd: dir, stdio: 'pipe' })
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
