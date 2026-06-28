import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_CONTEXT_CHARS = 2000

export interface ProjectContext {
  project: string
  decisions: string
  knowledge: string
}

export function contextDir(targetDir: string): string {
  return join(targetDir, '.yoke', 'context')
}

function readIf(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function loadContext(dir: string): ProjectContext {
  return {
    project: readIf(join(dir, 'PROJECT.md')),
    decisions: readIf(join(dir, 'DECISIONS.md')),
    knowledge: readIf(join(dir, 'KNOWLEDGE.md')),
  }
}

function boundHead(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '\n… (truncated)'
}

function boundTail(s: string, max: number): string {
  return s.length <= max ? s : '… (truncated)\n' + s.slice(s.length - max)
}

export function formatForPrompt(ctx: ProjectContext, max: number = MAX_CONTEXT_CHARS): string {
  const parts: string[] = []
  if (ctx.project.trim()) parts.push(`### North star (PROJECT.md)\n${boundHead(ctx.project.trim(), max)}`)
  if (ctx.knowledge.trim()) parts.push(`### Known gotchas (KNOWLEDGE.md)\n${boundHead(ctx.knowledge.trim(), max)}`)
  if (ctx.decisions.trim()) parts.push(`### Recent decisions (DECISIONS.md)\n${boundTail(ctx.decisions.trim(), max)}`)
  if (parts.length === 0) return ''
  return ['## Project context (from .yoke/context — read before implementing)', ...parts].join('\n\n')
}
