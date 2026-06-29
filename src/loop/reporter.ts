import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export type LoopState = 'running' | 'blocked' | 'complete' | 'cap-reached'
export type LoopPhase = 'implementing' | 'verifying' | 'reviewing' | 'committing'

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
}

export interface ReporterOpts {
  log?: (line: string) => void
  quiet?: boolean
}

export function makeReporter(
  dir: string,
  opts: ReporterOpts = {},
  now: () => Date = () => new Date(),
): LoopReporter {
  const sink = opts.log ?? ((line: string) => process.stdout.write(line + '\n'))
  const emitConsole = (line: string) => { if (!opts.quiet) sink(line) }
  let current: LoopStatus | null = null

  const persist = (next: LoopStatus, logLabel: string, consoleLine: string) => {
    current = next
    try {
      writeStatus(dir, next)
      mkdirSync(join(dir, '.yoke'), { recursive: true })
      appendFileSync(
        join(dir, '.yoke', 'loop.log'),
        `${next.updatedAt}  ${logLabel}  ${next.story ?? '-'}  ${next.reason ?? ''}`.trimEnd() + '\n',
      )
    } catch { /* observability must never abort the loop */ }
    emitConsole(consoleLine)
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
  }
}

function emptyStatus(ts: string): LoopStatus {
  return { state: 'running', iteration: 0, progress: { passed: 0, total: 0 }, startedAt: ts, updatedAt: ts }
}

export const noopReporter: LoopReporter = {
  storyStart() {}, phase() {}, blocked() {}, complete() {}, capReached() {},
}
