import type { Agent } from '../retrofit/config.js'

export type PermissionProfile = 'safe' | 'unsafe' | 'read-only'

export interface AgentInvocation {
  command: string
  args: string[]
  input: string
  cwd: string
}

export interface ProviderTelemetry {
  usageAvailable: boolean
  tokens?: { inputTokens: number; outputTokens: number; model?: string }
}

export interface AgentProvider {
  agent: Agent
  invocation(prompt: string, cwd: string, permissions: PermissionProfile): AgentInvocation
}
