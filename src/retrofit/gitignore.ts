import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const YOKE_IGNORE_LINES = [
  '.yoke/worktrees/',
  '.yoke/backup/',
  '.yoke/loop-status.json',
  '.yoke/loop.log',
  '.yoke/loop.lock',
  '.yoke/loop.pause',
  '.yoke/runner.pid',
  '.yoke/ambiguity.md',
  '.yoke/story-durations.json',
  '.yoke/proof/',
]

const HEADER = '# Yoke runtime artifacts (managed by yoke retrofit)'

// Idempotently ensure each Yoke runtime path is gitignored. Appends only the
// lines not already present (matched verbatim, line-wise). Preserves existing
// content. Returns true if the file changed.
export function ensureGitignore(targetDir: string): boolean {
  const file = join(targetDir, '.gitignore')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const present = new Set(current.split(/\r?\n/).map((l) => l.trim()))
  const missing = YOKE_IGNORE_LINES.filter((l) => !present.has(l))
  if (missing.length === 0) return false
  const prefix = current === '' ? '' : current.endsWith('\n') ? '' : '\n'
  const block = `${prefix}${current === '' ? '' : '\n'}${HEADER}\n${missing.join('\n')}\n`
  writeFileSync(file, current + block)
  return true
}
