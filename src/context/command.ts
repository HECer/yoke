import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCanonDir } from '../retrofit/canon-dir.js'
import { baseContextActions } from '../retrofit/context-actions.js'
import { applyActions } from '../retrofit/apply.js'
import { contextDir } from './context.js'

export function runContextInit(targetDir: string): number {
  const canonDir = resolveCanonDir()
  const actions = baseContextActions(canonDir)
  const applied = applyActions(actions, targetDir, { backupDir: join(targetDir, '.yoke', 'backup', 'context') })
  for (const a of applied) console.log(`  ${a.status.padEnd(11)} ${a.target}`)
  return 0
}

export function runContextStatus(targetDir: string): number {
  const dir = contextDir(targetDir)
  const files = ['PROJECT.md', 'DECISIONS.md', 'KNOWLEDGE.md']
  if (!files.some(f => existsSync(join(dir, f)))) {
    console.log('Context not initialised (no .yoke/context). Run: yoke context init')
    return 0
  }
  for (const f of files) {
    const p = join(dir, f)
    console.log(existsSync(p) ? `  ${f.padEnd(13)} ${statSync(p).size} bytes` : `  ${f.padEnd(13)} (missing)`)
  }
  const decisions = join(dir, 'DECISIONS.md')
  if (existsSync(decisions)) {
    const last = readFileSync(decisions, 'utf8').split('\n').filter(l => l.startsWith('## ')).pop()
    if (last) console.log(`  last decision: ${last.slice(3)}`)
  }
  return 0
}
