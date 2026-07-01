import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Best-effort, non-fatal detection of a gstack install (garrytan/gstack).
// gstack lives at ~/.claude/skills/gstack (global) or .claude/skills/gstack (repo-local).
export function detectGstack(targetDir: string, home: string = homedir()): boolean {
  const candidates = [
    join(targetDir, '.claude', 'skills', 'gstack'),
    join(home, '.claude', 'skills', 'gstack'),
  ]
  return candidates.some(p => {
    try { return existsSync(p) } catch { return false }
  })
}
