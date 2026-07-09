import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleCase } from '../src/index.mjs'

test('capitalizes each significant word', () => {
  assert.equal(titleCase('the quick brown fox'), 'The Quick Brown Fox')
})

test('keeps small words lowercase mid-title', () => {
  assert.equal(titleCase('a tale of two cities'), 'A Tale of Two Cities')
  assert.equal(titleCase('war and peace'), 'War and Peace')
})

test('always capitalizes the first and last word, even small ones', () => {
  assert.equal(titleCase('of mice and men'), 'Of Mice and Men')
  assert.equal(titleCase('what dreams may come to'), 'What Dreams May Come To')
})

test('normalizes ALL-CAPS input', () => {
  assert.equal(titleCase('THE GREAT GATSBY'), 'The Great Gatsby')
})

test('single word is capitalized', () => {
  assert.equal(titleCase('dune'), 'Dune')
})
