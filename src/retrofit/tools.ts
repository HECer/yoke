import type { CodeGraph } from './config.js'

export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort launch commands per code-graph tool. Users may need to adjust these
// to match their local install (graphify: `uv tool install graphifyy`; serena: `uv`,
// e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`).
const CODE_GRAPH_SERVERS: Record<CodeGraph, McpServerConfig> = {
  graphify: { command: 'graphify', args: ['serve'] },
  serena: { command: 'serena', args: ['start-mcp-server'] },
}

export function mcpServers(codeGraph: CodeGraph = 'graphify'): Record<string, McpServerConfig> {
  return {
    [codeGraph]: CODE_GRAPH_SERVERS[codeGraph],
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  }
}

// rtk has no transparent-rewrite hook on Codex/Gemini; those agents get this
// instruction instead. On Claude (Windows) it is also the WSL-less fallback.
export function rtkInstruction(): string {
  return [
    '## Token efficiency (rtk)',
    '',
    'Prefix shell/dev commands with `rtk` to compress their output before it enters context.',
    'Example: `rtk git status`, `rtk npm test`. See https://github.com/rtk-ai/rtk.',
  ].join('\n')
}
