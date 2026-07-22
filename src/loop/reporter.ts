import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const LOG_CAP_BYTES = 256 * 1024

// Append a line to .yoke/loop.log, keeping the file bounded: once it exceeds
// capBytes, truncate to the recent tail (starting at a line boundary) so the log
// can never grow without bound across many loop runs.
export function appendLog(dir: string, line: string, capBytes: number = LOG_CAP_BYTES): void {
  const file = join(dir, '.yoke', 'loop.log')
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  appendFileSync(file, line + '\n')
  let size: number
  try { size = statSync(file).size } catch { return }
  if (size <= capBytes) return
  const content = readFileSync(file, 'utf8')
  const tail = content.slice(content.length - Math.floor(capBytes / 2))
  const nl = tail.indexOf('\n')
  const trimmed = nl >= 0 ? tail.slice(nl + 1) : tail
  writeFileSync(file, `# … loop.log truncated …\n${trimmed}`)
}

export type LoopState = 'running' | 'blocked' | 'complete' | 'cap-reached' | 'paused'
export type LoopPhase = 'implementing' | 'verifying' | 'perf' | 'reviewing' | 'committing'

// Remaining-time estimate from observed story durations (current run first,
// falling back to the persisted history of previous runs).
export interface LoopEta { avgStoryMs: number; remainingStories: number; etaMs: number }

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 > 0 ? `${m}m${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 > 0 ? `${h}h${m % 60}m` : `${h}h`
}

export const DURATION_HISTORY_CAP = 50
export interface StoryDuration { storyId: string; ms: number }

function durationsPath(dir: string): string {
  return join(dir, '.yoke', 'story-durations.json')
}

export function readDurations(dir: string): StoryDuration[] {
  try {
    const arr: unknown = JSON.parse(readFileSync(durationsPath(dir), 'utf8'))
    if (!Array.isArray(arr)) return []
    return arr.filter((d): d is StoryDuration => typeof (d as StoryDuration)?.ms === 'number' && (d as StoryDuration).ms > 0)
  } catch {
    return []
  }
}

function appendDuration(dir: string, d: StoryDuration): void {
  const all = [...readDurations(dir), d].slice(-DURATION_HISTORY_CAP)
  try {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(durationsPath(dir), JSON.stringify(all))
  } catch { /* observability must never abort the loop */ }
}

// Cumulative runner token usage across the run (claude stream-json runners only).
// model is the last-seen model id from the stream (absent if the CLI never reported one).
export interface TokenUsage { inputTokens: number; outputTokens: number; model?: string }

export interface LoopStatus {
  state: LoopState
  phase?: LoopPhase
  story?: string
  storyTitle?: string
  reason?: string
  iteration: number
  progress: { passed: number; total: number }
  percent?: number
  eta?: LoopEta
  startedAt: string
  updatedAt: string
  tokens?: TokenUsage
}

function statusPath(dir: string): string {
  return join(dir, '.yoke', 'loop-status.json')
}

export function writeStatus(dir: string, status: LoopStatus): void {
  const file = statusPath(dir)
  mkdirSync(join(dir, '.yoke'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(status, null, 2))
  renameSync(tmp, file)
}

export function readStatus(dir: string): LoopStatus | null {
  const file = statusPath(dir)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LoopStatus
  } catch {
    return null
  }
}

export interface StoryRef { id: string; title: string }
export interface Progress { passed: number; total: number }

export interface LoopReporter {
  storyStart(story: StoryRef, iteration: number, progress: Progress): void
  /** A story landed (verified + committed): record its duration and refresh the estimate. */
  storyDone(story: StoryRef, progress: Progress): void
  phase(phase: LoopPhase): void
  blocked(reason: string): void
  complete(progress: Progress): void
  capReached(progress: Progress): void
  paused(progress: Progress): void
  /** Accumulate runner token usage; totals ride along on every subsequent status write. */
  addTokens(usage: TokenUsage): void
}

export interface ReporterOpts {
  log?: (line: string) => void
  quiet?: boolean
  /** Machine mode: emit one `{"type":"status",…}` NDJSON line per status write instead of the human narrative. */
  json?: boolean
}

export function makeReporter(
  dir: string,
  opts: ReporterOpts = {},
  now: () => Date = () => new Date(),
): LoopReporter {
  const sink = opts.log ?? ((line: string) => process.stdout.write(line + '\n'))
  const emitConsole = (line: string) => { if (!opts.quiet) sink(line) }
  let current: LoopStatus | null = null
  let tokens: TokenUsage | undefined
  // ETA source: durations of stories completed in THIS run beat the persisted
  // history of earlier runs (current velocity over old experience).
  const history = readDurations(dir).map(h => h.ms)
  const runDurations: number[] = []
  let storyStartedAt: number | null = null

  const percentOf = (p: Progress): number => (p.total > 0 ? Math.round((p.passed / p.total) * 100) : 0)
  const etaFor = (p: Progress): LoopEta | undefined => {
    const pool = runDurations.length > 0 ? runDurations : history
    if (pool.length === 0) return undefined
    const avg = pool.reduce((a, b) => a + b, 0) / pool.length
    const remainingStories = Math.max(0, p.total - p.passed)
    return { avgStoryMs: Math.round(avg), remainingStories, etaMs: Math.round(avg * remainingStories) }
  }

  const persist = (status: LoopStatus, logLabel: string, consoleLine: string) => {
    const withPercent = { ...status, percent: percentOf(status.progress) }
    const next = tokens ? { ...withPercent, tokens: { ...tokens } } : withPercent
    current = next
    try {
      writeStatus(dir, next)
      appendLog(dir, `${next.updatedAt}  ${logLabel}  ${next.story ?? '-'}  ${next.reason ?? ''}`.trimEnd())
    } catch { /* observability must never abort the loop */ }
    // json mode owns stdout: one machine-readable line per status write, no narrative.
    if (opts.json) sink(JSON.stringify({ type: 'status', ...next }))
    else emitConsole(consoleLine)
  }

  return {
    storyStart(story, iteration, progress) {
      const ts = now().toISOString()
      storyStartedAt = now().getTime()
      const eta = etaFor(progress)
      const hint = eta ? ` · ~${fmtDuration(eta.etaMs)} left (Ø ${fmtDuration(eta.avgStoryMs)}/story)` : ''
      persist(
        { state: 'running', phase: 'implementing', story: story.id, storyTitle: story.title,
          iteration, progress, ...(eta ? { eta } : {}), startedAt: ts, updatedAt: ts },
        'implementing',
        `▶ ${story.id} (${progress.passed}/${progress.total} · ${percentOf(progress)}%) — implementing…${hint}`,
      )
    },
    storyDone(story, progress) {
      const t = now().getTime()
      const ms = storyStartedAt !== null ? Math.max(0, t - storyStartedAt) : undefined
      storyStartedAt = null
      if (ms !== undefined) {
        runDurations.push(ms)
        appendDuration(dir, { storyId: story.id, ms })
      }
      const eta = etaFor(progress)
      const base = current ?? emptyStatus(now().toISOString())
      const took = ms !== undefined ? ` in ${fmtDuration(ms)}` : ''
      const hint = eta && eta.remainingStories > 0 ? ` · ~${fmtDuration(eta.etaMs)} left` : ''
      persist(
        { ...base, state: 'running', phase: undefined, story: story.id, storyTitle: story.title,
          progress, ...(eta ? { eta } : {}), updatedAt: now().toISOString() },
        'story-done',
        `✓ ${story.id} done${took} — ${progress.passed}/${progress.total} (${percentOf(progress)}%)${hint}`,
      )
    },
    phase(phase) {
      if (!current) return
      persist({ ...current, phase, updatedAt: now().toISOString() }, phase, `  · ${phase}…`)
    },
    blocked(reason) {
      const base = current ?? emptyStatus(now().toISOString())
      persist({ ...base, state: 'blocked', reason, updatedAt: now().toISOString() },
        'blocked', `■ blocked on ${base.story ?? '?'}: ${reason}`)
    },
    complete(progress) {
      persist({ ...(current ?? emptyStatus(now().toISOString())), state: 'complete', phase: undefined,
        progress, reason: undefined, updatedAt: now().toISOString() },
        'complete', `✔ loop complete — ${progress.passed}/${progress.total}`)
    },
    capReached(progress) {
      persist({ ...(current ?? emptyStatus(now().toISOString())), state: 'cap-reached', phase: undefined,
        progress, updatedAt: now().toISOString() },
        'cap-reached', `◾ iteration cap reached — ${progress.passed}/${progress.total}`)
    },
    paused(progress) {
      persist({ ...(current ?? emptyStatus(now().toISOString())), state: 'paused', phase: undefined,
        progress, updatedAt: now().toISOString() },
        'paused', `⏸ loop paused — ${progress.passed}/${progress.total}`)
    },
    addTokens(usage) {
      const model = usage.model ?? tokens?.model
      tokens = {
        inputTokens: (tokens?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (tokens?.outputTokens ?? 0) + usage.outputTokens,
        ...(model ? { model } : {}),
      }
    },
  }
}

function emptyStatus(ts: string): LoopStatus {
  return { state: 'running', iteration: 0, progress: { passed: 0, total: 0 }, startedAt: ts, updatedAt: ts }
}

export const noopReporter: LoopReporter = {
  storyStart() {}, storyDone() {}, phase() {}, blocked() {}, complete() {}, capReached() {}, paused() {}, addTokens() {},
}
