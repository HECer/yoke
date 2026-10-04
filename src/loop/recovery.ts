import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync as filesystemRealpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { statePath } from '../workspace/state.js'
import { loadPrd } from './prd.js'
import { observedError, safeFailure, type FailureObservation } from '../observability/failure.js'

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

export type ParallelRecoveryPhase = 'implementation' | 'integration'

const LegacyParallelRecovery = z.object({
  version: z.literal(1), root: z.string().max(4096), storyId: z.string().max(1024), worktree: z.string().max(4096), baseCommit: z.string().max(128),
  prdHash: z.string().length(64), ownerToken: z.string().min(1).max(256), reason: z.string().max(16384), state: z.literal('retained'), recordedAt: z.string().datetime(),
  observation: z.unknown().transform(safeFailure).refine(value => value !== undefined, 'Invalid failure observation').optional(),
}).strict()
const CurrentParallelRecovery = LegacyParallelRecovery.extend({ version: z.literal(2), phase: z.enum(['implementation', 'integration']) })
const ParallelRecovery = z.discriminatedUnion('version', [LegacyParallelRecovery, CurrentParallelRecovery])

export function parallelAcceptanceDigest(directory: string): string {
  // Accepted sibling stories change only passes. Their acceptance contracts remain protected.
  const contract = loadPrd(join(directory, '.yoke', 'prd.yaml')).map(({ passes: _passes, ...story }) => story)
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex')
}

function parallelRecordPath(directory: string, file: string): string {
  const safe = statePath(directory, 'integration-recovery', basename(file))
  if (pathIdentity(resolve(file)) !== pathIdentity(resolve(safe))) throw new Error('Invalid parallel recovery record path')
  return safe
}

export function discardParallelRecoveryRecords(directory: string): void {
  const parent = statePath(directory, 'integration-recovery')
  if (!existsSync(parent)) return
  for (const name of readdirSync(parent)) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue
    const file = statePath(directory, 'integration-recovery', name)
    if (!lstatSync(file).isFile()) throw new Error('Parallel recovery record is not a file')
    rmSync(file)
  }
}

/** Records are outside the candidate and bind reuse to unchanged target acceptance. */
export function retainParallelWorktree(directory: string, file: string, input: { storyId: string; worktree: string; ownerToken: string; reason: string; baseCommit: string; prdHash: string; phase?: ParallelRecoveryPhase; observation?: FailureObservation }): void {
  const root = realpathSync(directory)
  const worktree = realpathSync(input.worktree)
  const record = CurrentParallelRecovery.parse({ version: 2, root, ...input, phase: input.phase ?? 'integration', reason: input.reason.slice(0, 16384), worktree, state: 'retained', recordedAt: new Date().toISOString() })
  const safe = parallelRecordPath(directory, file)
  mkdirSync(dirname(safe), { recursive: true })
  const temp = statePath(directory, 'integration-recovery', `${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    parallelRecordPath(directory, file)
    renameSync(temp, safe)
  } finally { rmSync(temp, { force: true }) }
}

export function recoverParallelWorktree(directory: string, file: string, storyId: string): { path: string; baseCommit: string; recovered: true; ownerToken: string; recovery: { phase: ParallelRecoveryPhase; feedback: string; observation?: FailureObservation } } | undefined {
  let safe: string
  try { safe = parallelRecordPath(directory, file) } catch (error) { throw Object.assign(error as Error, { failure: observedError('', 'invalid-evidence').failure }) }
  if (!existsSync(safe)) return undefined
  const stat = lstatSync(safe)
  if (!stat.isFile()) throw observedError('Parallel recovery record is not a file', 'invalid-evidence')
  if (stat.size > 65536) throw observedError('Parallel recovery record is too large', 'invalid-evidence')
  const parsed = (() => { const raw = readFileSync(safe, 'utf8'); try { return ParallelRecovery.parse(JSON.parse(raw)) } catch (error) { throw Object.assign(error as Error, { failure: observedError('', 'invalid-evidence').failure }) } })()
  const saved = parsed
  // Existing records describe independently checked candidates awaiting integration.
  const phase = saved.version === 1 ? 'integration' : saved.phase
  if (!existsSync(saved.worktree)) throw new Error(`Retained candidate is missing: ${saved.worktree}; resolve its recovery record before retrying`)
  const root = realpathSync(directory)
  const actual = realpathSync(saved.worktree)
  const parent = realpathSync(join(root, '.yoke', 'worktrees'))
  const rel = relative(parent, actual)
  const expectedName = createHash('sha256').update(JSON.stringify([storyId, saved.ownerToken])).digest('hex').slice(0, 24)
  if (saved.storyId !== storyId || pathIdentity(saved.root) !== pathIdentity(root) || pathIdentity(actual) !== pathIdentity(saved.worktree) || isAbsolute(rel) || rel !== expectedName) throw observedError('Retained candidate ownership or path binding is invalid', 'invalid-evidence')
  const git = (args: string[], cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
  const stale = () => observedError(`Retained candidate is stale against target or PRD: ${actual}; reconcile it before retrying`, 'source-changed')
  if (saved.prdHash !== parallelAcceptanceDigest(root)) throw stale()
  if (saved.baseCommit !== git(['rev-parse', 'HEAD'])) {
    if (phase === 'integration') throw stale()
    // Siblings may have integrated while this worker was still incomplete. Reuse
    // its original checkout only for a forward target; integration still rebases
    // and independently verifies the combined tree before accepting the story.
    try { git(['merge-base', '--is-ancestor', saved.baseCommit, 'HEAD']) }
    catch { throw stale() }
  }
  const common = realpathSync(resolve(root, git(['rev-parse', '--git-common-dir'])))
  if (pathIdentity(realpathSync(resolve(actual, git(['rev-parse', '--git-common-dir'], actual)))) !== pathIdentity(common)) throw new Error('Retained candidate belongs to another repository')
  const registered = git(['worktree', 'list', '--porcelain']).split(/\r?\n/u).filter(line => line.startsWith('worktree ')).map(line => realpathSync(resolve(line.slice(9))))
  if (!registered.some(path => pathIdentity(path) === pathIdentity(actual))) throw new Error('Retained candidate is not a registered worktree')
  git(['merge-base', '--is-ancestor', saved.baseCommit, 'HEAD'], actual)
  return { path: actual, baseCommit: saved.baseCommit, recovered: true, ownerToken: saved.ownerToken, recovery: { phase, feedback: saved.reason, ...(saved.observation ? { observation: saved.observation } : {}) } }
}
