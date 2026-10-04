import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { workspaceFingerprint } from '../workspace/fingerprint.js'
import { storyPathSegment } from './prd.js'

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
function safePath(root: string, path: string): void {
  const rel = relative(resolve(root), resolve(path))
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Proof path escaped workspace')
  let current = root
  for (const segment of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, segment)
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Proof path must not contain a link: ${current}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
/** Copy selected proof into an immutable runtime snapshot; errors preserve the candidate. */
export function retainRuntimeProof(directory: string, storyId: string, targetDirectory: string): void {
  const entries: { path: string; sha256: string; bytes: Buffer }[] = []
  const walk = (dir: string, base: string, prefix = ''): void => {
    safePath(directory, dir)
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name); safePath(directory, file)
      const stat = lstatSync(file)
      if (stat.isDirectory()) walk(file, base, prefix)
      else if (stat.isFile()) {
        const bytes = readFileSync(file)
        entries.push({ path: (prefix + relative(base, file)).replace(/\\/gu, '/'), sha256: hash(bytes), bytes })
      } else throw new Error(`Unsupported proof entry: ${file}`)
    }
  }
  const artifacts = join(directory, '.yoke/artifacts'), proof = join(directory, '.yoke/proof')
  walk(artifacts, artifacts)
  walk(proof, proof, 'proof/')
  if (!entries.length) return
  const config = ['config.yaml', 'acceptance.yaml', 'prd.yaml'].map(name => {
    const path = join(directory, '.yoke', name); safePath(directory, path)
    return [name, existsSync(path) ? hash(readFileSync(path)) : 'missing']
  })
  const manifest = JSON.stringify({ version: 1, source: workspaceFingerprint(directory), config: hash(JSON.stringify(config)), environment: hash(JSON.stringify({ platform: process.platform, arch: process.arch, versions: process.versions })), files: entries.map(({ path, sha256 }) => ({ path, sha256 })) }, null, 2) + '\n'
  const destination = join(targetDirectory, '.yoke/proof', storyPathSegment(storyId), 'runtime-artifacts', hash(manifest))
  for (const { path, sha256, bytes } of [...entries, { path: 'manifest.json', sha256: hash(manifest), bytes: Buffer.from(manifest) }]) {
    const copied = join(destination, path); safePath(targetDirectory, copied)
    mkdirSync(dirname(copied), { recursive: true })
    if (existsSync(copied)) {
      if (hash(readFileSync(copied)) !== sha256) throw new Error(`Retained proof hash mismatch: ${path}`)
    } else writeFileSync(copied, bytes, { mode: 0o600, flag: 'wx' })
    if (hash(readFileSync(copied)) !== sha256) throw new Error(`Proof copy hash mismatch: ${path}`)
  }
}
