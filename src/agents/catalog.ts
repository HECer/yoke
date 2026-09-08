import { AgentSchema } from './contracts.js'
import type { Agent } from './contracts.js'

/** Single source of truth for CLI help, setup prompts, and default resolution. */
export const SUPPORTED_AGENTS: readonly Agent[] = AgentSchema.options

export const AGENT_LIST = SUPPORTED_AGENTS.join(',')

export function isSupportedAgent(value: string): value is Agent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(value)
}
