import { McpBackendAdapter } from './mcp.js'

export const SERENA_VERSION = '1.7.1-dev'
export function createSerenaAdapter(cwd: string, override?: { command?: string; args?: string[] }): McpBackendAdapter {
  return new McpBackendAdapter({
    name: 'serena-lsp', version: SERENA_VERSION, cwd, command: override?.command ?? 'serena', args: override?.args ?? ['start-mcp-server', '--project-from-cwd', '--context', 'codex'], framing: 'content-length', semantic: true, documents: false,
    aliases: {
      symbol: 'find_symbol', references: 'find_referencing_symbols', implementations: 'find_implementations', overview: 'get_symbols_overview', diagnostics: 'get_diagnostics_for_file',
      rename: 'rename_symbol', replace_symbol_body: 'replace_symbol_body', insert_before_symbol: 'insert_before_symbol', insert_after_symbol: 'insert_after_symbol', safe_delete: 'safe_delete_symbol',
    },
  })
}
