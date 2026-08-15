import { posix, win32 } from 'node:path'
import { z } from 'zod'
import type { CandidateCoordinatorInput, CandidateEvidence, WorktreePathPlatform } from './candidate-contracts.js'

const CandidateEvidenceSchema = z.object({
  digest: z.string().min(1),
  artifacts: z.array(z.string()),
})

const CandidateIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

export function candidateConfigProblem(input: CandidateCoordinatorInput): string | null {
  if (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1 || input.maxCandidates > 5) {
    return 'maxCandidates must be an integer from 1 to 5'
  }
  if (input.candidates.length === 0) return 'at least one candidate is required'
  if (input.candidates.some(candidate => !CandidateIdSchema.safeParse(candidate.id).success)) {
    return 'candidate ids must be non-empty safe identifiers'
  }
  if (new Set(input.candidates.map(candidate => candidate.id)).size !== input.candidates.length) {
    return 'candidate ids must be unique'
  }
  return null
}

export function parseCandidateEvidence(value: unknown): CandidateEvidence {
  const parsed = CandidateEvidenceSchema.parse(value)
  return { digest: parsed.digest, artifacts: [...parsed.artifacts] }
}

export function canonicalWorktreePath(path: string, platform: WorktreePathPlatform): string | null {
  if (platform === 'win32') {
    if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path)) return null
    const normalized = win32.normalize(path).replaceAll('/', '\\').toLowerCase()
    return trimSeparators(normalized, win32.parse(normalized).root, '\\')
  }
  if (!posix.isAbsolute(path)) return null
  const normalized = posix.normalize(path)
  return trimSeparators(normalized, posix.parse(normalized).root, '/')
}

function trimSeparators(path: string, root: string, separator: '\\' | '/'): string {
  let key = path
  while (key.length > root.length && key.endsWith(separator)) key = key.slice(0, -1)
  return key
}
