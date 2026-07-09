import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from '../src/index.mjs'

test('lowercases and replaces spaces with single dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
})

test('strips characters that are not alphanumeric, dash, or space', () => {
  assert.equal(slugify("What's Up, Doc?"), 'whats-up-doc')
})

test('collapses runs of spaces/dashes into one dash', () => {
  assert.equal(slugify('a  --  b'), 'a-b')
})

test('trims leading/trailing dashes', () => {
  assert.equal(slugify('  hello  '), 'hello')
  assert.equal(slugify('-hello-'), 'hello')
})

test('returns empty string for input with no usable characters', () => {
  assert.equal(slugify('!!!'), '')
})
