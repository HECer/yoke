import { z } from 'zod'
import type { RepairLimits } from './repair.js'

const QualityPolicySchema = z.enum(['blocking', 'advisory'])
const QualityAgentSchema = z.enum(['claude', 'codex', 'gemini'])
const RelativePathSchema = z.string().min(1).refine(value => !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) && !value.split(/[\\/]+/).includes('..'), 'path must stay within the project')

const QualityReferenceSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  kind: z.enum(['url', 'file', 'command']),
  digest: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.kind === 'file' && !RelativePathSchema.safeParse(value.source).success) context.addIssue({ code: 'custom', path: ['source'], message: 'file reference must stay within the project' })
})

const QualityCandidateSchema = z.union([
  z.object({ kind: z.enum(['screenshots', 'files']), paths: z.array(RelativePathSchema).min(1) }),
  z.object({ kind: z.enum(['command-output', 'benchmark']), command: z.string().min(1) }),
])

export const ProjectQualityDefaultsSchema = z.object({
  enabled: z.boolean().default(false),
  policy: QualityPolicySchema.default('blocking'),
  maxRounds: z.number().int().positive().default(3),
  maxMinutes: z.number().int().positive().default(60),
  consistencyChecks: z.literal(2).default(2),
  maxParallelCandidates: z.number().int().positive().default(2),
  criticAgent: QualityAgentSchema.optional(),
  criticModel: z.string().min(1).optional(),
  criticReasoningEffort: z.string().min(1).optional(),
  repairAgent: QualityAgentSchema.optional(),
  repairModel: z.string().min(1).optional(),
  repairReasoningEffort: z.string().min(1).optional(),
  critic: z.object({
    agent: QualityAgentSchema.optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
  }).optional(),
  repair: z.object({
    agent: QualityAgentSchema.optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
  }).optional(),
})

export const StoryQualityDeclarationSchema = z.object({
  reference: QualityReferenceSchema,
  candidate: QualityCandidateSchema,
  rubric: z.string().min(1),
  policy: QualityPolicySchema.optional(),
})

export type ProjectQualityDefaults = z.infer<typeof ProjectQualityDefaultsSchema>
export type StoryQualityDeclaration = z.infer<typeof StoryQualityDeclarationSchema>
export type QualityPolicy = z.infer<typeof QualityPolicySchema>

export type QualityRunOverrides = {
  readonly quality?: boolean
  readonly qualityRounds?: number
  readonly qualityMinutes?: number
  readonly qualityPolicy?: QualityPolicy
  readonly qualityUnbounded?: true
  readonly candidates?: number
}

export type ResolvedQualityPolicy = {
  readonly enabled: boolean
  readonly policy: QualityPolicy
  readonly limits: RepairLimits
}

export type QualityStatusMetadata = {
  readonly policy: QualityPolicy
  readonly referenceDigest?: string
}

export function resolveQualityPolicy(input: {
  readonly defaults?: ProjectQualityDefaults
  readonly declaration?: StoryQualityDeclaration
  readonly overrides?: QualityRunOverrides
}): ResolvedQualityPolicy {
  const overrides = input.overrides
  const unbounded = overrides?.qualityUnbounded === true
  const enabled = input.declaration !== undefined && (unbounded || (overrides?.quality ?? input.defaults?.enabled ?? false))
  const policy = overrides?.qualityPolicy ?? input.declaration?.policy ?? input.defaults?.policy ?? 'blocking'
  const maxRounds = overrides?.qualityRounds ?? input.defaults?.maxRounds ?? 3
  const maxMinutes = overrides?.qualityMinutes ?? input.defaults?.maxMinutes ?? 60
  return {
    enabled,
    policy,
    limits: unbounded ? { unbounded: true } : { maxRounds, maxMinutes },
  }
}
