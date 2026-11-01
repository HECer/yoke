import type { Operation, PreviewData } from './contracts.js'
import { EDITS_UNAVAILABLE } from './contracts.js'
import type { Snapshot } from './snapshots.js'

/** Legacy receipt type; no edit plan can be created, approved or applied. */
export interface EditPlan extends PreviewData {
  workspace_id: string
  snapshot_id: string
  root: string
  sandbox_root: string
  operations: Operation[]
  validation_profile: 'default' | 'extended'
  created_at: string
  diff_hash: string
  sandbox_hash: string
}

export function createEditPlan(_root: string, _snapshot: Snapshot, _sandboxRoot: string, _operations: Operation[], _validation: 'passed' | 'failed' | 'incomplete', _validationProfile: 'default' | 'extended', _changedPaths: string[], _diff: string, _ttlMs?: number): EditPlan {
  throw new Error(EDITS_UNAVAILABLE)
}
export function loadEditPlan(_root: string, _planId: string): EditPlan { throw new Error(EDITS_UNAVAILABLE) }
export function approveEditPlan(_root: string, _planId: string): void { throw new Error(EDITS_UNAVAILABLE) }
export function readPlanApproval(_root: string, _plan: EditPlan): boolean { return false }
