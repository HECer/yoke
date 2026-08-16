import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { AgentSchema, PermissionProfileSchema } from '../agents/contracts.js'
import type { PermissionProfile } from '../agents/types.js'
import { ProjectQualityDefaultsSchema } from '../quality/types.js'
import { DEFAULT_OUTPUT_POLICY, type OutputPolicy } from '../output/types.js'

export type Agent = z.infer<typeof AgentSchema>
export type CodeGraph = 'graphify' | 'serena'
export type DecisionPolicy = 'auto' | 'critical'
export type RoutingStrategy = 'balanced' | 'cost' | 'speed' | 'quality'

const CodeGraphSchema = z.enum(['graphify', 'serena'])

const SmokeFlowSchema = z.object({ name: z.string().min(1), path: z.string().min(1), landmark: z.string().optional() })
const SmokeSchema = z.object({ baseUrl: z.string().min(1), flows: z.array(SmokeFlowSchema).min(1) })
const OutputPolicySchema = z.object({
  previewBytes: z.number().int().positive().optional(),
  artifactThresholdBytes: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  const previewBytes = value.previewBytes ?? DEFAULT_OUTPUT_POLICY.previewBytes
  const artifactThresholdBytes = value.artifactThresholdBytes ?? DEFAULT_OUTPUT_POLICY.artifactThresholdBytes
  if (artifactThresholdBytes < previewBytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifactThresholdBytes'],
      message: 'artifactThresholdBytes must be greater than or equal to previewBytes',
    })
  }
})
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
    permissions: PermissionProfileSchema.optional(),
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
  verify: z.object({
    command: z.string().min(1).optional(),
    retries: z.number().int().nonnegative().optional(),
    requireCriteria: z.boolean().optional(),
  }).optional(),
  // Runs only when no open stories remain. This proves the current integrated
  // system, without introducing release objects or a persistent stale graph.
  completion: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
  // Optional performance budget gate: a benchmark command that must exit 0 for a
  // story to land (runs after verify). Benchmarks are noisy → retried like verify.
  perf: z.object({ command: z.string().min(1), retries: z.number().int().nonnegative().optional() }).optional(),
  codeGraph: CodeGraphSchema.optional(),
  smoke: SmokeSchema.optional(),
  quality: ProjectQualityDefaultsSchema.optional(),
  output: OutputPolicySchema.optional(),
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
  verify?: { command?: string; retries?: number; requireCriteria?: boolean }
  completion?: { command: string; retries?: number }
  perf?: { command: string; retries?: number }
  codeGraph?: CodeGraph
  smoke?: SmokeConfig
  quality?: import('../quality/types.js').ProjectQualityDefaults
  output?: Partial<OutputPolicy>
  update?: { auto: boolean }
}

export function defaultConfig(canonVersion: string): YokeConfig {
  return { canonVersion, agents: [], loop: { enabled: false }, verify: { requireCriteria: true } }
}

export function resolveOutputPolicy(config: YokeConfig): OutputPolicy {
  return {
    previewBytes: config.output?.previewBytes ?? DEFAULT_OUTPUT_POLICY.previewBytes,
    artifactThresholdBytes: config.output?.artifactThresholdBytes ?? DEFAULT_OUTPUT_POLICY.artifactThresholdBytes,
  }
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
