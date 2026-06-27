import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from './config.js'

export interface Detection {
  agents: Agent[]
  hasAgentsMd: boolean
  hasForgeConfig: boolean
}

export function detectProject(targetDir: string): Detection {
  const has = (...parts: string[]) => existsSync(join(targetDir, ...parts))
  const agents: Agent[] = []
  if (has('.claude') || has('CLAUDE.md')) agents.push('claude')
  if (has('.codex') || has('AGENTS.md')) agents.push('codex')
  if (has('.gemini') || has('GEMINI.md')) agents.push('gemini')
  return {
    agents,
    hasAgentsMd: has('AGENTS.md'),
    hasForgeConfig: has('.forge', 'config.yaml'),
  }
}
