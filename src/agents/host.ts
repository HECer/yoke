import type { Agent, YokeConfig } from '../retrofit/config.js'

type Environment = Record<string, string | undefined>

export function detectHostAgent(env: Environment = process.env): Agent | undefined {
  // Active-session markers outrank install/config directory hints inherited by
  // other shells. A globally set CODEX_HOME must not hijack a Claude session.
  if (env.CODEX_THREAD_ID || env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) return 'codex'
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude'
  if (env.GEMINI_CLI) return 'gemini'
  if (env.CODEX_HOME) return 'codex'
  if (env.CLAUDE_CONFIG_DIR) return 'claude'
  if (env.GEMINI_CLI_HOME) return 'gemini'
  return undefined
}

export function resolveRunnerAgent(config: YokeConfig | null, explicit?: Agent, host?: Agent): Agent {
  if (explicit) return explicit
  if (config?.runner?.agent) return config.runner.agent
  if (host && (!config || config.agents.length === 0 || config.agents.includes(host))) return host
  return config?.agents[0] ?? host ?? 'claude'
}
