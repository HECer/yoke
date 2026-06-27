import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Action } from './plan.js'
import { mergeJson } from './merge-json.js'

export interface AppliedAction {
  target: string
  status: 'created' | 'overwritten' | 'unchanged' | 'merged'
  backedUp?: string
  reason: string
}

export interface ApplyOptions {
  backupDir: string
}

export function applyActions(actions: Action[], targetDir: string, opts: ApplyOptions): AppliedAction[] {
  const results: AppliedAction[] = []

  for (const action of actions) {
    const dest = join(targetDir, action.target)
    let status: AppliedAction['status']
    let backedUp: string | undefined

    if (existsSync(dest)) {
      const current = readFileSync(dest, 'utf8')

      if (action.merge) {
        let parsedCurrent: unknown
        try {
          parsedCurrent = JSON.parse(current)
        } catch {
          throw new Error(`forge: cannot merge ${action.target} — existing file is not valid JSON. Fix or delete it and re-run.`)
        }
        const merged = JSON.stringify(mergeJson(parsedCurrent, JSON.parse(action.content)), null, 2) + '\n'
        if (merged === current) {
          results.push({ target: action.target, status: 'unchanged', reason: action.reason })
          continue
        }
        backedUp = join(opts.backupDir, action.target)
        mkdirSync(dirname(backedUp), { recursive: true })
        copyFileSync(dest, backedUp)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, merged)
        results.push({ target: action.target, status: 'merged', backedUp, reason: action.reason })
        continue
      }

      if (current === action.content) {
        results.push({ target: action.target, status: 'unchanged', reason: action.reason })
        continue
      }
      backedUp = join(opts.backupDir, action.target)
      mkdirSync(dirname(backedUp), { recursive: true })
      copyFileSync(dest, backedUp)
      status = 'overwritten'
    } else {
      status = 'created'
    }

    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, action.content)
    results.push({ target: action.target, status, backedUp, reason: action.reason })
  }

  return results
}
