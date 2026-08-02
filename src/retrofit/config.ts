import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { PermissionProfile } from '../agents/types.js'

export type Agent = 'claude' | 'codex' | 'gemini'
export type CodeGraph = 'graphify' | 'serena'
export type DecisionPolicy = 'auto' | 'critical'
export type RoutingStrategy = 'balanced' | 'cost' | 'speed' | 'quality'

const AgentSchema = z.enum(['claude', 'codex', 'gemini'])
const CodeGraphSchema = z.enum(['graphify', 'serena'])

const SmokeFlowSchema = z.object({ name: z.string().min(1), path: z.string().min(1), landmark: z.string().optional() })
const SmokeSchema = z.object({ baseUrl: z.string().min(1), flows: z.array(SmokeFlowSchema).min(1) })
const RoutingWorkerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  agent: AgentSchema,
  model: z.string().min(1).optional(),
  reasoningEffort: z.string().min(1).optional(),
  costTier: z.enum(['low', 'medium', 'high']).default('medium'),
  capabilities: z.array(z.string().min(1)).default([]),
})

export const YokeConfigSchema = z.object({
  canonVersion: z.string().min(1),
  agents: z.array(AgentSchema),
  loop: z.object({
    enabled: z.boolean(),
    timeoutMinutes: z.number().optional(),
    decisionPolicy: z.enum(['auto', 'critical']).optional(),
    // Ambiguous acceptance criteria: 'resolve' (default — agent decides and continues)
    // or 'abort' (agent stops the story via .yoke/ambiguity.md for a human decision).
    onAmbiguity: z.enum(['resolve', 'abort']).optional(),
  }),
  runner: z.object({
    agent: AgentSchema.optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
    bare: z.boolean().optional(),
    permissions: z.enum(['safe', 'unsafe', 'read-only']).optional(),
  }).optional(),
  routing: z.object({
    enabled: z.boolean(),
    strategy: z.enum(['balanced', 'cost', 'speed', 'quality']).default('balanced'),
    maxCandidates: z.number().int().min(1).max(5).default(3),
    orchestrator: z.object({
      model: z.string().min(1).optional(),
      reasoningEffort: z.string().min(1).optional(),
    }).optional(),
    workers: z.array(RoutingWorkerSchema).max(12).default([]),
  }).optional(),
  commit: z.object({
    authorName: z.string().min(1).optional(),
    authorEmail: z.string().email().optional(),
    allowCoAuthors: z.boolean().optional(),
  }).optional(),
  audit: z.object({
    enabled: z.boolean(),
    command: z.string().min(1).optional(),
    suppressionsVersion: z.literal(1).optional(),
    suppressions: z.array(z.object({ ruleId: z.string().min(1), file: z.string().min(1).optional(), reason: z.string(), expires: z.string().optional() })).optional(),
  }).optional(),
  verify: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
  // Optional performance budget gate: a benchmark command that must exit 0 for a
  // story to land (runs after verify). Benchmarks are noisy → retried like verify.
  perf: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
  codeGraph: CodeGraphSchema.optional(),
  smoke: SmokeSchema.optional(),
  // Opt-in: upgrade yoke at loop START when a newer version is cached (never mid-run).
  update: z.object({ auto: z.boolean() }).optional(),
})

export interface SmokeFlow { name: string; path: string; landmark?: string }
export interface SmokeConfig { baseUrl: string; flows: SmokeFlow[] }
export interface RoutingWorker {
  id: string
  agent: Agent
  model?: string
  reasoningEffort?: string
  costTier: 'low' | 'medium' | 'high'
  capabilities: string[]
}

export interface YokeConfig {
  canonVersion: string
  agents: Agent[]
  loop: { enabled: boolean; timeoutMinutes?: number; decisionPolicy?: DecisionPolicy; onAmbiguity?: 'resolve' | 'abort' }
  runner?: { agent?: Agent; model?: string; reasoningEffort?: string; bare?: boolean; permissions?: PermissionProfile }
  routing?: {
    enabled: boolean
    strategy: RoutingStrategy
    maxCandidates: number
    orchestrator?: { model?: string; reasoningEffort?: string }
    workers: RoutingWorker[]
  }
  commit?: { authorName?: string; authorEmail?: string; allowCoAuthors?: boolean }
  audit?: { enabled: boolean; command?: string; suppressionsVersion?: 1; suppressions?: Array<{ ruleId: string; file?: string; reason: string; expires?: string }> }
  verify?: { command: string; retries?: number }
  perf?: { command: string; retries?: number }
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
