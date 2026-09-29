import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unique } from '../src/unique.mjs'
test('deduplicates in order', () => assert.deepEqual(unique([2,1,2,3,1]), [2,1,3]))
test('empty', () => assert.deepEqual(unique([]), []))
test('SameValueZero', () => assert.deepEqual(unique([NaN,NaN,0,-0]), [NaN,0]))
test('identity and immutable input', () => { const a = {}; const b = {}; const input = Object.freeze([a,b,a]); assert.deepEqual(unique(input), [a,b]) })
test('invalid input', () => assert.throws(() => unique('abc'), TypeError))
