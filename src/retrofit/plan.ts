import { planClaude } from './planners/claude.js'
import { planCodex } from './planners/codex.js'
import { planGemini } from './planners/gemini.js'
import type { Agent, CodeGraph } from './config.js'

export interface Action {
  kind: 'write'
  target: string
  content: string
  reason: string
  merge?: boolean
}

export function planClaudeRetrofit(canonDir: string, targetDir: string): Action[] {
  return planClaude(canonDir, targetDir)
}

export type AgentPlanner = (canonDir: string, targetDir: string, codeGraph: CodeGraph) => Action[]

export const PLANNERS: Record<Agent, AgentPlanner> = {
  claude: (c, t, cg) => planClaude(c, t, undefined, cg),
  codex: planCodex,
  gemini: planGemini,
}

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[], codeGraph: CodeGraph = 'graphify'): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
  for (const agent of agents) {
    for (const action of PLANNERS[agent](canonDir, targetDir, codeGraph)) {
      if (seen.has(action.target)) continue
      seen.add(action.target)
      merged.push(action)
    }
  }
  return merged
}
