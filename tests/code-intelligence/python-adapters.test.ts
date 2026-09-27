import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createSerenaAdapter } from '../../src/code-intelligence/adapters/serena.js'
import { createGraphifyAdapter } from '../../src/code-intelligence/adapters/graphify.js'
import { McpBackendAdapter } from '../../src/code-intelligence/adapters/mcp.js'

it('rejects MCP tool error results instead of treating them as evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-mcp-error-')); const file = join(root, 'server.mjs')
  writeFileSync(file, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
 const message = JSON.parse(line); if (message.id === undefined) return;
 const result = message.method === 'initialize' ? {} : { isError: true, content: [{ type: 'text', text: 'graph unavailable' }] };
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});`)
  const adapter = createGraphifyAdapter(root, { command: process.execPath, args: [file] })
  try { await expect(adapter.call({ tool: 'context', arguments: {} }, 2000)).rejects.toThrow('MCP backend tool returned an error') }
  finally { await adapter.close() }
})

it.each([
  ['plain backend text', { content: [{ type: 'text', text: 'src/main.ts:L12 symbol' }] }, 'src/main.ts:L12 symbol'],
  ['Serena structured result', { structuredContent: { result: JSON.stringify([{ name_path: 'answer', relative_path: 'src/main.ts' }]) } }, [{ name_path: 'answer', relative_path: 'src/main.ts' }]],
  ['Serena result envelope', { content: [{ type: 'text', text: JSON.stringify({ result: JSON.stringify([{ name_path: 'answer', relative_path: 'src/main.ts' }]) }) }] }, [{ name_path: 'answer', relative_path: 'src/main.ts' }]],
])('unwraps %s', async (_name, response, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-mcp-result-'))
  const file = join(root, 'server.mjs')
  writeFileSync(file, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
 const message = JSON.parse(line); if (message.id === undefined) return;
 const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25' } : ${JSON.stringify(response)};
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});`)
  const adapter = new McpBackendAdapter({ name: 'serena-lsp', version: 'test', command: process.execPath, args: [file], cwd: root, framing: 'line', semantic: true, documents: false, aliases: {} })
  try { expect(await adapter.call({ tool: 'symbol', arguments: {} }, 2000)).toEqual(expected) }
  finally { await adapter.close() }
})

it.each([createSerenaAdapter, createGraphifyAdapter])('calls a newline-only MCP server through Python adapter %s', async factory => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-python-mcp-'))
  const file = join(root, 'server.mjs')
  writeFileSync(file, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  let message; try { message = JSON.parse(line) } catch { return }
  if (message.id === undefined) return;
  const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: {} } : { content: [{ type: 'text', text: '{"ok":true}' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});`)
  const adapter = factory(root, { command: process.execPath, args: [file] })
  try { expect(await adapter.call({ tool: 'context', arguments: {} }, 1000)).toEqual({ ok: true }) }
  finally { await adapter.close() }
})
