import type { Agent } from '../retrofit/config.js'
import type {
  AgentInvocation,
  ModelSelection,
  PermissionProfile,
  ProviderTelemetry,
} from './contracts.js'

export type {
  AgentInvocation,
  ModelSelection,
  PermissionProfile,
  ProviderTelemetry,
}

export interface AgentProvider {
  agent: Agent
  invocation(prompt: string, cwd: string, permissions: PermissionProfile, model?: ModelSelection): AgentInvocation
}
