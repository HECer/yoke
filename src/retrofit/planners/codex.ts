import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'

function tomlMcp(codeGraph: CodeGraph): string {
  const servers = mcpServers(codeGraph)
  // Codex reads MCP servers from ~/.codex/config.toml. This project-level file is a
  // ready-to-merge snippet; users append these blocks to their global config.
  return Object.entries(servers)
    .map(([name, cfg]) => {
      const args = cfg.args.map(a => `"${a}"`).join(', ')
      return `[mcp_servers.${name}]\ncommand = "${cfg.command}"\nargs = [${args}]\n`
    })
    .join('\n')
}

export function planCodex(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
  return [
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: readFileSync(join(canonDir, 'AGENTS.md'), 'utf8'),
      reason: 'baseline instructions (Codex reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: '.codex/config.toml',
      content: `# Forge: MCP servers for Codex. Merge into ~/.codex/config.toml.\n\n${tomlMcp(codeGraph)}`,
      reason: 'MCP servers (code-graph + playwright)',
    },
    {
      kind: 'write',
      target: 'RTK.md',
      content: rtkInstruction() + '\n',
      reason: 'rtk instruction (Codex has no rewrite hook)',
    },
  ]
}
