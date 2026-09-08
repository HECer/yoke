import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../../canon/manifest.js'
import type { Action } from '../plan.js'
import type { CodeGraph, CodeIntelligenceMode } from '../config.js'
import { rtkInstruction } from '../tools.js'
import { PRESERVE_SCAFFOLD } from '../preserve.js'
import { skillPackageActions } from '../skill-actions.js'

export function planPi(canonDir: string, _targetDir: string, _codeGraph: CodeGraph = 'graphify', _codeIntelligence: CodeIntelligenceMode = 'off'): Action[] {
  const manifest = loadManifest(join(canonDir, 'manifest.yaml'))
  const baseline = readFileSync(join(canonDir, 'AGENTS.md'), 'utf8')
  const actions: Action[] = manifest.skills.flatMap(skill => skillPackageActions(canonDir, skill, 'pi'))
  actions.push(
    {
      kind: 'write',
      target: 'AGENTS.md',
      content: `${baseline.trimEnd()}\n\n${rtkInstruction()}\n\n## Pi integration\n\nPi has no MCP or native sub-agent layer; use the installed Yoke skills and the explicit Yoke loop for orchestration.\n\n${PRESERVE_SCAFFOLD}\n`,
      reason: 'baseline instructions (Pi reads AGENTS.md natively)',
    },
    {
      kind: 'write',
      target: '.pi/settings.json',
      merge: true,
      content: JSON.stringify({ skills: ['.pi/skills'] }, null, 2) + '\n',
      reason: 'Pi project skill discovery',
    },
  )
  return actions
}
