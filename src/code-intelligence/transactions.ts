import { EDITS_UNAVAILABLE } from './contracts.js'
import type { Snapshot } from './snapshots.js'
import type { EditPlan } from './edit-plans.js'

export interface TransactionResult { transaction_id: string; plan_id: string; changed_paths: string[]; worktree: string; new_snapshot_id: string; validation: EditPlan['validation']; committed: false; merged: false }

/** Retained only to fail closed for direct legacy callers. Host integration is required. */
export function applyEditPlan(_root: string, _plan: EditPlan, _snapshot: Snapshot, _idempotencyKey: string): TransactionResult {
  throw new Error(EDITS_UNAVAILABLE)
}
