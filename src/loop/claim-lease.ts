import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'

export type ClaimLeaseOptions = {
  readonly now: Date
  readonly staleMs: number
  readonly isAlive: (pid: number) => boolean
  readonly filesystem?: {
    readonly beforeRecoveryRemove?: (file: string) => void
  }
}

export type ClaimOperationContext = {
  readonly now: Date
  readonly staleMs: number
  readonly isAlive: (pid: number) => boolean
}

const ClaimOperationLeaseSchema = z.object({
  schemaVersion: z.literal(1),
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  createdAt: z.string().min(1),
})

function operationPath(file: string): string {
  return `${file}.operation`
}

function recoveryPath(file: string): string {
  return `${operationPath(file)}.recovery`
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function publish(file: string, value: unknown, token: string = randomUUID()): boolean {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${token}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' })
  try {
    linkSync(temporary, file)
    return true
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  } finally {
    rmSync(temporary, { force: true })
  }
}

function readLease(file: string): z.infer<typeof ClaimOperationLeaseSchema> | null {
  if (!existsSync(file)) return null
  try {
    return ClaimOperationLeaseSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function expired(lease: z.infer<typeof ClaimOperationLeaseSchema>, options: ClaimLeaseOptions): boolean {
  const createdAt = Date.parse(lease.createdAt)
  return !options.isAlive(lease.pid) && (!Number.isFinite(createdAt) || options.now.getTime() - createdAt > options.staleMs)
}

function lease(token: string, options: ClaimLeaseOptions): z.infer<typeof ClaimOperationLeaseSchema> {
  return { schemaVersion: 1, token, pid: process.pid, createdAt: options.now.toISOString() }
}

function acquireRecovery(file: string, options: ClaimLeaseOptions): string | null {
  const token = randomUUID()
  if (publish(file, lease(token, options), token)) return token
  const observed = readLease(file)
  if (!observed || !expired(observed, options)) return null
  options.filesystem?.beforeRecoveryRemove?.(file)
  const current = readLease(file)
  if (!current || current.token !== observed.token || !expired(current, options)) return null
  rmSync(file, { force: true })
  return publish(file, lease(token, options), token) ? token : null
}

export function publishClaimFile(file: string, value: unknown): boolean {
  return publish(file, value)
}

export function replaceClaimFile(file: string, value: unknown): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' })
  renameSync(temporary, file)
}

export function acquireClaimOperation(file: string, options: ClaimLeaseOptions): string | null {
  const token = randomUUID()
  const candidate = lease(token, options)
  const operation = operationPath(file)
  if (publish(operation, candidate, token)) return token

  const observed = readLease(operation)
  if (!observed || !expired(observed, options)) return null

  const recovery = recoveryPath(file)
  const recoveryToken = acquireRecovery(recovery, options)
  if (!recoveryToken) return null
  try {
    const current = readLease(operation)
    if (!current || !expired(current, options)) return null
    rmSync(operation, { force: true })
    return publish(operation, candidate, token) ? token : null
  } finally {
    releaseClaimOperation(recovery, recoveryToken, true)
  }
}

export function releaseClaimOperation(file: string, token: string, rawPath = false): void {
  const operation = rawPath ? file : operationPath(file)
  const current = readLease(operation)
  if (current?.token === token) rmSync(operation, { force: true })
}

export function withClaimOperation<TRecord, TResult>(
  file: string,
  context: ClaimOperationContext,
  readRecords: () => readonly TRecord[],
  task: (records: readonly TRecord[]) => TResult | null,
): TResult | null {
  return withClaimOperations(file, context, readRecords, () => [], task)
}

export function withClaimOperations<TRecord, TResult>(
  file: string,
  context: ClaimLeaseOptions,
  readRecords: () => readonly TRecord[],
  claimFiles: (records: readonly TRecord[]) => readonly string[],
  task: (records: readonly TRecord[]) => TResult | null,
): TResult | null {
  const token = acquireClaimOperation(file, context)
  if (!token) return null

  const acquired: Array<{ readonly file: string; readonly token: string }> = []
  const orderedFiles = [...new Set(claimFiles(readRecords()).filter(candidate => candidate !== file))].sort((left, right) => left.localeCompare(right))
  try {
    for (const nextFile of orderedFiles) {
      const nextToken = acquireClaimOperation(nextFile, context)
      if (!nextToken) return null
      acquired.push({ file: nextFile, token: nextToken })
    }
    return task(readRecords())
  } finally {
    for (const lease of acquired.reverse()) releaseClaimOperation(lease.file, lease.token)
    releaseClaimOperation(file, token)
  }
}
