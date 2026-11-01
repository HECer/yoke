import type { BackendName } from '../contracts.js'
import { McpStdioClient, type McpFraming } from '../mcp-client.js'
import type { BackendAdapter, BackendCall } from './types.js'

export interface McpBackendOptions { name: BackendName; version: string; command: string; args: string[]; cwd: string; framing: McpFraming; semantic: boolean; documents: boolean; aliases: Record<string, string> }

function decodeText(text: string, depth = 0): unknown {
  if (depth > 4) return text
  // Pinned Serena emits a labelled JSON form when reference context is too
  // large. Preserve that qualification rather than treating it as full output.
  const prefix = 'References without surrounding lines:\n'
  if (text.startsWith(prefix)) {
    try { return { backend_shortened: 'Reference context omitted by backend.', results: JSON.parse(text.slice(prefix.length)) } } catch { return text }
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && typeof parsed.result === 'string' ? decodeText(parsed.result, depth + 1) : parsed
  } catch { return text }
}

function valueFromResult(value: any): unknown {
  if (!value || typeof value !== 'object') return value
  if (value.isError === true) throw new Error('MCP backend tool returned an error')
  if (value.structuredContent !== undefined) {
    const structured = value.structuredContent
    if (structured && typeof structured === 'object' && Object.keys(structured).length === 1 && typeof structured.result === 'string') {
      return decodeText(structured.result)
    }
    return structured
  }
  const text = Array.isArray(value.content) ? value.content.filter((item: any) => item?.type === 'text' && typeof item.text === 'string').map((item: any) => item.text).join('\n') : undefined
  if (typeof text !== 'string') return value
  return decodeText(text)
}

export class McpBackendAdapter implements BackendAdapter {
  readonly name: BackendName
  readonly expectedVersion: string
  get version(): string { return this.client.serverVersion ?? 'unknown' }
  readonly semantic: boolean
  readonly documents: boolean
  private readonly client: McpStdioClient
  private readonly aliases: Record<string, string>
  constructor(options: McpBackendOptions) {
    this.name = options.name; this.expectedVersion = options.version; this.semantic = options.semantic; this.documents = options.documents
    this.aliases = options.aliases
    this.client = new McpStdioClient(options.command, options.args, options.cwd, options.framing)
  }
  async call(request: BackendCall, timeoutMs: number): Promise<unknown> {
    const tool = this.aliases[request.tool] ?? request.tool
    return valueFromResult(await this.client.call(tool, request.arguments, timeoutMs))
  }
  probe(timeoutMs: number): Promise<string[]> { return this.client.listTools(timeoutMs) }
  close(): Promise<void> { return this.client.close() }
}
