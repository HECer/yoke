import { McpBackendAdapter } from './mcp.js'
import type { BackendCall } from './types.js'

export const GRAFT_VERSION = '0.17.0'
export function createGraftAdapter(cwd: string, override?: { command?: string; args?: string[] }): McpBackendAdapter {
  return new McpBackendAdapter({
    name: 'graft', version: GRAFT_VERSION, cwd, command: override?.command ?? 'graft', args: override?.args ?? ['mcp'], framing: 'line', semantic: false, documents: false,
    aliases: { context: 'graft_find_code', trace: 'graft_trace_calls', file: 'graft_file_api', freshness: 'graft_check_freshness', repo_map: 'graft_repo_map' },
  })
}

export function graftCall(kind: string, args: Record<string, unknown>): BackendCall {
  return { tool: kind, arguments: args }
}
