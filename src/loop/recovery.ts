import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync as filesystemRealpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'

const Recovery = z.object({ version: z.literal(1), root: z.string(), worktree: z.string(), base: z.string(), prdHash: z.string() }).strict()
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const pathIdentity = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path
// Native handle-based resolution expands Windows 8.3 names. The JS realpath
// implementation can retain RUNNER~1 while Git reports runneradmin.
const realpathSync = filesystemRealpathSync.native

/** Explicit recovery is valid only for the unchanged original target and PRD. */
export function prepareIsolatedWorktree(directory: string, worktree: string, resume: boolean): void {
  const root = realpathSync(directory)
  // Resolve caller aliases (including Windows 8.3 temp paths) against the same
  // canonical root before comparing them with Git's registered path spellings.
  const wt = resolve(root, relative(resolve(directory), resolve(worktree)))
  const expectedParent = join(root, '.yoke', 'worktrees')
  if (pathIdentity(dirname(wt)) !== pathIdentity(expectedParent)) throw new Error('Recovery worktree path must be a direct project worktree')
  const git = (args: string[], cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const common = realpathSync(resolve(root, git(['rev-parse', '--git-common-dir'])))
  const name = createHash('sha256').update(wt).digest('hex')
  const record = join(common, 'yoke-recovery', `${name}.json`)
  const base = git(['rev-parse', 'HEAD'])
  const prdHash = digest(join(root, '.yoke', 'prd.yaml'))
  if (existsSync(wt)) {
    if (!resume) throw new Error(`Retained worktree: ${wt}. Use --resume-worktree to continue or explicit loop cleanup to discard.`)
    if (!existsSync(record)) throw new Error('No trusted worktree recovery record exists')
    const saved = Recovery.parse(JSON.parse(readFileSync(record, 'utf8')))
    if (pathIdentity(saved.root) !== pathIdentity(root) || pathIdentity(saved.worktree) !== pathIdentity(wt) || saved.base !== base || saved.prdHash !== prdHash) throw new Error('Target or PRD changed; recovery is stale')
    const actual = realpathSync(wt)
    const rel = relative(realpathSync(expectedParent), actual)
    if (isAbsolute(rel) || rel.startsWith('..') || rel.includes('/') || rel.includes('\\')) throw new Error('Recovery worktree path escaped')
    const registered = git(['worktree', 'list', '--porcelain']).split(/\r?\n/).filter(line => line.startsWith('worktree ')).map(line => realpathSync(resolve(line.slice(9))))
    if (!registered.some(path => pathIdentity(path) === pathIdentity(actual))) throw new Error(`Recovery directory is not a registered worktree: ${actual}; registered: ${registered.join(', ')}`)
    if (pathIdentity(realpathSync(resolve(actual, git(['rev-parse', '--git-common-dir'], actual)))) !== pathIdentity(common)) throw new Error('Recovery belongs to a different repository')
    git(['merge-base', '--is-ancestor', base, 'HEAD'], actual)
    return
  }
  mkdirSync(dirname(record), { recursive: true })
  git(['worktree', 'add', '--detach', wt, base])
  // Record is outside the worker checkout and binds reuse to its source state.
  writeFileSync(record, JSON.stringify({ version: 1, root, worktree: wt, base, prdHash }), { mode: 0o600 })
}
