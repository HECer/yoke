#!/usr/bin/env node
import { CodeIntelligenceCoordinator } from './coordinator.js'
import { CodeIntelligenceModeSchema, TOOL_DEFINITIONS } from './contracts.js'
import { loadConfig } from '../retrofit/config.js'
import { workspaceId } from './snapshots.js'

const MAX_INPUT_BYTES = 2_000_000
const MAX_PENDING = 16
function arg(name: string, args: string[]): string | undefined { return args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) }
export interface CodeIntelligenceServerIo { stdin: NodeJS.ReadableStream; stdout: Pick<NodeJS.WritableStream, 'write'> }

export async function runCodeIntelligenceServer(argv = process.argv.slice(2), io: CodeIntelligenceServerIo = process): Promise<void> {
  const workspace = arg('workspace', argv) ?? process.cwd(), configured = loadConfig(workspace)?.codeIntelligence
  const mode = CodeIntelligenceModeSchema.parse(arg('mode', argv) ?? configured?.mode ?? 'shadow')
  const workspaceIdentifier = configured?.workspaceId ?? workspaceId(workspace)
  const coordinator = new CodeIntelligenceCoordinator(workspace, {
    mode, workspaceId: workspaceIdentifier, policy: configured?.policy, limits: configured?.limits,
    graft: configured?.graft, graphify: configured?.graphify, serena: configured?.serena,
  })
  let framing: 'line' | 'content-length' = 'line', buffer = Buffer.alloc(0), pending = 0, stopping = false
  const send = (message: unknown) => {
    if (stopping) return
    const payload = JSON.stringify(message)
    io.stdout.write(framing === 'line' ? `${payload}\n` : `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
  }
  const handle = async (message: any) => {
    if (message?.method?.startsWith('notifications/')) return
    if (message?.method === 'initialize') { send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'yoke-code-intelligence', version: '0.2.0' } } }); return }
    if (message?.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools: mode === 'off' ? [] : TOOL_DEFINITIONS.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...(tool.inputSchema as any).properties, workspace_id: { type: 'string', const: workspaceIdentifier, description: 'Accepted workspace identifier.' } } } })) } }); return
    }
    if (message?.method === 'tools/call') {
      const response = await coordinator.dispatch(message.params?.name, message.params?.arguments ?? {})
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `status=${response.status} snapshot=${response.snapshot_id}; full result in structuredContent${response.evidence_cursor ? '; continue with code_evidence using evidence_cursor' : ''}` }], structuredContent: response, isError: response.status === 'error' || response.status === 'blocked' } }); return
    }
    if (message?.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
  }
  let finish!: () => void
  const done = new Promise<void>(resolve => { finish = resolve })
  const stop = () => {
    if (stopping) return
    stopping = true; buffer = Buffer.alloc(0)
    process.off('SIGTERM', stop); process.off('SIGINT', stop); io.stdin.off('end', stop); io.stdin.off('data', consume)
    void coordinator.close().catch(() => {}).finally(finish)
  }
  const consume = (chunk: unknown) => {
    if (stopping) return
    buffer = Buffer.concat([buffer, Buffer.from(chunk as Uint8Array)])
    if (buffer.length > MAX_INPUT_BYTES) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'MCP input frame exceeds byte limit' } }); stop(); return }
    while (buffer.length) {
      let raw: string
      if (/^Content-Length:/i.test(buffer.toString('ascii', 0, Math.min(buffer.length, 32)))) {
        framing = 'content-length'; const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return
        const match = /^Content-Length:\s*(\d+)\s*$/im.exec(buffer.subarray(0, end).toString('ascii')), length = Number(match?.[1])
        if (!match || !Number.isSafeInteger(length) || length > MAX_INPUT_BYTES) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid or oversized MCP input frame' } }); stop(); return }
        if (buffer.length < end + 4 + length) return
        raw = buffer.subarray(end + 4, end + 4 + length).toString('utf8'); buffer = buffer.subarray(end + 4 + length)
      } else {
        const end = buffer.indexOf(10); if (end < 0) return
        raw = buffer.subarray(0, end).toString('utf8').trim(); buffer = buffer.subarray(end + 1)
      }
      if (!raw) continue
      let message: any
      try { message = JSON.parse(raw) } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue }
      if (pending >= MAX_PENDING) { send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32000, message: 'Too many pending requests; retry after completion' } }); continue }
      pending++
      void handle(message).catch(() => send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'MCP request failed' } })).finally(() => { pending-- })
    }
  }
  io.stdin.on('data', consume); io.stdin.once('end', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop)
  await done
}
if (process.argv[1]?.endsWith('code-intelligence-server.js')) void runCodeIntelligenceServer()
