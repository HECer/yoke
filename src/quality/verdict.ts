import { z } from 'zod'

export const QualityLabelSchema = z.enum(['A', 'B'])
export type QualityLabel = z.infer<typeof QualityLabelSchema>

const DigestSchema = z.string().min(1)
const ComparedArtifactSchema = z.object({ label: QualityLabelSchema, digest: DigestSchema })
const ProvenanceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptDigest: DigestSchema,
  rubricDigest: DigestSchema,
  referenceDigest: DigestSchema,
  candidateDigest: DigestSchema,
})

export const QualityVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: z.string().min(1),
  winner: z.enum(['candidate', 'reference']),
  biggestGap: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  candidate: ComparedArtifactSchema,
  reference: ComparedArtifactSchema,
  provenance: ProvenanceSchema,
}).superRefine((value, context) => {
  if (value.candidate.label === value.reference.label) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'candidate and reference labels must differ' })
  }
  if (value.candidate.digest !== value.provenance.candidateDigest || value.reference.digest !== value.provenance.referenceDigest) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'artifact digests must match provenance' })
  }
})

export type QualityVerdict = z.infer<typeof QualityVerdictSchema>

export type BlindLabels = { readonly candidate: QualityLabel; readonly reference: QualityLabel }

export type ComparisonReduction =
  | { readonly kind: 'pass'; readonly candidateDigest: string; readonly referenceDigest: string }
  | { readonly kind: 'lose'; readonly reason: 'reference-selected' | 'low-confidence'; readonly biggestGap: string; readonly evidence: readonly string[] }
  | { readonly kind: 'inconsistent'; readonly reason: 'invalid-verdict' | 'not-fresh' | 'attempt-mismatch' | 'labels-not-swapped' | 'digest-mismatch' | 'provenance-mismatch' | 'winner-disagrees' }

const CandidatePairVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: z.string().min(1),
  winner: QualityLabelSchema,
  evidence: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  left: ComparedArtifactSchema,
  right: ComparedArtifactSchema,
  provenance: z.object({
    leftDigest: DigestSchema,
    rightDigest: DigestSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    promptDigest: DigestSchema,
    rubricDigest: DigestSchema,
  }),
}).superRefine((value, context) => {
  if (value.left.label === value.right.label) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'candidate labels must differ' })
  }
  if (value.left.digest !== value.provenance.leftDigest || value.right.digest !== value.provenance.rightDigest) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'candidate digests must match provenance' })
  }
})

export type CandidatePairVerdict = z.infer<typeof CandidatePairVerdictSchema>

export type CandidatePairReduction =
  | { readonly kind: 'selected'; readonly winnerCandidateId: string; readonly winnerDigest: string; readonly normal: CandidatePairVerdict; readonly swapped: CandidatePairVerdict }
  | { readonly kind: 'inconsistent'; readonly reason: 'invalid-verdict' | 'attempt-mismatch' | 'label-mismatch' | 'digest-mismatch' | 'provenance-mismatch' | 'winner-disagrees' | 'low-confidence' }

type CandidatePairExpectation = {
  readonly request: {
    readonly permissions: 'read-only'
    readonly attemptId: string
    readonly left: { readonly label: QualityLabel; readonly digest: string; readonly artifacts: readonly string[] }
    readonly right: { readonly label: QualityLabel; readonly digest: string; readonly artifacts: readonly string[] }
  }
  readonly candidateIds: { readonly left: string; readonly right: string }
  readonly provenance: { readonly provider: string; readonly model: string; readonly promptDigest: string; readonly rubricDigest: string }
}

export type ComparisonExpectation = {
  readonly normal: { readonly attemptId: string; readonly candidateDigests: readonly string[]; readonly referenceDigest: string; readonly promptDigest: string; readonly rubricDigest: string }
  readonly swapped: { readonly attemptId: string; readonly candidateDigests: readonly string[]; readonly referenceDigest: string; readonly promptDigest: string; readonly rubricDigest: string }
  readonly provenance: { readonly provider: string; readonly model: string }
}

export function assignBlindLabels(selectCandidateLabel: () => QualityLabel): BlindLabels {
  const candidate = selectCandidateLabel()
  return { candidate, reference: candidate === 'A' ? 'B' : 'A' }
}

export function reduceComparisons(input: { readonly expected: ComparisonExpectation; readonly normal: unknown; readonly swapped: unknown }): ComparisonReduction {
  const normal = QualityVerdictSchema.safeParse(input.normal)
  const swapped = QualityVerdictSchema.safeParse(input.swapped)
  if (!normal.success || !swapped.success) return { kind: 'inconsistent', reason: 'invalid-verdict' }

  if (normal.data.attemptId === swapped.data.attemptId) return { kind: 'inconsistent', reason: 'not-fresh' }
  if (normal.data.attemptId !== input.expected.normal.attemptId || swapped.data.attemptId !== input.expected.swapped.attemptId) {
    return { kind: 'inconsistent', reason: 'attempt-mismatch' }
  }
  if (normal.data.candidate.label === swapped.data.candidate.label || normal.data.reference.label === swapped.data.reference.label) {
    return { kind: 'inconsistent', reason: 'labels-not-swapped' }
  }
  if (normal.data.candidate.digest !== swapped.data.candidate.digest || normal.data.reference.digest !== swapped.data.reference.digest) {
    return { kind: 'inconsistent', reason: 'digest-mismatch' }
  }
  if (!input.expected.normal.candidateDigests.includes(normal.data.candidate.digest)
    || !input.expected.swapped.candidateDigests.includes(swapped.data.candidate.digest)
    || normal.data.reference.digest !== input.expected.normal.referenceDigest
    || swapped.data.reference.digest !== input.expected.swapped.referenceDigest) {
    return { kind: 'inconsistent', reason: 'digest-mismatch' }
  }
  if (normal.data.provenance.provider !== input.expected.provenance.provider
    || swapped.data.provenance.provider !== input.expected.provenance.provider
    || normal.data.provenance.model !== input.expected.provenance.model
    || swapped.data.provenance.model !== input.expected.provenance.model
    || normal.data.provenance.promptDigest !== input.expected.normal.promptDigest
    || swapped.data.provenance.promptDigest !== input.expected.swapped.promptDigest
    || normal.data.provenance.rubricDigest !== input.expected.normal.rubricDigest
    || swapped.data.provenance.rubricDigest !== input.expected.swapped.rubricDigest) {
    return { kind: 'inconsistent', reason: 'provenance-mismatch' }
  }
  if (normal.data.winner !== swapped.data.winner) return { kind: 'inconsistent', reason: 'winner-disagrees' }
  if (normal.data.winner === 'reference') {
    return { kind: 'lose', reason: 'reference-selected', biggestGap: normal.data.biggestGap, evidence: normal.data.evidence }
  }
  if (normal.data.confidence === 'low' || swapped.data.confidence === 'low') {
    return { kind: 'lose', reason: 'low-confidence', biggestGap: normal.data.biggestGap, evidence: normal.data.evidence }
  }

  return {
    kind: 'pass',
    candidateDigest: normal.data.candidate.digest,
    referenceDigest: normal.data.reference.digest,
  }
}

export function reduceCandidatePairComparisons(input: {
  readonly expected: { readonly normal: CandidatePairExpectation; readonly swapped: CandidatePairExpectation }
  readonly normal: unknown
  readonly swapped: unknown
}): CandidatePairReduction {
  const normal = CandidatePairVerdictSchema.safeParse(input.normal)
  const swapped = CandidatePairVerdictSchema.safeParse(input.swapped)
  if (!normal.success || !swapped.success) return { kind: 'inconsistent', reason: 'invalid-verdict' }
  const normalMismatch = candidatePairMismatch(normal.data, input.expected.normal)
  if (normalMismatch) return { kind: 'inconsistent', reason: normalMismatch }
  const swappedMismatch = candidatePairMismatch(swapped.data, input.expected.swapped)
  if (swappedMismatch) return { kind: 'inconsistent', reason: swappedMismatch }
  if (normal.data.confidence === 'low' || swapped.data.confidence === 'low') {
    return { kind: 'inconsistent', reason: 'low-confidence' }
  }
  const normalWinner = normal.data.winner === normal.data.left.label
    ? { candidateId: input.expected.normal.candidateIds.left, digest: input.expected.normal.request.left.digest }
    : { candidateId: input.expected.normal.candidateIds.right, digest: input.expected.normal.request.right.digest }
  const swappedWinner = swapped.data.winner === swapped.data.left.label
    ? { candidateId: input.expected.swapped.candidateIds.left, digest: input.expected.swapped.request.left.digest }
    : { candidateId: input.expected.swapped.candidateIds.right, digest: input.expected.swapped.request.right.digest }
  return normalWinner.candidateId === swappedWinner.candidateId && normalWinner.digest === swappedWinner.digest
    ? { kind: 'selected', winnerCandidateId: normalWinner.candidateId, winnerDigest: normalWinner.digest, normal: normal.data, swapped: swapped.data }
    : { kind: 'inconsistent', reason: 'winner-disagrees' }
}

function candidatePairMismatch(
  verdict: z.infer<typeof CandidatePairVerdictSchema>,
  expected: CandidatePairExpectation,
): 'attempt-mismatch' | 'label-mismatch' | 'digest-mismatch' | 'provenance-mismatch' | null {
  if (verdict.attemptId !== expected.request.attemptId) return 'attempt-mismatch'
  if (verdict.left.label !== expected.request.left.label || verdict.right.label !== expected.request.right.label) return 'label-mismatch'
  if (verdict.left.digest !== expected.request.left.digest || verdict.right.digest !== expected.request.right.digest) return 'digest-mismatch'
  if (verdict.provenance.provider !== expected.provenance.provider
    || verdict.provenance.model !== expected.provenance.model
    || verdict.provenance.promptDigest !== expected.provenance.promptDigest
    || verdict.provenance.rubricDigest !== expected.provenance.rubricDigest) return 'provenance-mismatch'
  return null
}
