import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { isPidAlive } from './lock.js'
import { publishClaimFile, replaceClaimFile, withClaimOperations } from './claim-lease.js'
import type { Agent } from '../retrofit/config.js'
import { storyPathSegment } from './prd.js'

export const CLAIM_SCHEMA_VERSION = 2

export type ClaimRole = 'implementation' | 'quality' | 'repair' | 'review'

export type ClaimCancellation = {
  readonly requestedAt: string
  readonly reason: string
}

export type LegacyStoryClaim = {
  readonly storyId: string
  readonly owner: string
  readonly pid: number
  readonly claimedAt: string
}

export type RichStoryClaim = LegacyStoryClaim & {
  readonly schemaVersion: typeof CLAIM_SCHEMA_VERSION
  readonly dispatcherId: string
  readonly ownerToken: string
  readonly heartbeatAt: string
  readonly baseCommit?: string
  readonly worktree?: string
  readonly provider?: Agent
  readonly model?: string
  readonly role?: ClaimRole
  readonly cancellation?: ClaimCancellation
}

export type StoryClaim = LegacyStoryClaim | RichStoryClaim

export type ClaimAcquireOptions = {
  readonly now?: Date
  readonly staleMs?: number
  readonly pid?: number
  readonly isAlive?: (pid: number) => boolean
  readonly dispatcherId?: string
  readonly ownerToken?: string
  readonly baseCommit?: string
  readonly worktree?: string
  readonly provider?: Agent
  readonly model?: string
  readonly role?: ClaimRole
}

export type ClaimUpdateOptions = {
  readonly now?: Date
  readonly staleMs?: number
  readonly isAlive?: (pid: number) => boolean
}

const LegacyClaimSchema = z.object({
  storyId: z.string().min(1),
  owner: z.string().min(1),
  pid: z.number().int().positive(),
  claimedAt: z.string().min(1),
})

const RichClaimSchema = LegacyClaimSchema.extend({
  schemaVersion: z.literal(CLAIM_SCHEMA_VERSION),
  dispatcherId: z.string().min(1),
  ownerToken: z.string().min(1),
  heartbeatAt: z.string().min(1),
  baseCommit: z.string().min(1).optional(),
  worktree: z.string().min(1).optional(),
  provider: z.enum(['claude', 'codex', 'gemini']).optional(),
  model: z.string().min(1).optional(),
  role: z.enum(['implementation', 'quality', 'repair', 'review']).optional(),
  cancellation: z.object({
    requestedAt: z.string().min(1),
    reason: z.string().min(1),
  }).optional(),
})

const StoredClaimSchema = z.union([RichClaimSchema, LegacyClaimSchema])

function claimsDir(dir: string): string {
  return join(dir, '.yoke', 'claims')
}

function pathFor(dir: string, id: string): string {
  return join(claimsDir(dir), `${storyPathSegment(id)}.json`)
}

function claimOwner(claim: StoryClaim): string {
  return 'ownerToken' in claim ? claim.ownerToken : claim.owner
}

function readClaimFile(file: string): StoryClaim | null {
  if (!existsSync(file)) return null
  try {
    return StoredClaimSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

type ClaimRecord = { readonly path: string; readonly claim: StoryClaim }

function claimRecords(dir: string, storyId: string): ClaimRecord[] {
  const canonicalPath = pathFor(dir, storyId)
  const records: ClaimRecord[] = []
  const canonicalClaim = readClaimFile(canonicalPath)
  if (canonicalClaim?.storyId === storyId) records.push({ path: canonicalPath, claim: canonicalClaim })
  if (!existsSync(claimsDir(dir))) return records
  for (const file of readdirSync(claimsDir(dir))) {
    const path = join(claimsDir(dir), file)
    if (path === canonicalPath) continue
    const claim = readClaimFile(path)
    if (claim?.storyId === storyId) records.push({ path, claim })
  }
  return records
}

function resolveClaimRecord(dir: string, storyId: string): ClaimRecord | null {
  return claimRecords(dir, storyId)[0] ?? null
}

function matchingClaimRecords(records: readonly ClaimRecord[], ownerToken: string): ClaimRecord[] {
  return records.filter(record => claimOwner(record.claim) === ownerToken)
}

export function readClaim(dir: string, storyId: string): StoryClaim | null {
  return resolveClaimRecord(dir, storyId)?.claim ?? null
}

function isExpired(claim: StoryClaim, now: Date, staleMs: number, isAlive: (pid: number) => boolean): boolean {
  const heartbeatAt = 'heartbeatAt' in claim ? claim.heartbeatAt : claim.claimedAt
  const heartbeatMs = Date.parse(heartbeatAt)
  return !isAlive(claim.pid) && (!Number.isFinite(heartbeatMs) || now.getTime() - heartbeatMs > staleMs)
}

function richClaim(storyId: string, owner: string, options: ClaimAcquireOptions): RichStoryClaim {
  const now = options.now ?? new Date()
  const ownerToken = options.ownerToken ?? owner
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    storyId,
    owner: ownerToken,
    ownerToken,
    dispatcherId: options.dispatcherId ?? owner,
    pid: options.pid ?? process.pid,
    claimedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    ...(options.baseCommit ? { baseCommit: options.baseCommit } : {}),
    ...(options.worktree ? { worktree: options.worktree } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.role ? { role: options.role } : {}),
  }
}

function promoteClaim(claim: StoryClaim, now: Date): RichStoryClaim {
  if ('schemaVersion' in claim) return claim
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    storyId: claim.storyId,
    owner: claim.owner,
    ownerToken: claim.owner,
    dispatcherId: claim.owner,
    pid: claim.pid,
    claimedAt: claim.claimedAt,
    heartbeatAt: now.toISOString(),
  }
}

export function acquireClaim(dir: string, storyId: string, owner: string, options: ClaimAcquireOptions = {}): RichStoryClaim | null {
  const candidate = richClaim(storyId, owner, options)
  const now = options.now ?? new Date()
  const staleMs = options.staleMs ?? 30 * 60_000
  const isAlive = options.isAlive ?? isPidAlive
  const file = resolveClaimRecord(dir, storyId)?.path ?? pathFor(dir, storyId)
  return withClaimOperations(file, { now, staleMs, isAlive }, () => claimRecords(dir, storyId), records => records.map(record => record.path), records => {
    if (records.some(record => !isExpired(record.claim, now, staleMs, isAlive))) return null
    for (const record of records) rmSync(record.path, { force: true })
    return publishClaimFile(pathFor(dir, storyId), candidate) ? candidate : null
  })
}

export function heartbeatClaim(dir: string, storyId: string, ownerToken: string, options: ClaimUpdateOptions = {}): RichStoryClaim | null {
  const now = options.now ?? new Date()
  const staleMs = options.staleMs ?? 30 * 60_000
  const isAlive = options.isAlive ?? isPidAlive
  const file = resolveClaimRecord(dir, storyId)?.path ?? pathFor(dir, storyId)
  return withClaimOperations(file, { now, staleMs, isAlive }, () => claimRecords(dir, storyId), records => records.map(record => record.path), records => {
    const record = records.find(candidate => claimOwner(candidate.claim) === ownerToken)
    if (!record) return null
    const updated = { ...promoteClaim(record.claim, now), heartbeatAt: now.toISOString() }
    for (const matchingRecord of matchingClaimRecords(records, ownerToken)) replaceClaimFile(matchingRecord.path, updated)
    return updated
  })
}

export function requestClaimCancellation(dir: string, storyId: string, ownerToken: string, reason: string, options: ClaimUpdateOptions = {}): RichStoryClaim | null {
  const now = options.now ?? new Date()
  const staleMs = options.staleMs ?? 30 * 60_000
  const isAlive = options.isAlive ?? isPidAlive
  const file = resolveClaimRecord(dir, storyId)?.path ?? pathFor(dir, storyId)
  return withClaimOperations(file, { now, staleMs, isAlive }, () => claimRecords(dir, storyId), records => records.map(record => record.path), records => {
    const record = records.find(candidate => claimOwner(candidate.claim) === ownerToken)
    if (!record) return null
    const updated = {
      ...promoteClaim(record.claim, now),
      cancellation: { reason, requestedAt: now.toISOString() },
    }
    for (const matchingRecord of matchingClaimRecords(records, ownerToken)) replaceClaimFile(matchingRecord.path, updated)
    return updated
  })
}

export function releaseClaim(dir: string, storyId: string, ownerToken: string, options: ClaimUpdateOptions = {}): boolean {
  const now = options.now ?? new Date()
  const staleMs = options.staleMs ?? 30 * 60_000
  const isAlive = options.isAlive ?? isPidAlive
  const file = resolveClaimRecord(dir, storyId)?.path ?? pathFor(dir, storyId)
  return withClaimOperations(file, { now, staleMs, isAlive }, () => claimRecords(dir, storyId), records => records.map(record => record.path), records => {
    const matchingRecords = matchingClaimRecords(records, ownerToken)
    if (!matchingRecords.length) return false
    for (const record of matchingRecords) rmSync(record.path, { force: true })
    return true
  }) ?? false
}

export function cleanupClaims(dir: string, ownerToken?: string): number {
  const dirPath = claimsDir(dir)
  let removed = 0
  try {
    for (const file of readdirSync(dirPath)) {
      const path = join(dirPath, file)
      const claim = readClaimFile(path)
      if (!claim) continue
      if (!ownerToken || claimOwner(claim) === ownerToken) {
        rmSync(path, { force: true })
        removed += 1
      }
    }
  } catch {
    return removed
  }
  return removed
}
