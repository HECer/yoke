import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { runQualityCritic, type QualityCriticRequest } from '../../src/quality/runner.js'
import { QualityDecisionSchema, CandidatePairDecisionSchema } from '../../src/quality/verdict.js'
import { qualityCriticPrompt } from '../../src/quality/prompt.js'

const decision = (request: QualityCriticRequest, confidence = 'high') => ({ schemaVersion: 1, attemptId: request.attemptId, winner: request.candidateLabel, biggestGap: 'none observed', evidence: ['measured layout agreement'], confidence })
const base = { targetDir: '/fixture', storyId: 'S1', round: 1, policy: 'blocking' as const, rubric: 'Compare layout consistency', reference: { digest: 'reference', artifact: '/private/original-reference.png' }, candidate: { digests: ['candidate'], artifacts: ['/private/candidate-file.png'] }, provider: 'codex' as const, model: 'requested-alias', mkdir: () => {}, firstLabel: () => 'A' as const }

it.each([
  [1, 'high', 'high', 1], [2, 'low', 'high', 2], ['adaptive', undefined, 'high', 2], ['adaptive', 'high', 'high', 2], ['adaptive', 'low', 'high', 1], ['adaptive', 'low', 'medium', 2],
] as const)('uses %s checks with risk %s and confidence %s', (consistencyChecks, risk, confidence, expected) => {
  let calls = 0
  const result = runQualityCritic({ ...base, consistencyChecks, risk, writeFile: () => {}, invoke: request => { calls++; return { ok: true, actualModel: 'canonical-model', output: JSON.stringify(decision(request, confidence)) } } })
  expect(result.kind).toBe('pass')
  expect(calls).toBe(expected)
})

it('binds immutable host provenance to opaque bundles and the exact rendered prompt', () => {
  const files = new Map<string, string>()
  const result = runQualityCritic({ ...base, consistencyChecks: 1, writeFile: (path, value) => { files.set(path, value) }, invoke: request => {
    const prompt = qualityCriticPrompt(request), payload = JSON.parse(prompt)
    expect(payload.bundles.map((bundle: { label: string }) => bundle.label)).toEqual(['A', 'B'])
    expect(payload).not.toHaveProperty('candidateLabel')
    expect(payload).not.toHaveProperty('reference')
    expect(prompt).not.toContain('/private/')
    expect(payload.bundles.flatMap((bundle: { artifacts: Array<{ path: string }> }) => bundle.artifacts.map(artifact => artifact.path))).toEqual(['A-1.png', 'B-1.png'])
    expect(request.promptDigest).toBe(createHash('sha256').update(prompt).digest('hex'))
    return { ok: true, actualModel: 'canonical-model', output: JSON.stringify(decision(request)) }
  } })
  expect(result.kind).toBe('pass')
  const saved = JSON.parse([...files.values()][0])
  expect(saved.verdict.provenance).toMatchObject({ provider: 'codex', requestedModel: 'requested-alias', actualModel: 'canonical-model', model: 'canonical-model', candidateDigest: 'candidate', referenceDigest: 'reference' })
})

it('keeps missing actual model identity explicit and rejects changing identities across paired calls', () => {
  const files: string[] = []
  expect(runQualityCritic({ ...base, consistencyChecks: 1, writeFile: (_path, value) => files.push(value), invoke: request => ({ ok: true, output: JSON.stringify(decision(request)) }) }).kind).toBe('pass')
  expect(JSON.parse(files[0]).verdict.provenance).toMatchObject({ actualModel: null, model: 'unknown', requestedModel: 'requested-alias' })
  let calls = 0
  expect(runQualityCritic({ ...base, consistencyChecks: 2, writeFile: () => {}, invoke: request => ({ ok: true, actualModel: ++calls === 1 ? 'first-model' : 'second-model', output: JSON.stringify(decision(request)) }) })).toMatchObject({ kind: 'infrastructure', summary: expect.stringContaining('model evidence changed') })
})

it('rejects invalid A/B decisions, missing evidence, and forged host fields', () => {
  const valid = { schemaVersion: 1, attemptId: 'attempt', winner: 'A', biggestGap: 'none', evidence: ['measured'], confidence: 'high' }
  expect(QualityDecisionSchema.safeParse(valid).success).toBe(true)
  for (const invalid of [{ ...valid, winner: 'candidate' }, { ...valid, winner: 'C' }, { ...valid, evidence: [] }, { ...valid, provenance: { provider: 'forged' } }, { ...valid, candidate: { digest: 'forged' } }]) expect(QualityDecisionSchema.safeParse(invalid).success).toBe(false)
  const { biggestGap: _gap, ...pair } = valid
  expect(CandidatePairDecisionSchema.safeParse(pair).success).toBe(true)
  expect(CandidatePairDecisionSchema.safeParse({ ...pair, provenance: { model: 'forged' } }).success).toBe(false)
})

it('does not accept a replayed attempt even when its winner looks valid', () => {
  const result = runQualityCritic({ ...base, consistencyChecks: 1, writeFile: () => {}, invoke: request => ({ ok: true, output: JSON.stringify({ ...decision(request), attemptId: 'old-attempt' }) }) })
  expect(result).toEqual({ kind: 'inconsistent', reason: 'attempt-mismatch' })
})

it('does not invoke a critic when the candidate bundle is empty or incomplete', () => {
  for (const candidate of [{ digests: [] }, { digests: ['candidate'], artifacts: [] }]) {
    const result = runQualityCritic({ ...base, candidate, writeFile: () => {}, invoke: () => { throw Error('must not dispatch') } })
    expect(result).toEqual({ kind: 'infrastructure', summary: 'candidate critic evidence is incomplete' })
  }
})
