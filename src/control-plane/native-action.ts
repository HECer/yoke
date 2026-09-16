import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { prepareIsolatedWorktree } from '../loop/recovery.js'
import type { AgentContext, AgentResult } from '../loop/runner.js'
import { statePath } from '../workspace/state.js'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import { reserveBudget, settleBudget } from './budget.js'
import { assertLedgerOwner, readLedger, transactLedgerOwned } from './store.js'
import { createWorkspaceBroker, parseWorkspaceEdits } from './workspace-broker.js'
import { captureWorkspaceSnapshot, resolveWorkspacePath, snapshotEntries, workspacePath, type WorkspaceSnapshot } from './workspace-snapshot.js'
import { fail, identifier } from './validation.js'
import { planWorkspace } from './workspace-plan.js'

export const NativeWorkspaceActionSchema = z.object({
  kind: z.literal('workspace-edit'),
  storyId: z.string().min(1).max(128),
  writeScopes: z.array(z.string().min(1)).min(1).max(200),
  edits: z.array(z.object({ path: z.string(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), content: z.string().max(1024 * 1024).nullable() }).strict()).min(1).max(200),
  reserveComputeMs: z.number().int().min(1).max(600000).default(1000),
}).strict()
export type NativeWorkspaceAction = z.infer<typeof NativeWorkspaceActionSchema>
export interface NativeActionAuthority {
  readonly projectRoot: string
  readonly ownerToken: string
  /** Pinned by the existing loop from the operator's root acceptance manifest. */
  readonly protectedScopes: readonly string[]
}

function assertQuiet(root: string): void {
  if (existsSync(statePath(root, 'runner.pid'))) fail('writer_inventory_unknown', 'A legacy runner record remains; inspect cleanup before broker execution')
  const providers = statePath(root, 'provider-processes')
  if (existsSync(providers) && readdirSync(providers).length) fail('writer_inventory_unknown', 'Provider process records remain; no shared broker execution')
  const supervision = statePath(root, 'supervision')
  if (!existsSync(supervision)) return
  const files = readdirSync(supervision)
  if (files.length > 1000) fail('writer_inventory_unknown', 'Supervision inventory exceeds the bounded scan')
  for (const name of files) {
    const file = statePath(root, 'supervision', name)
    if (!statSync(file).isFile() || statSync(file).size > 65536) fail('writer_inventory_unknown', 'Oversized supervision record')
    let value: unknown
    try { value = JSON.parse(readFileSync(file, 'utf8')) } catch { fail('writer_inventory_unknown', 'Unreadable supervision record') }
    if (!value || typeof value !== 'object' || (value as { state?: unknown }).state !== 'stopped') fail('writer_inventory_unknown', 'A provider is not confirmed stopped')
  }
}

function saveJournal(root: string, id: string, value: unknown): void {
  const dir = statePath(root, 'control-plane', 'native')
  mkdirSync(dir, { recursive: true })
  const file = statePath(root, 'control-plane', 'native', `${id}.json`)
  const temp = statePath(root, 'control-plane', 'native', `${id}.${randomUUID()}.tmp`)
  const content = JSON.stringify(value, null, 2) + '\n'
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temp, file)
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }) }
}

/**
 * Controller-only publication. The broker's batch is atomic in memory; a disk I/O
 * failure may leave a partial candidate. Keep its journal/backups and fail the loop,
 * never roll back over a concurrent edit or claim multi-file filesystem atomicity.
 */
function publishSnapshot(root: string, id: string, before: WorkspaceSnapshot, after: WorkspaceSnapshot, checkOwner: () => void): void {
  mkdirSync(statePath(root, 'control-plane'), { recursive: true })
  const staging = statePath(root, 'control-plane', `edit-${id}`)
  mkdirSync(staging, { recursive: false })
  writeFileSync(join(staging, 'before.json'), JSON.stringify(snapshotEntries(before)), { flag: 'wx', mode: 0o600 })
  writeFileSync(join(staging, 'after.json'), JSON.stringify(snapshotEntries(after)), { flag: 'wx', mode: 0o600 })
  const changed = after.files.filter(file => file.sha256 !== before.files.find(old => old.path === file.path)?.sha256)
  const modes = new Map(changed.map(file => [file.path, file.sha256 !== null && before.read(file.path) !== null
    ? statSync(resolveWorkspacePath(root, file.path)).mode & 0o777 : 0o644]))
  for (const [index, file] of changed.entries()) {
    const content = after.read(file.path)
    if (content !== null) writeFileSync(join(staging, String(index)), content, { flag: 'wx', mode: modes.get(file.path)! })
  }
  checkOwner()
  if (captureWorkspaceSnapshot(root, before.files.map(f => f.path)).id !== before.id) fail('stale_snapshot', 'Candidate changed before publication; no edits applied')
  for (const [index, file] of changed.entries()) {
    checkOwner()
    const current = captureWorkspaceSnapshot(root, [file.path]).files[0]!
    if (current.sha256 !== before.files.find(old => old.path === file.path)!.sha256 || current.executable !== before.files.find(old => old.path === file.path)!.executable) fail('stale_file', `Candidate changed while publishing: ${file.path}`)
    const full = resolveWorkspacePath(root, file.path)
    if (file.sha256 === null) unlinkSync(full)
    else {
      mkdirSync(dirname(full), { recursive: true })
      // Resolve again after directory creation; do not follow a substituted ancestor.
      resolveWorkspacePath(root, file.path)
      renameSync(join(staging, String(index)), full)
      if (process.platform !== 'win32') chmodSync(full, modes.get(file.path)!)
    }
  }
  if (captureWorkspaceSnapshot(root, after.files.map(f => f.path)).id !== after.id) fail('publication_mismatch', 'Published files do not match the sealed snapshot')
  // Backups are retained intentionally, including after success, until worktree cleanup.
}

/** Executable first native adapter: bounded text edits, no shell/model callbacks. */
export function runNativeWorkspaceAction(context: AgentContext, supplied: NativeWorkspaceAction, authority: NativeActionAuthority): AgentResult {
  const action = NativeWorkspaceActionSchema.parse(supplied)
  identifier(action.storyId, 'storyId')
  if (action.storyId !== context.story.id) fail('task_mismatch', 'Native action does not belong to this story')
  const root = assertLedgerOwner(authority.projectRoot, authority.ownerToken)
  // Reuse Yoke's real, persisted ownership/recovery contract, not a path-only claim.
  if (!existsSync(context.targetDir)) fail('worktree_missing', 'The loop must create the candidate worktree')
  prepareIsolatedWorktree(root, context.targetDir, true)
  assertQuiet(root); assertQuiet(context.targetDir)
  const edits = parseWorkspaceEdits(action.edits)
  action.writeScopes.forEach(workspacePath)
  const storyScopes = (context.story.writes ?? []).map(workspacePath).map(scope => scope.toLowerCase())
  if (!storyScopes.length || action.writeScopes.some(scope => !storyScopes.some(grant => scope.toLowerCase() === grant || scope.toLowerCase().startsWith(`${grant}/`)))) {
    fail('story_scope_not_granted', 'Managed edit scopes must be contained in the story write scopes')
  }
  if (!authority.protectedScopes.length) fail('acceptance_not_protected', 'Managed edits require explicitly protected acceptance infrastructure')
  const paths = edits.map(edit => edit.path)
  const before = captureWorkspaceSnapshot(context.targetDir, paths)
  const broker = createWorkspaceBroker(before, action.writeScopes, [...authority.protectedScopes, 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])
  const writer = broker.acquireWriter()
  try { writer.apply(before.id, edits) } finally { writer.release() }
  const after = broker.seal()
  if (before.id === after.id) fail('no_changes', 'This action would not change the candidate')
  // These capabilities describe this in-process DATA broker, not installed CLIs.
  const plan = planWorkspace({ version: 1, mode: 'auto', baseSnapshot: before.id, inventory: 'complete', externalWriters: 0,
    guarantees: { readOnlyEnforcement: 'supported', exclusiveWriter: 'supported', stableSnapshot: 'supported', isolatedWorktrees: 'supported' },
    participants: [{ id: 'native-editor', purpose: 'implement', effects: 'workspace-write', consistency: 'snapshot' }] })
  if (plan.status !== 'planned') fail('workspace_blocked', plan.reasons.join(', '))
  const ledger = readLedger(root)
  if (!ledger) fail('ledger_missing', 'Initialize the control-plane budget before running managed edits')
  const id = randomUUID(), reservationId = `native-edit:${id}`
  const reserved = transactLedgerOwned(root, authority.ownerToken, ledger.revision, budget => {
    const admission = reserveBudget(budget, { id: reservationId, taskId: action.storyId, role: 'worker', requested: { tokens: 0, costMicrousd: 0, computeMs: action.reserveComputeMs } })
    if (admission.disposition !== 'created') fail('attempt_replayed', 'A reservation replay cannot execute')
    return admission.ledger
  })
  const started = performance.now()
  const targetFingerprint = workspaceFingerprint(root)
  const receipt = { version: 1, runtime: 'native-text-broker-v1', boundary: 'broker-operations-only', reservationId, taskId: action.storyId,
    worktree: context.targetDir, topology: plan.mode, coverage: before.coverage, before: { id: before.id, files: before.files }, after: { id: after.id, files: after.files }, acceptance: 'pending-existing-loop-gates' }
  let summary: string, success = false, candidateFingerprint: string | undefined, candidateHead: string | undefined
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: context.targetDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    saveJournal(root, id, { ...receipt, phase: 'prepared' })
    publishSnapshot(context.targetDir, id, before, after, () => { assertLedgerOwner(root, authority.ownerToken) })
    if (workspaceFingerprint(root) !== targetFingerprint) fail('target_changed', 'Integration target changed; candidate retained without acceptance')
    candidateFingerprint = workspaceFingerprint(context.targetDir)
    candidateHead = head()
    saveJournal(root, id, { ...receipt, phase: 'applied', candidateFingerprint, candidateHead })
    success = true
    summary = `Native workspace edits applied to an owned candidate; snapshot ${after.id}; existing gates still required`
  } catch (error) {
    summary = `Native workspace publication blocked; candidate/backups retained: ${error instanceof Error ? error.message : String(error)}`
    saveJournal(root, id, { ...receipt, phase: 'failed', reason: summary })
  }
  // No worker code/subprocesses run in this adapter; return/throw is a real stop
  // boundary. A lost process/crash leaves its durable reservation in flight.
  transactLedgerOwned(root, authority.ownerToken, reserved.revision, budget => settleBudget(budget, reservationId, { tokens: 0, costMicrousd: 0, computeMs: Math.max(0, Math.ceil(performance.now() - started)) }, true))
  return { success, infrastructureFailure: !success, summary,
    ...(success ? { assertStableCandidate: () => {
      assertLedgerOwner(root, authority.ownerToken)
      prepareIsolatedWorktree(root, context.targetDir, true)
      assertQuiet(root); assertQuiet(context.targetDir)
      if (head() !== candidateHead || workspaceFingerprint(root) !== targetFingerprint || workspaceFingerprint(context.targetDir) !== candidateFingerprint) {
        fail('verification_source_changed', 'Managed candidate or integration target changed during verification; candidate retained')
      }
    } } : {}), tokens: { inputTokens: 0, outputTokens: 0, measurementComplete: true, totalCostUsd: 0, calls: [] } }
}
