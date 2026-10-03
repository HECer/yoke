import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { defaultConfig, saveConfig } from '../../src/retrofit/config.js'
import { runCodeIntelligenceServer } from '../../src/code-intelligence/mcp-server.js'

const constructed = vi.hoisted(() => vi.fn())
vi.mock('../../src/code-intelligence/coordinator.js', () => ({
  CodeIntelligenceCoordinator: class {
    constructor(root: string, options: unknown) { constructed(root, options) }
    async close() {}
  },
}))

it('boots the facade with all configured limits and advertises request controls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yoke-ci-server-limits-'))
  const stdin = new PassThrough(); const stdout = new PassThrough(); const messages: any[] = []
  stdout.on('data', chunk => messages.push(JSON.parse(chunk.toString())))
  saveConfig(root, { ...defaultConfig('test'), codeIntelligence: { mode: 'shadow', limits: { tokenBudget: 1300, timeoutMs: 750, maxBytes: 1400, maxBackends: 2 } } })
  const server = runCodeIntelligenceServer([`--workspace=${root}`], { stdin, stdout })
  try {
    expect(constructed).toHaveBeenLastCalledWith(root, expect.objectContaining({ limits: { tokenBudget: 1300, timeoutMs: 750, maxBytes: 1400, maxBackends: 2 } }))
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    const tools = new Map(messages[0].result.tools.map((tool: any) => [tool.name, tool.inputSchema.properties]))
    expect((tools.get('code_symbol') as any).token_budget).toBeDefined()
    expect((tools.get('code_trace') as any).require_resolved).toBeDefined()
    expect((tools.get('code_trace') as any).timeout_ms).toBeDefined()
    expect((tools.get('code_edit_preview') as any).timeout_ms).toBeDefined()
  } finally { stdin.end(); await server; rmSync(root, { recursive: true, force: true }) }
})
