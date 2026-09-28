import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph, CodeIntelligenceMode } from '../config.js'
import { rtkInstruction } from '../tools.js'
import { PRESERVE_SCAFFOLD } from '../preserve.js'
import { skillPackageActions } from '../skill-actions.js'

const reviewerAgent = `---
description: Read-only Yoke reviewer for correctness and acceptance criteria
mode: primary
toolsets:
  - file
---

Review the observed diff and test evidence. Do not modify files. Return only actionable findings grounded in evidence.
`

export function planHermes(canonDir: string, _targetDir: string, _codeGraph: CodeGraph = 'graphify', _codeIntelligence: CodeIntelligenceMode = 'off'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const actions: Action[] = manifest.skills.flatMap(skill => skillPackageActions(canonDir, skill, 'hermes'))
  actions.push(
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: `${baseline.trimEnd()}\n\n${rtkInstruction()}\n\n## Hermes integration\n\nHermes loads project skills from .hermes/skills and project context from AGENTS.md.\n\n${PRESERVE_SCAFFOLD}\n`,
      reason: 'baseline instructions (Hermes reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: '.hermes/agents/yoke-reviewer.md',
      content: reviewerAgent,
      reason: 'Hermes read-only reviewer agent',
    },
  )
  return actions
}
