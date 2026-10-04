import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

const CACHE_PATHS = ['node_modules', '.vite-temp', '.vite', '.cache', 'node_modules/.vite-temp', 'node_modules/.vite', 'node_modules/.cache']

/** Check writable roots only: ordinary package links and download stores remain supported. */
export function cacheIsolationProblem(worktree: string): string | undefined {
  let root: string
  try { root = realpathSync.native(worktree) }
  catch { return 'Cannot verify isolated worktree cache boundary. Restore the candidate directory before running gates.' }
  for (const path of CACHE_PATHS) {
    const candidate = join(root, path)
    try { lstatSync(candidate) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return `Cannot inspect isolated cache ${path}. Repair permissions before running gates.`
    }
    let actual: string
    try { actual = realpathSync.native(candidate) }
    catch { return `Cannot resolve isolated cache ${path}. Repair its dangling link or permissions before running gates.` }
    const rel = relative(root, actual)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
      return `Isolated cache ${path} resolves outside the candidate. Use worktree-local node_modules and writable runtime caches; shared package download stores and package-level links are allowed. Repair this link before retrying; do not relax the sandbox.`
    }
  }
  return undefined
}
