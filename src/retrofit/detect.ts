import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from './config.js'
import { detectUiProject, type UiDetection } from './ui-detect.js'

export interface Detection {
  agents: Agent[]
  hasAgentsMd: boolean
  hasYokeConfig: boolean
  ui: UiDetection
}

export function detectProject(targetDir: string): Detection {
  const has = (...parts: string[]) => existsSync(join(targetDir, ...parts))
  const agents: Agent[] = []
  if (has('.claude') || has('CLAUDE.md')) agents.push('claude')
  if (has('.codex') || has('AGENTS.md')) agents.push('codex')
  if (has('.gemini') || has('GEMINI.md')) agents.push('gemini')
  if (has('.qwen') || has('QWEN.md')) agents.push('qwen')
  if (has('.opencode') || has('opencode.json') || has('opencode.jsonc')) agents.push('opencode')
  if (has('.kilo') || has('kilo.json') || has('kilo.jsonc')) agents.push('kilo')
  if (has('.pi') || has('PI.md')) agents.push('pi')
  return {
    agents,
    hasAgentsMd: has('AGENTS.md'),
    hasYokeConfig: has('.yoke', 'config.yaml'),
    ui: detectUiProject(targetDir),
  }
}
