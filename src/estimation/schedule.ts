import { estimateDurations } from './durations.js'
import { criticalPathRanks, writeScopesOverlap } from '../loop/scheduler.js'
export interface ScheduleStory { id: string; needs?: readonly string[]; area?: string; writes?: readonly string[]; priority?: number; passes?: boolean }
export interface ScheduleHistory { storyId: string; ms: number }
export type ScheduleEstimate = { available: false; reason: string } | {
  available: true; etaMs: number; lowerMs: number; upperMs: number; sampleCount: number; confidence: 'low' | 'medium'
  tasks: { storyId: string; startMs: number; endMs: number }[]
}

/** Simulate the same dependency/area constraints as the loop scheduler. */
export function estimateSchedule(stories: readonly ScheduleStory[], maxConcurrency: number, history: readonly ScheduleHistory[]): ScheduleEstimate {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) return { available: false, reason: 'Invalid concurrency' }
  if (new Set(stories.map(story => story.id)).size !== stories.length) return { available: false, reason: 'Duplicate story IDs' }
  const estimate = estimateDurations(history.map(item => item.ms))
  if (!estimate) return { available: false, reason: 'No measured duration history' }
  const ranks = criticalPathRanks(stories)
  const pending = stories.filter(story => !story.passes).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0) || a.id.localeCompare(b.id))
  const complete = new Set(stories.filter(story => story.passes).map(story => story.id))
  const active: { story: ScheduleStory; end: number }[] = []
  const tasks: { storyId: string; startMs: number; endMs: number }[] = []
  let time = 0
  while (pending.length || active.length) {
    for (let index = 0; index < pending.length && active.length < maxConcurrency;) {
      const story = pending[index]
      if ((story.needs ?? []).every(id => complete.has(id)) && (!story.area || !active.some(item => item.story.area === story.area)) && !active.some(item => writeScopesOverlap(story.writes, item.story.writes))) {
        const duration = estimateDurations(history.filter(item => item.storyId === story.id).map(item => item.ms)) ?? estimate
        const end = time + duration.typicalMs
        active.push({ story, end })
        tasks.push({ storyId: story.id, startMs: time, endMs: end })
        pending.splice(index, 1)
      } else index++
    }
    if (!active.length) return { available: false, reason: 'Cyclic or missing dependencies' }
    time = Math.min(...active.map(item => item.end))
    for (let index = active.length - 1; index >= 0; index--) if (active[index].end === time) { complete.add(active[index].story.id); active.splice(index, 1) }
  }
  return { available: true, etaMs: time, lowerMs: time * estimate.lowerMs / estimate.typicalMs, upperMs: time * estimate.upperMs / estimate.typicalMs, sampleCount: estimate.sampleCount, confidence: estimate.confidence, tasks }
}
