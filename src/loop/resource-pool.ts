import { randomUUID, createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { AgentSchema } from '../agents/contracts.js'
import { processIncarnation } from '../agents/process-incarnation.js'
import { isPidAlive } from './lock.js'
import { publishClaimFile, replaceClaimFile, withClaimOperations } from './claim-lease.js'

export const MAX_PROJECT_WORKERS = 8
export const DEFAULT_GLOBAL_WORKERS = 3
const STALE_OWNER_MS = 30_000
const WAIT_POLL_MS = 200
const MAX_QUEUE_OVERTAKES = 3
const POOL_SCHEMA_VERSION = 1

const PoolRecordSchema = z.object({
  schemaVersion: z.literal(POOL_SCHEMA_VERSION),
  id: z.string().uuid(),
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  incarnation: z.string().min(1).optional(),
  project: z.string().regex(/^[a-f0-9]{16}$/u),
  storyId: z.string().min(1).max(500),
  provider: AgentSchema,
  role: z.enum(['implementation', 'integration']),
  units: z.number().int().min(1).max(MAX_PROJECT_WORKERS),
  limit: z.number().int().min(1).max(MAX_PROJECT_WORKERS).default(DEFAULT_GLOBAL_WORKERS),
  overtakes: z.number().int().nonnegative().default(0),
  state: z.enum(['waiting', 'active']),
  createdAt: z.string().datetime(),
})

type PoolRecord = z.infer<typeof PoolRecordSchema>
export type PoolRole = PoolRecord['role']

export interface PoolRequest {
  readonly targetDir: string
  readonly storyId: string
  readonly provider: PoolRecord['provider']
  readonly role: PoolRole
  readonly units?: number
  readonly signal?: AbortSignal
}

export interface PoolLease {
  readonly id: string
  readonly acquiredAt: string
  release(): Promise<boolean>
}

export interface SharedPoolStatus {
  readonly limit: number
  readonly activeUnits: number
  readonly activeWorkers: number
  readonly waitingWorkers: number
  readonly activeByRole: Readonly<Record<PoolRole, number>>
  readonly oldestWaitMs: number
}

const identities = new Map<number, { readonly checkedAt: number; readonly incarnation?: string }>()
let cachedGlobalLimit: number | undefined
const syncWaitCell = new Int32Array(new SharedArrayBuffer(4))

export function globalWorkerLimit(environment: NodeJS.ProcessEnv = process.env): number {
  if (environment === process.env && cachedGlobalLimit !== undefined) return cachedGlobalLimit
  const raw = environment.YOKE_MAX_PARALLEL_WORKERS
  if (raw === undefined || raw === '') {
    if (environment === process.env) cachedGlobalLimit = DEFAULT_GLOBAL_WORKERS
    return DEFAULT_GLOBAL_WORKERS
  }
  if (!/^\d+$/u.test(raw)) throw new Error('YOKE_MAX_PARALLEL_WORKERS must be an integer from 1 to 8')
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > MAX_PROJECT_WORKERS) {
    throw new Error('YOKE_MAX_PARALLEL_WORKERS must be an integer from 1 to 8')
  }
  if (environment === process.env) cachedGlobalLimit = value
  return value
}

function poolDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || join(homedir(), '.yoke')
  return join(resolve(base), 'Yoke', 'parallel-pool')
}

function ensurePoolDir(): string {
  const dir = poolDir()
  mkdirSync(dir, { recursive: true })
  const stat = lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Yoke shared worker-pool directory must be a real directory')
  return dir
}

function recordPath(dir: string, id: string): string {
  return join(dir, `worker-${id}.json`)
}

function readRecords(dir: string): PoolRecord[] {
  const records: PoolRecord[] = []
  const names = readdirSync(dir).filter(value => value.startsWith('worker-') && value.endsWith('.json'))
  for (const name of names) {
    if (!/^worker-[a-f0-9-]{36}\.json$/u.test(name)) throw new Error(`Invalid Yoke worker-pool record name: ${name}`)
    const file = join(dir, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error(`Invalid Yoke worker-pool record: ${name}`)
    let record: PoolRecord
    try { record = PoolRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) }
    catch { throw new Error(`Unreadable Yoke worker-pool record: ${name}; inspect ${dir} before retrying`) }
    if (name !== `worker-${record.id}.json`) throw new Error(`Yoke worker-pool record identity mismatch: ${name}`)
    records.push(record)
  }
  return records
}

function processIdentity(pid: number): string | undefined {
  const cached = identities.get(pid)
  // A process cannot change its own incarnation while it is alive. Keep the
  // local identity for the lifetime of this Yoke process so each lease does
  // not spawn another OS query (notably a slow PowerShell/CIM call on Windows).
  if (pid === process.pid && cached) return cached.incarnation
  if (cached && Date.now() - cached.checkedAt < 5_000) return cached.incarnation
  const incarnation = processIncarnation(pid)
  identities.set(pid, { checkedAt: Date.now(), incarnation })
  if (identities.size > 256) identities.delete(identities.keys().next().value!)
  return incarnation
}

function ownerAlive(record: PoolRecord): boolean {
  if (!isPidAlive(record.pid)) return false
  if (!record.incarnation) return true
  const current = processIdentity(record.pid)
  // Unknown identity blocks admission. Reclaiming on uncertainty could exceed the cap.
  return current === undefined || current === record.incarnation
}

function staleDead(record: PoolRecord, now: number): boolean {
  if (ownerAlive(record)) return false
  const created = Date.parse(record.createdAt)
  return !Number.isFinite(created) || now - created > STALE_OWNER_MS
}

function withPoolLock<T>(operation: (records: PoolRecord[], dir: string) => T | null): T | null {
  const dir = ensurePoolDir()
  const lockFile = join(dir, 'pool')
  return withClaimOperations(
    lockFile,
    { now: new Date(), staleMs: STALE_OWNER_MS, isAlive: isPidAlive },
    () => readRecords(dir),
    () => [],
    records => {
      const now = Date.now()
      const live: PoolRecord[] = []
      for (const record of records) {
        if (staleDead(record, now)) rmSync(recordPath(dir, record.id), { force: true })
        else live.push(record)
      }
      return operation(live, dir)
    },
  )
}

function projectKey(targetDir: string): string {
  return createHash('sha256').update(`${process.platform}\0${resolve(targetDir)}`).digest('hex').slice(0, 16)
}

function abortReason(signal: AbortSignal): string {
  return typeof signal.reason === 'string' && signal.reason.length > 0 ? signal.reason : 'worker cancelled while waiting for shared capacity'
}

function waitForCapacity(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error(abortReason(signal)))
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolveWait()
    }, WAIT_POLL_MS)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error(signal ? abortReason(signal) : 'worker cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function waitForCapacitySync(): void {
  Atomics.wait(syncWaitCell, 0, 0, WAIT_POLL_MS)
}

function capacityWinner(records: readonly PoolRecord[], limit: number, now: Date): PoolRecord | undefined {
  const active = records.filter(record => record.state === 'active')
  const waiting = records.filter(record => record.state === 'waiting').sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
  const used = active.reduce((total, record) => total + record.units, 0)
  const head = waiting[0]
  if (!head || head.createdAt > now.toISOString()) return undefined
  if (used + head.units <= limit) return head
  if (head.overtakes >= MAX_QUEUE_OVERTAKES) return undefined
  return waiting.find(record => used + record.units <= limit && record.createdAt <= now.toISOString())
}

function effectiveLimit(records: readonly PoolRecord[], localLimit: number): number {
  return records.reduce((limit, record) => Math.min(limit, record.limit), localLimit)
}

function replaceRecord(dir: string, record: PoolRecord): void {
  replaceClaimFile(recordPath(dir, record.id), record)
}

function writeRecord(dir: string, record: PoolRecord): void {
  if (!publishClaimFile(recordPath(dir, record.id), record)) throw new Error('Could not publish a unique Yoke worker-pool reservation')
}

export async function acquireSharedWorker(request: PoolRequest): Promise<PoolLease> {
  const units = request.units ?? 1
  const limit = globalWorkerLimit()
  if (!Number.isInteger(units) || units < 1 || units > MAX_PROJECT_WORKERS) throw new Error(`Worker reservation units must be an integer from 1 to ${MAX_PROJECT_WORKERS}`)
  if (units > limit) throw new Error(`This task needs ${units} parallel worker units but the shared Yoke limit is ${limit}; raise YOKE_MAX_PARALLEL_WORKERS (maximum ${MAX_PROJECT_WORKERS}) or lower --candidates`)
  if (request.signal?.aborted) throw new Error(abortReason(request.signal))

  const id = randomUUID(), token = randomUUID(), createdAt = new Date().toISOString()
  const incarnation = processIdentity(process.pid)
  const waiting: PoolRecord = {
    schemaVersion: POOL_SCHEMA_VERSION,
    id,
    token,
    pid: process.pid,
    ...(incarnation ? { incarnation } : {}),
    project: projectKey(request.targetDir),
    storyId: createHash('sha256').update(request.storyId).digest('hex').slice(0, 16),
    provider: request.provider,
    role: request.role,
    units,
    limit,
    overtakes: 0,
    state: 'waiting',
    createdAt,
  }
  let published = false
  while (!published) {
    if (request.signal?.aborted) throw new Error(abortReason(request.signal))
    const result = withPoolLock((_records, dir) => { writeRecord(dir, waiting); return true })
    if (result === true) published = true
    else await waitForCapacity(request.signal)
  }

  try {
    for (;;) {
      if (request.signal?.aborted) throw new Error(abortReason(request.signal))
      const granted = withPoolLock((records, dir) => {
        const own = records.find(record => record.id === id && record.token === token)
        if (!own) throw new Error('Yoke worker-pool reservation disappeared while waiting; no worker was started')
        if (own.state === 'active') return true
        const winner = capacityWinner(records, effectiveLimit(records, limit), new Date())
        if (winner?.id !== id) return false
        const head = records.filter(record => record.state === 'waiting').sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
        if (head && head.id !== id) replaceRecord(dir, { ...head, overtakes: head.overtakes + 1 })
        replaceRecord(dir, { ...own, state: 'active' })
        return true
      })
      if (granted === true) {
        const acquiredAt = new Date().toISOString()
        let released = false
        return {
          id,
          acquiredAt,
          async release(): Promise<boolean> {
            if (released) return false
            for (;;) {
              const result = withPoolLock((records, dir) => {
                const own = records.find(record => record.id === id && record.token === token)
                if (!own) return false
                rmSync(recordPath(dir, id), { force: true })
                return true
              })
              if (result !== null) {
                released = true
                return result
              }
              await waitForCapacity()
            }
          },
        }
      }
      await waitForCapacity(request.signal)
    }
  } catch (error) {
    for (;;) {
      const removed = withPoolLock((records, dir) => {
        const own = records.find(record => record.id === id && record.token === token)
        if (own) rmSync(recordPath(dir, id), { force: true })
        return true
      })
      if (removed !== null) break
      await waitForCapacity()
    }
    throw error
  }
}

/** Synchronous companion for the legacy serial loop, whose runner contract is synchronous. */
export function withSharedWorkerSync<T>(request: Omit<PoolRequest, 'signal' | 'units'> & { readonly onWait?: (waitMs: number) => void }, operation: () => T): T {
  const units = 1
  const limit = globalWorkerLimit()
  const requestedAt = Date.now()
  const id = randomUUID(), token = randomUUID(), createdAt = new Date().toISOString()
  const incarnation = processIdentity(process.pid)
  const waiting: PoolRecord = {
    schemaVersion: POOL_SCHEMA_VERSION,
    id,
    token,
    pid: process.pid,
    ...(incarnation ? { incarnation } : {}),
    project: projectKey(request.targetDir),
    storyId: createHash('sha256').update(request.storyId).digest('hex').slice(0, 16),
    provider: request.provider,
    role: request.role,
    units,
    limit,
    overtakes: 0,
    state: 'waiting',
    createdAt,
  }
  for (;;) {
    const published = withPoolLock((_records, dir) => { writeRecord(dir, waiting); return true })
    if (published === true) break
    waitForCapacitySync()
  }
  try {
    for (;;) {
      const granted = withPoolLock((records, dir) => {
        const own = records.find(record => record.id === id && record.token === token)
        if (!own) throw new Error('Yoke worker-pool reservation disappeared while waiting; no worker was started')
        const winner = capacityWinner(records, effectiveLimit(records, limit), new Date())
        if (winner?.id !== id) return false
        const head = records.filter(record => record.state === 'waiting').sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
        if (head && head.id !== id) replaceRecord(dir, { ...head, overtakes: head.overtakes + 1 })
        replaceRecord(dir, { ...own, state: 'active' })
        return true
      })
      if (granted === true) {
        request.onWait?.(Date.now() - requestedAt)
        return operation()
      }
      waitForCapacitySync()
    }
  } finally {
    for (;;) {
      const removed = withPoolLock((records, dir) => {
        const own = records.find(record => record.id === id && record.token === token)
        if (own) rmSync(recordPath(dir, id), { force: true })
        return true
      })
      if (removed !== null) break
      waitForCapacitySync()
    }
  }
}

export function sharedPoolStatus(): SharedPoolStatus {
  const limit = globalWorkerLimit()
  const snapshot = withPoolLock(records => records.map(record => ({ ...record })))
  const records = snapshot ?? readRecords(ensurePoolDir()).filter(record => !staleDead(record, Date.now()))
  const sharedLimit = effectiveLimit(records, limit)
  const active = records.filter(record => record.state === 'active')
  const waiting = records.filter(record => record.state === 'waiting')
  const activeByRole = { implementation: 0, integration: 0 }
  for (const record of active) activeByRole[record.role] += record.units
  const oldest = waiting.reduce((min, record) => Math.min(min, Date.parse(record.createdAt)), Number.POSITIVE_INFINITY)
  return {
    limit: sharedLimit,
    activeUnits: active.reduce((total, record) => total + record.units, 0),
    activeWorkers: active.length,
    waitingWorkers: waiting.length,
    activeByRole,
    oldestWaitMs: Number.isFinite(oldest) ? Math.max(0, Date.now() - oldest) : 0,
  }
}
