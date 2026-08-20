import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'
import { skillPackageActions } from '../skill-actions.js'

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
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const actions: Action[] = manifest.skills.flatMap(skill => skillPackageActions(canonDir, skill, 'codex'))

  const roles = [
    ['implementer', 'Implementation specialist for one scoped story.', 'workspace-write', 'Implement only the assigned scope. Use tests first, run verification, and do not review or commit your own work.'],
    ['reviewer', 'Read-only reviewer for correctness and acceptance criteria.', 'read-only', 'Review observed diffs and test evidence. Do not modify files. Return only findings grounded in evidence.'],
    ['security', 'Read-only security reviewer for changed code.', 'read-only', 'Inspect changed code for exploitable security regressions. Do not modify files and avoid speculative findings.'],
    ['docs', 'Documentation specialist for release and API consistency.', 'workspace-write', 'Update only documentation required by the assigned change. Verify commands and version references against the repository. Use no-ai-slop Detect mode before prose edits, preserve the writer\'s voice, and apply only observed fixes.'],
  ] as const

  actions.push(
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: `${baseline.trimEnd()}\n\n@RTK.md\n`,
      reason: 'baseline instructions (Codex reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: '.codex/config.toml',
      content: `# Yoke project configuration. Codex loads this in trusted repositories.\n\n[features]\nhooks = true\n\n${tomlMcp(codeGraph)}`,
      reason: 'MCP servers (code-graph + playwright)',
    },
    {
      kind: 'write',
      target: '.codex/hooks.json',
      merge: true,
      content: JSON.stringify({
        description: 'Yoke command compression for Codex',
        hooks: {
          PreToolUse: [{
            matcher: '^Bash$',
            hooks: [{
              type: 'command',
              command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/rtk.mjs"',
              commandWindows: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = git rev-parse --show-toplevel; node (Join-Path $root \'.codex/hooks/rtk.mjs\')"',
              timeout: 5,
              statusMessage: 'Compressing command output with RTK',
            }],
          }],
        },
      }, null, 2) + '\n',
      reason: 'rtk PreToolUse hook adapter',
    },
    {
      kind: 'write',
      target: '.codex/hooks/rtk.mjs',
      content: readFileSync(join(canonDir, 'tools', 'codex-rtk-hook.mjs'), 'utf8'),
      reason: 'rtk Codex hook adapter',
    },
    {
      kind: 'write',
      target: 'RTK.md',
      content: rtkInstruction() + '\n',
      reason: 'rtk instruction (Codex has no rewrite hook)',
    },
  )

  for (const [name, description, sandbox, instructions] of roles) {
    actions.push({
      kind: 'write',
      target: `.codex/agents/${name}.toml`,
      content: `name = "${name}"\ndescription = "${description}"\nsandbox_mode = "${sandbox}"\ndeveloper_instructions = """\n${instructions}\n"""\n`,
      reason: `Codex role agent: ${name}`,
    })
  }
  return actions
}
