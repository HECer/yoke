import { McpBackendAdapter } from './mcp.js'

export const GRAPHIFY_VERSION = '0.9.56'
export function createGraphifyAdapter(cwd: string, override?: { command?: string; args?: string[] }): McpBackendAdapter {
  return new McpBackendAdapter({
    name: 'graphify', version: GRAPHIFY_VERSION, cwd, command: override?.command ?? 'python', args: override?.args ?? ['-m', 'graphify.serve'], framing: 'content-length', semantic: false, documents: true,
    aliases: { context: 'query_graph', symbol: 'get_node', neighbors: 'get_neighbors', trace: 'shortest_path', impact: 'get_pr_impact' },
  })
}
