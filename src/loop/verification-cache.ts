import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type Stats } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { VerifyResult } from './verify.js'

export type VerificationCacheSkipReason = 'ineligible_phase' | 'invalid_inputs' | 'file_limit' | 'byte_limit' | 'linked_input' | 'unsupported_input' | 'input_changed' | 'git_error' | 'io_error' | 'mutating_command'
export interface VerificationCacheDiagnostic { reason: VerificationCacheSkipReason; message: string }
export interface VerificationCacheDiagnostics {
  identityChecks: number
  workspaceFilesHashed: number
  workspaceBytesHashed: number
  runtimeBytesHashed: number
  identityMs: number
  skipped: Partial<Record<VerificationCacheSkipReason, number>>
  lastSkip?: VerificationCacheDiagnostic
}
export interface VerificationSession {
  run(directory: string, command: string, phase: string, execute: () => VerifyResult, options?: { env?: NodeJS.ProcessEnv; policyKey?: string }): VerifyResult
  stats(): { executed: number; reused: number }
  diagnostics(): VerificationCacheDiagnostics
}

const MAX_WORKSPACE_FILES = 10_000
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024
const MAX_RUNTIME_BYTES = 512 * 1024 * 1024
const MAX_ENTRIES = 20_000
class UnavailableIdentity extends Error {
  constructor(readonly reason: VerificationCacheSkipReason, message: string) { super(message) }
}
interface Entry { path: string; name: string; stat: Stats }
const POLICY_INPUTS = ['.yoke/acceptance.yaml', '.yoke/config.yaml', '.yoke/prd.json', '.yoke/prd.yaml', '.yoke/requirements.yaml', '.yoke/plan.md']

function containedInput(root: string, input: string): string {
  if (typeof input !== 'string') throw new UnavailableIdentity('invalid_inputs', 'Declared inputs must be workspace-relative file or directory paths.')
  const normalized = input.replaceAll('\\', '/')
  if (!normalized || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..') || /[\0*?\[\]{}]/.test(normalized)) throw new UnavailableIdentity('invalid_inputs', 'Declared inputs must be workspace-relative paths without parent traversal or globs.')
  const path = resolve(root, normalized), rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new UnavailableIdentity('invalid_inputs', 'A declared input escapes the workspace.')
  let ancestor = root
  for (const component of rel.split(/[\\/]/).filter(Boolean)) {
    ancestor = join(ancestor, component)
    try { if (lstatSync(ancestor).isSymbolicLink()) throw new UnavailableIdentity('linked_input', 'A declared input has a symlink ancestor; command reuse is disabled.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error }
  }
  return path
}

/** Stat the entire input set before allocating/reading content. Oversized or
 * linked trees disable reuse without first hashing the runtime or large files. */
function inventory(root: string, declaredInputs?: readonly string[]): { entries: Entry[]; missingPolicy: string[]; declaration: string[] | null } {
  const missingPolicy: string[] = []
  let selected = [root], declaration: string[] | null = null
  if (declaredInputs !== undefined) {
    if (!Array.isArray(declaredInputs) || !declaredInputs.length || declaredInputs.length > 256) throw new UnavailableIdentity('invalid_inputs', 'Declare 1–256 complete input paths, or omit the declaration to fingerprint all local inputs.')
    selected = [...new Set(declaredInputs.map(path => containedInput(root, path)))].sort()
    declaration = selected.map(path => relative(root, path) || '.')
    for (const path of selected) {
      try { lstatSync(path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new UnavailableIdentity('invalid_inputs', 'A declared input does not exist; command reuse is disabled.')
        throw error
      }
    }
    for (const policy of POLICY_INPUTS) {
      const path = containedInput(root, policy)
      try { lstatSync(path); selected.push(path) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') missingPolicy.push(policy); else throw error }
    }
    selected = [...new Set(selected)].filter(path => !selected.some(parent => path !== parent && relative(parent, path) !== '' && !relative(parent, path).startsWith('..') && !isAbsolute(relative(parent, path)))).sort()
  }
  const entries: Entry[] = [], pending = [...selected].reverse()
  if (!selected.includes(root)) entries.push({ path: root, name: '.', stat: lstatSync(root) })
  let files = 0, bytes = 0
  while (pending.length) {
    const path = pending.pop()!, stat = lstatSync(path), name = relative(root, path) || '.'
    if (stat.isSymbolicLink()) throw new UnavailableIdentity('linked_input', 'A local input is a symlink; command reuse is disabled.')
    if (!stat.isDirectory() && !stat.isFile()) throw new UnavailableIdentity('unsupported_input', 'A local input is not a regular file or directory; command reuse is disabled.')
    entries.push({ path, name, stat })
    if (entries.length > MAX_ENTRIES) throw new UnavailableIdentity('file_limit', 'Input inventory exceeds 20,000 entries; command reuse is disabled.')
    if (stat.isDirectory()) {
      const directory = opendirSync(path), children: string[] = []
      try {
        let child
        while ((child = directory.readSync())) {
          if (child.name === '.git') continue
          children.push(child.name)
          if (entries.length + pending.length + children.length > MAX_ENTRIES) throw new UnavailableIdentity('file_limit', 'Input inventory exceeds 20,000 entries; command reuse is disabled.')
        }
      } finally { directory.closeSync() }
      for (const child of children.sort().reverse()) pending.push(join(path, child))
    } else {
      if (++files > MAX_WORKSPACE_FILES) throw new UnavailableIdentity('file_limit', 'Local inputs exceed 10,000 files; command reuse is disabled.')
      if ((bytes += stat.size) > MAX_WORKSPACE_BYTES) throw new UnavailableIdentity('byte_limit', 'Local inputs exceed 64 MiB; command reuse is disabled.')
    }
  }
  return { entries, missingPolicy, declaration }
}

function unchanged(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
}

function fileHash(entry: Entry, buffer: Buffer, onRead: (bytes: number) => void): string {
  const descriptor = openSync(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), hash = createHash('sha256')
  try {
    if (!unchanged(entry.stat, fstatSync(descriptor))) throw new UnavailableIdentity('input_changed', 'A local input changed while identity was being read; command reuse is disabled.')
    let bytes = 0, count: number
    while ((count = readSync(descriptor, buffer, 0, buffer.length, bytes)) > 0) {
      bytes += count; onRead(count)
      if (bytes > entry.stat.size) throw new UnavailableIdentity('input_changed', 'A local input grew while identity was being read; command reuse is disabled.')
      hash.update(buffer.subarray(0, count))
    }
    if (bytes !== entry.stat.size || !unchanged(entry.stat, fstatSync(descriptor))) throw new UnavailableIdentity('input_changed', 'A local input changed while identity was being read; command reuse is disabled.')
    return hash.digest('hex')
  } finally { closeSync(descriptor) }
}

/** Preserve Git state without a second pass over source contents. */
function gitIdentity(root: string): unknown {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 5000 })
  let top: string
  try { top = git(['rev-parse', '--show-toplevel']).trim() }
  catch (error) {
    if (String((error as { stderr?: unknown }).stderr).includes('not a git repository')) return null
    throw new UnavailableIdentity('git_error', 'Git identity could not be read; command reuse is disabled.')
  }
  try {
    const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
    const index = git(['ls-files', '--stage', '-z', '--', '.'])
    if (/(?:^|\0)160000 /.test(index)) throw new UnavailableIdentity('unsupported_input', 'A nested Git worktree requires independent identity; command reuse is disabled.')
    // --quiet distinguishes a new repository from other Git failures below.
    let head: string | null = null
    try { head = git(['rev-parse', '--verify', '--quiet', 'HEAD']).trim() }
    catch (error) { if ((error as { status?: unknown }).status !== 1) throw error }
    return { top, status, index, head }
  } catch (error) {
    if (error instanceof UnavailableIdentity) throw error
    throw new UnavailableIdentity('git_error', 'Git identity could not be read; command reuse is disabled.')
  }
}

function identity(directory: string, command: string, phase: string, env: NodeJS.ProcessEnv, policyKey: string, diagnostics: VerificationCacheDiagnostics, declaredInputs?: readonly string[]): string {
  const root = realpathSync(resolve(directory)), { entries, missingPolicy, declaration } = inventory(root, declaredInputs)
  const hash = createHash('sha256').update(JSON.stringify({
    identity_version: 2, root, command, phase, policyKey, node: process.version, platform: process.platform, arch: process.arch,
    environment: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)), git: gitIdentity(root), declared_inputs: declaration, missing_policy: missingPolicy,
  }) + '\n')
  const runtimePath = realpathSync(process.execPath), runtimeStat = lstatSync(runtimePath), buffer = Buffer.allocUnsafe(128 * 1024)
  if (!runtimeStat.isFile() || runtimeStat.size > MAX_RUNTIME_BYTES) throw new UnavailableIdentity('byte_limit', 'Runtime identity exceeds its separate 512 MiB limit; command reuse is disabled.')
  const runtimeHash = fileHash({ path: runtimePath, name: runtimePath, stat: runtimeStat }, buffer, count => { diagnostics.runtimeBytesHashed += count })
  hash.update(JSON.stringify({ runtime: process.execPath, resolved: runtimePath, mode: runtimeStat.mode, sha256: runtimeHash }) + '\n')
  for (const entry of entries) {
    if (entry.stat.isDirectory()) hash.update(JSON.stringify({ path: entry.name, type: 'directory', mode: entry.stat.mode }) + '\n')
    else {
      const digest = fileHash(entry, buffer, count => { diagnostics.workspaceBytesHashed += count })
      diagnostics.workspaceFilesHashed++
      hash.update(JSON.stringify({ path: entry.name, type: 'file', mode: entry.stat.mode, bytes: entry.stat.size, sha256: digest }) + '\n')
    }
  }
  // Default identity includes ignored files, dependencies and local .yoke
  // state. A smaller input set requires an explicit operator declaration.
  for (const entry of entries) if (!unchanged(entry.stat, lstatSync(entry.path))) throw new UnavailableIdentity('input_changed', 'The input tree changed during identity collection; command reuse is disabled.')
  for (const policy of missingPolicy) {
    try { lstatSync(join(root, policy)); throw new UnavailableIdentity('input_changed', 'Project policy appeared during identity collection; command reuse is disabled.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return hash.digest('hex')
}

/** Explicit run-local reuse. Independent integration/completion never uses this cache. */
export function createVerificationSession(options: { inputPaths?: readonly string[]; onDiagnostic?: (diagnostic: VerificationCacheDiagnostic) => void } = {}): VerificationSession {
  const results = new Map<string, VerifyResult>()
  const declaredInputs = options.inputPaths === undefined ? undefined : Array.isArray(options.inputPaths) ? [...options.inputPaths] : options.inputPaths
  const diagnostics: VerificationCacheDiagnostics = { identityChecks: 0, workspaceFilesHashed: 0, workspaceBytesHashed: 0, runtimeBytesHashed: 0, identityMs: 0, skipped: {} }
  let executed = 0, reused = 0
  const skip = (diagnostic: VerificationCacheDiagnostic): undefined => {
    const previous = diagnostics.skipped[diagnostic.reason] ?? 0
    diagnostics.skipped[diagnostic.reason] = previous + 1; diagnostics.lastSkip = diagnostic
    if (!previous && options.onDiagnostic) { try { options.onDiagnostic({ ...diagnostic }) } catch { /* Observability must not change acceptance. */ } }
    return undefined
  }
  const checkedIdentity = (directory: string, command: string, phase: string, env: NodeJS.ProcessEnv, policyKey = ''): string | undefined => {
    const started = performance.now(); diagnostics.identityChecks++
    try { return identity(directory, command, phase, env, policyKey, diagnostics, declaredInputs) }
    catch (error) { return skip(error instanceof UnavailableIdentity ? { reason: error.reason, message: error.message } : { reason: 'io_error', message: 'Local input identity could not be read; command reuse is disabled.' }) }
    finally { diagnostics.identityMs += performance.now() - started }
  }
  return {
    run(directory, command, phase, execute, options = {}) {
      const eligible = phase === 'criterion' || phase === 'verify'
      const before = eligible ? checkedIdentity(directory, command, phase, options.env ?? process.env, options.policyKey) : skip({ reason: 'ineligible_phase', message: 'Integration and completion require independent execution.' })
      if (before && results.has(before)) { reused++; return { ...results.get(before)! } }
      executed++
      const result = execute()
      if (result.passed && before) {
        const after = checkedIdentity(directory, command, phase, options.env ?? process.env, options.policyKey)
        if (after === before) {
          if (results.size >= 128) results.delete(results.keys().next().value!)
          results.set(before, { ...result })
        } else if (after) skip({ reason: 'mutating_command', message: 'A successful command changed its inputs; its result was not cached.' })
      }
      return result
    },
    stats: () => ({ executed, reused }),
    diagnostics: () => ({ ...diagnostics, skipped: { ...diagnostics.skipped }, ...(diagnostics.lastSkip ? { lastSkip: { ...diagnostics.lastSkip } } : {}) }),
  }
}
