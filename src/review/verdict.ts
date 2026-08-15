import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { AgentSchema, PermissionProfileSchema } from '../agents/contracts.js'

export const ReviewFindingSchema = z.object({
  id: z.string().min(1).optional(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string().min(1),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  actionable: z.boolean().optional(),
  suggestedFix: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)).optional(),
})

export const ReviewVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  approved: z.boolean(),
  summary: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
  provenance: z.object({
    provider: AgentSchema,
    model: z.string().min(1),
    role: z.literal('review'),
    promptVersion: z.literal(1),
    permissions: PermissionProfileSchema,
  }),
})

export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>
export type ReviewDecision = Pick<ReviewVerdict, 'approved' | 'summary' | 'findings'>

export function parseReviewVerdict(value: unknown, expected?: { readonly provider: z.infer<typeof AgentSchema>; readonly model?: string }): ReviewVerdict {
  const result = ReviewVerdictSchema.safeParse(value)
  if (!result.success) throw new Error(`Review verdict is invalid: ${result.error.message}`)
  if (expected && result.data.provenance.provider !== expected.provider) throw new Error(`Review verdict provider mismatch: expected ${expected.provider}, received ${result.data.provenance.provider}`)
  if (expected?.model && result.data.provenance.model !== expected.model) throw new Error(`Review verdict model mismatch: expected ${expected.model}, received ${result.data.provenance.model}`)
  return result.data
}

export function selectRepairFinding(verdict: ReviewDecision): ReviewDecision['findings'][number] | null {
  if (verdict.approved) return null
  return verdict.findings.find(candidate => candidate.severity === 'blocking' && (candidate.actionable ?? true)) ?? null
}

export function reviewVerdictPath(targetDir: string): string {
  return resolve(join(targetDir, '.yoke', 'review-verdict.json'))
}

export function readReviewVerdict(path: string, expected?: { readonly provider: z.infer<typeof AgentSchema>; readonly model?: string }): ReviewVerdict {
  if (!existsSync(path)) throw new Error(`Review verdict is missing: ${path}`)
  try {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`Review verdict is malformed JSON: ${(error as Error).message}`)
    }
    return parseReviewVerdict(value, expected)
  } finally {
    rmSync(path, { force: true })
  }
}

export function formatReviewStdoutContract(provider: z.infer<typeof AgentSchema>): string {
  return [
    'Return exactly one JSON object as your final response. Do not write any file.',
    `{"schemaVersion":1,"approved":boolean,"summary":"non-empty string","findings":[],"provenance":{"provider":"${provider}","model":"provider-reported model","role":"review","promptVersion":1,"permissions":"read-only"}}`,
  ].join('\n')
}

export function formatReviewContract(path: string, provider?: z.infer<typeof AgentSchema>): string {
  return [
    `Write your final verdict to this absolute path: ${path}`,
    'The file must contain exactly one JSON object with this contract:',
    `{"schemaVersion":1,"approved":boolean,"summary":"non-empty string","findings":[{"id":"optional id","severity":"blocking|warning|info","message":"non-empty string","file":"optional path","line":1,"actionable":true,"suggestedFix":"optional repair","evidence":["optional evidence reference"]}],"provenance":{"provider":"${provider ?? 'claude|codex|gemini'}","model":"provider-reported model","role":"review","promptVersion":1,"permissions":"safe"}}`,
    'Set approved=false when any blocking finding exists. Create the file even when the process also exits non-zero.',
  ].join('\n')
}
