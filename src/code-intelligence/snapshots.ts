import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

export const SnapshotFileSchema = z.object({ path: z.string().min(1), hash: z.string().length(64), size: z.number().int().nonnegative() })
export const SnapshotSchema = z.object({
  snapshot_id: z.string().length(64), workspace_id: z.string().min(1), root: z.string().min(1), head: z.string().nullable(),
  files: z.array(SnapshotFileSchema), policy_hash: z.string().length(64), created_at: z.string(),
})
export type Snapshot = z.infer<typeof SnapshotSchema>

export interface SnapshotPolicy { excludePatterns?: string[]; maxFileBytes?: number }

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function excluded(path: string, policy: SnapshotPolicy): boolean {
  const standard = [/^\.git(?:\/|$)/, /^\.yoke\/code-intelligence(?:\/|$)/, /(^|\/)\.env(?:\.|$)/, /\.(?:pem|key|p12|pfx)$/i]
  if (standard.some(re => re.test(path))) return true
  return (policy.excludePatterns ?? []).some(pattern => globToRegExp(pattern).test(path))
}

function safeFile(root: string, rel: string, policy: SnapshotPolicy): { path: string; bytes: Buffer } | null {
  const normalized = rel.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..') || excluded(normalized, policy)) return null
  const absolute = resolve(root, normalized)
  if (!inside(root, absolute) || !existsSync(absolute)) return null
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink() || (policy.maxFileBytes && stat.size > policy.maxFileBytes)) return null
  return { path: normalized, bytes: readFileSync(absolute) }
}

function fallbackFiles(root: string, dir = root, output: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.yoke' || entry.name === 'node_modules') continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) fallbackFiles(root, absolute, output)
    else if (entry.isFile()) output.push(relative(root, absolute).replaceAll('\\', '/'))
  }
  return output
}

function trackedAndUntracked(root: string): string[] {
  try {
    const result = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] })
    return result.toString('utf8').split('\0').filter(Boolean)
  } catch {
    return fallbackFiles(root)
  }
}

function head(root: string): string | null {
  try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { return null }
}

export function workspaceId(workspaceRoot: string): string {
  return `workspace-${sha256(realpathSync(resolve(workspaceRoot))).slice(0, 24)}`
}

export function assertSafePath(workspaceRoot: string, candidate: string, policy: SnapshotPolicy = {}): string {
  const root = realpathSync(resolve(workspaceRoot))
  const absolute = resolve(root, candidate)
  const rel = relative(root, absolute).replaceAll('\\', '/')
  if (!inside(root, absolute) || rel === '' || excluded(rel, policy)) throw new Error(`path is outside the permitted workspace: ${candidate}`)
  try { if (lstatSync(absolute).isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${candidate}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return rel
}

export function createSnapshot(workspaceRoot: string, policy: SnapshotPolicy = {}, workspace = workspaceId(workspaceRoot)): Snapshot {
  const root = realpathSync(resolve(workspaceRoot))
  const files = trackedAndUntracked(root).map(path => safeFile(root, path, policy)).filter((value): value is { path: string; bytes: Buffer } => value !== null)
    .sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ path: file.path, hash: sha256(file.bytes), size: file.bytes.byteLength }))
  const policyHash = sha256(JSON.stringify({ excludePatterns: policy.excludePatterns ?? [], maxFileBytes: policy.maxFileBytes ?? null }))
  const identity = JSON.stringify({ workspace, root, head: head(root), files, policyHash })
  const snapshot = SnapshotSchema.parse({ snapshot_id: sha256(identity), workspace_id: workspace, root, head: head(root), files, policy_hash: policyHash, created_at: new Date().toISOString() })
  const dir = join(root, '.yoke', 'code-intelligence', 'snapshots')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${snapshot.snapshot_id}.json`), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 })
  return snapshot
}

export function loadSnapshot(workspaceRoot: string, snapshotId: string): Snapshot {
  const root = realpathSync(resolve(workspaceRoot))
  const file = join(root, '.yoke', 'code-intelligence', 'snapshots', `${snapshotId}.json`)
  if (!existsSync(file)) throw new Error(`unknown snapshot: ${snapshotId}`)
  const snapshot = SnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  if (snapshot.root !== root) throw new Error('snapshot belongs to another workspace')
  return snapshot
}

export function currentSnapshotMatches(workspaceRoot: string, snapshot: Snapshot, policy: SnapshotPolicy = {}): boolean {
  const current = createSnapshot(workspaceRoot, policy, snapshot.workspace_id)
  return current.snapshot_id === snapshot.snapshot_id
}

export function assertSnapshotCurrent(workspaceRoot: string, snapshot: Snapshot, policy: SnapshotPolicy = {}): void {
  if (!currentSnapshotMatches(workspaceRoot, snapshot, policy)) throw new Error('snapshot is stale; create a new snapshot before continuing')
}
