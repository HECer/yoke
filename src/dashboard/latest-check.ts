import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DASHBOARD_LIMITS } from './contracts.js'

/** UUID order is unrelated to recency; never fall back to an arbitrary old pass. */
export function latestCheckFile(root: string): string | undefined {
  const state = join(root, '.yoke'), directory = join(state, 'checks')
  try {
    if (lstatSync(state).isSymbolicLink() || lstatSync(directory).isSymbolicLink()) throw Error('Linked checks unavailable')
    const names = readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/u.test(name))
    if (names.length > DASHBOARD_LIMITS.checkFiles) throw Error('Latest check unavailable: check history exceeds the complete scan limit')
    let latest: { name: string; time: number } | undefined
    let ambiguous = false
    for (const name of names) {
      const stat = lstatSync(join(directory, name))
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Latest check unavailable: unsafe check history entry')
      if (!latest || stat.mtimeMs > latest.time) { latest = { name, time: stat.mtimeMs }; ambiguous = false }
      else if (stat.mtimeMs === latest.time) ambiguous = true
    }
    if (ambiguous) throw Error('Latest check unavailable: newest reports have indistinguishable timestamps')
    return latest ? `.yoke/checks/${latest.name}` : undefined
  } catch (error) {
    // A disappearing file inside an existing directory makes recency uncertain.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { lstatSync(directory) } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return undefined }
    }
    throw error
  }
}
