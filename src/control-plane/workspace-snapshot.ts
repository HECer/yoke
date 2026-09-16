import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { fail } from './validation.js'

export const SNAPSHOT_LIMITS = Object.freeze({ files: 200, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024 })
export interface SnapshotEntry { readonly path: string; readonly content: string | null; readonly executable: boolean }
export interface SnapshotFile { readonly path: string; readonly sha256: string | null; readonly bytes: number; readonly executable: boolean }
export interface WorkspaceSnapshot {
  readonly id: string
  readonly coverage: 'explicit-files'
  readonly files: readonly SnapshotFile[]
  read(path: string): string | null
}
const snapshots = new WeakMap<WorkspaceSnapshot, readonly SnapshotEntry[]>()
export const contentDigest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** Portable literal paths only. In particular, Windows aliases must not weaken scopes. */
export function workspacePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f:*?<>|\[\]{}]/u.test(value) || isAbsolute(value)) fail('invalid_workspace_path', 'Expected a portable literal repository-relative path')
  const parts = value.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || p !== p.trim() || /[. ]$/u.test(p) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(p) || p.toLowerCase() === '.git')) fail('invalid_workspace_path', `Unsafe workspace path: ${value}`)
  return value
}

/** Check every ancestor, not just the final entry. This is not an OS sandbox. */
export function resolveWorkspacePath(directory: string, name: string): string {
  const root = realpathSync.native(directory)
  if (!lstatSync(root).isDirectory()) fail('invalid_root', 'Workspace root must be a directory')
  const parts = workspacePath(name).split('/')
  let full = root
  for (const [index, part] of parts.entries()) {
    full = join(full, part)
    let stat
    try { stat = lstatSync(full) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (stat.isSymbolicLink()) fail('linked_workspace_path', `Workspace links are not supported: ${name}`)
    if (index < parts.length - 1 && !stat.isDirectory()) fail('invalid_workspace_path', `Non-directory ancestor: ${name}`)
    if (index === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1)) fail('unsupported_workspace_entry', `Expected a regular non-hardlinked file: ${name}`)
    const rel = relative(root, realpathSync.native(full))
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) fail('workspace_escape', 'Workspace path escaped its root')
    const canonical = rel.replace(/\\/gu, '/')
    const expected = parts.slice(0, index + 1).join('/')
    if ((process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected)) fail('path_alias', 'Filesystem path aliases are not supported')
  }
  return full
}

/** UTF-8 strings are immutable. Neither callers nor readers receive mutable buffers/maps. */
export function createWorkspaceSnapshot(input: readonly SnapshotEntry[]): WorkspaceSnapshot {
  if (!Array.isArray(input) || !input.length || input.length > SNAPSHOT_LIMITS.files) fail('snapshot_size', 'Snapshot needs 1–200 explicit file entries')
  const seen = new Set<string>()
  let total = 0
  const entries = input.map(entry => {
    const path = workspacePath(entry.path), key = path.toLowerCase()
    if (seen.has(key)) fail('path_alias', `Duplicate or case-aliased snapshot path: ${path}`)
    seen.add(key)
    if (entry.content !== null && (typeof entry.content !== 'string' || Buffer.from(entry.content, 'utf8').toString('utf8') !== entry.content)) fail('invalid_text', `Expected lossless UTF-8 text: ${path}`)
    if (typeof entry.executable !== 'boolean' || (entry.content === null && entry.executable)) fail('invalid_mode', 'Missing files cannot have executable permissions')
    const bytes = entry.content === null ? 0 : Buffer.byteLength(entry.content)
    total += bytes
    if (bytes > SNAPSHOT_LIMITS.fileBytes || total > SNAPSHOT_LIMITS.totalBytes) fail('snapshot_size', 'Workspace snapshot exceeds its byte quota')
    return Object.freeze({ path, content: entry.content, executable: entry.executable })
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // A regular file cannot simultaneously be a parent directory of another entry.
  for (const entry of entries) if (entries.some(other => other.path.toLowerCase().startsWith(`${entry.path.toLowerCase()}/`))) fail('path_alias', 'Overlapping file paths are not supported')
  const files = Object.freeze(entries.map(entry => Object.freeze({ path: entry.path, sha256: entry.content === null ? null : contentDigest(entry.content), bytes: entry.content === null ? 0 : Buffer.byteLength(entry.content), executable: entry.executable })))
  const id = contentDigest(JSON.stringify({ version: 1, coverage: 'explicit-files', files }))
  const byPath = new Map(entries.map(entry => [entry.path, entry.content]))
  const snapshot: WorkspaceSnapshot = Object.freeze({
    id, coverage: 'explicit-files' as const, files,
    read(path: string): string | null {
      workspacePath(path)
      if (!byPath.has(path)) fail('outside_snapshot', `File is outside this snapshot's explicit coverage: ${path}`)
      return byPath.get(path)!
    },
  })
  snapshots.set(snapshot, Object.freeze(entries))
  return snapshot
}

export function snapshotEntries(snapshot: WorkspaceSnapshot): readonly SnapshotEntry[] {
  const entries = snapshots.get(snapshot)
  if (!entries) fail('untrusted_snapshot', 'Use a snapshot produced by the native snapshot service')
  return entries
}

/** Capture at a controller-owned quiet boundary; afterwards reads never revisit the disk. */
export function captureWorkspaceSnapshot(root: string, paths: readonly string[]): WorkspaceSnapshot {
  if (!Array.isArray(paths) || !paths.length || paths.length > SNAPSHOT_LIMITS.files) fail('snapshot_size', 'Snapshot needs 1–200 explicit paths')
  const entries: SnapshotEntry[] = []
  let total = 0
  for (const path of paths) {
    const full = resolveWorkspacePath(root, path)
    let fd: number
    try { fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      entries.push({ path, content: null, executable: false }); continue
    }
    try {
      const before = fstatSync(fd)
      if (!before.isFile() || before.nlink !== 1) fail('unsupported_workspace_entry', `Expected a regular file: ${path}`)
      total += before.size
      if (before.size > SNAPSHOT_LIMITS.fileBytes || total > SNAPSHOT_LIMITS.totalBytes) fail('snapshot_size', 'Workspace snapshot exceeds its byte quota')
      const bounded = Buffer.alloc(before.size + 1)
      let used = 0
      while (used < bounded.length) {
        const count = readSync(fd, bounded, used, bounded.length - used, null)
        if (!count) break
        used += count
      }
      const buffer = bounded.subarray(0, used)
      const after = fstatSync(fd)
      if (buffer.length !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('snapshot_changed', `File changed while being captured: ${path}`)
      const content = buffer.toString('utf8')
      if (!Buffer.from(content, 'utf8').equals(buffer)) fail('invalid_text', `Binary/non-UTF-8 file is not supported by the text broker: ${path}`)
      entries.push({ path, content, executable: Boolean(before.mode & 0o111) })
    } finally { closeSync(fd) }
  }
  return createWorkspaceSnapshot(entries)
}
