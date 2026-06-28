import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action } from './plan.js'

const CONTEXT_FILES = ['PROJECT.md', 'DECISIONS.md', 'KNOWLEDGE.md'] as const

export function baseContextActions(canonDir: string): Action[] {
  return CONTEXT_FILES.map(name => {
    let content: string
    try {
      content = readFileSync(join(canonDir, 'context', name), 'utf8')
    } catch {
      throw new Error(`yoke: missing context template ${name} in ${canonDir}/context — run \`yoke validate canon\` to diagnose the canon.`)
    }
    return {
      kind: 'write' as const,
      target: `.yoke/context/${name}`,
      content,
      reason: `context scaffold: ${name}`,
      ifAbsent: true,
    }
  })
}
