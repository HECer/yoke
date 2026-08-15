import { randomUUID } from 'node:crypto'
import { reduceCandidatePairComparisons } from '../quality/verdict.js'
import { parseCandidateEvidence } from './candidate-boundaries.js'
import type { CandidateComparisonRequest, CandidateComparisonTrail, CandidateCoordinatorInput, CandidateEvidence, CandidateEvidenceInput, CandidateJudgeProvenance } from './candidate-contracts.js'

type PreparedEvidence = { readonly trusted: CandidateEvidence; readonly handle: CandidateEvidence }
type SelectionResult<T extends CandidateEvidenceInput> =
  | { readonly kind: 'selected'; readonly candidate: T; readonly evidence: CandidateEvidence; readonly comparisons: readonly CandidateComparisonTrail[] }
  | { readonly kind: 'paused' }
  | { readonly kind: 'inconsistent'; readonly reason: string }

type CandidatePairExpectation = {
  readonly request: CandidateComparisonRequest
  readonly candidateIds: { readonly left: string; readonly right: string }
  readonly provenance: CandidateJudgeProvenance
}
type IssuedComparison = { readonly request: CandidateComparisonRequest; readonly expected: CandidatePairExpectation }
type ComparisonSide<T extends CandidateEvidenceInput> = { readonly candidate: T; readonly evidence: PreparedEvidence }

export async function selectCandidate<T extends CandidateEvidenceInput>(input: {
  readonly candidates: readonly T[]
  readonly evidence: CandidateCoordinatorInput['evidence']
  readonly stageEvidence: CandidateCoordinatorInput['stageEvidence']
  readonly judgeProvenance: CandidateJudgeProvenance
  readonly judge: CandidateCoordinatorInput['judge']
  readonly pause?: () => boolean
  readonly ensureActive: () => void
  readonly discard: (candidate: T) => Promise<void>
}): Promise<SelectionResult<T>> {
  const first = input.candidates[0]
  if (!first) return { kind: 'inconsistent', reason: 'selection requires one candidate' }
  let selected = first
  let selectedEvidence = await prepareEvidence(input, first)
  input.ensureActive()
  if (input.pause?.()) return { kind: 'paused' }
  const comparisons: CandidateComparisonTrail[] = []

  for (let index = 1; index < input.candidates.length; index += 1) {
    const challenger = input.candidates[index]
    if (!challenger) continue
    const challengerEvidence = await prepareEvidence(input, challenger)
    input.ensureActive()
    if (input.pause?.()) return { kind: 'paused' }
    const normal = issueComparison({ left: { candidate: selected, evidence: selectedEvidence }, right: { candidate: challenger, evidence: challengerEvidence }, provenance: input.judgeProvenance })
    const swapped = issueComparison({ left: { candidate: challenger, evidence: challengerEvidence }, right: { candidate: selected, evidence: selectedEvidence }, provenance: input.judgeProvenance })
    const normalVerdict = await input.judge(structuredClone(normal.expected.request))
    input.ensureActive()
    if (input.pause?.()) return { kind: 'paused' }
    const swappedVerdict = await input.judge(structuredClone(swapped.expected.request))
    input.ensureActive()
    if (input.pause?.()) return { kind: 'paused' }
    const reduction = reduceCandidatePairComparisons({ expected: { normal: normal.expected, swapped: swapped.expected }, normal: normalVerdict, swapped: swappedVerdict })
    if (reduction.kind === 'inconsistent') return reduction

    const winner = reduction.winnerCandidateId === selected.candidateId ? selected : challenger
    const loser = winner.candidateId === selected.candidateId ? challenger : selected
    comparisons.push({
      normal: { request: structuredClone(normal.expected.request), verdict: structuredClone(reduction.normal) },
      swapped: { request: structuredClone(swapped.expected.request), verdict: structuredClone(reduction.swapped) },
      selectedCandidateId: reduction.winnerCandidateId,
      selectedDigest: reduction.winnerDigest,
    })
    await input.discard(loser)
    input.ensureActive()
    if (input.pause?.()) return { kind: 'paused' }
    if (winner.candidateId === challenger.candidateId) {
      selected = challenger
      selectedEvidence = challengerEvidence
    }
  }

  input.ensureActive()
  return input.pause?.() ? { kind: 'paused' } : { kind: 'selected', candidate: selected, evidence: selectedEvidence.trusted, comparisons }
}

async function prepareEvidence<T extends CandidateEvidenceInput>(input: {
  readonly evidence: CandidateCoordinatorInput['evidence']
  readonly stageEvidence: CandidateCoordinatorInput['stageEvidence']
}, candidate: T): Promise<PreparedEvidence> {
  const trusted = parseCandidateEvidence(input.evidence(candidate))
  const handle = { digest: `evidence-${randomUUID()}`, artifacts: trusted.artifacts.map(() => `artifact-${randomUUID()}`) }
  await input.stageEvidence({
    handle: { digest: handle.digest, artifacts: [...handle.artifacts] },
    trusted: { digest: trusted.digest, artifacts: [...trusted.artifacts] },
  })
  return { trusted, handle }
}

function issueComparison<T extends CandidateEvidenceInput>(input: {
  readonly left: ComparisonSide<T>
  readonly right: ComparisonSide<T>
  readonly provenance: CandidateJudgeProvenance
}): IssuedComparison {
  const request: CandidateComparisonRequest = {
    permissions: 'read-only',
    attemptId: randomUUID(),
    left: { digest: input.left.evidence.handle.digest, artifacts: [...input.left.evidence.handle.artifacts], label: 'A' },
    right: { digest: input.right.evidence.handle.digest, artifacts: [...input.right.evidence.handle.artifacts], label: 'B' },
  }
  return {
    request,
    expected: {
      request: {
        permissions: request.permissions,
        attemptId: request.attemptId,
        left: { ...request.left, artifacts: [...request.left.artifacts] },
        right: { ...request.right, artifacts: [...request.right.artifacts] },
      },
      candidateIds: { left: input.left.candidate.candidateId, right: input.right.candidate.candidateId },
      provenance: { ...input.provenance },
    },
  }
}
