import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph, CodeIntelligenceMode } from '../config.js'
import { openCodeMcpServers, rtkInstruction } from '../tools.js'
import { PRESERVE_SCAFFOLD } from '../preserve.js'
import { skillPackageActions } from '../skill-actions.js'

const reviewerAgent = `---
description: Read-only Yoke reviewer for correctness and acceptance criteria
mode: primary
tools:
  edit: false
  write: false
  bash: false
---

Review the observed diff and test evidence. Do not modify files. Return only actionable findings grounded in evidence.
`

export function planOpenCode(canonDir: string, targetDir: string, codeGraph: CodeGraph = 'graphify', codeIntelligence: CodeIntelligenceMode = 'off'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const actions: Action[] = manifest.skills.flatMap(skill => skillPackageActions(canonDir, skill, 'opencode'))
  actions.push(
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: `${baseline.trimEnd()}\n\n${rtkInstruction()}\n\n${PRESERVE_SCAFFOLD}\n`,
      reason: 'baseline instructions (OpenCode reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: 'opencode.json',
      merge: true,
      content: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        instructions: ['AGENTS.md', '.yoke/context/*.md'],
        mcp: openCodeMcpServers(codeGraph, codeIntelligence, targetDir),
      }, null, 2) + '\n',
      reason: 'OpenCode instructions + MCP servers',
    },
    {
      kind: 'write',
      target: '.opencode/agents/yoke-reviewer.md',
      content: reviewerAgent,
      reason: 'OpenCode read-only reviewer agent',
    },
  )
  return actions
}
