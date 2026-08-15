import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { StoryQualityDeclaration } from './types.js'
import { hasShellControlOperator, parseQualityCommand } from './process-command.js'

export type CandidateArtifact = {
  readonly kind: 'screenshot' | 'file' | 'command-output' | 'benchmark'
  readonly path?: string
  readonly source?: string
  readonly bytes: number
  readonly digest: string
}

export type ArtifactCollectionResult =
  | { readonly kind: 'collected'; readonly artifacts: readonly CandidateArtifact[]; readonly digests: readonly string[] }
  | { readonly kind: 'rejected'; readonly reason: 'path-traversal' | 'outside-project' | 'outside-proof' | 'missing' | 'shell-control' | 'invalid-command' }

export type CapturedCandidateArtifact = {
  readonly artifact: CandidateArtifact
  readonly bytes: Uint8Array
}

export type CandidateArtifactCaptureResult =
  | { readonly kind: 'captured'; readonly artifacts: readonly CapturedCandidateArtifact[]; readonly digests: readonly string[] }
  | { readonly kind: 'rejected'; readonly reason: 'path-traversal' | 'outside-project' | 'outside-proof' | 'missing' | 'shell-control' | 'invalid-command' }

export type ArtifactCollectionAdapters = {
  readonly readFile: (path: string) => Uint8Array | null
  readonly commandOutput: (command: string) => Uint8Array
  readonly benchmark: (command: string) => Uint8Array
  readonly realpath?: (path: string) => string | null
}

export function collectCandidateArtifacts(
  input: { readonly projectDir: string; readonly candidate: StoryQualityDeclaration['candidate'] },
  adapters: ArtifactCollectionAdapters,
): ArtifactCollectionResult {
  const captured = captureCandidateArtifacts(input, adapters)
  if (captured.kind === 'rejected') return captured
  return { kind: 'collected', artifacts: captured.artifacts.map(value => value.artifact), digests: captured.digests }
}

export function captureCandidateArtifacts(
  input: { readonly projectDir: string; readonly candidate: StoryQualityDeclaration['candidate'] },
  adapters: ArtifactCollectionAdapters,
): CandidateArtifactCaptureResult {
  if ('command' in input.candidate) {
    if (hasShellControlOperator(input.candidate.command)) return { kind: 'rejected', reason: 'shell-control' }
    if (!parseQualityCommand(input.candidate.command)) return { kind: 'rejected', reason: 'invalid-command' }
    const bytes = input.candidate.kind === 'command-output'
      ? adapters.commandOutput(input.candidate.command)
      : adapters.benchmark(input.candidate.command)
    const artifact: CandidateArtifact = { kind: input.candidate.kind, source: input.candidate.command, bytes: bytes.byteLength, digest: digest(bytes) }
    return { kind: 'captured', artifacts: [{ artifact, bytes }], digests: [artifact.digest] }
  }

  const projectRoot = resolve(input.projectDir)
  const proofRoot = join(projectRoot, '.yoke', 'proof')
  const kind = input.candidate.kind === 'screenshots' ? 'screenshot' : 'file'
  const artifacts: CapturedCandidateArtifact[] = []
  for (const source of input.candidate.paths) {
    if (containsTraversal(source)) return { kind: 'rejected', reason: 'path-traversal' }
    if (isAbsolute(source)) return { kind: 'rejected', reason: 'outside-project' }
    const path = resolve(projectRoot, source)
    if (!isInside(projectRoot, path)) return { kind: 'rejected', reason: 'outside-project' }
    if (kind === 'screenshot' && !isInside(proofRoot, path)) return { kind: 'rejected', reason: 'outside-proof' }
    const canonicalRoot = adapters.realpath?.(projectRoot) ?? projectRoot
    const canonicalPath = adapters.realpath?.(path) ?? path
    if (!isInside(canonicalRoot, canonicalPath)) return { kind: 'rejected', reason: 'outside-project' }
    if (kind === 'screenshot' && !isInside(adapters.realpath?.(proofRoot) ?? proofRoot, canonicalPath)) return { kind: 'rejected', reason: 'outside-proof' }
    const bytes = adapters.readFile(canonicalPath)
    if (bytes === null) return { kind: 'rejected', reason: 'missing' }
    artifacts.push({ artifact: { kind, path: canonicalPath, bytes: bytes.byteLength, digest: digest(bytes) }, bytes })
  }

  artifacts.sort((left, right) => left.artifact.digest.localeCompare(right.artifact.digest) || (left.artifact.path ?? '').localeCompare(right.artifact.path ?? ''))
  return { kind: 'captured', artifacts, digests: artifacts.map(artifact => artifact.artifact.digest) }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function containsTraversal(path: string): boolean {
  return path.split(/[\\/]+/).includes('..')
}

function isInside(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
}
