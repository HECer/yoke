import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { createLineFramer } from '../../src/agents/stream-buffer.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

describe('stream failure boundaries', () => {
  it('does not consume a frame again when consumption finishes reentrantly', () => {
    let calls = 0
    const framer = createLineFramer(() => { if (++calls === 1) framer.finish() }, () => {})
    framer.append('one\ntwo\n')
    assert.equal(calls, 2)
  })
  it('does not replay a frame after its callback throws', () => {
    let calls = 0
    const framer = createLineFramer(() => { calls++; throw Error('consumer failed') }, () => {})
    assert.throws(() => framer.append('one\n'), /consumer failed/)
    framer.finish()
    assert.equal(calls, 1)
  })
  it('does not restore lost child coverage from an empty modelUsage object', () => {
    const stream = createTelemetryAccumulator('claude', 256)
    stream.append('x'.repeat(257) + '\n')
    stream.append(JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 2 }, modelUsage: {} }) + '\n')
    assert.equal(stream.finish().usageAvailable, false)
    assert.equal(stream.finish().partialUsage?.inputTokens, 10)
  })
})
