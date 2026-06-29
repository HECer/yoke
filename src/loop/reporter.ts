import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
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
