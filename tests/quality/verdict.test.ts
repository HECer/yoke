import { describe, expect, it } from 'vitest'
import { QualityVerdictSchema, assignBlindLabels, reduceComparisons } from '../../src/quality/verdict.js'

const makeVerdict = (input: {
  readonly attemptId: string
  readonly winner?: 'candidate' | 'reference'
  readonly candidateLabel?: 'A' | 'B'
  readonly candidateDigest?: string
  readonly referenceDigest?: string
  readonly confidence?: 'high' | 'medium' | 'low'
  readonly provider?: string
  readonly model?: string
  readonly promptDigest?: string
  readonly rubricDigest?: string
}) => {
  const candidateLabel = input.candidateLabel ?? 'A'
  const candidateDigest = input.candidateDigest ?? 'candidate-digest'
  const referenceDigest = input.referenceDigest ?? 'reference-digest'
  return {
    schemaVersion: 1,
    attemptId: input.attemptId,
    winner: input.winner ?? 'candidate',
    biggestGap: 'candidate spacing is less consistent',
    evidence: ['header alignment differs by 8px'],
    confidence: input.confidence ?? 'high',
    candidate: { label: candidateLabel, digest: candidateDigest },
    reference: { label: candidateLabel === 'A' ? 'B' : 'A', digest: referenceDigest },
    provenance: {
      provider: input.provider ?? 'codex',
      model: input.model ?? 'gpt-5.6',
      promptDigest: input.promptDigest ?? 'prompt-digest',
      rubricDigest: input.rubricDigest ?? 'rubric-digest',
      referenceDigest,
      candidateDigest,
    },
  }
}

const expected = {
  normal: { attemptId: 'normal', candidateDigests: ['candidate-digest'], referenceDigest: 'reference-digest', promptDigest: 'prompt-digest', rubricDigest: 'rubric-digest' },
  swapped: { attemptId: 'swapped', candidateDigests: ['candidate-digest'], referenceDigest: 'reference-digest', promptDigest: 'prompt-digest', rubricDigest: 'rubric-digest' },
  provenance: { provider: 'codex', model: 'gpt-5.6' },
}

describe('quality verdicts', () => {
  it('requires schema version one, one nonempty gap, evidence, provenance, and distinct blind labels', () => {
    const valid = makeVerdict({ attemptId: 'normal' })
    const invalid = {
      ...valid,
      biggestGap: '',
      evidence: [],
      candidate: { ...valid.candidate, label: 'A' },
      reference: { ...valid.reference, label: 'A' },
    }

    expect(QualityVerdictSchema.safeParse(valid).success).toBe(true)
    expect(QualityVerdictSchema.safeParse(invalid).success).toBe(false)
  })

  it('assigns the opposing blind label from an injected deterministic choice', () => {
    expect(assignBlindLabels(() => 'B')).toEqual({ candidate: 'B', reference: 'A' })
  })

  it('passes only when fresh normal and swapped verdicts both select the same candidate with sufficient confidence', () => {
    const result = reduceComparisons({
      expected,
      normal: makeVerdict({ attemptId: 'normal', candidateLabel: 'A', confidence: 'high' }),
      swapped: makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', confidence: 'medium' }),
    })

    expect(result).toMatchObject({ kind: 'pass', candidateDigest: 'candidate-digest', referenceDigest: 'reference-digest' })
  })

  it('loses when both fresh comparisons select the reference or candidate confidence is low', () => {
    const referenceWinner = reduceComparisons({
      expected,
      normal: makeVerdict({ attemptId: 'normal', winner: 'reference', candidateLabel: 'A' }),
      swapped: makeVerdict({ attemptId: 'swapped', winner: 'reference', candidateLabel: 'B' }),
    })
    const lowConfidence = reduceComparisons({
      expected,
      normal: makeVerdict({ attemptId: 'normal', candidateLabel: 'A', confidence: 'low' }),
      swapped: makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', confidence: 'low' }),
    })

    expect(referenceWinner.kind).toBe('lose')
    expect(lowConfidence.kind).toBe('lose')
  })

  it('reports inconsistent results for reused attempts, unswapped labels, or mismatched digests', () => {
    const reused = reduceComparisons({
      expected,
      normal: makeVerdict({ attemptId: 'same', candidateLabel: 'A' }),
      swapped: makeVerdict({ attemptId: 'same', candidateLabel: 'B' }),
    })
    const digestMismatch = reduceComparisons({
      expected,
      normal: makeVerdict({ attemptId: 'normal', candidateLabel: 'A' }),
      swapped: makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', candidateDigest: 'other-candidate' }),
    })

    expect(reused).toMatchObject({ kind: 'inconsistent', reason: 'not-fresh' })
    expect(digestMismatch).toMatchObject({ kind: 'inconsistent', reason: 'digest-mismatch' })
  })

  it.each([
    ['attempt', makeVerdict({ attemptId: 'replayed-normal', candidateLabel: 'A' }), makeVerdict({ attemptId: 'replayed-swapped', candidateLabel: 'B' }), 'attempt-mismatch'],
    ['digest', makeVerdict({ attemptId: 'normal', candidateLabel: 'A', candidateDigest: 'stale' }), makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', candidateDigest: 'stale' }), 'digest-mismatch'],
    ['provenance', makeVerdict({ attemptId: 'normal', candidateLabel: 'A', provider: 'stale-provider' }), makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', provider: 'stale-provider' }), 'provenance-mismatch'],
    ['prompt provenance', makeVerdict({ attemptId: 'normal', candidateLabel: 'A', promptDigest: 'foreign-prompt' }), makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', promptDigest: 'foreign-prompt' }), 'provenance-mismatch'],
    ['rubric provenance', makeVerdict({ attemptId: 'normal', candidateLabel: 'A', rubricDigest: 'foreign-rubric' }), makeVerdict({ attemptId: 'swapped', candidateLabel: 'B', rubricDigest: 'foreign-rubric' }), 'provenance-mismatch'],
  ] as const)('rejects distinct stale %s verdicts even when the pair agrees', (_case, normal, swapped, reason) => {
    expect(reduceComparisons({ expected, normal, swapped })).toEqual({ kind: 'inconsistent', reason })
  })
})
