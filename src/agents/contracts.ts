import { z } from 'zod'

export const AgentSchema = z.enum(['claude', 'codex', 'gemini'])
export const PermissionProfileSchema = z.enum(['safe', 'unsafe', 'read-only'])

export const ModelSelectionSchema = z.object({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).optional(),
  reasoningEffort: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/).optional(),
  nativeMultiAgent: z.boolean().optional(),
  bare: z.boolean().optional(),
})

export const AgentInvocationSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  input: z.string(),
  cwd: z.string().min(1),
})

const ProviderTokenUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative().optional(),
  cacheWriteInputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative(),
  reasoningOutputTokens: z.number().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  model: z.string().min(1).optional(),
})

export const ProviderTelemetrySchema = z.object({
  usageAvailable: z.boolean(),
  tokens: ProviderTokenUsageSchema.optional(),
  partialUsage: ProviderTokenUsageSchema.partial().optional(),
  reportedModels: z.array(z.string().min(1)).optional(),
}).superRefine((telemetry, ctx) => {
  if (telemetry.usageAvailable && !telemetry.tokens) {
    ctx.addIssue({ code: 'custom', path: ['tokens'], message: 'usageAvailable telemetry requires token totals' })
  }
})

const MachineRoleSchema = z.enum([
  'route',
  'review',
  'quality',
  'decomposition',
  'candidate-selection',
  'telemetry',
])

export const MachineEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  provider: AgentSchema,
  model: z.string().min(1).optional(),
  role: MachineRoleSchema,
  durationMs: z.number().int().nonnegative(),
  permissions: PermissionProfileSchema,
  usage: ProviderTokenUsageSchema.optional(),
  raw: z.record(z.unknown()).optional(),
})

export type Agent = z.infer<typeof AgentSchema>
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>
export type ModelSelection = z.infer<typeof ModelSelectionSchema>
export type AgentInvocation = z.infer<typeof AgentInvocationSchema>
export type ProviderTelemetry = z.infer<typeof ProviderTelemetrySchema>
