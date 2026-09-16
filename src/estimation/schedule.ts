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
  const durations = new Map(stories.filter(story => !story.passes).map(story => [story.id,
    estimateDurations(history.filter(item => item.storyId === story.id).map(item => item.ms)) ?? estimate,
  ]))
  const simulate = (field: 'typicalMs' | 'lowerMs' | 'upperMs') => {
  const pending = stories.filter(story => !story.passes).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0) || a.id.localeCompare(b.id))
  const complete = new Set(stories.filter(story => story.passes).map(story => story.id))
  const active: { story: ScheduleStory; end: number }[] = []
  const tasks: { storyId: string; startMs: number; endMs: number }[] = []
  let time = 0
  while (pending.length || active.length) {
    for (let index = 0; index < pending.length && active.length < maxConcurrency;) {
      const story = pending[index]
      if ((story.needs ?? []).every(id => complete.has(id)) && (!story.area || !active.some(item => item.story.area === story.area)) && !active.some(item => writeScopesOverlap(story.writes, item.story.writes))) {
        const end = time + durations.get(story.id)![field]
        active.push({ story, end })
        tasks.push({ storyId: story.id, startMs: time, endMs: end })
        pending.splice(index, 1)
      } else index++
    }
    if (!active.length) return undefined
    time = Math.min(...active.map(item => item.end))
    for (let index = active.length - 1; index >= 0; index--) if (active[index].end === time) { complete.add(active[index].story.id); active.splice(index, 1) }
  }
    return { time, tasks }
  }
  const typical = simulate('typicalMs'), lower = simulate('lowerMs'), upper = simulate('upperMs')
  if (!typical || !lower || !upper) return { available: false, reason: 'Cyclic or missing dependencies' }
  // Different durations can change a greedy schedule's ordering. Keep the
  // empirical scenario envelope ordered; this is not a calibrated interval.
  return { available: true, etaMs: typical.time,
    lowerMs: Math.min(lower.time, typical.time, upper.time), upperMs: Math.max(lower.time, typical.time, upper.time),
    sampleCount: estimate.sampleCount,
    confidence: [...durations.values()].some(duration => duration.confidence === 'low') ? 'low' : estimate.confidence,
    tasks: typical.tasks }
}
