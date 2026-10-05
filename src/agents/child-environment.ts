import { statSync } from 'node:fs'
import { resolve, win32 } from 'node:path'
import { observedError } from '../observability/failure.js'

/** Prepare process-local execution inputs without modifying the parent environment. */
export function prepareChildEnvironment(cwd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { cwd: string; env: NodeJS.ProcessEnv } {
  const absolute = resolve(cwd)
  try {
    if (!cwd.trim() || !statSync(absolute).isDirectory()) throw new Error('not a directory')
  } catch {
    throw observedError(`Invalid working directory: ${absolute}`, 'invalid-cwd', 'not-started')
  }
  const next = { ...env }
  if (platform !== 'win32') return { cwd: absolute, env: next }
  const path = win32
  const keys = Object.keys(next).filter(key => key.toLowerCase() === 'path')
  const entries = keys.flatMap(key => (next[key] ?? '').split(';'))
  for (const key of keys) delete next[key]
  const seen = new Set<string>()
  const paths: string[] = []
  for (const entry of entries) {
    if (!entry.trim()) continue
    const unquoted = entry.replace(/^"(.*)"$/u, '$1')
    const normalized = path.resolve(absolute, unquoted)
    const identity = normalized.toLowerCase()
    if (seen.has(identity)) continue
    const relative = path.relative(absolute, normalized)
    const foreign = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    if (/[\\/]node_modules[\\/]\.bin(?:[\\/]?$)/iu.test(normalized) && foreign) continue
    seen.add(identity)
    paths.push(path.isAbsolute(unquoted) ? unquoted : normalized)
  }
  if (keys.length) next.PATH = paths.join(';')
  return { cwd: absolute, env: next }
}
