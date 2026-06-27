import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'

export type Agent = 'claude' | 'codex' | 'gemini'

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
  return parse(readFileSync(file, 'utf8')) as ForgeConfig
}

export function saveConfig(targetDir: string, config: ForgeConfig): void {
  const file = configPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stringify(config))
}
