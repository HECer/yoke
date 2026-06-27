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
}
