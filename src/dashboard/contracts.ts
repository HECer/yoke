import { z } from 'zod'

export const DASHBOARD_LIMITS = {
  projects: 500,
  events: 100,
  historyBytes: 32 * 1024 * 1024,
  requestBytes: 16 * 1024,
  fileBytes: 1_048_576,
} as const

export const DashboardControlPayloadSchema = z.object({ action: z.literal('pause') }).strict()
export type DashboardControlPayload = z.infer<typeof DashboardControlPayloadSchema>

export const DashboardControlResponseSchema = z.object({ status: z.literal('pause-requested') })
export type DashboardControlResponse = z.infer<typeof DashboardControlResponseSchema>

export function parseDashboardLimit(value: string | null): number {
  if (value === null) return DASHBOARD_LIMITS.events
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > DASHBOARD_LIMITS.events) throw Error(`Limit must be an integer from 1 to ${DASHBOARD_LIMITS.events}`)
  return limit
}
