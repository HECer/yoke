import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

export const ReviewFindingSchema = z.object({
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string().min(1),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
})

export const ReviewVerdictSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
})

export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>

export function reviewVerdictPath(targetDir: string): string {
  return resolve(join(targetDir, '.yoke', 'review-verdict.json'))
}

export function readReviewVerdict(path: string): ReviewVerdict {
  if (!existsSync(path)) throw new Error(`Review verdict is missing: ${path}`)
  try {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`Review verdict is malformed JSON: ${(error as Error).message}`)
    }
    const result = ReviewVerdictSchema.safeParse(value)
    if (!result.success) throw new Error(`Review verdict is invalid: ${result.error.message}`)
    return result.data
  } finally {
    rmSync(path, { force: true })
  }
}

export function formatReviewContract(path: string): string {
  return [
    `Write your final verdict to this absolute path: ${path}`,
    'The file must contain exactly one JSON object with this contract:',
    '{"approved":boolean,"summary":"non-empty string","findings":[{"severity":"blocking|warning|info","message":"non-empty string","file":"optional path","line":1}]}',
    'Set approved=false when any blocking finding exists. Create the file even when the process also exits non-zero.',
  ].join('\n')
}
