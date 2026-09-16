import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { acquireLock, releaseLock } from '../loop/lock.js'
import { statePath } from '../workspace/state.js'
import { type BudgetLedger, type BudgetLimits, createLedger, parseLedger, reserveBudget, RESOURCE_KEYS } from './budget.js'
import { fail, integer, record } from './validation.js'

export interface LedgerSnapshot { readonly version: 1; readonly revision: number; readonly ledger: BudgetLedger }
const MAX_BYTES = 4 * 1024 * 1024
function rootPath(root: string): string {
  const canonical = realpathSync(root)
  if (!statSync(canonical).isDirectory()) fail('invalid_root', 'Project root must be a directory')
  // Validate the shared lock paths BEFORE acquireLock can write under .yoke.
  for (const name of ['loop.lock', 'loop.lock.takeover', 'loop.lock.takeover.recovery']) statePath(canonical, name)
  statePath(canonical, 'control-plane', 'budget.json')
  return canonical
}
function parseSnapshot(value: unknown): LedgerSnapshot {
  const raw = record(value, ['version', 'revision', 'ledger'], 'snapshot')
  if (raw.version !== 1) fail('unsupported_version', 'Unsupported control-plane store version')
  return { version: 1, revision: integer(raw.revision, 'revision'), ledger: parseLedger(raw.ledger) }
}
export function readLedger(root: string): LedgerSnapshot | null {
  const file = statePath(rootPath(root), 'control-plane', 'budget.json')
  if (!existsSync(file)) return null
  if (statSync(file).size > MAX_BYTES) fail('store_too_large', 'Ledger exceeds the bounded read size')
  return parseSnapshot(JSON.parse(readFileSync(file, 'utf8')))
}
function save(root: string, value: LedgerSnapshot): LedgerSnapshot {
  const snapshot = parseSnapshot(value), content = JSON.stringify(snapshot, null, 2) + '\n'
  if (Buffer.byteLength(content) > MAX_BYTES) fail('store_too_large', 'Ledger exceeds the bounded write size')
  mkdirSync(statePath(root, 'control-plane'), { recursive: true })
  const file = statePath(root, 'control-plane', 'budget.json'), temp = statePath(root, 'control-plane', `${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, content, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temp, file)
    // Atomic replacement and file fsync; directory/power-loss durability varies by FS.
    return snapshot
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }) }
}
function locked<T>(root: string, run: (canonical: string) => T): T {
  const canonical = rootPath(root), lock = acquireLock(canonical)
  if (!lock.acquired) fail('project_busy', 'The existing Yoke project lock is held; no second coordinator started')
  try { return run(canonical) } finally { releaseLock(canonical, lock.ownerToken) }
}
/** Explicit initialization only. Never resets an existing budget or edits legacy config. */
export function initializeLedger(root: string, limits: BudgetLimits): LedgerSnapshot {
  return locked(root, canonical => {
    if (readLedger(canonical)) fail('ledger_exists', 'A ledger already exists; initialization cannot erase consumption')
    return save(canonical, { version: 1, revision: 0, ledger: createLedger(limits) })
  })
}
/** Optimistic revision check inside Yoke's existing cross-process project lock. */
export function transactLedger(root: string, expectedRevision: number, update: (ledger: BudgetLedger) => BudgetLedger): LedgerSnapshot {
  integer(expectedRevision, 'expectedRevision')
  return locked(root, canonical => {
    const current = readLedger(canonical)
    if (!current) fail('ledger_missing', 'Initialize the control-plane budget explicitly')
    if (current.revision !== expectedRevision) fail('stale_revision', 'Ledger changed; re-read and recompute admission')
    if (current.revision === Number.MAX_SAFE_INTEGER) fail('revision_overflow', 'Ledger revision exhausted')
    const next = parseLedger(update(structuredClone(current.ledger)))
    if (next.limits.maxActive !== current.ledger.limits.maxActive || RESOURCE_KEYS.some(key => next.limits[key] !== current.ledger.limits[key])) fail('budget_policy_changed', 'A reservation transaction cannot change operator-approved limits')
    // Append-only reservations; settle once. A callback cannot erase charged attempts.
    for (const old of current.ledger.reservations) {
      const item = next.reservations.find(item => item.id === old.id)
      if (!item || item.taskId !== old.taskId || item.role !== old.role || RESOURCE_KEYS.some(key => item.requested[key] !== old.requested[key]) || (old.usage && (!item.usage || RESOURCE_KEYS.some(key => item.usage![key] !== old.usage![key])))) fail('history_rewrite', 'Budget history cannot be removed or rewritten')
    }
    if (current.ledger.reservations.some((item, index) => next.reservations[index]?.id !== item.id)) fail('history_rewrite', 'Recorded reservation order is immutable')
    // A durable intent must precede execution. New records cannot arrive already
    // settled, bypass admission, or silently overbook the shared budget.
    let reconciled: BudgetLedger = { ...current.ledger, reservations: next.reservations.slice(0, current.ledger.reservations.length) }
    for (const item of next.reservations.slice(current.ledger.reservations.length)) {
      if (item.usage !== null) fail('invalid_new_reservation', 'Commit a new in-flight reservation before recording settlement')
      reconciled = reserveBudget(reconciled, { id: item.id, taskId: item.taskId, role: item.role, requested: item.requested }).ledger
    }
    if (JSON.stringify(current.ledger) === JSON.stringify(next)) return current
    return save(canonical, { version: 1, revision: current.revision + 1, ledger: next })
  })
}
