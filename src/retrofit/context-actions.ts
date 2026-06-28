import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action } from './plan.js'

const CONTEXT_FILES = ['PROJECT.md', 'DECISIONS.md', 'KNOWLEDGE.md'] as const

export function baseContextActions(canonDir: string): Action[] {
  return CONTEXT_FILES.map(name => ({
    kind: 'write',
    target: `.yoke/context/${name}`,
    content: readFileSync(join(canonDir, 'context', name), 'utf8'),
    reason: `context scaffold: ${name}`,
    ifAbsent: true,
  }))
}
