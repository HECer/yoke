import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Content identity, including new files. Symlinks are identified, never followed. */
export function workspaceFingerprint(directory: string): string {
  const root = realpathSync(directory)
  const hash = createHash('sha256')
  let names: string[]
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  try {
    git(['rev-parse', '--show-toplevel'])
  } catch (error) {
    // Plain directories are supported for review fixtures and standalone checks;
    // permission/corruption errors in actual repositories must never become success.
    if (!String((error as { stderr?: unknown }).stderr).includes('not a git repository')) throw error
    const walk = (dir: string): string[] => readdirSync(dir).sort().flatMap(name => {
      if (['.git', 'node_modules', '.yoke'].includes(name)) return []
      const path = join(dir, name)
      return lstatSync(path).isDirectory() ? walk(path) : [relative(root, path)]
    })
    names = walk(root)
    return digest(names)
  }
  hash.update(git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude).yoke/**']))
  hash.update(git(['ls-files', '--stage', '-z', '--', '.', ':(exclude).yoke/**']))
  names = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).yoke/**']).split('\0').filter(Boolean))].sort()
  return digest(names)

  function digest(files: string[]): string {
    // Runtime status and evidence change during checks. Executable project policy
    // must still belong to the identity, even when globally ignored by Git.
    for (const name of [...new Set([...files, '.yoke/acceptance.yaml', '.yoke/config.yaml', '.yoke/prd.json', '.yoke/prd.yaml'])].sort()) {
      const full = resolve(root, name)
      const rel = relative(root, full)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error('Fingerprint path escapes workspace')
      hash.update(JSON.stringify(name))
      let stat
      try { stat = lstatSync(full) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { hash.update('missing'); continue }
        throw error
      }
      if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(full)}`)
      else if (stat.isFile()) {
        if (stat.size > 64 * 1024 * 1024) throw new Error(`File too large to fingerprint safely: ${name}`)
        hash.update(`file:${stat.mode}:${stat.size}:`).update(readFileSync(full))
      } else if (stat.isDirectory()) throw new Error(`Cannot safely fingerprint a nested repository or directory entry: ${name}`)
      else throw new Error(`Unsupported workspace entry: ${name}`)
    }
    return hash.digest('hex')
  }
}
