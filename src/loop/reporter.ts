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
export type LoopPhase = 'implementing' | 'verifying' | 'reviewing' | 'committing'

// Cumulative runner token usage across the run (claude stream-json runners only).
export interface TokenUsage { inputTokens: number; outputTokens: number }

export interface LoopStatus {
  state: LoopState
  phase?: LoopPhase
  story?: string
  storyTitle?: string
  reason?: string
  iteration: number
  progress: { passed: number; total: number }
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

  const persist = (status: LoopStatus, logLabel: string, consoleLine: string) => {
    const next = tokens ? { ...status, tokens: { ...tokens } } : status
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
      persist(
        { state: 'running', phase: 'implementing', story: story.id, storyTitle: story.title,
          iteration, progress, startedAt: ts, updatedAt: ts },
        'implementing',
        `▶ ${story.id} (${progress.passed}/${progress.total}) — implementing…`,
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
      tokens = {
        inputTokens: (tokens?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (tokens?.outputTokens ?? 0) + usage.outputTokens,
      }
    },
  }
}

function emptyStatus(ts: string): LoopStatus {
  return { state: 'running', iteration: 0, progress: { passed: 0, total: 0 }, startedAt: ts, updatedAt: ts }
}

export const noopReporter: LoopReporter = {
  storyStart() {}, phase() {}, blocked() {}, complete() {}, capReached() {}, paused() {}, addTokens() {},
}
