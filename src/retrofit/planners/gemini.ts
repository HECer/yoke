import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import { parseFrontmatter } from '../../canon/frontmatter.js'
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'
import { PRESERVE_SCAFFOLD } from '../preserve.js'
import { skillPackageActions } from '../skill-actions.js'

function tomlString(s: string): string {
  return '"""\n' + s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"') + '\n"""'
}

export function planGemini(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  // GEMINI.md: baseline + instruction for commands outside the rewrite hook.
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const autoSkillIndex = manifest.skills
    .filter(skill => skill.invocation === 'auto')
    .map(skill => {
      const source = readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8')
      const description = String(parseFrontmatter(source)?.description ?? skill.id).replace(/\s+/gu, ' ').trim()
      return `- \`/${skill.id}\` — ${description}`
    })
    .join('\n')
  actions.push({
    kind: 'write',
    target: 'GEMINI.md',
    content: `${baseline}\n${rtkInstruction()}\n\n## Yoke automatic skills\n\nUse the matching command when its capability is relevant:\n\n${autoSkillIndex}\n\n${PRESERVE_SCAFFOLD}\n`,
    reason: 'baseline + rtk instruction',
  })

  // One TOML slash command per skill.
  for (const skill of manifest.skills) {
    const body = readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8')
    const fm = parseFrontmatter(body) ?? {}
    // Collapse any newlines so the single-line TOML `description = "..."` stays valid
    // even for ported skills whose frontmatter description spans multiple lines.
    const description = String(fm.description ?? skill.id).replace(/\s*\r?\n\s*/g, ' ').trim()
    const skillBody = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    const prompt = `You are using the "${skill.id}" skill.\n\n${skillBody}\n\nFollow it for the current task.`
    actions.push({
      kind: 'write',
      target: `.gemini/commands/${skill.id}.toml`,
      content: `description = "${description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nprompt = ${tomlString(prompt)}\n`,
      reason: `gemini command: ${skill.id}`,
    })
    actions.push(...skillPackageActions(canonDir, skill, 'gemini'))
  }

  actions.push({
    kind: 'write',
    target: '.gemini/hooks/gemini-rtk-hook.mjs',
    content: readFileSync(join(canonDir, 'tools/gemini-rtk-hook.mjs'), 'utf8'),
    reason: 'portable RTK BeforeTool argument adapter',
  })

  // Merge to preserve user MCP servers, context and unrelated hooks.
  actions.push({
    kind: 'write',
    target: '.gemini/settings.json',
    merge: true,
    content: JSON.stringify({
      mcpServers: mcpServers(codeGraph),
      context: { fileName: ['AGENTS.md', 'GEMINI.md'] },
      hooks: { BeforeTool: [{ matcher: '^run_shell_command$', hooks: [{ name: 'yoke-rtk', type: 'command', command: 'node .gemini/hooks/gemini-rtk-hook.mjs' }] }] },
    }, null, 2) + '\n',
    reason: 'MCP servers + AGENTS.md context',
  })

  // Also ship AGENTS.md so the context.fileName entry resolves.
  actions.push({
    kind: 'write',
    target: 'AGENTS.md',
    content: baseline,
    reason: 'baseline instructions (shared)',
  })

  return actions
}
