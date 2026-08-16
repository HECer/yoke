import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { OutputArtifact, OutputPhase } from './types.js'

function safeLabel(value: string | undefined): string {
  const cleaned = (value ?? '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 80)
  return cleaned || 'session'
}

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(resolve(root), resolve(candidate))
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('artifact path escaped the project artifact root')
}

export function writeOutputArtifact(
  targetDir: string,
  raw: string,
  options: { readonly phase: OutputPhase; readonly storyId?: string },
): OutputArtifact {
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const label = safeLabel(options.storyId)
  const relativeDir = join('.yoke', 'artifacts', label)
  const projectRoot = realpathSync(targetDir)
  const yokeRoot = join(targetDir, '.yoke')
  if (existsSync(yokeRoot)) {
    if (lstatSync(yokeRoot).isSymbolicLink()) throw new Error('artifact root parent must not be a symlink')
    assertContained(projectRoot, realpathSync(yokeRoot))
  } else {
    mkdirSync(yokeRoot, { mode: 0o700 })
  }
  const artifactRoot = join(targetDir, '.yoke', 'artifacts')
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 })
  if (lstatSync(artifactRoot).isSymbolicLink()) throw new Error('artifact root must not be a symlink')
  const resolvedArtifactRoot = realpathSync(artifactRoot)
  assertContained(projectRoot, resolvedArtifactRoot)
  const artifactDir = join(artifactRoot, label)
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 })
  assertContained(resolvedArtifactRoot, realpathSync(artifactDir))

  let digestLength = 12
  let filename = `${options.phase}-${sha256.slice(0, digestLength)}.log`
  let file = join(artifactDir, filename)
  while (existsSync(file) && !lstatSync(file).isSymbolicLink() && createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256) {
    if (digestLength === sha256.length) throw new Error('artifact digest path contains mismatched content')
    digestLength = Math.min(sha256.length, digestLength + 8)
    filename = `${options.phase}-${sha256.slice(0, digestLength)}.log`
    file = join(artifactDir, filename)
  }
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('artifact file must not be a symlink')
  if (!existsSync(file)) writeFileSync(file, raw, { encoding: 'utf8', mode: 0o600 })
  else chmodSync(file, 0o600)

  const relativePath = `${relativeDir.replace(/\\/gu, '/')}/${filename}`
  const bytes = Buffer.byteLength(raw)
  return {
    relativePath,
    bytes,
    sha256,
    marker: `[full output: ${relativePath} | ${bytes} bytes | sha256:${sha256}]`,
  }
}
