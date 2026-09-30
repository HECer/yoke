import { test } from 'node:test'
import assert from 'node:assert/strict'
import { range } from '../src/range.mjs'
test('ascending', () => assert.deepEqual(range(1,5), [1,2,3,4]))
test('descending', () => assert.deepEqual(range(5,0,-2), [5,3,1]))
test('fractional', () => assert.deepEqual(range(0,1,0.25), [0,0.25,0.5,0.75]))
test('empty', () => { assert.deepEqual(range(1,1), []); assert.deepEqual(range(1,5,-1), []); assert.deepEqual(range(5,1,1), []) })
test('invalid numbers', () => { for (const args of [[0,1,0],[NaN,1],[0,Infinity],[0,1,Infinity]]) assert.throws(() => range(...args), RangeError) })
