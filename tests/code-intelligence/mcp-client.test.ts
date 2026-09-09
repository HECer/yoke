import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpStdioClient } from '../../src/code-intelligence/mcp-client.js'

const fakeServer = `
let buffer = Buffer.alloc(0)
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)])
  while (buffer.length) {
    let raw
    if (buffer.toString('ascii', 0, 14).toLowerCase().startsWith('content-length:')) {
      const end = buffer.indexOf('\\r\\n\\r\\n'); if (end < 0) return
      const length = Number(/content-length:\\s*(\\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))[1]); if (buffer.length < end + 4 + length) return
      raw = buffer.subarray(end + 4, end + 4 + length).toString(); buffer = buffer.subarray(end + 4 + length)
    } else {
      const end = buffer.indexOf(10); if (end < 0) return
      raw = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1)
    }
    const message = JSON.parse(raw); if (message.id === undefined) continue
    const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25' } : { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }
    const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
    if (raw.startsWith('{')) process.stdout.write(payload + '\\n')
    else process.stdout.write('Content-Length: ' + Buffer.byteLength(payload) + '\\r\\n\\r\\n' + payload)
  }
})
`

describe('MCP stdio client', () => {
  it('speaks newline JSON-RPC for Graft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-')); const file = join(root, 'server.mjs'); writeFileSync(file, fakeServer)
    const client = new McpStdioClient(process.execPath, [file], root, 'line'); const result = await client.call('graft_find_code', { query: 'answer' }, 2000)
    expect(result.content?.[0]?.text).toContain('ok'); await client.close()
  })
})
