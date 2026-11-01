import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { acquireLock, isPidAlive, readLock, releaseLock } from '../loop/lock.js'
import { StorySchema, validateDependencies } from '../loop/prd.js'
import { readPlanningFile } from '../routing/contracts.js'
import { statePath } from '../workspace/state.js'
import { hostProjectStatePath, readHostStateFile } from '../workspace/host-state.js'
import { MAX_REQUIREMENTS_BYTES, RequirementsSchema, validateRequirements } from './requirements.js'

const files = { prd: 'prd.yaml', requirements: 'requirements.yaml', brief: 'plan.md' } as const
type Key = keyof typeof files
// Keep this lookup lazy: the PRD and requirement readers call recovery and
// therefore participate in the same module graph as this publisher.
function limitFor(key: Key): number { return key === 'requirements' ? MAX_REQUIREMENTS_BYTES : key === 'prd' ? 1_048_576 : 80_000 }
const keys = Object.keys(files) as Key[]
const SourceSchema = z.object({ prd: z.string().nullable(), requirements: z.string().nullable(), brief: z.string().nullable() }).strict()
export type PlanningState = z.infer<typeof SourceSchema>
const ChangeSchema = z.object({ id: z.string().min(1).max(120), requestDigest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
export type PlanningChange = z.infer<typeof ChangeSchema>
const JournalSchema = z.object({ version: z.literal(1), pid: z.number().int().positive(), before: SourceSchema, after: SourceSchema, beforeHash: z.string(), afterHash: z.string(), change: ChangeSchema.optional() }).strict()
const active = new Set<string>()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const planningStateDigest = (state: PlanningState): string => hash(state)
export const planningChange = (request: { id: string; request: string; createdAt: string }): PlanningChange => ({ id: request.id, requestDigest: hash({ id: request.id, request: request.request, createdAt: request.createdAt }) })
export const planningTransactionPath = (root: string, create = false): string => hostProjectStatePath(root, 'planning', ['transaction.json'], create)
const receiptPath = (root: string, change: PlanningChange, create = false) => hostProjectStatePath(root, 'planning', ['receipts', `${hash(change.id)}.json`], create)

function readState(root: string): PlanningState {
  return Object.fromEntries(keys.map(key => [key, readPlanningFile(root, `.yoke/${files[key]}`, limitFor(key)) ?? null])) as PlanningState
}

function durableFile(path: string, text: string): void {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
}

function replaceFile(path: string, text: string | null): void {
  if (text === null) { rmSync(path, { force: true }); return }
  const temporary = `${path}.${randomUUID()}.tmp`
  try { durableFile(temporary, text); renameSync(temporary, path) }
  finally { rmSync(temporary, { force: true }) }
}

/** Validate the entire future contract without reading partially published files. */
export function validatePlanningState(state: PlanningState): void {
  for (const key of keys) if (state[key] !== null && Buffer.byteLength(state[key]!) > limitFor(key)) throw Error(`Planning ${key} exceeds its file limit`)
  if (state.prd === null) throw Error('Planning transaction requires a PRD')
  const stories = z.array(StorySchema).max(2_000).parse(parse(state.prd, { maxAliasCount: 10 }))
  const issues = validateDependencies(stories)
  if (issues.length) throw Error(`Invalid PRD dependency graph: ${issues.join('; ')}`)
  if (state.requirements === null) {
    if (stories.some(story => story.requirementsFor)) throw Error('Bound PRD requires its original requirement ledger')
  } else validateRequirements(RequirementsSchema.parse(parse(state.requirements, { maxAliasCount: 10 })), stories, state.brief ?? '')
}

function assertKnownState(root: string, before: PlanningState, after: PlanningState): PlanningState {
  const current = readState(root)
  for (const key of keys) if (current[key] !== before[key] && current[key] !== after[key]) throw Error(`Planning ${key} changed outside the transaction; recovery retained for inspection`)
  return current
}

function writeState(root: string, state: PlanningState, current: PlanningState, afterWrite?: (key: Key) => void): void {
  for (const key of keys) if (state[key] !== current[key]) {
    // A publisher owns the Yoke lease, but an editor need not honor it. Recheck
    // later files after each publication rather than overwriting a stale snapshot.
    assertKnownState(root, current, state)
    replaceFile(statePath(root, files[key]), state[key])
    afterWrite?.(key)
  }
}

function receipt(root: string, change: PlanningChange | undefined, state: PlanningState): void {
  if (change) replaceFile(receiptPath(root, change, true), JSON.stringify({ version: 1, change, stateHash: hash(state) }))
}

/** A receipt authorizes commit retry only for this exact approved request and state. */
export function hasPlanningReceipt(root: string, change: PlanningChange, state: PlanningState): boolean {
  const source = readHostStateFile(receiptPath(root, change), 2_000)
  if (!source) return false
  const value = z.object({ version: z.literal(1), change: ChangeSchema, stateHash: z.string() }).strict().parse(JSON.parse(source))
  return value.change.id === change.id && value.change.requestDigest === change.requestDigest && value.stateHash === hash(state)
}

/** Finish an approved write after a crashed publisher; never overwrite unrelated edits. */
export function recoverPlanningTransaction(root: string): void {
  if (!existsSync(root)) return
  const path = planningTransactionPath(root)
  if (!existsSync(path)) return
  if (active.has(path)) throw Error('Planning transaction is being published')
  const source = readHostStateFile(path, 10_000_000)
  if (!source) return
  const journal = JournalSchema.parse(JSON.parse(source))
  if (journal.pid !== process.pid && isPidAlive(journal.pid)) throw Error('Another process is publishing the planning transaction')
  const borrowed = readLock(root)?.pid === process.pid
  const lock = borrowed ? undefined : acquireLock(root)
  if (lock && !lock.acquired) throw Error('Planning recovery requires the project lock')
  try {
    if (readHostStateFile(path, 10_000_000) !== source) throw Error('Planning recovery journal changed')
    if (hash(journal.before) !== journal.beforeHash || hash(journal.after) !== journal.afterHash) throw Error('Planning transaction source hash mismatch')
    validatePlanningState(journal.after)
    const current = assertKnownState(root, journal.before, journal.after)
    writeState(root, journal.after, current)
    receipt(root, journal.change, journal.after)
    rmSync(path)
  } finally { if (lock?.acquired) releaseLock(root, lock.ownerToken) }
}

export function readPlanningState(root: string): PlanningState {
  recoverPlanningTransaction(root)
  return readState(root)
}

export function assertPlanningState(root: string, expected: PlanningState): void {
  if (hash(readState(root)) !== hash(expected)) throw Error('PRD, requirement ledger or approved planning brief changed; refusing to overwrite concurrent edits')
}

/** Recoverable intent for process crashes; readers finish all files before parsing. */
export function publishPlanningState(root: string, before: PlanningState, after: PlanningState, options: {
  change?: PlanningChange
  /** Fault injection at the actual file-publication boundary; never used by providers. */
  afterWrite?: (key: Key) => void
} = {}): void {
  recoverPlanningTransaction(root)
  validatePlanningState(after)
  assertPlanningState(root, before)
  const path = planningTransactionPath(root, true)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  active.add(path)
  try {
    durableFile(temporary, JSON.stringify({ version: 1, pid: process.pid, before, after, beforeHash: hash(before), afterHash: hash(after), ...(options.change ? { change: options.change } : {}) }))
    // Link refuses another transaction instead of replacing its recovery record.
    linkSync(temporary, path)
    try {
      assertPlanningState(root, before)
      writeState(root, after, before, options.afterWrite)
      assertPlanningState(root, after)
      receipt(root, options.change, after)
      rmSync(path)
    } catch (error) {
      try {
        const current = assertKnownState(root, before, after)
        writeState(root, before, current)
        rmSync(path)
      } catch (rollback) {
        throw Error(`${(error as Error).message}; planning recovery retained: ${(rollback as Error).message}`)
      }
      throw error
    }
  } finally { active.delete(path); rmSync(temporary, { force: true }) }
}
