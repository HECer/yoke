import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncate } from '../src/index.mjs'

test('returns short strings unchanged', () => {
  assert.equal(truncate('hello', 10), 'hello')
})

test('string of exactly max length is unchanged', () => {
  assert.equal(truncate('exact', 5), 'exact')
})

test('truncates at a word boundary and appends a single ellipsis character', () => {
  assert.equal(truncate('the quick brown fox', 12), 'the quick…')
})

test('result length never exceeds max', () => {
  const out = truncate('the quick brown fox jumps', 10)
  assert.ok(out.length <= 10, `expected <= 10, got ${out.length}: "${out}"`)
})

test('falls back to a hard cut when the first word is longer than max', () => {
  assert.equal(truncate('extraordinary', 6), 'extra…')
})

test('throws RangeError for max < 1', () => {
  assert.throws(() => truncate('x', 0), RangeError)
})
