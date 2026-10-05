import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import { statePath } from '../workspace/state.js'

export interface LoopSnapshot {
  cursor: string
  status: null | {
    state: string
    iteration: number
    progress: { passed: number; total: number }
    phase?: string
    story?: string
    reason?: string
    failure?: { failureId: string; failureCategory: string; failureCause: string }
  }
}
export interface LoopWaitOptions {
  timeoutMs?: number
  until?: 'terminal' | 'change'
  since?: string
  signal?: AbortSignal
}
export interface LoopWaitResult extends LoopSnapshot {
  outcome: 'changed' | 'timeout' | 'cancelled'
}
const states = ['running', 'blocked', 'complete', 'cap-reached', 'paused']
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

/** A semantic cursor excludes timestamps, token updates and unbounded diagnostics. */
export function loopSnapshot(root: string): LoopSnapshot {
  const path = statePath(root, 'loop-status.json')
  let status: LoopSnapshot['status'] = null
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > 256 * 1024) throw Error('Invalid loop status file')
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const progress = raw.progress as { passed?: unknown; total?: unknown } | undefined
    if (!states.includes(String(raw.state)) || !count(raw.iteration) || !count(progress?.passed)
      || !count(progress.total) || progress.passed > progress.total) throw Error('Invalid loop status contract')
    status = { state: String(raw.state), iteration: raw.iteration, progress: { passed: progress.passed, total: progress.total } }
    for (const key of ['phase', 'story', 'reason'] as const) {
      if (typeof raw[key] === 'string') status[key] = raw[key].slice(0, key === 'reason' ? 1200 : 200)
    }
    const observation = (raw.failure as { observation?: unknown } | undefined)?.observation as Record<string, unknown> | undefined
    if (observation && ['failureId', 'failureCategory', 'failureCause'].every(key => typeof observation[key] === 'string')) {
      status.failure = { failureId: String(observation.failureId).slice(0, 100), failureCategory: String(observation.failureCategory).slice(0, 100), failureCause: String(observation.failureCause).slice(0, 100) }
    }
  }
  return { status, cursor: createHash('sha256').update(JSON.stringify(status)).digest('hex') }
}

/** Wait in Node, not in a model. Terminal handoff is the default to avoid phase polling. */
export async function waitForLoop(directory: string, options: LoopWaitOptions = {}): Promise<LoopWaitResult> {
  const timeout = options.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 86_400_000) throw Error('Loop wait timeout must be 1–86400000 ms')
  if (options.until !== undefined && !['terminal', 'change'].includes(options.until)) throw Error('Invalid loop wait condition')
  if (options.since !== undefined && !/^[a-f0-9]{64}$/u.test(options.since)) throw Error('Invalid loop wait cursor')
  const root = resolve(directory)
  if (!lstatSync(root).isDirectory()) throw Error('Loop wait target must be a directory')
  const initial = loopSnapshot(root)
  const since = options.since ?? initial.cursor
  const ready = (snapshot: LoopSnapshot) => options.until === 'change'
    ? snapshot.cursor !== since : snapshot.status !== null && snapshot.status.state !== 'running'
  if (options.signal?.aborted) return { ...initial, outcome: 'cancelled' }
  if (ready(initial)) return { ...initial, outcome: 'changed' }

  return new Promise((resolveResult, reject) => {
    let finished = false
    const watchers: FSWatcher[] = []
    let stateWatcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      finished = true
      if (timer) clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      options.signal?.removeEventListener('abort', abort)
    }
    const finish = (outcome: LoopWaitResult['outcome']) => {
      if (finished) return
      try { const snapshot = loopSnapshot(root); close(); resolveResult({ ...snapshot, outcome }) }
      catch (error) { close(); reject(error) }
    }
    const abort = () => finish('cancelled')
    const subscribeState = () => {
      const path = statePath(root)
      if (!stateWatcher && existsSync(path)) {
        stateWatcher = watch(path, inspect)
        stateWatcher.on('error', error => { close(); reject(error) })
        watchers.push(stateWatcher)
      }
    }
    const inspect = () => {
      if (finished) return
      try { subscribeState(); if (ready(loopSnapshot(root))) finish('changed') }
      catch (error) { close(); reject(error) }
    }
    try {
      const parentWatcher = watch(root, inspect)
      parentWatcher.on('error', error => { close(); reject(error) })
      watchers.push(parentWatcher)
      subscribeState()
      options.signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => finish('timeout'), timeout)
      // Closing the read/subscribe race avoids missing an atomic status replacement.
      inspect()
      if (options.signal?.aborted) abort()
    } catch (error) { close(); reject(error) }
  })
}
