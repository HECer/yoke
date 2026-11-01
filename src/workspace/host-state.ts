import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Authority stays outside worker worktrees; project-controlled links are never followed. */
export function hostProjectStatePath(root: string, namespace: string, parts: readonly string[], create = false): string {
  if (![namespace, ...parts].every(part => part && !/[\\/]/u.test(part) && part !== '.' && part !== '..') || !parts.length) throw Error('Invalid host state path')
  const project = realpathSync(root)
  let path = resolve(process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || join(homedir(), '.yoke'))
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 })
  try { path = realpathSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const components = ['Yoke', namespace, createHash('sha256').update(project).digest('hex'), ...parts]
  for (let index = 0; index < components.length; index++) {
    path = join(path, components[index])
    const directory = index < components.length - 1
    if (create && directory) {
      try { mkdirSync(path, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || directory && !stat.isDirectory()) throw Error('Linked or invalid host state is unavailable')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path
}

export function readHostStateFile(path: string, maximum: number): string | undefined {
  let stat
  try { stat = lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('Invalid or oversized host state file')
  return readFileSync(path, 'utf8')
}

/** Flush complete authority before publication; never replace an existing record. */
export function publishHostStateFile(path: string, text: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
    linkSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}
