import type { Agent } from '../retrofit/config.js'
import type { Story } from './prd.js'

export interface SchedulerOptions {
  activeAreas?: Set<string>
  activeWrites?: readonly (readonly string[])[]
  agent?: Agent
}

export function validWriteScope(scope: string): boolean {
  const normalized = scope.replace(/\\/gu, '/').replace(/\/$/u, '')
  return Boolean(normalized) && scope === scope.trim() && !/[\0\r\n:*?<>|\[\]{}]/u.test(normalized) && normalized.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

/** Advisory declarations: unknown scopes preserve existing scheduler behavior. */
export function writeScopesOverlap(left: readonly string[] = [], right: readonly string[] = []): boolean {
  const normalize = (value: string) => value.replace(/\\/gu, '/').replace(/\/$/u, '').toLowerCase()
  return left.some(a => right.some(b => {
    const first = normalize(a), second = normalize(b)
    return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
  }))
}

/** Remaining dependency depth provides a deterministic critical-path tie-break. */
export function criticalPathRanks(stories: readonly { id: string; needs?: readonly string[]; passes?: boolean }[]): Map<string, number> {
  const children = new Map<string, string[]>()
  for (const story of stories.filter(story => !story.passes)) for (const need of story.needs ?? []) children.set(need, [...(children.get(need) ?? []), story.id])
  const ranks = new Map<string, number>()
  const visiting = new Set<string>()
  const rank = (id: string): number => {
    if (ranks.has(id)) return ranks.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const value = 1 + Math.max(0, ...(children.get(id) ?? []).map(rank))
    visiting.delete(id)
    ranks.set(id, value)
    return value
  }
  for (const story of stories) rank(story.id)
  return ranks
}

export function readyStories(stories: Story[], opts: SchedulerOptions = {}): Story[] {
  const passed = new Set(stories.filter(story => story.passes).map(story => story.id))
  const ranks = criticalPathRanks(stories)
  return stories
    .filter(story => !story.passes)
    .filter(story => (story.needs ?? []).every(id => passed.has(id)))
    .filter(story => !story.area || !opts.activeAreas?.has(story.area))
    .filter(story => !opts.activeWrites?.some(scopes => writeScopesOverlap(story.writes, scopes)))
    .sort((a, b) => a.priority - b.priority || (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0) || Number(b.agent === opts.agent) - Number(a.agent === opts.agent) || a.id.localeCompare(b.id))
}
