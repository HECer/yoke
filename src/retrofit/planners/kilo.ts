import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph } from '../config.js'
import { openCodeMcpServers, rtkInstruction } from '../tools.js'
import { PRESERVE_SCAFFOLD } from '../preserve.js'
import { skillPackageActions } from '../skill-actions.js'

const reviewerAgent = `---
description: Read-only Yoke reviewer for correctness and acceptance criteria
mode: primary
permission:
  edit: deny
  write: deny
  bash: deny
---

Review the observed diff and test evidence. Do not modify files. Return only actionable findings grounded in evidence.
`

export function planKilo(canonDir: string, _targetDir: string, codeGraph: CodeGraph = 'graphify'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const actions: Action[] = manifest.skills.flatMap(skill => skillPackageActions(canonDir, skill, 'kilo'))
  actions.push(
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: `${baseline.trimEnd()}\n\n${rtkInstruction()}\n\n${PRESERVE_SCAFFOLD}\n`,
      reason: 'baseline instructions (Kilo reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: 'kilo.jsonc',
      merge: true,
      content: JSON.stringify({
        $schema: 'https://app.kilo.ai/config.json',
        instructions: ['AGENTS.md', '.yoke/context/*.md'],
        mcp: openCodeMcpServers(codeGraph),
      }, null, 2) + '\n',
      reason: 'Kilo instructions + MCP servers',
    },
    {
      kind: 'write',
      target: '.kilo/agents/yoke-reviewer.md',
      content: reviewerAgent,
      reason: 'Kilo read-only reviewer agent',
    },
  )
  return actions
}

