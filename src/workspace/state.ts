import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/** Fixed internal runtime paths only. Never follow project-controlled state links. */
export function statePath(root: string, ...parts: string[]): string {
  let path = root
  for (const part of ['.yoke', ...parts]) {
    if (!part || /[\\/]/u.test(part) || part === '.' || part === '..') throw new Error('Invalid state path component')
    path = join(path, part)
    try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Linked Yoke state is not supported: ${part}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path
}
