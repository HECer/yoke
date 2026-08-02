import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendDecision, contextDir, type DecisionAppendPlan } from '../context/context.js'
import { loadConfig } from '../retrofit/config.js'
import { resolveCommitIdentity } from './identity.js'
import { commitPaths, realGitOps } from './git.js'
import { acquireLock, releaseLock } from './lock.js'
import { loadPrd, selectNextStory } from './prd.js'

const singleLine = (max: number) => z.string().trim().min(1).max(max).refine(
  value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
  'must be a single line without control or bidi-formatting characters',
)

const MAX_STATE_BYTES = 256 * 1024

const DecisionOptionSchema = z.object({
  id: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  label: singleLine(200),
  tradeoff: singleLine(500).optional(),
})

export const DecisionRequestSchema = z.object({
  version: z.literal(1),
  occurrenceId: z.string().regex(/^[a-f0-9]{16}$/u).optional(),
  storyId: singleLine(128),
  question: singleLine(500),
  reason: singleLine(1000),
  options: z.array(DecisionOptionSchema).min(2).max(4),
  recommended: singleLine(32),
}).superRefine((request, ctx) => {
  const ids = new Set<string>()
  const labels = new Set<string>()
  request.options.forEach((option, index) => {
    const id = option.id.toLowerCase()
    const label = option.label.toLowerCase()
    if (ids.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', index, 'id'], message: 'option IDs must be unique' })
    if (labels.has(label)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options', index, 'label'], message: 'option labels must be unique' })
    ids.add(id)
    labels.add(label)
  })
})

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>

const DecisionJournalSchema = z.object({
  version: z.literal(1),
  phase: z.enum(['claimed', 'committed']),
  requestId: z.string().regex(/^[a-f0-9]{16}$/u),
  request: DecisionRequestSchema,
  answer: z.object({
    selectedId: singleLine(32), rationale: singleLine(1000).optional(),
    answerId: z.string().regex(/^[a-f0-9]{16}$/u),
  }).optional(),
  append: z.object({
    fileExisted: z.boolean(), priorBytes: z.number().int().nonnegative(),
    priorHash: z.string().regex(/^[a-f0-9]{64}$/u), block: z.string().min(1).max(16_384),
  }).optional(),
})

type DecisionJournal = z.infer<typeof DecisionJournalSchema>

export const DecisionResumeSchema = z.object({
  version: z.literal(1),
  storyId: singleLine(128),
  requestId: z.string().regex(/^[a-f0-9]{16}$/u),
  answered: z.boolean().optional(),
  maxIterations: z.number().int().positive(),
  agent: z.enum(['claude', 'codex', 'gemini']).optional(),
  isolate: z.boolean().optional(),
  reviewer: z.enum(['claude', 'codex', 'gemini']).optional(),
  review: z.boolean().optional(),
  allowSelfReview: z.boolean().optional(),
  timeoutMinutes: z.number().nonnegative().optional(),
  json: z.boolean().optional(),
  onAmbiguity: z.enum(['resolve', 'abort']).optional(),
  decisionPolicy: z.enum(['auto', 'critical']).optional(),
  permissions: z.enum(['safe', 'unsafe', 'read-only']).optional(),
  parallel: z.number().int().positive().optional(),
  routing: z.boolean().optional(),
  projectId: z.string().regex(/^[a-f0-9]{16}$/u).optional(),
  baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/u).optional(),
  prdHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  decisionCommit: z.string().regex(/^[a-f0-9]{40,64}$/u).optional(),
  answerId: z.string().regex(/^[a-f0-9]{16}$/u).optional(),
})

export type DecisionResumeState = z.infer<typeof DecisionResumeSchema>

export function decisionRequestPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'decision-request.yaml')
}

export function pendingDecisionPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'pending-decision.yaml')
}

export function decisionResumePath(targetDir: string): string {
  const projectId = projectBinding(targetDir).projectId
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return join(resolve(targetDir, gitDir), 'yoke', `decision-resume-${projectId}.yaml`)
  } catch {
    // Unit-test/non-git fallback. Real loop projects are git repositories.
    return join(targetDir, '.yoke', `decision-resume-${projectId}.yaml`)
  }
}

function decisionAnsweringPath(targetDir: string): string {
  return join(targetDir, '.yoke', 'decision-answering.yaml')
}

export function decisionRequestId(request: DecisionRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16)
}

export function decisionAnswerId(requestId: string, selectedId: string, rationale?: string): string {
  return createHash('sha256').update(JSON.stringify({ requestId, selectedId, rationale })).digest('hex').slice(0, 16)
}

function writeYamlAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, stringify(value))
    renameSync(temp, path)
  } finally {
    try { unlinkSync(temp) } catch { /* renamed or already cleaned */ }
  }
}

function writeDecisionJournal(targetDir: string, journal: DecisionJournal): void {
  writeYamlAtomic(decisionAnsweringPath(targetDir), DecisionJournalSchema.parse(journal))
}

function parseYamlFile(path: string): unknown {
  const size = statSync(path).size
  if (size > MAX_STATE_BYTES) throw new Error(`${path} exceeds the ${MAX_STATE_BYTES}-byte state-file limit`)
  return parse(readFileSync(path, 'utf8'))
}

function hashFile(path: string): string {
  const content = existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
  return createHash('sha256').update(content).digest('hex')
}

function projectBinding(targetDir: string): { projectId: string; head?: string; prdHash: string } {
  let canonical: string
  try { canonical = realpathSync.native(targetDir) } catch { canonical = resolve(targetDir) }
  const pathIdentity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  const projectId = createHash('sha256').update(pathIdentity).digest('hex').slice(0, 16)
  let head: string | undefined
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { /* non-git test/project */ }
  return { projectId, head, prdHash: hashFile(join(targetDir, '.yoke', 'prd.yaml')) }
}

function committedDecisionText(targetDir: string): string | null {
  try {
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return execFileSync('git', ['show', `HEAD:${prefix}.yoke/context/DECISIONS.md`], { cwd: targetDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return null
  }
}

function committedAnswerId(targetDir: string, requestId: string): string | undefined {
  const committed = committedDecisionText(targetDir)
  if (!committed) return undefined
  const match = committed.match(new RegExp(`Request-ID: ${requestId}\\r?\\nAnswer-ID: ([a-f0-9]{16})`, 'u'))
  return match?.[1]
}

export function decisionProcessingExists(targetDir: string): boolean {
  return existsSync(decisionAnsweringPath(targetDir))
}

function rollbackClaimedAppend(targetDir: string, append: DecisionAppendPlan | undefined): void {
  if (!append) return
  const file = join(contextDir(targetDir), 'DECISIONS.md')
  if (!existsSync(file)) {
    if (append.fileExisted) throw new Error('decision context disappeared while recovering an answer')
    return
  }
  const current = readFileSync(file)
  const currentHash = createHash('sha256').update(current).digest('hex')
  if (current.length === append.priorBytes && currentHash === append.priorHash) return
  const block = Buffer.from(append.block)
  if (current.length < block.length || !current.subarray(current.length - block.length).equals(block)) {
    throw new Error('decision context changed after the interrupted answer; refusing an unsafe rollback')
  }
  const prior = current.subarray(0, current.length - block.length)
  if (prior.length !== append.priorBytes || createHash('sha256').update(prior).digest('hex') !== append.priorHash) {
    throw new Error('decision context prefix does not match the interrupted answer journal')
  }
  if (append.fileExisted) writeFileSync(file, prior)
  else rmSync(file, { force: true })
  try { execFileSync('git', ['reset', '--quiet', '--', '.yoke/context/DECISIONS.md'], { cwd: targetDir, stdio: 'ignore' }) } catch { /* non-git or unstaged */ }
}

type RecoveryResult = { status: 'none' | 'restored' | 'committed'; journal?: DecisionJournal }

export function recoverDecisionProcessing(
  targetDir: string,
  isAnswerCommitted?: (targetDir: string, requestId: string, answerId: string) => boolean,
): RecoveryResult {
  const processing = decisionAnsweringPath(targetDir)
  if (!existsSync(processing)) return { status: 'none' }
  const raw = parseYamlFile(processing)
  const journalResult = DecisionJournalSchema.safeParse(raw)
  const journal: DecisionJournal = journalResult.success
    ? journalResult.data
    : (() => {
        const request = DecisionRequestSchema.parse(raw)
        return { version: 1, phase: 'claimed', requestId: decisionRequestId(request), request }
      })()
  if (journal.answer && (
    committedAnswerId(targetDir, journal.requestId) === journal.answer.answerId
    || isAnswerCommitted?.(targetDir, journal.requestId, journal.answer.answerId) === true
  )) {
    return { status: 'committed', journal }
  }
  rollbackClaimedAppend(targetDir, journal.append)
  const pending = pendingDecisionPath(targetDir)
  if (existsSync(pending)) {
    const existing = readRequest(pending)
    if (decisionRequestId(existing) !== journal.requestId) {
      throw new Error('processing journal and pending decision refer to different requests')
    }
  } else {
    writeFileSync(pending, stringify(journal.request))
  }
  unlinkSync(processing)
  return { status: 'restored', journal }
}

export function writeDecisionResume(targetDir: string, state: DecisionResumeState): void {
  const binding = projectBinding(targetDir)
  const parsed = DecisionResumeSchema.parse({
    ...state,
    projectId: state.projectId ?? binding.projectId,
    baseCommit: state.baseCommit ?? binding.head,
    prdHash: state.prdHash ?? binding.prdHash,
    decisionCommit: state.answered ? (state.decisionCommit ?? binding.head) : undefined,
    answerId: state.answered ? (state.answerId ?? committedAnswerId(targetDir, state.requestId)) : undefined,
  })
  const path = decisionResumePath(targetDir)
  writeYamlAtomic(path, parsed)
}

export function readDecisionResume(targetDir: string): DecisionResumeState | null {
  const path = decisionResumePath(targetDir)
  return existsSync(path) ? DecisionResumeSchema.parse(parseYamlFile(path)) : null
}

export function clearDecisionResume(targetDir: string): void {
  try { unlinkSync(decisionResumePath(targetDir)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function decisionResumeMatchesCurrent(targetDir: string, state: DecisionResumeState): boolean {
  const parsedState = DecisionResumeSchema.parse(state)
  const binding = projectBinding(targetDir)
  let request = readPendingDecision(targetDir)
  let processingCommitted = false
  if (!request && decisionProcessingExists(targetDir)) {
    const raw = parseYamlFile(decisionAnsweringPath(targetDir))
    const journal = DecisionJournalSchema.safeParse(raw)
    request = journal.success ? journal.data.request : DecisionRequestSchema.parse(raw)
    processingCommitted = journal.success
      && journal.data.answer !== undefined
      && committedAnswerId(targetDir, journal.data.requestId) === journal.data.answer.answerId
  }
  return parsedState.projectId === binding.projectId
    && (parsedState.baseCommit === binding.head || processingCommitted)
    && parsedState.prdHash === binding.prdHash
    && request !== null
    && parsedState.storyId === request.storyId
    && parsedState.requestId === decisionRequestId(request)
}

export function answeredDecisionResumeIsValid(targetDir: string, state: DecisionResumeState): boolean {
  const parsedState = DecisionResumeSchema.parse(state)
  const binding = projectBinding(targetDir)
  if (!parsedState.answered || !parsedState.decisionCommit || parsedState.projectId !== binding.projectId || parsedState.prdHash !== binding.prdHash) return false
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', parsedState.decisionCommit, 'HEAD'], { cwd: targetDir, stdio: 'ignore' })
  } catch { return false }
  return parsedState.answerId !== undefined && committedAnswerId(targetDir, parsedState.requestId) === parsedState.answerId
}

export function finalizeCommittedDecisionResume(targetDir: string, state: DecisionResumeState): DecisionResumeState | null {
  const parsedState = DecisionResumeSchema.parse(state)
  const answerId = committedAnswerId(targetDir, parsedState.requestId)
  if (!answerId) return null
  writeDecisionResume(targetDir, { ...parsedState, answered: true, answerId })
  return readDecisionResume(targetDir)
}

function readRequest(path: string): DecisionRequest {
  const request = DecisionRequestSchema.parse(parseYamlFile(path))
  if (!request.options.some(option => option.id === request.recommended)) {
    throw new Error(`recommended option "${request.recommended}" is not present in options`)
  }
  return request
}

export function consumeDecisionRequest(sourceDir: string, targetDir: string = sourceDir, expectedStoryId?: string): DecisionRequest | null {
  const source = decisionRequestPath(sourceDir)
  if (!existsSync(source)) return null
  const parsedRequest = readRequest(source)
  // The agent controls request content; the harness controls occurrence identity.
  // Identical questions asked twice must never bind to the same historical answer.
  const request = DecisionRequestSchema.parse({
    ...parsedRequest,
    occurrenceId: randomUUID().replaceAll('-', '').slice(0, 16),
  })
  if (expectedStoryId && request.storyId !== expectedStoryId) {
    throw new Error(`decision request storyId "${request.storyId}" does not match active story "${expectedStoryId}"`)
  }
  const pending = pendingDecisionPath(targetDir)
  mkdirSync(dirname(pending), { recursive: true })
  writeYamlAtomic(pending, request)
  unlinkSync(source)
  return request
}

export function readPendingDecision(targetDir: string): DecisionRequest | null {
  const path = pendingDecisionPath(targetDir)
  return existsSync(path) ? readRequest(path) : null
}

export function formatPendingDecision(targetDir: string): string {
  const request = readPendingDecision(targetDir)
  if (!request) return 'No pending Yoke decision.'
  return [
    `Story ${request.storyId}: ${request.question}`,
    `Why this is critical: ${request.reason}`,
    ...request.options.map(option => `  ${option.id}: ${option.label}${option.tradeoff ? ` — ${option.tradeoff}` : ''}`),
    `recommended: ${request.recommended}`,
  ].join('\n')
}

export interface AnswerDecisionOptions {
  choice: string
  rationale?: string
  commit?: (targetDir: string, message: string) => void
  isClean?: (targetDir: string) => boolean
  removeProcessing?: (path: string) => void
  isAnswerCommitted?: (targetDir: string, requestId: string, answerId: string) => boolean
  onCommitted?: (requestId: string, answerId: string) => void
}

function selectedAnswer(request: DecisionRequest, choice: string): DecisionRequest['options'][number] | undefined {
  const normalized = choice.trim().toLowerCase()
  return request.options.find(option => option.id.toLowerCase() === normalized || option.label.toLowerCase() === normalized)
}

export function answerPendingDecision(targetDir: string, opts: AnswerDecisionOptions): number {
  let lock: ReturnType<typeof acquireLock>
  try { lock = acquireLock(targetDir) } catch (error) {
    console.error(`Cannot acquire the Yoke decision lock: ${(error as Error).message}`)
    return 1
  }
  if (!lock.acquired) {
    console.error(`Cannot answer while another Yoke loop/answer process holds the lock (pid ${lock.holderPid}).`)
    return 1
  }
  try {
    let recovery: RecoveryResult
    try {
      recovery = recoverDecisionProcessing(targetDir, opts.isAnswerCommitted)
    } catch (error) {
      console.error(`Could not recover the prior decision answer: ${(error as Error).message}`)
      return 1
    }
    if (recovery.status === 'committed' && recovery.journal) {
      const selected = selectedAnswer(recovery.journal.request, opts.choice)
      const rationale = opts.rationale?.trim() || undefined
      if (!selected || !recovery.journal.answer) {
        console.error('The prior answer was committed, but its exact selection cannot be verified. Inspect DECISIONS.md before continuing.')
        return 1
      }
      if (selected.id !== recovery.journal.answer.selectedId || rationale !== recovery.journal.answer.rationale) {
        console.error(`Decision ${recovery.journal.requestId} was already committed as ${recovery.journal.answer.selectedId}${recovery.journal.answer.rationale ? ` (${recovery.journal.answer.rationale})` : ''}; refusing a conflicting replay.`)
        return 1
      }
      try { opts.onCommitted?.(recovery.journal.requestId, recovery.journal.answer.answerId) } catch (error) {
        console.error(`The decision is committed, but trusted resume state could not be finalized: ${(error as Error).message}`)
        return 1
      }
      unlinkSync(decisionAnsweringPath(targetDir))
      console.log('The identical decision answer was already committed; recovered its cleanup state.')
      return 0
    }
    let request: DecisionRequest | null
    try { request = readPendingDecision(targetDir) } catch (error) {
      console.error(`Invalid pending decision: ${(error as Error).message}`)
      return 1
    }
    if (!request) {
      console.error('No pending Yoke decision.')
      return 1
    }
    if (!request.occurrenceId) {
      request = DecisionRequestSchema.parse({ ...request, occurrenceId: randomUUID().replaceAll('-', '').slice(0, 16) })
      writeYamlAtomic(pendingDecisionPath(targetDir), request)
    }

    const prdFile = join(targetDir, '.yoke', 'prd.yaml')
    let activeStoryId: string | undefined
    try { activeStoryId = existsSync(prdFile) ? selectNextStory(loadPrd(prdFile))?.id : undefined } catch (error) {
      console.error(`Cannot validate the pending decision against the PRD: ${(error as Error).message}`)
      return 1
    }
    if (activeStoryId !== request.storyId) {
      console.error(`Pending decision is for story "${request.storyId}", but the current open story is "${activeStoryId ?? 'none'}". The pending decision was kept.`)
      return 1
    }

    const clean = opts.isClean ? opts.isClean(targetDir) : opts.commit ? true : realGitOps.isClean(targetDir)
    if (!clean) {
      console.error('Cannot record the decision while the working tree has uncommitted story changes. Review or clean them first; the pending decision was kept.')
      return 1
    }
    const selected = selectedAnswer(request, opts.choice)
    if (!selected) {
      console.error(`Unknown choice "${opts.choice}". Expected one of: ${request.options.map(option => option.id).join(', ')}`)
      return 1
    }
    const rationale = opts.rationale?.trim() || undefined
    if (rationale && !singleLine(1000).safeParse(rationale).success) {
      console.error('Decision rationale must be a single line of at most 1000 characters.')
      return 1
    }

    const pending = pendingDecisionPath(targetDir)
    const processing = decisionAnsweringPath(targetDir)
    if (existsSync(processing)) {
      console.error(`A prior decision answer is still being recovered at ${processing}; resolve it before retrying.`)
      return 1
    }
    const requestId = decisionRequestId(request)
    const answer = { selectedId: selected.id, rationale, answerId: decisionAnswerId(requestId, selected.id, rationale) }
    try {
      renameSync(pending, processing)
      writeDecisionJournal(targetDir, { version: 1, phase: 'claimed', requestId, request, answer })
    } catch (error) {
      try { if (existsSync(processing) && !existsSync(pending)) renameSync(processing, pending) } catch { /* recover on next answer */ }
      console.error(`Could not claim pending decision: ${(error as Error).message}`)
      return 1
    }

    const summary = [
      `Decision: ${JSON.stringify(`${selected.id} — ${selected.label}`)}`,
      rationale ? `Rationale: ${JSON.stringify(rationale)}` : undefined,
      `Request-ID: ${requestId}`,
      `Answer-ID: ${answer.answerId}`,
    ].filter(Boolean).join('\n')
    let appendPlan: DecisionAppendPlan | undefined
    let appended: { rollback: () => void }
    try {
      appended = appendDecision(contextDir(targetDir), {
        storyId: request.storyId,
        title: JSON.stringify(request.question),
        summary,
      }, new Date(), plan => {
        appendPlan = plan
        writeDecisionJournal(targetDir, { version: 1, phase: 'claimed', requestId, request, answer, append: plan })
      })
    } catch (error) {
      console.error(`Could not prepare the decision context safely: ${(error as Error).message}. The recovery journal was kept.`)
      return 1
    }
    try {
      if (opts.commit) opts.commit(targetDir, `yoke: decide ${request.storyId} ${request.question}`)
      else {
        const config = loadConfig(targetDir)
        const identity = resolveCommitIdentity(targetDir, config?.commit)
        const contextFile = relative(targetDir, join(contextDir(targetDir), 'DECISIONS.md'))
        commitPaths(targetDir, [contextFile], `yoke: decide ${request.storyId} ${request.question}`, identity)
      }
    } catch (error) {
      appended.rollback()
      try {
        writeFileSync(pending, stringify(request))
        unlinkSync(processing)
      } catch { /* keep recovery journal if restoration fails */ }
      console.error(`Could not record decision: ${(error as Error).message}`)
      return 1
    }
    try { writeDecisionJournal(targetDir, { version: 1, phase: 'committed', requestId, request, answer, append: appendPlan }) } catch (error) {
      console.warn(`Decision was committed, but its recovery marker could not be updated: ${(error as Error).message}`)
    }
    try { opts.onCommitted?.(requestId, answer.answerId) } catch (error) {
      console.error(`Decision was committed, but trusted resume state could not be finalized: ${(error as Error).message}. The recovery journal was kept.`)
      return 1
    }
    try { (opts.removeProcessing ?? unlinkSync)(processing) } catch (error) {
      console.warn(`Decision was committed, but cleanup of ${processing} failed: ${(error as Error).message}. It will not be committed again.`)
    }
    console.log(`Recorded ${request.storyId} decision: ${selected.id} — ${selected.label}`)
    return 0
  } finally {
    releaseLock(targetDir, lock.ownerToken)
  }
}
