#!/usr/bin/env node
import { CodeIntelligenceCoordinator } from './coordinator.js'
import { TOOL_DEFINITIONS } from './contracts.js'
import { loadConfig } from '../retrofit/config.js'

const INPUT_SCHEMAS: Record<string, object> = {
  code_context: { type: 'object', required: ['workspace_id', 'query'], properties: { workspace_id: { type: 'string' }, query: { type: 'string' }, snapshot_id: { type: 'string' }, mode: { type: 'string', enum: ['orient', 'locate', 'explain'] }, paths: { type: 'array', items: { type: 'string' } }, include_docs: { type: 'boolean' }, token_budget: { type: 'integer' }, timeout_ms: { type: 'integer' } } },
  code_symbol: { type: 'object', required: ['workspace_id', 'snapshot_id'], properties: { workspace_id: { type: 'string' }, snapshot_id: { type: 'string' }, symbol_id: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' }, include: { type: 'array' } } },
  code_trace: { type: 'object', required: ['workspace_id', 'snapshot_id', 'symbol_id', 'direction', 'relations'], properties: { workspace_id: { type: 'string' }, snapshot_id: { type: 'string' }, symbol_id: { type: 'string' }, direction: { type: 'string', enum: ['in', 'out'] }, relations: { type: 'array' }, max_depth: { type: 'integer' }, max_nodes: { type: 'integer' } } },
  code_impact: { type: 'object', required: ['workspace_id', 'snapshot_id'], properties: { workspace_id: { type: 'string' }, snapshot_id: { type: 'string' }, targets: { type: 'array' }, plan_id: { type: 'string' }, include_docs: { type: 'boolean' }, require_semantic: { type: 'boolean' } } },
  code_edit_preview: { type: 'object', required: ['workspace_id', 'snapshot_id', 'operations', 'validation_profile'], properties: { workspace_id: { type: 'string' }, snapshot_id: { type: 'string' }, operations: { type: 'array' }, validation_profile: { type: 'string', enum: ['default', 'extended'] } } },
  code_edit_apply: { type: 'object', required: ['workspace_id', 'plan_id', 'expected_snapshot_id', 'idempotency_key'], properties: { workspace_id: { type: 'string' }, plan_id: { type: 'string' }, expected_snapshot_id: { type: 'string' }, idempotency_key: { type: 'string' } } },
}

function arg(name: string, args: string[]): string | undefined { return args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) }
function summary(response: any): string { return `status=${response.status} snapshot=${response.snapshot_id} warnings=${response.warnings.length} (full result in structuredContent)` }

export async function runCodeIntelligenceServer(argv = process.argv.slice(2)): Promise<void> {
  const workspace = arg('workspace', argv) ?? process.cwd(); const configured = loadConfig(workspace)?.codeIntelligence
  const mode = (arg('mode', argv) as 'off' | 'shadow' | 'active' | undefined) ?? configured?.mode ?? 'active'
  const coordinator = new CodeIntelligenceCoordinator(workspace, {
    mode,
    policy: { excludePatterns: configured?.policy?.excludePatterns, maxFileBytes: configured?.policy?.maxFileBytes },
    limits: { maxBytes: configured?.limits?.maxBytes, maxBackends: configured?.limits?.maxBackends },
    graft: configured?.graft, graphify: configured?.graphify, serena: configured?.serena,
  })
  let framing: 'line' | 'content-length' = 'line'; let buffer = Buffer.alloc(0)
  const send = (message: unknown) => {
    const payload = JSON.stringify(message)
    if (framing === 'line') process.stdout.write(`${payload}\n`)
    else process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`)
  }
  const handle = async (message: any) => {
    if (message.method === 'notifications/initialized' || message.method?.startsWith('notifications/')) return
    if (message.method === 'initialize') { send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'yoke-code-intelligence', version: '0.1.0' } } }); return }
    if (message.method === 'tools/list') { send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOL_DEFINITIONS.map(tool => ({ ...tool, inputSchema: INPUT_SCHEMAS[tool.name] })) } }); return }
    if (message.method === 'tools/call') {
      const name = message.params?.name; const response = await coordinator.dispatch(name, message.params?.arguments ?? {})
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: summary(response) }], structuredContent: response, isError: response.status === 'error' || response.status === 'blocked' } }); return
    }
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
  }
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)])
    while (buffer.length) {
      let raw: string | undefined
      if (/^Content-Length:/i.test(buffer.toString('ascii', 0, Math.min(buffer.length, 32)))) {
        framing = 'content-length'; const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return
        const header = buffer.subarray(0, end).toString('ascii'); const match = /Content-Length:\s*(\d+)/i.exec(header); if (!match) { buffer = buffer.subarray(end + 4); continue }
        const length = Number(match[1]); if (buffer.length < end + 4 + length) return
        raw = buffer.subarray(end + 4, end + 4 + length).toString('utf8'); buffer = buffer.subarray(end + 4 + length)
      } else {
        const end = buffer.indexOf(10); if (end < 0) return
        raw = buffer.subarray(0, end).toString('utf8').trim(); buffer = buffer.subarray(end + 1)
      }
      if (!raw) continue
      try { void handle(JSON.parse(raw)) } catch { /* malformed protocol input is ignored */ }
    }
  })
  await new Promise<void>(resolve => { const stop = () => { process.off('SIGTERM', stop); process.off('SIGINT', stop); void coordinator.close().finally(resolve) }; process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdin.once('end', stop) })
}

if (process.argv[1]?.endsWith('code-intelligence-server.js')) void runCodeIntelligenceServer()
