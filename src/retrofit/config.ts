import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export type Agent = 'claude' | 'codex' | 'gemini'
export type CodeGraph = 'graphify' | 'serena'

const AgentSchema = z.enum(['claude', 'codex', 'gemini'])
const CodeGraphSchema = z.enum(['graphify', 'serena'])

const SmokeFlowSchema = z.object({ name: z.string().min(1), path: z.string().min(1), landmark: z.string().optional() })
const SmokeSchema = z.object({ baseUrl: z.string().min(1), flows: z.array(SmokeFlowSchema).min(1) })

export const YokeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({ enabled: z.boolean(), timeoutMinutes: z.number().optional() }),
  verify: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
  codeGraph: CodeGraphSchema.optional(),
  smoke: SmokeSchema.optional(),
  // Opt-in: upgrade yoke at loop START when a newer version is cached (never mid-run).
  update: z.object({ auto: z.boolean() }).optional(),
})

export interface SmokeFlow { name: string; path: string; landmark?: string }
export interface SmokeConfig { baseUrl: string; flows: SmokeFlow[] }

export interface YokeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean; timeoutMinutes?: number }
  verify?: { command: string; retries?: number }
  codeGraph?: CodeGraph
  smoke?: SmokeConfig
  update?: { auto: boolean }
}

export function defaultConfig(canonVersion: string): YokeConfig {
  return { canonVersion, agents: [], loop: { enabled: false } }
}

export function configPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'config.yaml')
}

export function loadConfig(targetDir: string): YokeConfig | null {
  const file = configPath(targetDir)
  if (!existsSync(file)) return null
  return YokeConfigSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function saveConfig(targetDir: string, config: YokeConfig): void {
  const file = configPath(targetDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stringify(config))
}

// Decide which command verifies a story is done: explicit config wins; otherwise
// detect an npm test script; otherwise null (caller must refuse to run blindly).
export function resolveVerifyCommand(targetDir: string, config: YokeConfig): string | null {
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
