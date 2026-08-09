import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { Agent } from '../retrofit/config.js'
import { criterionCommandProblem, isAcceptanceCriterion, loadPrd, parsePrd, savePrd, validateDependencies, type Story } from '../loop/prd.js'
import {
  agentInvocation, buildWatchdogInvocation, isAgentAvailable, runAgent,
  type AgentResult, type Invocation,
} from '../loop/runner.js'
import { commitPaths } from '../loop/git.js'
import type { ModelSelection, PermissionProfile } from '../agents/types.js'

const ChangeRequestSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  createdAt: z.string().datetime(),
  request: z.string().min(1),
})

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

export type ChangeRequest = z.infer<typeof ChangeRequestSchema>

export interface QueueChangeOptions {
  id?: string
  now?: () => Date
}

function changesDir(targetDir: string): string { return join(targetDir, '.yoke', 'changes') }
function pendingDir(targetDir: string): string { return join(changesDir(targetDir), 'pending') }
function appliedDir(targetDir: string): string { return join(changesDir(targetDir), 'applied') }

function requestFile(targetDir: string, id: string): string { return join(pendingDir(targetDir), `${id}.json`) }
export function proposalFile(targetDir: string, id: string): string { return resolve(changesDir(targetDir), `proposal-${id}.yaml`) }
export function reviewFile(targetDir: string, id: string): string { return resolve(changesDir(targetDir), `review-${id}.json`) }

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

function prdIsCommitted(targetDir: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', '.yoke/prd.yaml'], { cwd: targetDir, stdio: 'pipe' })
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', '.yoke/prd.yaml'], {
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
  ensureLocalIgnore(targetDir)
  mkdirSync(pendingDir(targetDir), { recursive: true })
  const path = requestFile(targetDir, change.id)
  if (existsSync(path)) throw new Error(`change ${change.id} already exists`)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(change, null, 2)}\n`, { flag: 'wx' })
  renameSync(temporary, path)
  return change
}

export function pendingChanges(targetDir: string): ChangeRequest[] {
  const dir = pendingDir(targetDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => ChangeRequestSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export function buildChangePrompt(request: ChangeRequest, proposalPath: string, stories: Story[]): string {
  return [
    'You are planning one newly requested product change for the Yoke autonomous loop.',
    `Change request ${request.id}: ${request.request}`,
    '',
    'Create an append-only proposal: add small new stories; never rewrite or delete existing stories.',
    `Existing story IDs: ${stories.map(story => story.id).join(', ') || '(none)'}`,
    'Every proposed story must have passes: false and 2-5 structured acceptance criteria.',
    'Every criterion must have a stable id, behavioral text, and one or more executable verify commands.',
    'Each criterion id must appear in every verify command; each entry must be one approved test command without shell control operators.',
    'Use only claude, codex, or gemini if an optional agent affinity is useful.',
    '',
    `Write ONLY a YAML array of the NEW stories to this exact file: ${proposalPath}`,
    'Do not edit .yoke/prd.yaml or any source file. Do not commit.',
  ].join('\n')
}

export function buildChangeReviewPrompt(request: ChangeRequest, reviewPath: string, proposed: Story[]): string {
  return [
    'Independently review whether a proposed append-only plan fully covers one product change.',
    `Change request ${request.id}: ${request.request}`,
    '',
    'Check every distinct requested outcome, edge case, and state transition against the proposed stories and their criteria.',
    'Approve only when every distinct requested outcome has a behavioral criterion and a criterion-specific verify command.',
    'Do not assume a broad test suite proves an outcome. List every omission in uncovered.',
    '',
    `Proposed stories: ${JSON.stringify(proposed, null, 2)}`,
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
  commit?: (prdPath: string, request: ChangeRequest) => void
  archive?: (targetDir: string, request: ChangeRequest) => void
  permissions?: PermissionProfile
  selection?: ModelSelection
}

export interface ChangeApplyResult {
  ok: boolean
  added: number
  summary: string
  changeId?: string
}

function archiveRequest(targetDir: string, request: ChangeRequest): void {
  mkdirSync(appliedDir(targetDir), { recursive: true })
  renameSync(requestFile(targetDir, request.id), join(appliedDir(targetDir), `${request.id}.json`))
  rmSync(proposalFile(targetDir, request.id), { force: true })
  rmSync(reviewFile(targetDir, request.id), { force: true })
}

export function runChangeApply(targetDir: string, opts: ChangeApplyOptions): ChangeApplyResult {
  let requests: ChangeRequest[]
  try { requests = pendingChanges(targetDir) } catch (error) {
    return { ok: false, added: 0, summary: `invalid pending request: ${(error as Error).message}` }
  }
  const request = requests[0]
  if (!request) return { ok: true, added: 0, summary: 'inbox empty' }

  const prdPath = join(targetDir, '.yoke', 'prd.yaml')
  const existingText = readFileSync(prdPath, 'utf8')
  const existing = loadPrd(prdPath)
  if (existing.some(story => story.sourceChange === request.id)) {
    if (!prdIsCommitted(targetDir)) {
      return {
        ok: false,
        added: 0,
        summary: `PRD contains change ${request.id} only as uncommitted recovery state; keeping the request pending`,
        changeId: request.id,
      }
    }
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
  const plannerDir = changesDir(targetDir)
  mkdirSync(plannerDir, { recursive: true })
  rmSync(proposal, { force: true })
  const base = agentInvocation(
    opts.runner,
    buildChangePrompt(request, proposal, existing),
    plannerDir,
    opts.permissions ?? 'safe',
    opts.selection,
  )
  const invocation = buildWatchdogInvocation(base, opts.timeoutMs ?? 0)
  const result = (opts.run ?? runAgent)(invocation)
  if (!result.success) return { ok: false, added: 0, summary: `planner failed: ${result.summary}`, changeId: request.id }
  if (readFileSync(prdPath, 'utf8') !== existingText) {
    return {
      ok: false,
      added: 0,
      summary: 'PRD changed while the planner was running; refusing to overwrite concurrent or out-of-contract edits',
      changeId: request.id,
    }
  }
  if (!existsSync(proposal)) return { ok: false, added: 0, summary: `planner did not write ${basename(proposal)}`, changeId: request.id }

  let proposed: Story[]
  try { proposed = parsePrd(proposal) } catch (error) {
    return { ok: false, added: 0, summary: `invalid story proposal: ${(error as Error).message}`, changeId: request.id }
  }
  if (proposed.length === 0) return { ok: false, added: 0, summary: 'planner proposed no stories', changeId: request.id }
  const existingIds = new Set(existing.map(story => story.id))
  const proposedIds = new Set<string>()
  for (const story of proposed) {
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

  const appended = proposed.map(story => ({ ...story, sourceChange: request.id }))
  const dependencyIssues = validateDependencies([...existing, ...appended])
  if (dependencyIssues.length > 0) {
    return { ok: false, added: 0, summary: `invalid combined dependency graph: ${dependencyIssues.join('; ')}`, changeId: request.id }
  }
  const reviewPath = reviewFile(targetDir, request.id)
  rmSync(reviewPath, { force: true })
  const reviewBase = agentInvocation(
    reviewer,
    buildChangeReviewPrompt(request, reviewPath, appended),
    plannerDir,
    opts.permissions ?? 'safe',
    reviewer === opts.runner ? opts.selection : undefined,
  )
  const reviewInvocation = buildWatchdogInvocation(reviewBase, opts.timeoutMs ?? 0)
  const reviewResult = (opts.review ?? runAgent)(reviewInvocation)
  if (!reviewResult.success) {
    return { ok: false, added: 0, summary: `coverage review failed: ${reviewResult.summary}`, changeId: request.id }
  }
  if (readFileSync(prdPath, 'utf8') !== existingText) {
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
    coverageReview = ChangeReviewSchema.parse(JSON.parse(readFileSync(reviewPath, 'utf8')))
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
  try {
    savePrd(prdPath, [...existing, ...appended])
    ;(opts.commit ?? ((path, change) => commitPaths(targetDir, [path], `yoke: plan change ${change.id}`)))(prdPath, request)
  } catch (error) {
    writeFileSync(prdPath, existingText)
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
