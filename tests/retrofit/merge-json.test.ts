import { describe, it, expect } from 'vitest'
import { mergeJson } from '../../src/retrofit/merge-json.js'

describe('mergeJson', () => {
  it('preserves keys only present in base', () => {
    expect(mergeJson({ model: 'opus', x: 1 }, { y: 2 })).toEqual({ model: 'opus', x: 1, y: 2 })
  })

  it('recursively merges nested objects', () => {
    expect(mergeJson({ a: { p: 1 } }, { a: { q: 2 } })).toEqual({ a: { p: 1, q: 2 } })
  })

  it('concatenates arrays and de-dupes by structural equality', () => {
    expect(mergeJson({ h: [{ k: 1 }] }, { h: [{ k: 1 }, { k: 2 }] })).toEqual({ h: [{ k: 1 }, { k: 2 }] })
  })

  it('incoming primitive overrides base on the same key', () => {
    expect(mergeJson({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  it('incoming wins when types mismatch', () => {
    expect(mergeJson({ a: { p: 1 } }, { a: 5 })).toEqual({ a: 5 })
  })
})
