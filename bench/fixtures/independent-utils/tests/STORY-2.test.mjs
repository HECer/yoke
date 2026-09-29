import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunk } from '../src/chunk.mjs'
test('consecutive chunks', () => assert.deepEqual(chunk([1,2,3,4,5],2), [[1,2],[3,4],[5]]))
test('empty', () => assert.deepEqual(chunk([],2), []))
test('large size', () => assert.deepEqual(chunk([1,2],9), [[1,2]]))
test('immutable input and new arrays', () => { const input = Object.freeze([1,2]); assert.notEqual(chunk(input,2)[0], input) })
test('invalid input and size', () => { assert.throws(() => chunk('abc',2), TypeError); for (const size of [0,-1,1.5,NaN,Infinity]) assert.throws(() => chunk([],size), RangeError) })
