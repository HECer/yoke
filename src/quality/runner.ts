import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseProviderResult } from '../agents/telemetry.js'
import type { Agent } from '../retrofit/config.js'
import { storyPathSegment } from '../loop/prd.js'
import { reduceComparisons, type ComparisonReduction, type QualityLabel } from './verdict.js'

export type QualityCriticRequest = {
  readonly permissions: 'read-only'
  readonly attemptId: string
  readonly candidateLabel: QualityLabel
  readonly referenceLabel: QualityLabel
  readonly trustedRubric: string
  readonly promptDigest: string
  readonly rubricDigest: string
  readonly reference: { readonly digest: string; readonly artifact: string; readonly contentType?: string }
  readonly candidate: { readonly digests: readonly string[]; readonly artifacts: readonly string[] }
}

export type QualityCriticResult = { readonly ok: true; readonly output: string; readonly actualModel?: string } | { readonly ok: false; readonly summary: string }

export type QualityCriticOutcome = ComparisonReduction | { readonly kind: 'infrastructure'; readonly summary: string } | { readonly kind: 'skipped'; readonly summary: string }

export function runQualityCritic(input: {
  readonly targetDir: string
  readonly storyId: string
  readonly round: number
  readonly evidenceScope?: string
  readonly attemptIdPrefix?: string
  readonly policy: 'blocking' | 'advisory'
  readonly rubric: string
  readonly reference: { readonly digest: string; readonly artifact?: string; readonly contentType?: string }
  readonly candidate: { readonly digests: readonly string[]; readonly artifacts?: readonly string[] }
  readonly provider: Agent
  readonly model?: string
  readonly invoke: (request: QualityCriticRequest) => QualityCriticResult
  readonly mkdir: (path: string) => void
  readonly writeFile: (path: string, content: string) => void
  readonly firstLabel: () => QualityLabel
}): QualityCriticOutcome {
  const segment = input.evidenceScope ? `${input.evidenceScope}-round-${input.round}` : `round-${input.round}`
  const root = join(input.targetDir, '.yoke', 'proof', storyPathSegment(input.storyId), 'quality', segment)
  input.mkdir(root)
  const first = input.firstLabel()
  const second: QualityLabel = first === 'A' ? 'B' : 'A'
  const attemptPrefix = input.attemptIdPrefix ?? String(input.round)
  const normalRequest = request(input, `${attemptPrefix}-normal`, first)
  const swappedRequest = request(input, `${attemptPrefix}-swapped`, second)
  const normal = input.invoke(structuredClone(normalRequest))
  if (!normal.ok) return { kind: 'infrastructure', summary: normal.summary }
  const swapped = input.invoke(structuredClone(swappedRequest))
  if (!swapped.ok) return { kind: 'infrastructure', summary: swapped.summary }
  if (normal.actualModel && swapped.actualModel && normal.actualModel !== swapped.actualModel) return { kind: 'infrastructure', summary: `critic model changed between comparisons: ${normal.actualModel} -> ${swapped.actualModel}` }
  const actualModel = normal.actualModel ?? swapped.actualModel ?? input.model
  if (!actualModel) return { kind: 'infrastructure', summary: 'critic did not report its model and no explicit model was configured' }
  const expected = {
    normal: expectation(normalRequest),
    swapped: expectation(swappedRequest),
    provenance: { provider: input.provider, model: actualModel },
  }
  input.writeFile(join(root, 'normal.verdict.json'), JSON.stringify({ provider: input.provider, model: actualModel, raw: normal.output }))
  input.writeFile(join(root, 'swapped.verdict.json'), JSON.stringify({ provider: input.provider, model: actualModel, raw: swapped.output }))
  const reduction = reduceComparisons({
    expected,
    normal: parseProviderResult(input.provider, normal.output),
    swapped: parseProviderResult(input.provider, swapped.output),
  })
  return input.policy === 'advisory' ? { kind: 'skipped', summary: 'advisory comparison recorded' } : reduction
}

function request(input: Parameters<typeof runQualityCritic>[0], attemptId: string, candidateLabel: QualityLabel): QualityCriticRequest {
  const issued = {
    permissions: 'read-only' as const,
    attemptId,
    candidateLabel,
    referenceLabel: candidateLabel === 'A' ? 'B' as const : 'A' as const,
    trustedRubric: input.rubric,
    reference: { ...input.reference, artifact: input.reference.artifact ?? 'reference.bin' },
    candidate: {
      digests: [...input.candidate.digests],
      artifacts: input.candidate.artifacts ? [...input.candidate.artifacts] : input.candidate.digests.map((_, index) => `candidate-${index + 1}.bin`),
    },
  }
  return { ...issued, promptDigest: digest(JSON.stringify(issued)), rubricDigest: digest(input.rubric) }
}

function expectation(request: QualityCriticRequest) {
  return {
    attemptId: request.attemptId,
    candidateDigests: [...request.candidate.digests],
    referenceDigest: request.reference.digest,
    promptDigest: request.promptDigest,
    rubricDigest: request.rubricDigest,
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
