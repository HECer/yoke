import { assessmentInstructions } from "../routing/assessment.js"
import { bindAssessments, preparedProblems } from '../prd/assess.js'
import { loadConfig } from '../retrofit/config.js'
import { resolvePlanner } from '../routing/planning.js'
import { readPlanningFile } from '../routing/contracts.js'
import { ApprovedChangeSchema, RequirementEntrySchema, RequirementsSchema, requirementObjective, type RequirementsLedger } from '../prd/requirements.js'
import { assertPlanningState, hasPlanningReceipt, planningChange, publishPlanningState, readPlanningState, validatePlanningState } from '../prd/transaction.js'
import { acquireLock, readLock, releaseLock } from '../loop/lock.js'
import { statePath } from '../workspace/state.js'
import { hostProjectStatePath, publishHostStateFile, readHostStateFile } from '../workspace/host-state.js'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, opendirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { parse, stringify } from 'yaml'
import type { Agent } from '../retrofit/config.js'
import { criterionCommandProblem, isAcceptanceCriterion, loadPrd, StorySchema, validateDependencies, type Story } from '../loop/prd.js'
import {
  agentInvocation, buildWatchdogInvocation, isAgentAvailable, runCapturedAgent,
  type AgentResult, type Invocation,
} from '../loop/runner.js'
import { commitPaths } from '../loop/git.js'
import type { ModelSelection, PermissionProfile } from '../agents/types.js'
import { measureInvocation } from '../observability/invocation.js'
import { withExecutionBudgetScope } from '../execution/budget.js'

const ChangeRequestSchema = z.object({
  version: z.literal(1),
  id: z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  createdAt: z.string().datetime(),
  request: z.string().min(1).max(20_000),
}).strict()
const MAX_PENDING_REQUESTS = 100
const MAX_REQUEST_BYTES = 100_000
const MAX_INBOX_BYTES = 2_000_000

const ChangeReviewSchema = z.object({
  version: z.literal(1),
  changeId: z.string().min(1),
  approved: z.boolean(),
  summary: z.string().min(1),
  uncovered: z.array(z.string().min(1)),
}).superRefine((review, ctx) => {
  if (review.approved && review.uncovered.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['approved'], message: 'approved review cannot list uncovered requirements' })
  }
})

const NewStoryId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LedgerProposalSchema = z.object({
  stories: z.array(StorySchema).min(1).max(12),
  requirements: z.array(RequirementEntrySchema).min(1).max(100),
  invariants: z.array(RequirementEntrySchema).max(50).default([]),
}).strict()

export type ChangeRequest = z.infer<typeof ChangeRequestSchema>

export interface QueueChangeOptions {
  id?: string
  now?: () => Date
}

function changesDir(targetDir: string): string { return statePath(targetDir, 'changes') }
function pendingDir(targetDir: string): string { return statePath(targetDir, 'changes', 'pending') }
function appliedDir(targetDir: string): string { return statePath(targetDir, 'changes', 'applied') }

function requestFile(targetDir: string, id: string): string { return statePath(targetDir, 'changes', 'pending', `${ChangeRequestSchema.shape.id.parse(id)}.json`) }
export function proposalFile(targetDir: string, id: string): string { return resolve(statePath(targetDir, 'changes', `proposal-${ChangeRequestSchema.shape.id.parse(id)}.yaml`)) }
export function reviewFile(targetDir: string, id: string): string { return resolve(statePath(targetDir, 'changes', `review-${ChangeRequestSchema.shape.id.parse(id)}.json`)) }
const authorizationPath = (root: string, id: string, create = false) => hostProjectStatePath(root, 'planning', ['requests', `${createHash('sha256').update(id).digest('hex')}.json`], create)

function pendingNames(targetDir: string): string[] {
  const path = pendingDir(targetDir)
  if (!existsSync(path)) return []
  const directory = opendirSync(path), names: string[] = []
  let entries = 0
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++entries > 1_000) throw Error('Change inbox has too many entries')
      if (!entry.name.endsWith('.json')) continue
      if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/u.test(entry.name)) throw Error('Change inbox requires regular files named for their request id')
      names.push(entry.name)
      if (names.length > MAX_PENDING_REQUESTS) throw Error(`Change inbox exceeds ${MAX_PENDING_REQUESTS} pending requests`)
    }
  } finally { directory.closeSync() }
  return names
}

function requireAuthorization(targetDir: string, request: ChangeRequest): void {
  const source = readHostStateFile(authorizationPath(targetDir, request.id), MAX_REQUEST_BYTES)
  const approved = source === undefined ? undefined : ChangeRequestSchema.parse(JSON.parse(source))
  if (!approved || JSON.stringify(approved) !== JSON.stringify(request)) throw Error(`Pending change ${request.id} lacks matching host authorization. Preserve and move that inbox file, then requeue the intended request with yoke change add.`)
}

function ensureLocalIgnore(targetDir: string): void {
  let exclude: string
  try {
    const gitPath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: targetDir, stdio: 'pipe' }).toString().trim()
    exclude = isAbsolute(gitPath) ? gitPath : resolve(targetDir, gitPath)
  } catch {
    return
  }
  mkdirSync(dirname(exclude), { recursive: true })
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (current.split(/\r?\n/).some(line => line.trim() === '.yoke/changes/')) return
  const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n'
  writeFileSync(exclude, `${current}${prefix}.yoke/changes/\n`)
}

function prdIsCommitted(targetDir: string, paths = ['.yoke/prd.yaml']): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', ...paths], { cwd: targetDir, stdio: 'pipe' })
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...paths], {
      cwd: targetDir,
      stdio: 'pipe',
    }).toString().trim() === ''
  } catch {
    return false
  }
}

export function queueChange(targetDir: string, request: string, opts: QueueChangeOptions = {}): ChangeRequest {
  const text = request.trim()
  if (!text) throw new Error('change request must not be empty')
  const change = ChangeRequestSchema.parse({
    version: 1,
    id: opts.id ?? randomUUID(),
    createdAt: (opts.now ?? (() => new Date()))().toISOString(),
    request: text,
  })
  if (pendingNames(targetDir).length >= MAX_PENDING_REQUESTS) throw Error(`Change inbox already contains ${MAX_PENDING_REQUESTS} requests`)
  mkdirSync(pendingDir(targetDir), { recursive: true })
  const path = requestFile(targetDir, change.id)
  if (existsSync(path)) throw new Error(`change ${change.id} already exists`)
  ensureLocalIgnore(targetDir)
  const source = `${JSON.stringify(change, null, 2)}\n`
  publishHostStateFile(authorizationPath(targetDir, change.id, true), source)
  publishHostStateFile(path, source)
  return change
}

export function pendingChanges(targetDir: string): ChangeRequest[] {
  let bytes = 0
  return pendingNames(targetDir)
    .map(name => {
      const source = readPlanningFile(targetDir, `.yoke/changes/pending/${name}`, MAX_REQUEST_BYTES)
      if (source === undefined) throw Error('Pending change disappeared while reading the inbox')
      bytes += Buffer.byteLength(source)
      if (bytes > MAX_INBOX_BYTES) throw Error('Change inbox exceeds its total byte limit')
      const request = ChangeRequestSchema.parse(JSON.parse(source))
      if (name !== `${request.id}.json`) throw Error('Pending change filename does not match its request id')
      requireAuthorization(targetDir, request)
      return request
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export function buildChangePrompt(request: ChangeRequest, proposalPath: string, stories: Story[], brief = '', ledger?: RequirementsLedger): string {
  return [
    'You are planning one newly requested product change for the Yoke autonomous loop.',
    `Change request ${request.id}: ${request.request}`,
    '',
    'Create an append-only proposal: add small new stories; never rewrite or delete existing stories.',
      assessmentInstructions,
      ...(brief ? ['Approved planning brief:', brief] : []),
    `Existing story IDs: ${stories.map(story => story.id).join(', ') || '(none)'}`,
    'Every proposed story must have passes: false and 2-5 structured acceptance criteria.',
    'Every criterion must have a stable id, behavioral text, and one or more executable verify commands.',
    'Each criterion id must appear in every verify command; each entry must be one approved test command without shell control operators.',
    'Use only a configured Yoke harness if an optional agent affinity is useful (claude, codex, gemini, qwen, opencode, kilo, pi, or hermes).',
    'Do not set requirementsFor, sourceChange or exploration; these are host-owned provenance.',
    ...(ledger ? [
      'Every new story needs explicit writes. Add needs dependencies on existing writers whenever ownership overlaps.',
      `Existing ownership: ${JSON.stringify(stories.map(story => ({ id: story.id, writes: story.writes, needs: story.needs })))}`,
      `Preserve this original contract and every invariant unchanged: ${JSON.stringify(ledger)}`,
      'Propose only NEW requirements and optional NEW invariants, each with a unique id, text and criteria: [{story, criterion}].',
      'Coverage references must name only new stories. Cover every new criterion and every requested outcome. Do not rewrite existing ledger entries or the objective.',
    ] : []),
    '',
    ledger
      ? `Write ONLY a YAML object {stories: [...], requirements: [...], invariants: []} to this exact file: ${proposalPath}`
      : `Write ONLY a YAML array of the NEW stories to this exact file: ${proposalPath}`,
    'Do not edit .yoke/prd.yaml or any source file. Do not commit.',
  ].join('\n')
}

export function buildChangeReviewPrompt(request: ChangeRequest, reviewPath: string, proposed: Story[], coverage?: { original: RequirementsLedger; proposed: RequirementsLedger }): string {
  return [
    'Independently review whether a proposed append-only plan fully covers one product change.',
    `Change request ${request.id}: ${request.request}`,
    '',
    'Check every distinct requested outcome, edge case, and state transition against the proposed stories and their criteria.',
    'Approve only when every distinct requested outcome has a behavioral criterion and a criterion-specific verify command.',
    'Do not assume a broad test suite proves an outcome. List every omission in uncovered.',
    '',
    `Proposed stories: ${JSON.stringify(proposed, null, 2)}`,
    ...(coverage ? [`Original contract (preserve its requirements and invariants): ${JSON.stringify(coverage.original)}`, `Proposed complete coverage ledger: ${JSON.stringify(coverage.proposed)}`, 'Check that the exact approved request is fully covered without weakening the original objective or invariants.'] : []),
    '',
    `Write ONLY JSON to this exact file: ${reviewPath}`,
    '{"version":1,"changeId":"<exact change id>","approved":true|false,"summary":"<reason>","uncovered":["<missing outcome>"]}',
    'Do not edit .yoke/prd.yaml, the proposal, or any source file. Do not commit.',
  ].join('\n')
}

export interface ChangeApplyOptions {
  runner: Agent
  reviewer?: Agent
  timeoutMs?: number
  isAvailable?: (agent: Agent) => boolean
  run?: (invocation: Invocation) => AgentResult
  review?: (invocation: Invocation) => AgentResult
  commit?: (prdPath: string, request: ChangeRequest, paths: string[]) => void
  archive?: (targetDir: string, request: ChangeRequest) => void
  permissions?: PermissionProfile
  selection?: ModelSelection
  ownedLockToken?: string
}

export interface ChangeApplyResult {
  ok: boolean
  added: number
  summary: string
  changeId?: string
}

function archiveRequest(targetDir: string, request: ChangeRequest): void {
  mkdirSync(appliedDir(targetDir), { recursive: true })
  const source = readPlanningFile(targetDir, `.yoke/changes/pending/${request.id}.json`, MAX_REQUEST_BYTES)
  if (!source || JSON.stringify(ChangeRequestSchema.parse(JSON.parse(source))) !== JSON.stringify(request)) throw Error('Queued change changed before archival')
  requireAuthorization(targetDir, request)
  const path = statePath(targetDir, 'changes', 'applied', `${request.id}.json`)
  const previous = readPlanningFile(targetDir, `.yoke/changes/applied/${request.id}.json`, MAX_REQUEST_BYTES)
  if (previous !== undefined && JSON.stringify(ChangeRequestSchema.parse(JSON.parse(previous))) !== JSON.stringify(request)) throw Error('Archived change id already belongs to a different request')
  if (previous === undefined) publishHostStateFile(path, `${JSON.stringify(request, null, 2)}\n`)
  rmSync(requestFile(targetDir, request.id))
  rmSync(proposalFile(targetDir, request.id), { force: true })
  rmSync(reviewFile(targetDir, request.id), { force: true })
}

export function runChangeApply(targetDir: string, opts: ChangeApplyOptions): ChangeApplyResult {
  return withExecutionBudgetScope(targetDir, () => applyWithLock(targetDir, opts))
}
function applyWithLock(targetDir: string, opts: ChangeApplyOptions): ChangeApplyResult {
  let lock: ReturnType<typeof acquireLock> | undefined
  try {
    statePath(targetDir, 'loop.lock')
    if (opts.ownedLockToken) {
      if (readLock(targetDir)?.ownerToken !== opts.ownedLockToken) throw Error('Invalid borrowed change-intake lock')
    } else {
      lock = acquireLock(targetDir)
      if (!lock.acquired) throw Error('Another Yoke operation owns the project lock')
    }
    return applyChange(targetDir, opts)
  } catch (error) { return { ok: false, added: 0, summary: `could not apply change: ${(error as Error).message}` } }
  finally { if (lock?.acquired) releaseLock(targetDir, lock.ownerToken) }
}

function applyChange(targetDir: string, opts: ChangeApplyOptions): ChangeApplyResult {
  const config = loadConfig(targetDir)
  const planner = resolvePlanner(config, opts.runner, opts.selection)
  opts = { ...opts, runner: planner.agent, selection: planner.selection }
  let requests: ChangeRequest[]
  try { requests = pendingChanges(targetDir) } catch (error) {
    return { ok: false, added: 0, summary: `invalid pending request: ${(error as Error).message}` }
  }
  const request = requests[0]
  if (!request) return { ok: true, added: 0, summary: 'inbox empty' }

  const prdPath = join(targetDir, '.yoke', 'prd.yaml')
  const before = readPlanningState(targetDir)
  let existing: Story[], ledger: RequirementsLedger | undefined
  try {
    existing = loadPrd(prdPath)
    ledger = before.requirements === null ? undefined : RequirementsSchema.parse(parse(before.requirements, { maxAliasCount: 10 }))
  } catch (error) { return { ok: false, added: 0, summary: `invalid original requirement contract: ${(error as Error).message}`, changeId: request.id } }
  const paths = ['.yoke/prd.yaml', ...(ledger ? ['.yoke/requirements.yaml'] : [])]
  const commit = () => (opts.commit ?? ((_path, change, changedPaths) => commitPaths(targetDir, changedPaths, `yoke: plan change ${change.id}`)))(prdPath, request, paths)
  if (existing.some(story => story.sourceChange === request.id)) {
    if (ledger && !ledger.changes?.some(change => change.id === request.id && change.request === request.request && change.createdAt === request.createdAt)) {
      return { ok: false, added: 0, summary: 'Existing story does not match the exact approved change binding', changeId: request.id }
    }
    if (!hasPlanningReceipt(targetDir, planningChange(request), before)) return {
      ok: false,
      added: 0,
      summary: `PRD contains change ${request.id} without an exact host approval receipt for its current state; keeping the request pending`,
      changeId: request.id,
    }
    if (!prdIsCommitted(targetDir, paths)) commit()
    try {
      ;(opts.archive ?? archiveRequest)(targetDir, request)
    } catch (error) {
      return {
        ok: false, added: 0,
        summary: `committed change ${request.id} could not be archived; keeping it pending for recovery: ${(error as Error).message}`,
        changeId: request.id,
      }
    }
    return { ok: true, added: 0, summary: `recovered applied change ${request.id}`, changeId: request.id }
  }
  const available = opts.isAvailable ?? isAgentAvailable
  if (!available(opts.runner)) return { ok: false, added: 0, summary: `planner CLI "${opts.runner}" is unavailable`, changeId: request.id }
  const reviewer = opts.reviewer ?? opts.runner
  if (!available(reviewer)) return { ok: false, added: 0, summary: `reviewer CLI "${reviewer}" is unavailable`, changeId: request.id }

  const proposal = proposalFile(targetDir, request.id)
  const brief = before.brief ?? ''
  const plannerDir = changesDir(targetDir)
  mkdirSync(plannerDir, { recursive: true })
  rmSync(proposal, { force: true })
  const prompt = buildChangePrompt(request, proposal, existing, brief, ledger)
  if (prompt.length > 60_000) return { ok: false, added: 0, summary: 'Change planning input exceeds 60000 characters; split or condense the work package', changeId: request.id }
  const base = agentInvocation(
    opts.runner,
    prompt,
    plannerDir,
    opts.permissions ?? 'safe',
    opts.selection,
  )
  const invocation = buildWatchdogInvocation(base, opts.timeoutMs ?? 0)
  const result = measureInvocation({ root: targetDir, agent: opts.runner, role: 'change-planner', storyId: request.id, runId: `change:${request.id}`, selection: opts.selection, invocation,
    execute: opts.run ?? (item => runCapturedAgent(opts.runner, item)),
  })
  if (!result.success) return { ok: false, added: 0, summary: `planner failed: ${result.summary}`, changeId: request.id }
  try { assertPlanningState(targetDir, before) } catch {
    return {
      ok: false,
      added: 0,
      summary: 'PRD changed while the planner was running; refusing to overwrite concurrent or out-of-contract edits',
      changeId: request.id,
    }
  }
  if (!existsSync(proposal)) return { ok: false, added: 0, summary: `planner did not write ${basename(proposal)}`, changeId: request.id }

  let proposed: Story[]
  let coverage: z.infer<typeof LedgerProposalSchema> | undefined
  try {
    const source = readPlanningFile(targetDir, `.yoke/changes/proposal-${request.id}.yaml`, 500_000)
    const value = parse(source!, { maxAliasCount: 10 })
    if (ledger) { coverage = LedgerProposalSchema.parse(value); proposed = coverage.stories }
    else proposed = z.array(StorySchema).parse(value)
  } catch (error) {
    return { ok: false, added: 0, summary: `invalid story proposal: ${(error as Error).message}`, changeId: request.id }
  }
  if (proposed.length === 0) return { ok: false, added: 0, summary: 'planner proposed no stories', changeId: request.id }
  const existingIds = new Set(existing.map(story => story.id))
  const proposedIds = new Set<string>()
  for (const story of proposed) {
    if (story.requirementsFor) return { ok: false, added: 0, summary: `proposed story ${story.id} cannot introduce an unsupported requirement binding`, changeId: request.id }
    if (story.exploration || story.sourceChange) return { ok: false, added: 0, summary: `proposed story ${story.id} cannot introduce host-owned change or exploration provenance`, changeId: request.id }
    if (!NewStoryId.test(story.id)) {
      return { ok: false, added: 0, summary: `proposed story id must be one safe path segment: ${story.id}`, changeId: request.id }
    }
    if (story.passes) return { ok: false, added: 0, summary: `proposed story ${story.id} is already marked passed`, changeId: request.id }
    if (existingIds.has(story.id) || proposedIds.has(story.id)) {
      return { ok: false, added: 0, summary: `duplicate proposed story id: ${story.id}`, changeId: request.id }
    }
    if (story.acceptance.length < 2 || story.acceptance.length > 5) {
      return { ok: false, added: 0, summary: `proposed story ${story.id} must have 2-5 acceptance criteria`, changeId: request.id }
    }
    if (story.acceptance.some(criterion => !isAcceptanceCriterion(criterion))) {
      return { ok: false, added: 0, summary: `proposed story ${story.id} lacks executable criterion evidence`, changeId: request.id }
    }
    for (const criterion of story.acceptance.filter(isAcceptanceCriterion)) {
      const problem = criterionCommandProblem(criterion)
      if (problem) return { ok: false, added: 0, summary: problem, changeId: request.id }
    }
    proposedIds.add(story.id)
  }

  let appended = proposed.map(story => ({ ...story, sourceChange: request.id }))
  const dependencyIssues = validateDependencies([...existing, ...appended])
  if (dependencyIssues.length > 0) {
    return { ok: false, added: 0, summary: `invalid combined dependency graph: ${dependencyIssues.join('; ')}`, changeId: request.id }
  }
  const reviewPath = reviewFile(targetDir, request.id)
  let nextLedger: RequirementsLedger | undefined
  if (ledger && coverage) {
    const entries = [...coverage.requirements, ...coverage.invariants]
    if (entries.some(entry => entry.criteria.some(ref => !proposedIds.has(ref.story)))) throw Error('New requirement coverage must reference only proposed stories')
    for (const story of appended) for (const criterion of story.acceptance.filter(isAcceptanceCriterion)) {
      if (!entries.some(entry => entry.criteria.some(ref => ref.story === story.id && ref.criterion === criterion.id))) throw Error(`New criterion ${story.id}/${criterion.id} has no requirement coverage`)
    }
    const changes = [...(ledger.changes ?? []), ApprovedChangeSchema.parse({ id: request.id, request: request.request, createdAt: request.createdAt })]
    nextLedger = RequirementsSchema.parse({ ...ledger, changes, objective: requirementObjective(ledger.objective.idea, brief, changes), requirements: [...ledger.requirements, ...coverage.requirements], invariants: [...ledger.invariants, ...coverage.invariants] })
    existing = existing.map(story => ({ ...story, requirementsFor: nextLedger!.objective.sha256 }))
    appended = appended.map(story => ({ ...story, requirementsFor: nextLedger!.objective.sha256 }))
  }
  const requirementSource = nextLedger ? stringify(nextLedger) : before.requirements
  const bound = bindAssessments([...existing, ...appended], brief, nextLedger ?? '')
  appended = bound.slice(existing.length).map(s => ({ ...s, sourceChange: request.id }))
  const after = { ...before, prd: stringify([...existing, ...appended]), requirements: requirementSource }
  validatePlanningState(after)
  if (config?.routing?.assessmentPolicy === 'prepared') {
    const issues = preparedProblems(bound, brief, nextLedger ?? '').filter(issue => appended.some(s => issue.startsWith(s.id + ':')))
    if (issues.length) return { ok: false, added: 0, summary: issues.join('; '), changeId: request.id }
  }
  rmSync(reviewPath, { force: true })
  const reviewPrompt = buildChangeReviewPrompt(request, reviewPath, appended, ledger && nextLedger ? { original: ledger, proposed: nextLedger } : undefined)
  if (reviewPrompt.length > 60_000) return { ok: false, added: 0, summary: 'Change review input exceeds 60000 characters; split or condense the work package', changeId: request.id }
  const reviewBase = agentInvocation(
    reviewer,
    reviewPrompt,
    plannerDir,
    opts.permissions ?? 'safe',
    reviewer === opts.runner ? opts.selection : undefined,
  )
  const reviewInvocation = buildWatchdogInvocation(reviewBase, opts.timeoutMs ?? 0)
  const reviewResult = measureInvocation({ root: targetDir, agent: reviewer, role: 'coverage-review', storyId: request.id, runId: `change:${request.id}`, selection: reviewer === opts.runner ? opts.selection : undefined, invocation: reviewInvocation,
    execute: opts.review ?? (item => runCapturedAgent(reviewer, item)),
  })
  if (!reviewResult.success) {
    return { ok: false, added: 0, summary: `coverage review failed: ${reviewResult.summary}`, changeId: request.id }
  }
  try { assertPlanningState(targetDir, before) } catch {
    return {
      ok: false, added: 0,
      summary: 'PRD changed while the coverage reviewer was running; refusing to overwrite concurrent or out-of-contract edits',
      changeId: request.id,
    }
  }
  if (!existsSync(reviewPath)) {
    return { ok: false, added: 0, summary: `coverage reviewer did not write ${basename(reviewPath)}`, changeId: request.id }
  }
  let coverageReview: z.infer<typeof ChangeReviewSchema>
  try {
    coverageReview = ChangeReviewSchema.parse(JSON.parse(readPlanningFile(targetDir, `.yoke/changes/review-${request.id}.json`, 32_000)!))
  } catch (error) {
    return { ok: false, added: 0, summary: `invalid coverage review: ${(error as Error).message}`, changeId: request.id }
  }
  if (coverageReview.changeId !== request.id) {
    return { ok: false, added: 0, summary: `coverage review targets ${coverageReview.changeId}, expected ${request.id}`, changeId: request.id }
  }
  if (!coverageReview.approved || coverageReview.uncovered.length > 0) {
    const missing = coverageReview.uncovered.length > 0 ? `: ${coverageReview.uncovered.join('; ')}` : ''
    return { ok: false, added: 0, summary: `coverage review rejected the proposal: ${coverageReview.summary}${missing}`, changeId: request.id }
  }
  let published = false
  try {
    publishPlanningState(targetDir, before, after, { change: planningChange(request) })
    published = true
    commit()
  } catch (error) {
    if (published) {
      try { publishPlanningState(targetDir, after, before) }
      catch (rollback) { return { ok: false, added: 0, summary: `could not persist change: ${(error as Error).message}; recovery retained: ${(rollback as Error).message}`, changeId: request.id } }
    }
    return { ok: false, added: 0, summary: `could not persist change: ${(error as Error).message}`, changeId: request.id }
  }
  try {
    ;(opts.archive ?? archiveRequest)(targetDir, request)
  } catch (error) {
    return {
      ok: false, added: appended.length,
      summary: `planned change ${request.id} was committed but could not be archived; keeping it pending for recovery: ${(error as Error).message}`,
      changeId: request.id,
    }
  }
  return { ok: true, added: appended.length, summary: `added ${appended.length} stories from ${request.id}`, changeId: request.id }
}
