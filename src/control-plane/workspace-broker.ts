import { scopesOverlap, normalizeScope } from './admission.js'
import { createWorkspaceSnapshot, snapshotEntries, workspacePath, type WorkspaceSnapshot } from './workspace-snapshot.js'
import { digest, fail, list, record } from './validation.js'

export interface WorkspaceEdit { readonly path: string; readonly expectedSha256: string | null; readonly content: string | null }
export interface WorkspaceReader { snapshot(): WorkspaceSnapshot }
export interface WorkspaceWriter {
  apply(expectedSnapshot: string, edits: readonly WorkspaceEdit[]): WorkspaceSnapshot
  release(): void
}
export interface WorkspaceBroker {
  readonly reader: WorkspaceReader
  acquireWriter(): WorkspaceWriter
  seal(): WorkspaceSnapshot
}

export function parseWorkspaceEdits(value: unknown): WorkspaceEdit[] {
  const edits = list(value, 'edits', 200).map(value => {
    const raw = record(value, ['path', 'expectedSha256', 'content'], 'workspace edit')
    if (raw.content !== null && (typeof raw.content !== 'string' || Buffer.byteLength(raw.content, 'utf8') > 1024 * 1024)) fail('invalid_text', 'Replacement content must be null or bounded UTF-8 text')
    return { path: workspacePath(raw.path), expectedSha256: raw.expectedSha256 === null ? null : digest(raw.expectedSha256, 'expectedSha256'), content: raw.content as string | null }
  })
  if (!edits.length) fail('empty_edits', 'At least one edit is required')
  if (new Set(edits.map(e => e.path.toLowerCase())).size !== edits.length) fail('path_alias', 'An edit batch cannot contain duplicate or case-aliased paths')
  return edits
}

/**
 * Enforced for broker operations, not arbitrary same-user shell processes. Worker
 * requests are data, never callbacks or commands. Publishing is a controller step.
 */
export function createWorkspaceBroker(base: WorkspaceSnapshot, writeScopes: readonly string[], protectedScopes: readonly string[] = []): WorkspaceBroker {
  snapshotEntries(base)
  const grants = writeScopes.map(normalizeScope)
  const protectedPaths = ['.git', '.yoke', ...protectedScopes].map(normalizeScope)
  let current = base, sealed = false, active: symbol | undefined
  const reader: WorkspaceReader = Object.freeze({ snapshot: () => current })
  return Object.freeze({
    reader,
    acquireWriter(): WorkspaceWriter {
      if (sealed) fail('workspace_sealed', 'A sealed workspace cannot start another writer')
      if (active) fail('writer_active', 'The workspace already has a writer')
      const token = Symbol('writer')
      active = token
      return Object.freeze({
        apply(expectedSnapshot: string, input: readonly WorkspaceEdit[]): WorkspaceSnapshot {
          if (sealed || active !== token) fail('writer_revoked', 'Writer authority is no longer current')
          if (digest(expectedSnapshot, 'snapshot') !== current.id) fail('stale_snapshot', 'The edit was based on an older workspace revision')
          const edits = parseWorkspaceEdits(input)
          for (const edit of edits) {
            const path = normalizeScope(edit.path)
            if (!grants.some(grant => path === grant || path.startsWith(`${grant}/`))) fail('scope_not_granted', `Write is outside the authorized scope: ${edit.path}`)
            if (protectedPaths.some(protectedPath => scopesOverlap(path, protectedPath))) fail('protected_scope', `Protected path cannot be edited: ${edit.path}`)
            const file = current.files.find(file => file.path === edit.path)
            if (!file) fail('outside_snapshot', `Edit is outside the pinned snapshot: ${edit.path}`)
            if (file.sha256 !== edit.expectedSha256) fail('stale_file', `File precondition no longer matches: ${edit.path}`)
          }
          // Construct and validate the whole revision before making it visible.
          const byPath = new Map(edits.map(edit => [edit.path, edit]))
          const next = createWorkspaceSnapshot(snapshotEntries(current).map(entry => {
            const edit = byPath.get(entry.path)
            return edit ? { ...entry, content: edit.content, executable: edit.content !== null && entry.executable } : entry
          }))
          current = next
          return current
        },
        release(): void { if (active === token) active = undefined },
      })
    },
    seal(): WorkspaceSnapshot {
      if (active) fail('writer_active', 'Release the writer before sealing verification input')
      sealed = true
      return current
    },
  })
}
