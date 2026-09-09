import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertSnapshotCurrent, type Snapshot } from './snapshots.js'
import { loadEditPlan, readPlanApproval, type EditPlan } from './edit-plans.js'

export interface TransactionResult { transaction_id: string; plan_id: string; changed_paths: string[]; worktree: string; new_snapshot_id: string; validation: EditPlan['validation']; committed: false; merged: false }
function transactionDir(root: string): string { return join(root, '.yoke', 'code-intelligence', 'transactions') }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export function applyEditPlan(root: string, plan: EditPlan, snapshot: Snapshot, idempotencyKey: string): TransactionResult {
  if (plan.expires_at <= new Date().toISOString()) throw new Error('edit plan has expired')
  if (!readPlanApproval(root, plan)) throw new Error('edit plan requires Yoke control approval')
  assertSnapshotCurrent(root, snapshot)
  if (!existsSync(plan.diff_uri) || hash(readFileSync(plan.diff_uri, 'utf8')) !== plan.diff_hash) throw new Error('edit plan diff has changed')
  const sandboxHash = hash(plan.changed_paths.map(path => [path, existsSync(join(plan.sandbox_root, path)) ? readFileSync(join(plan.sandbox_root, path)).toString('base64') : null]))
  if (sandboxHash !== plan.sandbox_hash) throw new Error('edit plan sandbox has changed')
  const dir = transactionDir(root); mkdirSync(dir, { recursive: true })
  const idem = join(dir, `${idempotencyKey}.json`)
  if (existsSync(idem)) {
    const prior = JSON.parse(readFileSync(idem, 'utf8')) as TransactionResult
    if (prior.plan_id !== plan.plan_id) throw new Error('idempotency key is bound to another plan')
    return prior
  }
  const lock = join(dir, '.write.lock')
  let handle: number | undefined
  try { handle = openSync(lock, 'wx') } catch { throw new Error('another code-intelligence transaction is active') }
  try {
    const transactionId = `tx-${randomUUID()}`
    const worktree = join(root, '.yoke', 'code-intelligence', 'worktrees', transactionId)
    mkdirSync(worktree, { recursive: true })
    for (const path of plan.changed_paths) {
      const source = join(plan.sandbox_root, path); const target = join(worktree, path)
      if (!existsSync(source)) continue
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target)
    }
    const result: TransactionResult = { transaction_id: transactionId, plan_id: plan.plan_id, changed_paths: plan.changed_paths, worktree, new_snapshot_id: snapshot.snapshot_id, validation: plan.validation, committed: false, merged: false }
    writeFileSync(idem, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    return result
  } finally {
    if (handle !== undefined) closeSync(handle)
    try { unlinkSync(lock) } catch { /* best effort */ }
  }
}
