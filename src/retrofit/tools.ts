import type { CodeGraph } from './config.js'
import type { CodeIntelligenceMode } from '../code-intelligence/contracts.js'

export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort launch commands per code-graph tool. Users may need to adjust these
// to match their local install (graphify: `uv tool install graphify`; serena: `uv`,
// e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`).
const CODE_GRAPH_SERVERS: Record<CodeGraph, McpServerConfig> = {
  graphify: { command: 'graphify', args: ['serve'] },
  serena: {
    command: 'serena',
    args: ['start-mcp-server', '--open-web-dashboard', 'false'],
  },
}

export function mcpServers(codeGraph: CodeGraph = 'graphify', codeIntelligence: CodeIntelligenceMode = 'off', targetDir = '.'): Record<string, McpServerConfig> {
  if (codeIntelligence !== 'off') return {
    'code-intelligence': { command: 'yoke', args: ['code-intelligence-server', `--workspace=${targetDir}`, `--mode=${codeIntelligence}`] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  }
  return { [codeGraph]: CODE_GRAPH_SERVERS[codeGraph], playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }
}

/** OpenCode-family CLIs use an object with a local command array, not Claude's mcpServers shape. */
export function openCodeMcpServers(codeGraph: CodeGraph = 'graphify', codeIntelligence: CodeIntelligenceMode = 'off', targetDir = '.'): Record<string, { type: 'local'; command: string[]; enabled: true }> {
  return Object.fromEntries(Object.entries(mcpServers(codeGraph, codeIntelligence, targetDir)).map(([name, server]) => [name, {
    type: 'local' as const,
    command: [server.command, ...server.args],
    enabled: true as const,
  }]))
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
