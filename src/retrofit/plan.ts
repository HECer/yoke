import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../canon/manifest.js'

export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
}

const CLAUDE_MD = `# Project Instructions

This project uses the Forge harness. Baseline instructions:

@AGENTS.md
`

export function planClaudeRetrofit(canonDir: string, _targetDir: string): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const actions: Action[] = []

  for (const skill of manifest.skills) {
    const content = readFileSync(join(canonDir, skill.path, 'SKILL.md'), 'utf8')
    actions.push({
      kind: 'write',
      target: `.claude/skills/${skill.id}/SKILL.md`,
      content,
      reason: `skill: ${skill.id}`,
    })
  }

  actions.push({
    kind: 'write',
    target: 'AGENTS.md',
    content: readFileSync(join(canonDir, 'AGENTS.md'), 'utf8'),
    reason: 'baseline instructions',
  })

  actions.push({
    kind: 'write',
    target: 'CLAUDE.md',
    content: CLAUDE_MD,
    reason: 'Claude entry importing AGENTS.md',
  })

  return actions
}
