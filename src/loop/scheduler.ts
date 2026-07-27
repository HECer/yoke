import type { Agent } from '../retrofit/config.js'
import type { Story } from './prd.js'

export interface SchedulerOptions {
  activeAreas?: Set<string>
  agent?: Agent
}

export function readyStories(stories: Story[], opts: SchedulerOptions = {}): Story[] {
  const passed = new Set(stories.filter(story => story.passes).map(story => story.id))
  return stories
    .filter(story => !story.passes)
    .filter(story => (story.needs ?? []).every(id => passed.has(id)))
    .filter(story => !story.area || !opts.activeAreas?.has(story.area))
    .sort((a, b) => a.priority - b.priority || Number(b.agent === opts.agent) - Number(a.agent === opts.agent) || a.id.localeCompare(b.id))
}
