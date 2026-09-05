import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, lstatSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
const Entry = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), root: z.string().refine(isAbsolute), name: z.string().max(500), registeredAt: z.string() })
export type RegisteredProject = z.infer<typeof Entry> & { error?: string }
const directory = () => join(resolve(process.env.YOKE_STATE_DIR ?? join(homedir(), '.yoke/state')), 'projects')
export function registerProject(root: string): RegisteredProject {
  const canonical = realpathSync(root)
  if (!lstatSync(canonical).isDirectory()) throw new Error('Project root must be a directory')
  const id = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex').slice(0, 32)
  const project = { id, root: canonical, name: basename(canonical) || canonical, registeredAt: new Date().toISOString() }
  mkdirSync(directory(), { recursive: true })
  try { writeFileSync(join(directory(), `${id}.json`), JSON.stringify(project), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return project
}
export function listProjects(): RegisteredProject[] {
  try {
    return readdirSync(directory()).filter(name => /^[a-f0-9]{32}\.json$/u.test(name)).sort().slice(0, 500).map(name => {
      const file = join(directory(), name)
      try {
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid registry entry')
        const project = Entry.parse(JSON.parse(readFileSync(file, 'utf8')))
        if (`${project.id}.json` !== name) throw new Error('Registry ID mismatch')
        try {
          if (realpathSync(project.root) !== project.root || !lstatSync(project.root).isDirectory()) throw new Error('Project root changed')
          return project
        } catch { return { ...project, error: 'Project directory is missing or changed' } }
      } catch { return { id: name.slice(0, -5), root: '', name: 'Unreadable project', registeredAt: '', error: 'Invalid registry entry' } }
    })
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

/** Remove a registry reference; project files remain untouched. */
export function unregisterProject(id: string): boolean {
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error('Invalid project ID')
  try { unlinkSync(join(directory(), `${id}.json`)); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
