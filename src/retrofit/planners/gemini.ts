import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import { parseFrontmatter } from '../../canon/frontmatter.js'
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { mcpServers, rtkInstruction } from '../tools.js'

function tomlString(s: string): string {
  return '"""\n' + s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"') + '\n"""'
}

export function planGemini(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  // GEMINI.md: baseline + rtk instruction (Gemini has no rewrite hook).
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  actions.push({
    kind: 'write',
    target: 'GEMINI.md',
    content: `${baseline}\n${rtkInstruction()}\n`,
    reason: 'baseline + rtk instruction (no hook on Gemini)',
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
  }

  // settings.json: MCP servers + read AGENTS.md as context.
  actions.push({
    kind: 'write',
    target: '.gemini/settings.json',
    content: JSON.stringify({
      mcpServers: mcpServers(codeGraph),
      context: { fileName: ['AGENTS.md', 'GEMINI.md'] },
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
