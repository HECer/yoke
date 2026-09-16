import { digest, fail, identifier, integer, list, oneOf, record } from './validation.js'

export const WORKSPACE_MODES = ['auto', 'shared-read', 'shared-single-writer', 'isolated-worktrees'] as const
export type WorkspaceMode = typeof WORKSPACE_MODES[number]
const GUARANTEES = ['readOnlyEnforcement', 'exclusiveWriter', 'stableSnapshot', 'isolatedWorktrees'] as const
const SUPPORT = ['supported', 'unsupported', 'unknown'] as const
export type WorkspaceGuarantees = Readonly<Record<typeof GUARANTEES[number], typeof SUPPORT[number]>>
export interface WorkspaceParticipant {
  readonly id: string
  readonly purpose: 'inspect' | 'implement' | 'verify'
  /** Effective tool/runtime effects, not a claim inferred from the role name. */
  readonly effects: 'read-only' | 'workspace-write' | 'unknown'
  readonly consistency: 'live' | 'snapshot'
}
export interface WorkspacePlanInput {
  readonly version: 1
  readonly mode: WorkspaceMode
  readonly baseSnapshot: string
  readonly inventory: 'complete' | 'unknown'
  readonly externalWriters: number
  readonly guarantees: WorkspaceGuarantees
  readonly participants: readonly WorkspaceParticipant[]
}
export interface WorkspaceStage {
  readonly phase: 'base-analysis' | 'implementation' | 'integration' | 'verification'
  readonly topology: 'frozen-shared-read' | 'shared-single-writer' | 'worktree-per-writer' | 'serial-integration' | 'disposable-per-verifier'
  readonly participants: readonly string[]
  readonly observers: readonly string[]
  readonly snapshot: 'base' | 'mutable-candidate' | 'fresh-integrated'
  readonly guards: readonly string[]
}
export interface WorkspacePlan {
  readonly version: 1
  readonly preview: true
  readonly effects: 'none'
  readonly dispatchAuthorized: false
  readonly status: 'planned' | 'blocked'
  readonly requestedMode: WorkspaceMode
  readonly mode: Exclude<WorkspaceMode, 'auto'> | null
  readonly baseSnapshot: string
  readonly reasons: readonly string[]
  readonly warnings: readonly string[]
  readonly stages: readonly WorkspaceStage[]
}

export function parseWorkspacePlan(value: unknown): WorkspacePlanInput {
  const raw = record(value, ['version', 'mode', 'baseSnapshot', 'inventory', 'externalWriters', 'guarantees', 'participants'], 'workspace plan')
  if (raw.version !== 1) fail('unsupported_version', 'Unsupported workspace plan version')
  const supplied = record(raw.guarantees, GUARANTEES, 'workspace guarantees')
  const guarantees = Object.fromEntries(GUARANTEES.map(key => [key, oneOf(supplied[key], SUPPORT, key)])) as Record<typeof GUARANTEES[number], typeof SUPPORT[number]>
  const participants = list(raw.participants, 'participants', 100).map(value => {
    const member = record(value, ['id', 'purpose', 'effects', 'consistency'], 'participant')
    return {
      id: identifier(member.id, 'participant.id'),
      purpose: oneOf(member.purpose, ['inspect', 'implement', 'verify'], 'purpose'),
      effects: oneOf(member.effects, ['read-only', 'workspace-write', 'unknown'], 'effects'),
      consistency: oneOf(member.consistency, ['live', 'snapshot'], 'consistency'),
    }
  })
  if (!participants.length) fail('empty_participants', 'At least one participant is required')
  if (new Set(participants.map(member => member.id)).size !== participants.length) fail('duplicate_id', 'Duplicate workspace participant id')
  return {
    version: 1,
    mode: oneOf(raw.mode, WORKSPACE_MODES, 'mode'),
    baseSnapshot: digest(raw.baseSnapshot, 'baseSnapshot'),
    inventory: oneOf(raw.inventory, ['complete', 'unknown'], 'inventory'),
    externalWriters: integer(raw.externalWriters, 'externalWriters'),
    guarantees,
    participants,
  }
}

/**
 * Topology advice only, using a supplied inventory/capability snapshot. This does not
 * probe a host, enforce permissions, reserve resources, run tests or grant acceptance.
 * An executor must revalidate at admission AND maintain the guards during execution.
 * Unknown filesystem/network/database effects must be represented as `unknown`.
 */
export function planWorkspace(value: unknown): WorkspacePlan {
  const input = parseWorkspacePlan(value)
  const base = {
    version: 1 as const, preview: true as const, effects: 'none' as const,
    dispatchAuthorized: false as const, requestedMode: input.mode, baseSnapshot: input.baseSnapshot,
  }
  const blocked = (...reasons: string[]): WorkspacePlan => ({ ...base, status: 'blocked', mode: null, reasons, warnings: [], stages: [] })
  if (input.inventory !== 'complete') return blocked('inventory_unknown')
  // Conservative M0 boundary: no snapshot capture or checkout coordination with an
  // unowned writer. A later runtime may prove safe immutable-source materialization.
  if (input.externalWriters > 0) return blocked('unowned_writer_active')
  if (input.participants.some(member => member.effects === 'unknown')) return blocked('effects_unknown')
  if (input.guarantees.stableSnapshot !== 'supported') return blocked('stable_snapshot_not_confirmed')
  if (input.participants.some(member => member.effects === 'read-only') && input.guarantees.readOnlyEnforcement !== 'supported') return blocked('read_only_not_enforced')

  const verifiers = input.participants.filter(member => member.purpose === 'verify')
  const writers = input.participants.filter(member => member.purpose !== 'verify' && member.effects === 'workspace-write')
  const readers = input.participants.filter(member => member.purpose !== 'verify' && member.effects === 'read-only')
  const writesDuringVerification = verifiers.some(member => member.effects === 'workspace-write')
  // Builds/tests that emit files are writers, even when their purpose is verification.
  // Keep them on disposable copies of the final snapshot, never on a live candidate.
  if (writesDuringVerification && input.guarantees.isolatedWorktrees !== 'supported') return blocked('verification_scratch_isolation_not_confirmed')
  let mode: Exclude<WorkspaceMode, 'auto'>
  if (input.mode === 'auto') {
    mode = writers.length === 0 ? 'shared-read'
      : writers.length === 1 && input.guarantees.exclusiveWriter === 'supported' ? 'shared-single-writer'
        : 'isolated-worktrees'
  } else mode = input.mode
  if (mode === 'shared-read' && writers.length > 0) return blocked('shared_read_has_writer')
  if (mode === 'shared-single-writer' && writers.length !== 1) return blocked('shared_mode_requires_exactly_one_writer')
  if (mode === 'shared-single-writer' && input.guarantees.exclusiveWriter !== 'supported') return blocked('exclusive_writer_not_confirmed')
  if (mode === 'isolated-worktrees' && input.guarantees.isolatedWorktrees !== 'supported') return blocked('worktree_isolation_not_confirmed')

  const warnings: string[] = ['declared_guarantees_are_not_live_probes', 'worktree_is_not_an_os_sandbox', 'existing_admission_budget_and_acceptance_still_required']
  const stages: WorkspaceStage[] = []
  const ids = (members: readonly WorkspaceParticipant[]) => members.map(member => member.id)
  const observers = mode === 'shared-single-writer' ? readers.filter(member => member.consistency === 'live') : []
  const baseReaders = readers.filter(member => !observers.includes(member))
  if (baseReaders.length) stages.push({
    phase: 'base-analysis', topology: 'frozen-shared-read', participants: ids(baseReaders), observers: [], snapshot: 'base',
    guards: ['pin-and-hold-base-snapshot', 'enforce-read-only-tools', 'no-acceptance-from-analysis'],
  })
  if (writers.length) {
    stages.push({
      phase: 'implementation', topology: mode === 'shared-single-writer' ? 'shared-single-writer' : 'worktree-per-writer',
      participants: ids(writers), observers: ids(observers), snapshot: 'mutable-candidate',
      guards: mode === 'shared-single-writer'
        ? ['session-owned-candidate-not-protected-target', 'exclusive-writer-for-whole-attempt', 'observers-enforced-read-only', 'live-observation-is-not-acceptance', 'preserve-on-failure']
        : ['session-owned-candidate-not-protected-target', 'one-materialized-worktree-per-writer', 'resource-namespaces-not-just-file-paths', 'preserve-on-failure'],
    })
    // Applies even to a single shared writer: admission/commit authority stays with
    // the existing Yoke gates; no direct worker-owned commit or acceptance shortcut.
    stages.push({
      phase: 'integration', topology: 'serial-integration', participants: ids(writers), observers: [], snapshot: 'fresh-integrated',
      guards: ['confirm-candidate-writer-process-tree-stopped', 'existing-review-and-integration-gates', 'revalidate-target-head', 'invalidate-stale-evidence'],
    })
  }
  if (verifiers.length) stages.push({
    phase: 'verification', topology: writesDuringVerification ? 'disposable-per-verifier' : 'frozen-shared-read',
    participants: ids(verifiers), observers: [], snapshot: writers.length ? 'fresh-integrated' : 'base',
    guards: ['hold-source-snapshot-through-verification', ...(writesDuringVerification ? ['one-disposable-copy-per-verifier', 'protect-code-and-acceptance-in-test-copy', 'check-source-unchanged-after-tests'] : ['enforce-read-only-tools']), 'bind-receipts-to-snapshot-policy-and-environment', 'existing-acceptance-authority-only'],
  })
  if (observers.length) warnings.push('live_observers_may_see_partial_edits')
  if (mode !== 'shared-single-writer' && readers.some(member => member.consistency === 'live')) warnings.push('live_readers_pinned_to_base_not_all_candidates')
  if (!verifiers.length) warnings.push('no_verifier_participant_declared_not_a_completion_claim')
  return { ...base, status: 'planned', mode, reasons: [`writers:${writers.length}`, `verifiers:${verifiers.length}`], warnings, stages }
}
