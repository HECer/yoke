import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Story } from '../loop/prd.js'
import { RequirementsSchema, type RequirementsLedger } from '../prd/requirements.js'
import { normalizePlanningBytes } from './planning-source.js'

export function readPlanningFile(root: string, relative: string, maxBytes = 1_048_576): string | undefined {
  let file = root
  for (const part of relative.split('/')) {
    file = join(file, part)
    let stat
    try { stat = lstatSync(file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (stat.isSymbolicLink()) throw Error('Linked planning state is unavailable')
  }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size > maxBytes) throw Error('Planning state exceeds its file limit')
  return readFileSync(file, 'utf8')
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Progress, priority and model output do not change a task's requirements. */
export function contractKeys(stories: Story[], brief = '', requirements: string | RequirementsLedger = ''): Map<string, string> {
  const byId = new Map(stories.map(story => [story.id, story]))
  if (byId.size !== stories.length || stories.length > 2000) throw Error('Invalid planning task set')
  const keys = new Map<string, string>(), visiting = new Set<string>()
  const plan = hash(normalizePlanningBytes(brief).toString('utf8'))
  const ledger = typeof requirements === 'string' ? undefined : requirements
  const entries = (items: RequirementsLedger['requirements'], storyId?: string) => items
    .filter(item => !storyId || item.criteria.some(ref => ref.story === storyId))
    .map(item => ({ id: item.id, text: item.text, criteria: item.criteria.filter(ref => !storyId || ref.story === storyId).map(ref => ({ story: ref.story, criterion: ref.criterion })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const visit = (id: string): string => {
    if (keys.has(id)) return keys.get(id)!
    const s = byId.get(id)
    if (!s || visiting.has(id)) throw Error('Invalid planning dependency graph')
    visiting.add(id)
    const upstream = [...(s.needs ?? [])].sort().map(need => [need, visit(need)])
    const binding = ledger ? {
      requirementContract: { idea: ledger.objective.idea, approvedPlanSha256: ledger.objective.approvedPlanSha256,
        requirements: entries(ledger.requirements, s.id), invariants: entries(ledger.invariants),
        change: ledger.changes?.find(change => change.id === s.sourceChange) },
    } : { ...(requirements ? { requirementDigest: requirements } : {}), ...(s.requirementsFor ? { requirementsFor: s.requirementsFor } : {}) }
    const key = hash({ version: ledger ? 2 : 1, plan, ...binding, id: s.id, title: s.title, acceptance: s.acceptance, writes: s.writes, area: s.area, agent: s.agent, quality: s.quality, exploration: s.exploration, upstream })
    visiting.delete(id); keys.set(id, key)
    return key
  }
  for (const story of stories) visit(story.id)
  return keys
}

export function currentContractKey(root: string, story: Story): string {
  const source = readPlanningFile(root, '.yoke/prd.yaml')
  const parsed = source === undefined ? [] : parse(source, { maxAliasCount: 10 }) as Story[]
  if (!Array.isArray(parsed)) throw Error('Invalid planning task set')
  // Use the supplied dispatch contract, while obtaining upstream contracts from
  // the stable project root rather than a worker's mutable worktree copy.
  const stories = [...parsed.filter(s => s.id !== story.id), story]
  const requirements = readPlanningFile(root, '.yoke/requirements.yaml', 200_000)
  return contractKeys(stories, readPlanningFile(root, '.yoke/plan.md', 80_000) ?? '', requirements === undefined ? '' : RequirementsSchema.parse(parse(requirements, { maxAliasCount: 10 }))).get(story.id)!
}
