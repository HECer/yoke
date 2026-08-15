import type { Agent } from '../retrofit/config.js'
import type { Story } from './prd.js'
import { readyStories } from './scheduler.js'

export interface ParallelWorkerResult { success: boolean; summary?: string }
export interface ParallelOptions {
  maxConcurrency: number
  maxIterations: number
  agents?: Agent[]
  paused?: () => boolean
  worker: (story: Story, agent?: Agent) => Promise<ParallelWorkerResult>
}
export interface ParallelResult { completed: string[]; failed: string[]; iterations: number; paused: boolean }

export async function runParallelLoop(stories: Story[], opts: ParallelOptions): Promise<ParallelResult> {
  const completed: string[] = []
  const failed: string[] = []
  const activeAreas = new Set<string>()
  const active = new Map<string, Promise<void>>()
  let iterations = 0
  let agentIndex = 0
  const launch = (story: Story) => {
    iterations++
    if (story.area) activeAreas.add(story.area)
    const affinity = story.agent ?? (opts.agents?.length ? opts.agents[agentIndex++ % opts.agents.length] : undefined)
    const promise = opts.worker(story, affinity).then(result => {
      if (result.success) completed.push(story.id); else failed.push(story.id)
    }).catch(() => { failed.push(story.id) }).finally(() => {
      active.delete(story.id)
      if (story.area) activeAreas.delete(story.area)
    })
    active.set(story.id, promise)
  }
  while (iterations < opts.maxIterations && !opts.paused?.()) {
    const slots = Math.max(0, opts.maxConcurrency - active.size)
    const ready = readyStories(stories, { activeAreas }).filter(s => !active.has(s.id) && !completed.includes(s.id) && !failed.includes(s.id)).slice(0, slots)
    for (const story of ready) launch(story)
    if (active.size === 0) break
    await Promise.race(active.values())
  }
  await Promise.all(active.values())
  return { completed, failed, iterations, paused: opts.paused?.() ?? false }
}
