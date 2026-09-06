import { appendFileSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { LoopEvent } from './events.js'

// Persistent, compact measurements; no prompts, paths, summaries or status snapshots.
// Each run owns its shard. Recent activity retention never deletes this history.
function directory(root: string, day: string, create: boolean): string {
  let path = root
  for (const part of ['.yoke', 'history', day]) {
    path = join(path, part)
    if (create) mkdirSync(path, { recursive: true })
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw Error('Linked or invalid measurement directory')
  }
  return path
}

export function archiveMeasurement(root: string, event: LoopEvent): void {
  if (event.type === 'status') return
  const day = event.timestamp.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return
  const file = join(directory(root, day, true), createHash('sha256').update(event.runId).digest('hex').slice(0, 32) + '.jsonl')
  try { if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw Error('Linked measurement file') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const data = event.data ?? {}
  const allowed = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'totalCostUsd', 'model', 'provider', 'role', 'calls', 'measurementComplete', 'costMeasurementComplete', 'usageAvailable', 'prediction', 'errorMs', 'withinObservedRange', 'escalated']
  const compact = { ...event, data: Object.fromEntries(allowed.filter(key => data[key] !== undefined).map(key => [key, data[key]])) }
  appendFileSync(file, JSON.stringify(compact) + '\n')
}

export function readMeasurements(root: string, from: number, to: number): { events: LoopEvent[]; errors: string[] } {
  const events: LoopEvent[] = [], errors: string[] = []
  let bytes = 0
  for (let time = Math.floor(from / 86400000) * 86400000; time < to; time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10)
    try {
      const dir = directory(root, day, false)
      const files = readdirSync(dir).filter(file => /^[a-f0-9]{32}\.jsonl$/u.test(file)).sort()
      if (files.length > 2000) errors.push(`${day}: too many measurement shards`)
      for (const name of files.slice(0, 2000)) {
        const file = join(dir, name), stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) { errors.push(`${day}: measurement shard unavailable`); continue }
        bytes += stat.size
        if (bytes > 32 * 1024 * 1024 || events.length >= 50000) return { events, errors: [...errors, 'History query limit reached; narrow the period'] }
        for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
          if (events.length >= 50000) return { events, errors: [...new Set([...errors, 'History query limit reached; narrow the period'])] }
          try {
            const event = JSON.parse(line) as LoopEvent
            const timestamp = Date.parse(event.timestamp)
            if (event.schemaVersion !== 1 || typeof event.id !== 'string' || !Number.isFinite(timestamp)) throw Error('Invalid measurement')
            if (timestamp >= from && timestamp < to) events.push(event)
          } catch { if (!errors.includes(`${day}: malformed measurement`)) errors.push(`${day}: malformed measurement`) }
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`${day}: history unavailable`) }
  }
  return { events, errors: [...new Set(errors)] }
}
