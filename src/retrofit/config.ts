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
  verify: z.object({ command: z.string().min(1) }).optional(),
})

export interface ForgeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean }
  verify?: { command: string }
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

// Decide which command verifies a story is done: explicit config wins; otherwise
// detect an npm test script; otherwise null (caller must refuse to run blindly).
export function resolveVerifyCommand(targetDir: string, config: ForgeConfig): string | null {
  if (config.verify?.command) return config.verify.command
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const testScript: unknown = pkg?.scripts?.test
      if (typeof testScript === 'string' && testScript.trim() !== '' && !testScript.includes('no test specified')) {
        return 'npm test'
      }
    } catch {
      // ignore malformed package.json
    }
  }
  return null
}
