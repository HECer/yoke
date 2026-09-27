import { estimateDurations } from './durations.js'
import { criticalPathRanks, writeScopesOverlap } from '../loop/scheduler.js'

export interface ScheduleStory { id: string; needs?: readonly string[]; area?: string; writes?: readonly string[]; priority?: number; passes?: boolean }
export interface ScheduleHistory { storyId: string; ms: number }
export interface ScheduleStageHistory {
  readonly integrationMs?: readonly number[]
  readonly integrationQueueWaitMs?: readonly number[]
  readonly globalLimit?: number
  readonly workerUnitsPerStory?: number
}
type ScheduledTask = { storyId: string; startMs: number; endMs: number }
type Scenario = { time: number; implementationWorkMs: number; integrationQueueWaitMs: number; integrationLaneMs: number; tasks: ScheduledTask[] }
export type ScheduleEstimate = { available: false; reason: string } | {
  available: true
  etaMs: number
  lowerMs: number
  upperMs: number
  sampleCount: number
  confidence: 'low' | 'medium'
  implementationWorkMs: number
  integrationQueueWaitMs: number
  integrationLaneMs: number
  integrationSampleCount: number
  maxConcurrency: number
  globalLimit: number
  workerUnitsPerStory: number
  tasks: ScheduledTask[]
}

/** Simulate dependency-aware implementation slots and a separate serialized integration lane. */
export function estimateSchedule(
  stories: readonly ScheduleStory[],
  maxConcurrency: number,
  history: readonly ScheduleHistory[],
  stages: ScheduleStageHistory = {},
): ScheduleEstimate {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) return { available: false, reason: 'Invalid concurrency' }
  if (new Set(stories.map(story => story.id)).size !== stories.length) return { available: false, reason: 'Duplicate story IDs' }
  const totalEstimate = estimateDurations(history.map(item => item.ms))
  if (!totalEstimate) return { available: false, reason: 'No measured duration history' }
  const integrationEstimate = estimateDurations((stages.integrationMs ?? []).filter(validSample))
  const queueEstimate = estimateDurations((stages.integrationQueueWaitMs ?? []).filter(validSample))
  const integrations = integrationEstimate ?? { typicalMs: 0, lowerMs: 0, upperMs: 0, sampleCount: 0, confidence: 'low' as const }
  const queueWait = queueEstimate ?? { typicalMs: 0, lowerMs: 0, upperMs: 0, sampleCount: 0, confidence: 'low' as const }
  const globalLimit = Number.isInteger(stages.globalLimit) && stages.globalLimit! >= 1 ? stages.globalLimit! : maxConcurrency
  const workerUnitsPerStory = Number.isInteger(stages.workerUnitsPerStory) && stages.workerUnitsPerStory! >= 1 ? stages.workerUnitsPerStory! : 1
  if (workerUnitsPerStory > globalLimit) return { available: false, reason: 'Worker weight exceeds the shared resource limit' }
  const ranks = criticalPathRanks(stories)
  const pending = stories.filter(story => !story.passes).sort((a, b) =>
    (a.priority ?? 0) - (b.priority ?? 0) || (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0) || a.id.localeCompare(b.id),
  )
  const simulate = (implementationScale: 'typicalMs' | 'lowerMs' | 'upperMs', integrationScale: 'typicalMs' | 'lowerMs' | 'upperMs'): Scenario | undefined => {
    const pendingWork = [...pending]
    const work = new Map(pending.map(story => {
      const estimate = estimateDurations(history.filter(item => item.storyId === story.id).map(item => item.ms)) ?? totalEstimate
      const subtract = integrationEstimate ? integrations[integrationScale] + queueWait[integrationScale] : 0
      return [story.id, Math.max(0, estimate[implementationScale] - subtract)]
    }))
    const integrationDuration = integrations[integrationScale]
    const complete = new Set(stories.filter(story => story.passes).map(story => story.id))
    const active: { story: ScheduleStory; ends: number }[] = []
    const queued: { story: ScheduleStory; readyAt: number }[] = []
    let integrating: { story: ScheduleStory; ends: number } | undefined
    const taskTimes = new Map<string, ScheduledTask>()
    let time = 0, implementationWorkMs = 0, integrationQueueWaitMs = 0, integrationLaneMs = 0
    let completedEvents = 0
    while (pendingWork.length || active.length || queued.length || integrating) {
      for (let index = 0; index < pendingWork.length && active.length < maxConcurrency && (active.length * workerUnitsPerStory) + (integrating ? 1 : 0) + workerUnitsPerStory <= globalLimit;) {
        const story = pendingWork[index]!
        const occupied = [...active.map(item => item.story), ...queued.map(item => item.story), ...(integrating ? [integrating.story] : [])]
        const dependenciesReady = (story.needs ?? []).every(id => complete.has(id))
        const scopesFree = (!story.area || !occupied.some(item => item.area === story.area))
          && !occupied.some(item => writeScopesOverlap(story.writes, item.writes))
        if (dependenciesReady && scopesFree) {
          const duration = work.get(story.id) ?? 0
          active.push({ story, ends: time + duration })
          taskTimes.set(story.id, { storyId: story.id, startMs: time, endMs: 0 })
          implementationWorkMs += duration
          pendingWork.splice(index, 1)
        } else index++
      }
      if (!integrating && queued.length && active.length * workerUnitsPerStory + 1 <= globalLimit) {
        const next = queued.shift()!
        integrationQueueWaitMs += Math.max(0, time - next.readyAt)
        integrationLaneMs += integrationDuration
        integrating = { story: next.story, ends: time + integrationDuration }
      }
      const nextEnd = Math.min(
        ...active.map(item => item.ends),
        ...(integrating ? [integrating.ends] : []),
      )
      if (!Number.isFinite(nextEnd)) return undefined
      time = nextEnd
      const finishedIntegration = integrating && integrating.ends === time ? integrating : undefined
      if (finishedIntegration) {
        complete.add(finishedIntegration.story.id)
        const task = taskTimes.get(finishedIntegration.story.id)
        if (task) task.endMs = time
        integrating = undefined
        completedEvents++
      }
      const finishedWorkers = active.filter(item => item.ends === time).sort((a, b) => a.story.id.localeCompare(b.story.id))
      for (const item of finishedWorkers) queued.push({ story: item.story, readyAt: time })
      for (let index = active.length - 1; index >= 0; index--) if (active[index]!.ends === time) active.splice(index, 1)
      if (finishedWorkers.length || finishedIntegration) continue
      if (!active.length && !queued.length && !integrating && pendingWork.length) return undefined
      if (completedEvents > stories.length) return undefined
    }
    return {
      time,
      implementationWorkMs,
      integrationQueueWaitMs,
      integrationLaneMs,
      tasks: [...taskTimes.values()],
    }
  }

  const typical = simulate('typicalMs', 'typicalMs')
  const lower = simulate('lowerMs', 'lowerMs')
  const upper = simulate('upperMs', 'upperMs')
  if (!typical || !lower || !upper) return { available: false, reason: 'Cyclic or missing dependencies' }
  return {
    available: true,
    etaMs: typical.time,
    lowerMs: Math.min(lower.time, typical.time, upper.time),
    upperMs: Math.max(lower.time, typical.time, upper.time),
    sampleCount: totalEstimate.sampleCount,
    confidence: !integrationEstimate || integrationEstimate.confidence === 'low' ? 'low' : totalEstimate.confidence,
    implementationWorkMs: typical.implementationWorkMs,
    integrationQueueWaitMs: typical.integrationQueueWaitMs,
    integrationLaneMs: typical.integrationLaneMs,
    integrationSampleCount: integrationEstimate?.sampleCount ?? 0,
    maxConcurrency,
    globalLimit,
    workerUnitsPerStory,
    tasks: typical.tasks,
  }
}

function validSample(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
