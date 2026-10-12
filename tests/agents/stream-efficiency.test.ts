import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { createBoundedOutput, createLineFramer, MAX_OUTPUT_BYTES } from '../../src/agents/stream-buffer.js'
import { createTelemetryAccumulator } from '../../src/agents/process-streams.js'

describe('bounded stream storage', () => {
  it('discards all output at a zero-byte limit, including repeated appends', () => {
    const output = createBoundedOutput(0)
    assert.equal(output.text, '')
    assert.equal(output.truncated, false)
    output.append('secret'); output.append('more')
    assert.equal(output.text, '')
    assert.equal(output.truncated, true)
  })
  it('rejects invalid limits before allocating memory', () => {
    for (const value of [-1, 0.5, NaN, Infinity, MAX_OUTPUT_BYTES + 1]) assert.throws(() => createBoundedOutput(value), RangeError)
  })
  it('retains exactly the newest ASCII bytes across wraps and oversized appends', () => {
    for (const limit of [1, 7, 32, 1024]) {
      const output = createBoundedOutput(limit)
      let reference = '', total = 0
      for (let i = 0; i < 400; i++) {
        const next = String(i % 10).repeat((i * 37) % (limit * 2 + 1))
        total += next.length; reference = (reference + next).slice(-limit)
        output.append(next)
        assert.equal(output.text, reference)
        assert.equal(output.text, reference)
        assert.equal(output.truncated, total > limit)
      }
    }
  })
  it('retains complete UTF-8 characters without replacement bytes or budget overruns', () => {
    for (let limit = 1; limit <= 20; limit++) {
      const output = createBoundedOutput(limit)
      let source = ''
      for (const next of ['ä', '🍀', '日本語', 'abc', '🌍']) {
        source += next; output.append(next)
        assert.ok(source.endsWith(output.text))
        assert.ok(Buffer.byteLength(output.text) <= limit)
        assert.ok(!output.text.includes('\uFFFD'))
      }
    }
  })
  it('does not mark exact-capacity output as truncated', () => {
    const output = createBoundedOutput(3)
    output.append('abc'); output.append('')
    assert.equal(output.truncated, false)
    output.append('d')
    assert.equal(output.text, 'bcd')
    assert.equal(output.truncated, true)
  })
})

describe('bounded NDJSON framing', () => {
  it('frames CRLF, split newlines and final unterminated messages exactly once', () => {
    const lines: string[] = []
    const framer = createLineFramer(line => lines.push(line), () => assert.fail('unexpected discard'))
    for (const part of ['one\r', '\n\nt', 'wo\nthree']) framer.append(part)
    framer.finish(); framer.finish()
    assert.deepEqual(lines, ['one', 'two', 'three'])
    assert.equal(framer.retainedBytes, 0)
  })
  it('bounds a very long newline-free stream and discards the entire frame', () => {
    const lines: string[] = []; let discarded = 0
    const framer = createLineFramer(line => lines.push(line), () => discarded++, 64)
    for (let i = 0; i < 10_000; i++) {
      framer.append('x'.repeat(11))
      assert.ok(framer.retainedBytes <= 64)
    }
    framer.append('{"suffix":"not a separate event"}\n{"ok":true}\n')
    assert.equal(discarded, 1)
    assert.deepEqual(lines, ['{"ok":true}'])
  })
  it('measures the line bound in bytes rather than UTF-16 characters', () => {
    const lines: string[] = []; let discarded = 0
    const framer = createLineFramer(line => lines.push(line), () => discarded++, 5)
    framer.append('🍀a\n🍀ä\nend')
    framer.finish()
    assert.deepEqual(lines, ['🍀a', 'end'])
    assert.equal(discarded, 1)
  })
  it('coalesces fragmented valid messages without losing their contents', () => {
    const line = JSON.stringify({ value: 'abcdef'.repeat(5000) })
    const lines: string[] = []
    const framer = createLineFramer(value => lines.push(value), () => assert.fail('unexpected discard'), 40_000)
    for (let i = 0; i < line.length; i += 7) framer.append(line.slice(i, i + 7))
    framer.finish()
    assert.deepEqual(lines, [line])
  })
  it('rejects invalid framing limits', () => {
    for (const value of [0, -1, 0.5, NaN, Infinity, MAX_OUTPUT_BYTES + 1]) assert.throws(() => createLineFramer(() => {}, () => {}, value), RangeError)
  })
})

describe('telemetry coverage after discarded frames', () => {
  it('recovers known totals from a subsequent cumulative Gemini result', () => {
    const stream = createTelemetryAccumulator('gemini', 200)
    stream.append('x'.repeat(500) + '\n')
    stream.append('{"type":"result","stats":{"input_tokens":12,"output_tokens":4}}\n')
    assert.deepEqual(stream.finish(), { usageAvailable: true, tokens: { inputTokens: 12, outputTokens: 4 } })
  })
  it('does not call incomplete OpenCode step sums a complete invocation', () => {
    const stream = createTelemetryAccumulator('opencode', 200)
    stream.append('x'.repeat(500) + '\n')
    stream.append('{"type":"step_finish","part":{"tokens":{"input":12,"output":4},"cost":0.2}}\n')
    assert.deepEqual(stream.finish(), { usageAvailable: false, partialUsage: { inputTokens: 12, outputTokens: 4, totalCostUsd: 0.2 } })
  })
  it('preserves model identity for OpenCode steps', () => {
    const stream = createTelemetryAccumulator('opencode')
    stream.append('{"type":"init","model":"test-model"}\n')
    stream.append('{"type":"step_finish","part":{"tokens":{"input":12,"output":4}}}\n')
    assert.deepEqual(stream.finish(), { usageAvailable: true, tokens: { inputTokens: 12, outputTokens: 4, model: 'test-model' } })
  })
  it('does not restore Claude tree-wide coverage from a root-only result after loss', () => {
    const stream = createTelemetryAccumulator('claude', 250)
    stream.append('x'.repeat(500) + '\n')
    stream.append('{"type":"result","usage":{"input_tokens":12,"output_tokens":4}}\n')
    assert.equal(stream.finish().usageAvailable, false)
    stream.append('{"type":"result","modelUsage":{"model":{"inputTokens":20,"outputTokens":6}}}\n')
    assert.deepEqual(stream.finish(), { usageAvailable: true, tokens: { inputTokens: 20, outputTokens: 6, model: 'model' } })
  })
  it('keeps Pi usage partial when a preceding message may have been discarded', () => {
    const stream = createTelemetryAccumulator('pi', 200)
    stream.append('x'.repeat(500) + '\n')
    stream.append('{"type":"message_end","message":{"role":"assistant","usage":{"input":8,"output":2}}}\n')
    assert.deepEqual(stream.finish(), { usageAvailable: false, partialUsage: { inputTokens: 8, outputTokens: 2 } })
  })
})
