import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseProviderResult } from '../agents/telemetry.js'
import type { Agent } from '../retrofit/config.js'
import { storyPathSegment } from '../loop/prd.js'
import { QualityDecisionSchema, reduceComparisons, reduceSingleComparison, type ComparisonReduction, type QualityLabel, type QualityVerdict } from './verdict.js'
import { qualityCriticPrompt } from './prompt.js'

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
  readonly consistencyChecks?: 1 | 2 | 'adaptive'
  readonly risk?: 'low' | 'medium' | 'high'
  readonly invoke: (request: QualityCriticRequest) => QualityCriticResult
  readonly mkdir: (path: string) => void
  readonly writeFile: (path: string, content: string) => void
  readonly firstLabel: () => QualityLabel
}): QualityCriticOutcome {
  if (input.candidate.digests.length === 0 || (input.candidate.artifacts && input.candidate.artifacts.length !== input.candidate.digests.length)) return { kind: 'infrastructure', summary: 'candidate critic evidence is incomplete' }
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
  const normalVerdict = bindDecision(input.provider, normal, normalRequest, input.model)
  const provenance = { provider: input.provider, model: normal.actualModel ?? 'unknown' }
  input.writeFile(join(root, 'normal.verdict.json'), JSON.stringify({ ...provenance, requestedModel: input.model ?? null, actualModel: normal.actualModel ?? null, raw: normal.output, verdict: normalVerdict }))
  if (!normal.actualModel && !input.model) return { kind: 'infrastructure', summary: 'critic did not report its model and no explicit model was configured' }
  const single = reduceSingleComparison({ expected: expectation(normalRequest), provenance, verdict: normalVerdict })
  const advisory = (result: ComparisonReduction): QualityCriticOutcome => input.policy === 'advisory' ? { kind: 'skipped', summary: 'advisory comparison recorded' } : result
  if (single.kind === 'inconsistent') return advisory(single)
  const checks = input.consistencyChecks ?? 'adaptive'
  // Unknown risk retains the paired check. A model's confidence alone cannot
  // authorize the cheaper mode; the host must also supply a low-risk assessment.
  if (checks === 1 || (checks === 'adaptive' && input.risk === 'low' && normalVerdict?.confidence === 'high')) return advisory(single)
  const swapped = input.invoke(structuredClone(swappedRequest))
  if (!swapped.ok) return { kind: 'infrastructure', summary: swapped.summary }
  const swappedVerdict = bindDecision(input.provider, swapped, swappedRequest, input.model)
  input.writeFile(join(root, 'swapped.verdict.json'), JSON.stringify({ provider: input.provider, model: swapped.actualModel ?? 'unknown', requestedModel: input.model ?? null, actualModel: swapped.actualModel ?? null, raw: swapped.output, verdict: swappedVerdict }))
  if (normal.actualModel !== swapped.actualModel) return { kind: 'infrastructure', summary: `critic model evidence changed between comparisons: ${normal.actualModel ?? 'unreported'} -> ${swapped.actualModel ?? 'unreported'}` }
  const expected = {
    normal: expectation(normalRequest),
    swapped: expectation(swappedRequest),
    provenance,
  }
  const reduction = reduceComparisons({
    expected,
    normal: normalVerdict,
    swapped: swappedVerdict,
  })
  return advisory(reduction)
}

function request(input: Parameters<typeof runQualityCritic>[0], attemptId: string, candidateLabel: QualityLabel): QualityCriticRequest {
  const issued = {
    permissions: 'read-only' as const,
    attemptId,
    candidateLabel,
    referenceLabel: candidateLabel === 'A' ? 'B' as const : 'A' as const,
    trustedRubric: input.rubric,
    reference: { ...input.reference, artifact: anonymousArtifact(candidateLabel === 'A' ? 'B' : 'A', 0, input.reference.artifact ?? 'artifact.bin') },
    candidate: {
      digests: [...input.candidate.digests],
      artifacts: input.candidate.digests.map((_, index) => anonymousArtifact(candidateLabel, index, input.candidate.artifacts?.[index] ?? 'artifact.bin')),
    },
  }
  return { ...issued, promptDigest: digest(qualityCriticPrompt(issued)), rubricDigest: digest(input.rubric) }
}

function anonymousArtifact(label: QualityLabel, index: number, original: string): string {
  const extension = extname(original).toLowerCase()
  return `${label}-${index + 1}${/^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : '.bin'}`
}

function candidateDigest(request: QualityCriticRequest): string {
  return request.candidate.digests.length === 1 ? request.candidate.digests[0]! : digest(JSON.stringify(request.candidate.digests))
}

function bindDecision(provider: Agent, result: Extract<QualityCriticResult, { ok: true }>, request: QualityCriticRequest, requestedModel?: string): QualityVerdict | null {
  const decision = QualityDecisionSchema.safeParse(parseProviderResult(provider, result.output))
  if (!decision.success || request.candidate.digests.length === 0) return null
  const selected = decision.data
  return { ...selected, winner: selected.winner === request.candidateLabel ? 'candidate' : 'reference',
    candidate: { label: request.candidateLabel, digest: candidateDigest(request) }, reference: { label: request.referenceLabel, digest: request.reference.digest },
    provenance: { provider, model: result.actualModel ?? 'unknown', actualModel: result.actualModel ?? null, ...(requestedModel ? { requestedModel } : {}), promptDigest: request.promptDigest, rubricDigest: request.rubricDigest, referenceDigest: request.reference.digest, candidateDigest: candidateDigest(request) } }
}

function expectation(request: QualityCriticRequest) {
  return {
    attemptId: request.attemptId,
    candidateDigests: [candidateDigest(request)],
    referenceDigest: request.reference.digest,
    promptDigest: request.promptDigest,
    rubricDigest: request.rubricDigest,
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
