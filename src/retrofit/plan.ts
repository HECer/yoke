import { planClaude } from './planners/claude.js'
import { planCodex } from './planners/codex.js'
import { planGemini } from './planners/gemini.js'
import { planQwen } from './planners/qwen.js'
import { planOpenCode } from './planners/opencode.js'
import { planKilo } from './planners/kilo.js'
import { planPi } from './planners/pi.js'
import { baseContextActions } from './context-actions.js'
import type { Agent, CodeGraph, CodeIntelligenceMode } from './config.js'

export interface Action {
  kind: 'write'
  target: string
  content: string | Uint8Array
  reason: string
  merge?: boolean
  ifAbsent?: boolean
  executable?: boolean
}

export function planClaudeRetrofit(canonDir: string, targetDir: string): Action[] {
  return planClaude(canonDir, targetDir)
}

export type AgentPlanner = (canonDir: string, targetDir: string, codeGraph: CodeGraph, codeIntelligence?: CodeIntelligenceMode) => Action[]

export const PLANNERS: Record<Agent, AgentPlanner> = {
  claude: (c, t, cg, ci) => planClaude(c, t, undefined, cg, undefined, ci),
  codex: planCodex,
  gemini: planGemini,
  qwen: planQwen,
  opencode: planOpenCode,
  kilo: planKilo,
  pi: planPi,
}

export function planRetrofit(canonDir: string, targetDir: string, agents: Agent[], codeGraph: CodeGraph = 'graphify', codeIntelligence: CodeIntelligenceMode = 'off'): Action[] {
  const seen = new Set<string>()
  const merged: Action[] = []
  for (const action of baseContextActions(canonDir)) {
    seen.add(action.target)
    merged.push(action)
  }
  for (const agent of agents) {
    for (const action of PLANNERS[agent](canonDir, targetDir, codeGraph, codeIntelligence)) {
      if (seen.has(action.target)) continue
      seen.add(action.target)
      merged.push(action)
    }
  }
  return merged
}
