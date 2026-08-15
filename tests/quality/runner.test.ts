import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { runQualityCritic } from '../../src/quality/runner.js'
import { storyPathSegment } from '../../src/loop/prd.js'
import type { QualityCriticRequest } from '../../src/quality/runner.js'

const verdict = (attemptId: string, candidateLabel: 'A' | 'B', overrides: {
  readonly candidateDigest?: string
  readonly model?: string
  readonly provider?: string
  readonly promptDigest?: string
  readonly rubricDigest?: string
} = {}) => JSON.stringify({
  schemaVersion: 1, attemptId, winner: 'candidate', biggestGap: 'spacing', evidence: ['measured difference'], confidence: 'high',
  candidate: { label: candidateLabel, digest: overrides.candidateDigest ?? 'candidate' }, reference: { label: candidateLabel === 'A' ? 'B' : 'A', digest: 'reference' },
  provenance: { provider: overrides.provider ?? 'codex', model: overrides.model ?? 'test', promptDigest: overrides.promptDigest ?? 'prompt', rubricDigest: overrides.rubricDigest ?? 'rubric', referenceDigest: 'reference', candidateDigest: overrides.candidateDigest ?? 'candidate' },
})

const verdictFor = (request: QualityCriticRequest, overrides: Parameters<typeof verdict>[2] = {}) => verdict(request.attemptId, request.candidateLabel, {
  promptDigest: request.promptDigest,
  rubricDigest: request.rubricDigest,
  ...overrides,
})

const providerStream = (provider: 'claude' | 'codex' | 'gemini', payload: string): string => {
  switch (provider) {
    case 'claude':
      return [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'critic-model' }),
        JSON.stringify({ type: 'result', result: payload, usage: { input_tokens: 10, output_tokens: 4 } }),
      ].join('\n')
    case 'codex':
      return [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: payload } }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 4 } }),
      ].join('\n')
    case 'gemini':
      return [
        JSON.stringify({ type: 'init', model: 'critic-model' }),
        JSON.stringify({ type: 'message', role: 'assistant', content: payload, delta: true }),
        JSON.stringify({ type: 'result', status: 'success', stats: { input_tokens: 10, output_tokens: 4 } }),
      ].join('\n')
  }
}

describe('runQualityCritic', () => {
  it('runs two read-only swapped blocking comparisons and persists raw verdict files', () => {
    const targetDir = resolve('project')
    const calls: Array<{ readonly permissions: string; readonly candidateLabel: string }> = []
    const writes: string[] = []
    const result = runQualityCritic({
      targetDir, storyId: 'S1', round: 1, policy: 'blocking', rubric: 'trusted rubric',
      reference: { digest: 'reference', contentType: 'image/png' }, candidate: { digests: ['candidate'] }, provider: 'codex', model: 'test',
      invoke: request => { calls.push({ permissions: request.permissions, candidateLabel: request.candidateLabel }); return { ok: true, output: verdictFor(request) } },
      mkdir: () => undefined,
      writeFile: path => { writes.push(path) },
      firstLabel: () => 'A',
    })

    expect(result).toMatchObject({ kind: 'pass' })
    expect(calls).toEqual([{ permissions: 'read-only', candidateLabel: 'A' }, { permissions: 'read-only', candidateLabel: 'B' }])
    expect(writes).toEqual([
      join(targetDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'normal.verdict.json'),
      join(targetDir, '.yoke', 'proof', storyPathSegment('S1'), 'quality', 'round-1', 'swapped.verdict.json'),
    ])
  })

  it('returns infrastructure when a provider invocation fails', () => {
    const result = runQualityCritic({
      targetDir: 'C:\\project', storyId: 'S1', round: 1, policy: 'blocking', rubric: 'r', reference: { digest: 'reference' }, candidate: { digests: ['candidate'] }, provider: 'codex', model: 'test',
      invoke: () => ({ ok: false, summary: 'watchdog expired' }), mkdir: () => undefined, writeFile: () => undefined, firstLabel: () => 'A',
    })
    expect(result).toEqual({ kind: 'infrastructure', summary: 'watchdog expired' })
  })

  it('records swapped advisory evidence without treating the result as blocking', () => {
    let calls = 0
    const result = runQualityCritic({
      targetDir: 'C:\\project', storyId: 'S1', round: 1, policy: 'advisory', rubric: 'r', reference: { digest: 'reference' }, candidate: { digests: ['candidate'] }, provider: 'codex', model: 'test',
      invoke: request => { calls += 1; return { ok: true, output: verdictFor(request) } }, mkdir: () => undefined, writeFile: () => undefined, firstLabel: () => 'A',
    })
    expect(result).toEqual({ kind: 'skipped', summary: 'advisory comparison recorded' })
    expect(calls).toBe(2)
  })

  it.each(['claude', 'codex', 'gemini'] as const)('extracts a quality verdict from a real %s JSONL envelope', provider => {
    const result = runQualityCritic({
      targetDir: 'C:\\project', storyId: 'S1', round: 1, policy: 'blocking', rubric: 'r', reference: { digest: 'reference' }, candidate: { digests: ['candidate'] }, provider, model: 'critic-model',
      invoke: request => ({ ok: true, output: providerStream(provider, verdictFor(request, { provider, model: 'critic-model' })) }),
      mkdir: () => undefined, writeFile: () => undefined, firstLabel: () => 'A',
    })

    expect(result).toMatchObject({ kind: 'pass' })
  })

  it.each([
    ['attempt', (request: QualityCriticRequest) => verdict(`stale-${request.candidateLabel}`, request.candidateLabel, { promptDigest: request.promptDigest, rubricDigest: request.rubricDigest })],
    ['digest', (request: QualityCriticRequest) => verdictFor(request, { candidateDigest: 'stale-candidate' })],
    ['provenance', (request: QualityCriticRequest) => verdictFor(request, { provider: 'stale-provider' })],
    ['prompt provenance', (request: QualityCriticRequest) => verdictFor(request, { promptDigest: 'foreign-prompt' })],
    ['rubric provenance', (request: QualityCriticRequest) => verdictFor(request, { rubricDigest: 'foreign-rubric' })],
  ] as const)('rejects stale %s output against the issued critic requests', (_case, output) => {
    const result = runQualityCritic({
      targetDir: 'C:\\project', storyId: 'S1', round: 1, policy: 'blocking', rubric: 'r', reference: { digest: 'reference' }, candidate: { digests: ['candidate'] }, provider: 'codex', model: 'test',
      invoke: request => ({ ok: true, output: output(request) }), mkdir: () => undefined, writeFile: () => undefined, firstLabel: () => 'A',
    })

    expect(result).toMatchObject({ kind: 'inconsistent' })
  })

  it('rejects forged verdicts after a callback mutates its boundary request', () => {
    const result = runQualityCritic({
      targetDir: 'C:\\project', storyId: 'S1', round: 1, policy: 'blocking', rubric: 'trusted-rubric',
      reference: { digest: 'reference' }, candidate: { digests: ['candidate'] }, provider: 'codex', model: 'test',
      invoke: request => {
        Reflect.set(request, 'attemptId', `forged-${request.candidateLabel}`)
        Reflect.set(request, 'promptDigest', 'forged-prompt')
        Reflect.set(request, 'rubricDigest', 'forged-rubric')
        Reflect.set(request.reference, 'digest', 'forged-reference')
        Reflect.set(request.candidate.digests, 0, 'forged-candidate')
        return {
          ok: true,
          output: JSON.stringify({
            schemaVersion: 1, attemptId: request.attemptId, winner: 'candidate', biggestGap: 'none', evidence: ['forged'], confidence: 'high',
            candidate: { label: request.candidateLabel, digest: 'forged-candidate' }, reference: { label: request.referenceLabel, digest: 'forged-reference' },
            provenance: { provider: 'codex', model: 'test', promptDigest: request.promptDigest, rubricDigest: request.rubricDigest, referenceDigest: 'forged-reference', candidateDigest: 'forged-candidate' },
          }),
        }
      },
      mkdir: () => undefined, writeFile: () => undefined, firstLabel: () => 'A',
    })

    expect(result).toMatchObject({ kind: 'inconsistent' })
  })
})
