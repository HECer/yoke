import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface LoopEvent {
  schemaVersion: 1
  id: string
  runId: string
  timestamp: string
  type: 'status' | 'tokens' | 'phase-ended' | 'attempt-ended'
  storyId?: string
  attemptId?: string
  phase?: string
  durationMs?: number
  outcome?: string
  data?: Record<string, unknown>
}
export const EVENT_CAP = 1000
export const EVENT_MAX_BYTES = 64 * 1024
const namePattern = /^\d{13}-[a-f0-9-]{36}\.json$/u
let lastStamp = 0
function directory(root: string, create: boolean): string {
  const parent = join(root, '.yoke')
  if (create) mkdirSync(parent, { recursive: true })
  if (lstatSync(parent).isSymbolicLink()) throw new Error('Event parent is a symbolic link')
  const dir = join(parent, 'events')
  if (create) mkdirSync(dir, { recursive: true })
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Invalid event directory')
  return dir
}

/** Files are created once, never rewritten. Retention removes oldest whole events. */
export function appendEvent(root: string, event: Omit<LoopEvent, 'schemaVersion' | 'id'>): void {
  try {
    const dir = directory(root, true)
    const id = randomUUID()
    let content = JSON.stringify({ ...event, schemaVersion: 1, id })
    if (Buffer.byteLength(content) > EVENT_MAX_BYTES) content = JSON.stringify({ ...event, data: { truncated: true }, schemaVersion: 1, id })
    if (Buffer.byteLength(content) > EVENT_MAX_BYTES) return
    lastStamp = Math.max(Date.now(), lastStamp + 1)
    writeFileSync(join(dir, `${String(lastStamp).padStart(13, '0')}-${id}.json`), content, { flag: 'wx' })
    const names = readdirSync(dir).filter(name => namePattern.test(name)).sort()
    for (const name of names.slice(0, Math.max(0, names.length - EVENT_CAP))) unlinkSync(join(dir, name))
  } catch { /* Local observability must never abort work. */ }
}

/** Bounded, chronological reads; malformed, oversized and linked files are ignored. */
export function readEvents(root: string, limit: number = 200): LoopEvent[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  try {
    const dir = directory(root, false)
    const names = readdirSync(dir).filter(name => namePattern.test(name)).sort().slice(-Math.min(EVENT_CAP, Math.floor(limit)))
    return names.flatMap(name => {
      try {
        const file = join(dir, name)
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > EVENT_MAX_BYTES) return []
        const value = JSON.parse(readFileSync(file, 'utf8')) as LoopEvent
        if (value?.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.runId !== 'string' || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || !['status', 'tokens', 'phase-ended', 'attempt-ended'].includes(value.type)) return []
        if (value.durationMs !== undefined && (!Number.isFinite(value.durationMs) || value.durationMs < 0)) return []
        return [value]
      } catch { return [] }
    }).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  } catch { return [] }
}
