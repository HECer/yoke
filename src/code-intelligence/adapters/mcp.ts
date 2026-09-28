import type { BackendName } from '../contracts.js'
import { McpStdioClient, type McpFraming } from '../mcp-client.js'
import type { BackendAdapter, BackendCall } from './types.js'

export interface McpBackendOptions { name: BackendName; version: string; command: string; args: string[]; cwd: string; framing: McpFraming; semantic: boolean; documents: boolean; aliases: Record<string, string> }

function valueFromResult(value: any): unknown {
  if (!value || typeof value !== 'object') return value
  if (value.isError === true) throw new Error('MCP backend tool returned an error')
  if (value.structuredContent !== undefined) {
    const structured = value.structuredContent
    if (structured && typeof structured === 'object' && Object.keys(structured).length === 1 && typeof structured.result === 'string') {
      try { return JSON.parse(structured.result) } catch { return structured.result }
    }
    return structured
  }
  const text = Array.isArray(value.content) ? value.content.find((item: any) => item?.type === 'text')?.text : undefined
  if (typeof text !== 'string') return value
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && typeof parsed.result === 'string') {
      try { return JSON.parse(parsed.result) } catch { return parsed.result }
    }
    return parsed
  } catch { return text }
}

export class McpBackendAdapter implements BackendAdapter {
  readonly name: BackendName
  readonly version: string
  readonly semantic: boolean
  readonly documents: boolean
  private readonly client: McpStdioClient
  private readonly aliases: Record<string, string>
  constructor(options: McpBackendOptions) {
    this.name = options.name; this.version = options.version; this.semantic = options.semantic; this.documents = options.documents
    this.aliases = options.aliases
    this.client = new McpStdioClient(options.command, options.args, options.cwd, options.framing)
  }
  async call(request: BackendCall, timeoutMs: number): Promise<unknown> {
    const tool = this.aliases[request.tool] ?? request.tool
    return valueFromResult(await this.client.call(tool, request.arguments, timeoutMs))
  }
  close(): Promise<void> { return this.client.close() }
}
