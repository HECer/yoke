import type { Story } from './prd.js'

export interface AgentContext {
  targetDir: string
  story: Story
}

export interface AgentResult {
  success: boolean
  summary: string
}

export type AgentRunner = (ctx: AgentContext) => AgentResult
