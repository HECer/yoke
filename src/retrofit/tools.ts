import type { CodeGraph } from './config.js'
import type { CodeIntelligenceMode } from '../code-intelligence/contracts.js'

export interface McpServerConfig {
  command: string
  args: string[]
}

// Best-effort launch commands per code-graph tool. Users may need to adjust these
// to match their local install (graphify: `uv tool install graphify`; serena: `uv`,
// e.g. `uvx --from git+https://github.com/oraios/serena serena-mcp-server`).
const CODE_GRAPH_SERVERS: Record<Exclude<CodeGraph, 'none'>, McpServerConfig> = {
  graphify: { command: 'graphify', args: ['serve'] },
  serena: {
    command: 'serena',
    args: ['start-mcp-server', '--open-web-dashboard', 'false'],
  },
}

export const PLAYWRIGHT_MCP_VERSION = '0.0.84'

export function mcpServers(codeGraph: CodeGraph = 'none', codeIntelligence: CodeIntelligenceMode = 'off', targetDir = '.', browserTools = false): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {}
  if (codeIntelligence !== 'off') {
    servers['code-intelligence'] = { command: 'yoke', args: ['code-intelligence-server', `--workspace=${targetDir}`, `--mode=${codeIntelligence}`] }
  } else if (codeGraph !== 'none') servers[codeGraph] = CODE_GRAPH_SERVERS[codeGraph]
  if (browserTools) servers.playwright = { command: 'npx', args: ['--yes', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`] }
  return servers
}

/** OpenCode-family CLIs use an object with a local command array, not Claude's mcpServers shape. */
export function openCodeMcpServers(codeGraph: CodeGraph = 'none', codeIntelligence: CodeIntelligenceMode = 'off', targetDir = '.', browserTools = false): Record<string, { type: 'local'; command: string[]; enabled: true }> {
  return Object.fromEntries(Object.entries(mcpServers(codeGraph, codeIntelligence, targetDir, browserTools)).map(([name, server]) => [name, {
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
    'When RTK is installed, use it for verbose shell output that would otherwise fill context.',
    'Keep exit codes and complete failure evidence. Read raw output when compression hides information needed for acceptance.',
    'Example: `rtk git status`, `rtk npm test`. Run `yoke tools-preflight` to check availability. See https://github.com/rtk-ai/rtk.',
  ].join('\n')
}
