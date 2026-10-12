import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { contextPacket, referencePacket, feedbackPacket } from '../../src/context/packet.js'

const context = (extra = {}) => ({ project: 'Project baseline', glossary: '', knowledge: '', decisions: '', contextMap: '', ...extra })

describe('bounded repair feedback', () => {
  it('respects every supported small budget even with many artifact references', () => {
    const input = 'HEAD\n' + Array.from({ length: 20 }, (_, i) => `[full output: /logs/${i}.txt]\n`).join('') + 'x'.repeat(30_000) + '\nLATEST FAILURE'
    for (const budget of [256, 257, 300, 512, 1024, 2400]) {
      const result = feedbackPacket(input, budget)
      assert.ok(result.length <= budget)
      assert.ok(result.startsWith('HEAD'))
      assert.ok(result.endsWith('LATEST FAILURE'))
      assert.ok(result.includes(createHash('sha256').update(input).digest('hex')))
    }
  })
  it('rejects invalid budgets rather than expanding text through negative slicing', () => {
    for (const budget of [-1, 0, 255, 256.5, NaN, Infinity]) assert.throws(() => feedbackPacket('x'.repeat(30_000), budget))
  })
  it('retains short feedback byte-for-byte', () => {
    assert.equal(feedbackPacket('the actual failure\n'), 'the actual failure\n')
  })
  it('includes a complete artifact marker in the reserved reference block', () => {
    const reference = '[full output: /tmp/diagnostics.txt]'
    const result = feedbackPacket('start'.repeat(1000) + reference + 'end'.repeat(1000), 256)
    assert.ok(result.includes(reference))
    assert.ok(result.length <= 256)
  })
  it('does not inject a cut artifact marker when the marker itself cannot fit', () => {
    const reference = `[full output: /tmp/${'long-'.repeat(200)}log.txt]`
    const result = feedbackPacket('head'.repeat(1000) + reference + 'tail'.repeat(1000), 256)
    assert.ok(!result.includes('[full output:'))
    assert.ok(result.includes('sha256:'))
  })
})

describe('task-specific context retrieval', () => {
  it('does not pad a task with unrelated historical sections', () => {
    const result = contextPacket(context({ knowledge: '## Old deployment\n' + 'unrelated archive '.repeat(1000) }), 'quaternion')
    assert.ok(!result.includes('unrelated archive'))
    assert.ok(result.includes('KNOWLEDGE'))
    assert.ok(result.length < 500)
  })
  it('preserves the stable project prefix regardless of a late query match', () => {
    const result = contextPacket(context({ project: 'CRITICAL PROJECT OVERVIEW\n' + 'padding '.repeat(500) + 'quaternion' }), 'quaternion')
    assert.ok(result.includes('CRITICAL PROJECT OVERVIEW'))
  })
  it('keeps a relevant passage beyond a long section prefix', () => {
    const source = '## Rendering\n' + 'padding '.repeat(2000) + 'QUATERNION exact rotation contract\n'
    const result = contextPacket(context({ knowledge: source }), 'quaternion')
    assert.ok(result.includes('QUATERNION exact rotation contract'))
    assert.ok(result.length <= 6000)
  })
  it('labels each excerpt with the digest of its full named source file', () => {
    const source = '## Alpha\nquaternion x\n## Beta\nquaternion y'
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
    const result = contextPacket(context({ knowledge: source }), 'quaternion')
    const matches = [...result.matchAll(/KNOWLEDGE.md; sha256:([a-f0-9]+)/g)]
    assert.equal(matches.length, 2)
    for (const match of matches) assert.equal(match[1], hash)
  })
  it('returns an empty packet when all context is empty', () => {
    assert.equal(contextPacket(context({ project: '' }), 'anything'), '')
  })
  it('respects context and reference budgets without a summarizer', () => {
    const source = '## Section\n' + 'some text '.repeat(8000) + 'QUATERNION'
    for (const budget of [256, 257, 1024, 6000]) {
      assert.ok(contextPacket(context({ knowledge: source }), 'quaternion', budget).length <= budget)
      assert.ok(referencePacket('.yoke/plan.md', source, 'quaternion', budget).length <= budget)
    }
  })
  it('retrieves late matches in secondary planning references', () => {
    const source = '## Plan\n' + 'padding '.repeat(2000) + 'QUATERNION should normalize\n'
    const result = referencePacket('.yoke/plan.md', source, 'quaternion')
    assert.ok(result.includes('QUATERNION should normalize'))
    assert.ok(result.includes(createHash('sha256').update(source).digest('hex')))
  })
})
