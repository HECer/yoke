import type { Agent } from '../retrofit/config.js'

export type PermissionProfile = 'safe' | 'unsafe' | 'read-only'

export interface ModelSelection {
  model?: string
  reasoningEffort?: string
  /** Prevent provider-native subagents when Yoke owns the routing decision. */
  nativeMultiAgent?: boolean
  /** Ignore personal plugins/MCP/config for reproducible or isolated runs. */
  bare?: boolean
}

export interface AgentInvocation {
  command: string
  args: string[]
  input: string
  cwd: string
}

export interface ProviderTelemetry {
  usageAvailable: boolean
  tokens?: {
    inputTokens: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
    outputTokens: number
    reasoningOutputTokens?: number
    totalCostUsd?: number
    model?: string
  }
}

export interface AgentProvider {
  agent: Agent
  invocation(prompt: string, cwd: string, permissions: PermissionProfile, model?: ModelSelection): AgentInvocation
}
