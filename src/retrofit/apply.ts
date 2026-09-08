import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Action } from './plan.js'
import { mergeQwenSettings } from './qwen-settings.js'
import { mergeJson } from './merge-json.js'
import { carryPreserved } from './preserve.js'

function parseJsonc(source: string): unknown {
  let withoutComments = ''
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false
        withoutComments += char
      } else withoutComments += ' '
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        withoutComments += '  '
        index += 1
      } else withoutComments += char === '\n' || char === '\r' ? char : ' '
      continue
    }
    if (inString) {
      withoutComments += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      withoutComments += char
    } else if (char === '/' && next === '/') {
      lineComment = true
      withoutComments += '  '
      index += 1
    } else if (char === '/' && next === '*') {
      blockComment = true
      withoutComments += '  '
      index += 1
    } else withoutComments += char
  }

  let withoutTrailingCommas = ''
  inString = false
  escaped = false
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index]!
    if (inString) {
      withoutTrailingCommas += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      withoutTrailingCommas += char
      continue
    }
    if (char === ',') {
      let lookahead = index + 1
      while (/\s/u.test(withoutComments[lookahead] ?? '')) lookahead += 1
      if (withoutComments[lookahead] === '}' || withoutComments[lookahead] === ']') continue
    }
    withoutTrailingCommas += char
  }
  return JSON.parse(withoutTrailingCommas)
}

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
    let content = action.content
    let reason = action.reason

    if (action.merge && typeof action.content !== 'string') {
      throw new Error(`yoke: binary content cannot be merged: ${action.target}`)
    }

    if (existsSync(dest)) {
      if (action.ifAbsent) {
        results.push({ target: action.target, status: 'unchanged', reason: `${action.reason} (exists, left untouched)` })
        continue
      }

      const currentBytes = readFileSync(dest)

      if (action.merge) {
        const current = currentBytes.toString('utf8')
        let parsedCurrent: unknown
        try {
          parsedCurrent = action.target.endsWith('.jsonc') ? parseJsonc(current) : JSON.parse(current)
        } catch {
          throw new Error(`yoke: cannot merge ${action.target} — existing file is not valid JSON. Fix or delete it and re-run.`)
        }
        const merged = JSON.stringify((action.target === '.qwen/settings.json' ? mergeQwenSettings : mergeJson)(parsedCurrent, JSON.parse(action.content as string)), null, 2) + '\n'
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

      if (typeof action.content === 'string') {
        const current = currentBytes.toString('utf8')
        // Exact matches need no preservation pass. In particular, skill examples
        // may contain literal preserve markers which must not be reinterpreted.
        if (current === action.content) {
          results.push({ target: action.target, status: 'unchanged', reason: action.reason })
          continue
        }
        // Carry user content marked with yoke preserve markers into the new file.
        content = carryPreserved(current, action.content)
        if (content !== action.content) reason = `${action.reason} (preserve block kept)`

        if (current === content) {
          results.push({ target: action.target, status: 'unchanged', reason: action.reason })
          continue
        }
      } else if (currentBytes.equals(Buffer.from(action.content))) {
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
    writeFileSync(dest, content)
    if (action.executable !== undefined && process.platform !== 'win32') {
      const currentMode = statSync(dest).mode
      chmodSync(dest, action.executable ? currentMode | 0o111 : currentMode & ~0o111)
    }
    results.push({ target: action.target, status, backedUp, reason })
  }

  return results
}
