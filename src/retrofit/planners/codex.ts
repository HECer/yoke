import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph, CodeIntelligenceMode } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'
import { skillPackageActions } from '../skill-actions.js'
import { mergeJson } from '../merge-json.js'

function codexHooks(targetDir: string): string {
  const path = join(targetDir, '.codex/hooks.json')
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  // Remove only the exact Yoke adapter command; keep other hooks in its block.
  if (Array.isArray(current.hooks?.PreToolUse)) {
    current.hooks.PreToolUse = current.hooks.PreToolUse.flatMap((block: any) => {
      if (!Array.isArray(block.hooks)) return [block]
      const hooks = block.hooks.filter((hook: any) => hook.command !== 'node "$(git rev-parse --show-toplevel)/.codex/hooks/rtk.mjs"')
      return hooks.length ? [{ ...block, hooks }] : []
    })
  }
  return JSON.stringify(mergeJson(current, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }] } }), null, 2) + '\n'
}

function tomlMcp(codeGraph: CodeGraph, codeIntelligence: CodeIntelligenceMode, targetDir: string): string {
  const servers = mcpServers(codeGraph, codeIntelligence, targetDir)
  // Codex reads MCP servers from ~/.codex/config.toml. This project-level file is a
  // ready-to-merge snippet; users append these blocks to their global config.
  return Object.entries(servers)
    .map(([name, cfg]) => {
      const args = cfg.args.map(a => `"${a}"`).join(', ')
      return `[mcp_servers.${name}]\ncommand = "${cfg.command}"\nargs = [${args}]\n`
    })
    .join('\n')
}

export function planCodex(canonDir: string, targetDir: string, codeGraph: CodeGraph = 'graphify', codeIntelligence: CodeIntelligenceMode = 'off'): Action[] {
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
      content: `# Yoke project configuration. Codex loads this in trusted repositories.\n\n[features]\nhooks = true\n\n${tomlMcp(codeGraph, codeIntelligence, targetDir)}`,
      reason: codeIntelligence === 'off' ? 'MCP servers (code-graph + playwright)' : 'Yoke code-intelligence facade + playwright',
    },
    {
      kind: 'write',
      target: '.codex/hooks.json',
      content: codexHooks(targetDir),
      reason: 'native RTK Codex hook; preserves foreign hooks and migrates the Yoke adapter',
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
      content: rtkInstruction() + '\n\nCodex uses `rtk hook codex` when supported by the installed RTK. Run `yoke tools-preflight --json` to check native rewriting. Nested code-mode shell calls remain unverified; explicitly prefix verbose commands with RTK.\n',
      reason: 'RTK guidance and operational verification',
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
