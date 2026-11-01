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

  it('de-dupes array items regardless of key order', () => {
    const out = mergeJson({ h: [{ a: 1, b: 2 }] }, { h: [{ b: 2, a: 1 }] }) as { h: unknown[] }
    expect(out.h).toHaveLength(1)
    expect(out).toEqual({ h: [{ a: 1, b: 2 }] })
  })

  it('does not pollute Object.prototype via __proto__', () => {
    mergeJson({}, JSON.parse('{"__proto__":{"polluted":true}}'))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('replaces selected MCP arguments and removes unselected Yoke tools without deleting foreign servers', () => {
    const base = { mcpServers: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'], env: { DISPLAY: ':1' } },
      graphify: { command: 'graphify', args: ['serve'] },
      custom: { url: 'https://example.test/mcp' },
    } }
    const selected = { mcpServers: { playwright: { command: 'npx', args: ['--yes', '@playwright/mcp@0.0.84'] } } }
    expect(mergeJson(base, selected)).toEqual({ mcpServers: {
      playwright: { ...base.mcpServers.playwright, ...selected.mcpServers.playwright },
      custom: base.mcpServers.custom,
    } })
    expect(mergeJson(base, { mcpServers: {} })).toEqual({ mcpServers: { custom: base.mcpServers.custom } })
    expect(mergeJson({ mcpServers: { graphify: { command: 'custom-graph-server' } } }, { mcpServers: {} }))
      .toEqual({ mcpServers: { graphify: { command: 'custom-graph-server' } } })
  })
})
