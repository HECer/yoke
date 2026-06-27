import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from '../canon/manifest.js'
import { planClaude } from './planners/claude.js'
import { planCodex } from './planners/codex.js'
import { planGemini } from './planners/gemini.js'
import type { Agent } from './config.js'

export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
}

export function planClaudeRetrofit(canonDir: string, targetDir: string): Action[] {
  return planClaude(canonDir, targetDir)
}

export type AgentPlanner = (canonDir: string, targetDir: string) => Action[]

export const PLANNERS: Record<Agent, AgentPlanner> = {
  claude: planClaude,
  codex: planCodex,
  gemini: planGemini,
}

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[]): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
  for (const agent of agents) {
    for (const action of PLANNERS[agent](canonDir, targetDir)) {
      if (seen.has(action.target)) continue
      seen.add(action.target)
      merged.push(action)
    }
  }
  return merged
}
