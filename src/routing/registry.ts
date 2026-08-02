import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Agent, RoutingWorker } from '../retrofit/config.js'

export interface RoutingObservation {
  schemaVersion: 1
  eventId: string
  recordedAt: string
  projectHash: string
  storyHash: string
  strategy: string
  selected: 'SELF' | string
  provider: Agent
  requestedModel?: string
  requestedReasoningEffort?: string
  actualModel?: string
  orchestratorProvider: Agent
  orchestratorModel?: string
  orchestratorDurationMs: number
  workerDurationMs: number
  processSuccess: boolean
  /** Independent Yoke gates, not the worker's own exit code, determine capability. */
  verificationSuccess: boolean
  inputTokens: number
  outputTokens: number
}

export interface WorkerHistory {
  runs: number
  successes: number
  successRate: number
  averageDurationMs: number
  averageTokens: number
}

const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function registryDir(): string {
  if (process.env.YOKE_REGISTRY_DIR) return resolve(process.env.YOKE_REGISTRY_DIR)
  const base = process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || join(homedir(), '.yoke')
  return join(base, 'Yoke', 'routing-registry')
}

function eventsDir(): string {
  return join(registryDir(), 'events')
}

export function projectHash(targetDir: string): string {
  return createHash('sha256').update(`${process.platform}\0${resolve(targetDir)}`).digest('hex').slice(0, 16)
}

export function storyHash(project: string, storyId: string): string {
  return createHash('sha256').update(`${project}\0${storyId}`).digest('hex').slice(0, 16)
}

/**
 * Immutable one-file-per-event writes avoid a shared mutable JSON file. Concurrent
 * Yoke processes never hold a registry lock and cannot overwrite each other.
 */
export function recordRoutingObservation(observation: Omit<RoutingObservation, 'schemaVersion' | 'eventId' | 'recordedAt'>): RoutingObservation | null {
  try {
    const dir = eventsDir()
    mkdirSync(dir, { recursive: true })
    const event: RoutingObservation = {
      schemaVersion: 1,
      eventId: randomUUID(),
      recordedAt: new Date().toISOString(),
      ...observation,
    }
    const stamp = event.recordedAt.replace(/[:.]/g, '-')
    writeFileSync(join(dir, `${stamp}-${process.pid}-${event.eventId}.json`), JSON.stringify(event), { flag: 'wx' })
    return event
  } catch {
    // Routing evidence is observability. A registry failure must never block a story.
    return null
  }
}

export function readRoutingObservations(limit = 1000): RoutingObservation[] {
  const dir = eventsDir()
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(file => file.endsWith('.json')).sort().slice(-limit)
  const observations: RoutingObservation[] = []
  for (const file of files) {
    try {
      const value = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RoutingObservation
      if (value.schemaVersion === 1 && typeof value.selected === 'string') observations.push(value)
    } catch { /* ignore partial/corrupt evidence without affecting routing */ }
  }
  return observations
}

export function historyForWorkers(workers: RoutingWorker[]): Map<string, WorkerHistory> {
  const wanted = new Map(workers.map(worker => [worker.id, worker]))
  const grouped = new Map<string, RoutingObservation[]>()
  const oldestUseful = Date.now() - HISTORY_MAX_AGE_MS
  for (const event of readRoutingObservations()) {
    const worker = wanted.get(event.selected)
    if (!worker) continue
    // Capability evidence belongs to the provider/model that produced it. This
    // prevents a reused worker id from inheriting scores from a retired model.
    if (event.provider !== worker.agent
      || event.requestedModel !== worker.model
      || event.requestedReasoningEffort !== worker.reasoningEffort) continue
    if (typeof event.verificationSuccess !== 'boolean') continue
    if (Date.parse(event.recordedAt) < oldestUseful) continue
    grouped.set(event.selected, [...(grouped.get(event.selected) ?? []), event])
  }
  const result = new Map<string, WorkerHistory>()
  for (const [id, events] of grouped) {
    const successes = events.filter(event => event.verificationSuccess).length
    result.set(id, {
      runs: events.length,
      successes,
      successRate: events.length ? successes / events.length : 0,
      averageDurationMs: Math.round(events.reduce((sum, event) => sum + event.workerDurationMs, 0) / events.length),
      averageTokens: Math.round(events.reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0) / events.length),
    })
  }
  return result
}
