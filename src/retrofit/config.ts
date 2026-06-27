import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export type Agent = 'claude' | 'codex' | 'gemini'

const AgentSchema = z.enum(['claude', 'codex', 'gemini'])

const ForgeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({ enabled: z.boolean() }),
})

export interface ForgeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean }
}

export function defaultConfig(canonVersion: string): ForgeConfig {
  return { canonVersion, agents: [], loop: { enabled: false } }
}

export function configPath(targetDir: string): string {
  return join(targetDir, '.forge', 'config.yaml')
}

export function loadConfig(targetDir: string): ForgeConfig | null {
  const file = configPath(targetDir)
  if (!existsSync(file)) return null
  return ForgeConfigSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function saveConfig(targetDir: string, config: ForgeConfig): void {
  const file = configPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stringify(config))
}
