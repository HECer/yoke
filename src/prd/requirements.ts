import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { criterionCommandProblem, isAcceptanceCriterion, loadPrd, type Story } from '../loop/prd.js'
import { writeScopesOverlap } from '../loop/scheduler.js'
import { readPlanningFile } from '../routing/contracts.js'
import { planningSourceDigest } from '../routing/planning-source.js'

export const MAX_REQUIREMENTS_BYTES = 200_000
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const id = z.string().min(1).max(120)
const reference = z.object({ story: id, criterion: id }).strict()
const entry = z.object({ id, text: z.string().min(1).max(2_000), criteria: z.array(reference).min(1).max(50) }).strict()
export const RequirementsSchema = z.object({
  version: z.literal(1),
  objective: z.object({ idea: z.string().min(1).max(20_000), approvedPlanSha256: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  requirements: z.array(entry).min(1).max(100),
  invariants: z.array(entry).max(50),
}).strict()
export type RequirementsLedger = z.infer<typeof RequirementsSchema>

/** Bind the exact original input, independently of planner-generated summaries. */
export function requirementObjective(idea: string, brief = ''): RequirementsLedger['objective'] {
  const source = { idea, approvedPlanSha256: planningSourceDigest(brief) }
  return { ...source, sha256: digest(JSON.stringify(source)) }
}

export function readRequirements(root: string): RequirementsLedger | undefined {
  const source = readPlanningFile(root, '.yoke/requirements.yaml', MAX_REQUIREMENTS_BYTES)
  return source === undefined ? undefined : RequirementsSchema.parse(parse(source, { maxAliasCount: 10 }))
}

export function requirementsDigest(root: string): string {
  const source = readPlanningFile(root, '.yoke/requirements.yaml', MAX_REQUIREMENTS_BYTES)
  return source === undefined ? '' : planningSourceDigest(source)
}

export function validateRequirements(ledger: RequirementsLedger, stories: Story[], brief = '', expectedIdea?: string): void {
  const objective = requirementObjective(expectedIdea ?? ledger.objective.idea, brief)
  if (ledger.objective.idea !== objective.idea || ledger.objective.approvedPlanSha256 !== objective.approvedPlanSha256 || ledger.objective.sha256 !== objective.sha256) throw Error('Stale requirement objective or approved source binding')
  if (stories.some(story => story.requirementsFor !== undefined && story.requirementsFor !== ledger.objective.sha256)) throw Error('Requirement objective differs from host-owned PRD binding')
  if (stories.length > 2_000) throw Error('Requirement coverage exceeds story limit')
  const byId = new Map(stories.map(s => [s.id, s]))
  if (byId.size !== stories.length) throw Error('Ambiguous requirement story reference')
  const seen = new Set<string>()
  for (const item of [...ledger.requirements, ...ledger.invariants]) {
    if (seen.has(item.id)) throw Error(`Duplicate requirement/invariant id ${item.id}`)
    seen.add(item.id)
    const refs = new Set<string>()
    for (const ref of item.criteria) {
      const key = JSON.stringify(ref)
      if (refs.has(key)) throw Error(`Duplicate coverage reference for ${item.id}`)
      refs.add(key)
      const criteria = byId.get(ref.story)?.acceptance.filter(isAcceptanceCriterion).filter(c => c.id === ref.criterion) ?? []
      if (criteria.length !== 1) throw Error(`Invalid or ambiguous coverage ${item.id}: ${ref.story}/${ref.criterion}`)
      const issue = criterionCommandProblem(criteria[0])
      if (issue) throw Error(issue)
    }
  }
  const ancestors = new Map<string, Set<string>>()
  const upstream = (story: Story): Set<string> => {
    if (ancestors.has(story.id)) return ancestors.get(story.id)!
    const found = new Set<string>(); ancestors.set(story.id, found)
    for (const need of story.needs ?? []) { found.add(need); for (const id of upstream(byId.get(need)!)) found.add(id) }
    return found
  }
  for (const story of stories) {
    if (!story.writes?.length) throw Error(`Missing write ownership for ${story.id}`)
    if (story.acceptance.length === 0 || story.acceptance.some(c => !isAcceptanceCriterion(c))) throw Error(`Requirement coverage needs structured executable criteria for ${story.id}`)
    for (const criterion of story.acceptance.filter(isAcceptanceCriterion)) {
      const issue = criterionCommandProblem(criterion)
      if (issue) throw Error(issue)
    }
    upstream(story)
  }
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) {
    const a = stories[i], b = stories[j]
    if (writeScopesOverlap(a.writes, b.writes) && !ancestors.get(a.id)!.has(b.id) && !ancestors.get(b.id)!.has(a.id)) throw Error(`Shared write ownership overlap requires a dependency: ${a.id}, ${b.id}`)
  }
}

/** Binding content is never silently truncated. Invariants apply to every task. */
export function requirementsPacket(root: string, storyId?: string): string | undefined {
  const ledger = readRequirements(root)
  const file = join(root, '.yoke', 'prd.yaml')
  if (!ledger) {
    if (existsSync(file)) loadPrd(file)
    return undefined
  }
  loadPrd(file)
  const entries = (items: RequirementsLedger['requirements']) => items.map(item => `${item.id}: ${item.text}\nEvidence: ${item.criteria.map(r => `${r.story}/${r.criterion}`).join(', ')}`).join('\n')
  return [
    '## Original objective and requirement coverage',
    ledger.objective.idea,
    `Objective SHA-256: ${ledger.objective.sha256}; approved plan SHA-256: ${ledger.objective.approvedPlanSha256}`,
    entries(ledger.requirements.filter(item => !storyId || item.criteria.some(ref => ref.story === storyId))),
    '## Preserved invariants (apply throughout implementation)', entries(ledger.invariants),
    'Mechanical coverage is not proof of semantic completeness. Review the original objective, preserved capabilities, boundary behavior and test adequacy.',
  ].join('\n')
}
