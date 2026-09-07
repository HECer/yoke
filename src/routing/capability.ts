import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, RoutingWorker, YokeConfig } from '../retrofit/config.js'
import type { ModelSelection } from '../agents/types.js'
import type { Story } from '../loop/prd.js'
import { AssessmentSchema, assessmentKey, requiredTier, tiers, type TaskAssessment } from './assessment.js'
import { projectHash, readRoutingObservations, type RoutingObservation } from './registry.js'
import { currentContractKey } from './contracts.js'

export function knownInfrastructureFailure(summary: string): boolean {
  return /\bENOENT\b|\bECONNREFUSED\b|\bETIMEDOUT\b|CreateProcess(?:AsUserW|W)? failed|Failed to create unified exec process|command not found|is not recognized as|Missing script:|rate limit exceeded|authentication failed|AuthRequired|No access token was provided|invalid api key|credentials (?:missing|not found)|quota exceeded/i.test(summary)
}

function statePath(root: string, key: string, create = false): string {
  let dir = root
  for (const part of ['.yoke', 'routing']) {
    dir = join(dir, part)
    if (create && !existsSync(dir)) mkdirSync(dir)
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw new Error('Linked routing state is not allowed')
  }
  const file = join(dir, `${key}.json`)
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || lstatSync(file).size > 32768)) throw new Error('Invalid routing state')
  return file
}

export function routingAssessmentKey(root: string, story: Story): string {
  return assessmentKey({ ...story, assessmentFor: currentContractKey(root, story) })
}

export function readAssessment(root: string, story: Story, requireBound = false): TaskAssessment | undefined {
  const contract = currentContractKey(root, story)
  if (story.assessment && (story.assessmentFor === contract || (!requireBound && !story.assessmentFor))) return story.assessment
  const file = statePath(root, routingAssessmentKey(root, story))
  if (!existsSync(file)) return undefined
  return AssessmentSchema.parse(JSON.parse(readFileSync(file, 'utf8')).assessment)
}

export function saveAssessment(root: string, story: Story, assessment: TaskAssessment, planner: { provider: Agent; model?: string }): void {
  const file = statePath(root, routingAssessmentKey(root, story), true)
  const value = { version: 1, assessment: AssessmentSchema.parse(assessment), planner, createdAt: new Date().toISOString() }
  try { writeFileSync(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
}

export function taskOutcomes(root: string, story: Story): RoutingObservation[] {
  return readRoutingObservations().filter(e => e.projectHash === projectHash(root) && e.assessmentKey === routingAssessmentKey(root, story) && e.role === 'implementation' && e.failureKind !== 'infrastructure')
}

export function chooseCapability(input: {
  root: string; story: Story; assessment: TaskAssessment; workers: RoutingWorker[];
  parent: Agent; parentSelection?: ModelSelection; role?: 'implementation' | 'reviewer' | 'critic' | 'repair';
  available?: (agent: Agent) => boolean; maxAttempts?: number;
  repairRound?: number;
  fallback?: 'parent' | 'block';
  maxTier?: import('./assessment.js').CapabilityTier;
}) {
  const role = input.role ?? 'implementation'
  const events = taskOutcomes(input.root, input.story)
  const lastSuccess = events.map(e => e.verificationSuccess).lastIndexOf(true)
  const failures = events.slice(lastSuccess + 1).filter(e => e.verificationSuccess === false)
  const baseTier = requiredTier(input.assessment, role)
  const level = Math.min(3, tiers.indexOf(baseTier) + Math.max(0, failures.length - 1, (input.repairRound ?? 1) - 1))
  const exhausted = failures.length >= Math.min(input.maxAttempts ?? 5, 5 - tiers.indexOf(baseTier))
  const candidates = input.workers.filter(w => w.tier && tiers.indexOf(w.tier) >= level && (!input.maxTier || tiers.indexOf(w.tier) <= tiers.indexOf(input.maxTier)) && (!w.roles || w.roles.includes(role)) && (!input.story.agent || w.agent === input.story.agent) && (input.available?.(w.agent) ?? true))
  const history = readRoutingObservations().filter(e => e.projectHash === projectHash(input.root) && e.taskClass === input.assessment.taskClass && e.requiredTier === baseTier && e.role === role && e.failureKind !== 'infrastructure' && Date.now() - Date.parse(e.recordedAt) < 30 * 86400000)
  const evidence = (w: RoutingWorker) => {
    const matching = history.filter(e => e.provider === w.agent && e.requestedModel === w.model && e.requestedReasoningEffort === w.reasoningEffort && e.actualModel)
    const actual = matching.at(-1)?.actualModel
    return actual ? matching.filter(e => e.actualModel === actual) : []
  }
  // Evidence can exclude a repeatedly unsuccessful profile, never lower the planner's safety floor.
  const reliable = candidates.filter(w => { const rows = evidence(w); return rows.length < 10 || rows.filter(e => e.verificationSuccess).length / rows.length >= 0.8 })
  const cost = { low: 0, medium: 1, high: 2 }
  reliable.sort((a, b) => tiers.indexOf(a.tier!) - tiers.indexOf(b.tier!) || cost[a.costTier] - cost[b.costTier] || a.id.localeCompare(b.id))
  const worker = reliable[0]
  const blocked = !worker && (input.fallback === 'block' || input.maxTier !== undefined)
  const provider = worker?.agent ?? input.story.agent ?? input.parent
  const selection: ModelSelection = worker ? { model: worker.model, reasoningEffort: worker.reasoningEffort, nativeMultiAgent: false, ...(provider !== 'gemini' && provider !== 'qwen' && input.parentSelection?.bare !== undefined ? { bare: input.parentSelection.bare } : {}) }
    : { ...(provider === input.parent ? input.parentSelection : {}), nativeMultiAgent: false }
  const reason = `${role}: ${tiers[level]}; ${input.assessment.reason}${failures.length ? `; ${failures.length} verified failure(s), ${failures.length === 1 ? 'one targeted repair' : 'escalated'}` : ''}${worker ? '' : '; no eligible profile, parent/provider fallback'}`
  return { worker, provider, selection, reason: blocked ? `${role}: no eligible profile within routing limits; execution blocked` : reason, blocked, requiredTier: baseTier, selectedTier: tiers[level], failures: failures.length, exhausted, next: input.maxTier && level >= tiers.indexOf(input.maxTier) ? 'stop at configured tier limit' : level < 3 ? tiers[level + 1] : 'stop after bounded attempts' }
}

/** Explicit role models are resolved by callers before consulting this fallback. */
export function roleSelection(root: string, config: YokeConfig, story: Story, provider: Agent, role: 'reviewer' | 'critic' | 'repair', repairRound = 1): ModelSelection | undefined {
  if (!config.routing?.enabled || config.routing.strategy !== 'capability') return undefined
  const assessment = readAssessment(root, story, config.routing.assessmentPolicy === 'prepared')
  if (!assessment) {
    if (config.routing.assessmentPolicy === 'prepared') throw Error('Prepare current task assessments before role execution')
    return undefined
  }
  const choice = chooseCapability({ root, story: { ...story, agent: provider }, assessment, workers: config.routing.workers, parent: provider,
    parentSelection: provider === config.runner?.agent ? config.runner : undefined, role, repairRound, maxAttempts: config.routing.maxAttempts, fallback: config.routing.fallback, maxTier: config.routing.maxTier })
  if (choice.blocked) throw Error(choice.reason)
  return choice.selection
}
