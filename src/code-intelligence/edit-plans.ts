import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Operation, PreviewData } from './contracts.js'
import type { Snapshot } from './snapshots.js'

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

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function storeDir(root: string): string { return join(root, '.yoke', 'code-intelligence', 'plans') }
function planHashInput(plan: Pick<EditPlan, 'workspace_id' | 'snapshot_id' | 'root' | 'sandbox_root' | 'operations' | 'validation_profile' | 'changed_paths' | 'validation' | 'expires_at' | 'diff_hash' | 'sandbox_hash'>): unknown {
  return { workspace_id: plan.workspace_id, snapshot_id: plan.snapshot_id, root: plan.root, sandbox_root: plan.sandbox_root, operations: plan.operations, validation_profile: plan.validation_profile, changedPaths: plan.changed_paths, validation: plan.validation, expiresAt: plan.expires_at, diffHash: plan.diff_hash, sandboxHash: plan.sandbox_hash }
}

export function createEditPlan(root: string, snapshot: Snapshot, sandboxRoot: string, operations: Operation[], validation: 'passed' | 'failed' | 'incomplete', validationProfile: 'default' | 'extended', changedPaths: string[], diff: string, ttlMs = 30 * 60_000): EditPlan {
  const planId = `plan-${randomUUID()}`
  const diffUri = join(storeDir(root), `${planId}.diff`)
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  const diffHash = hash(diff); const sandboxHash = hash(changedPaths.map(path => [path, existsSync(join(sandboxRoot, path)) ? readFileSync(join(sandboxRoot, path)).toString('base64') : null]))
  const base = { workspace_id: snapshot.workspace_id, snapshot_id: snapshot.snapshot_id, root, sandbox_root: sandboxRoot, operations, validation_profile: validationProfile, changedPaths, validation, expiresAt, diffHash, sandboxHash }
  const planHash = hash(base)
  const plan: EditPlan = {
    plan_id: planId, plan_hash: planHash, diff_uri: diffUri, changed_paths: changedPaths, validation, approval_required: true, expires_at: expiresAt,
    workspace_id: snapshot.workspace_id, snapshot_id: snapshot.snapshot_id, root, sandbox_root: sandboxRoot, operations, validation_profile: validationProfile, created_at: new Date().toISOString(), diff_hash: diffHash, sandbox_hash: sandboxHash,
  }
  mkdirSync(storeDir(root), { recursive: true }); writeFileSync(diffUri, diff, { mode: 0o600 }); writeFileSync(join(storeDir(root), `${planId}.json`), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 })
  return plan
}

export function loadEditPlan(root: string, planId: string): EditPlan {
  const file = join(storeDir(root), `${planId}.json`)
  if (!existsSync(file)) throw new Error(`unknown edit plan: ${planId}`)
  const plan = JSON.parse(readFileSync(file, 'utf8')) as EditPlan
  if (plan.plan_hash !== hash(planHashInput(plan))) throw new Error('edit plan integrity check failed')
  return plan
}

/** This is deliberately separate from the MCP apply tool. The loop/control layer
 * calls it only after human/policy approval has been recorded. */
export function approveEditPlan(root: string, planId: string): void {
  const plan = loadEditPlan(root, planId)
  mkdirSync(storeDir(root), { recursive: true })
  writeFileSync(join(storeDir(root), `${planId}.approval.json`), JSON.stringify({ plan_id: planId, plan_hash: plan.plan_hash, approved_at: new Date().toISOString(), authority: 'yoke-control' }) + '\n', { mode: 0o600 })
}

export function readPlanApproval(root: string, plan: EditPlan): boolean {
  const file = join(storeDir(root), `${plan.plan_id}.approval.json`)
  if (!existsSync(file)) return false
  try { const approval = JSON.parse(readFileSync(file, 'utf8')) as { plan_hash?: string; authority?: string }; return approval.plan_hash === plan.plan_hash && approval.authority === 'yoke-control' } catch { return false }
}
