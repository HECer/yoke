import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  const artifactDir = join(targetDir, relativeDir)
  assertContained(join(targetDir, '.yoke', 'artifacts'), artifactDir)
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 })

  let digestLength = 12
  let filename = `${options.phase}-${sha256.slice(0, digestLength)}.log`
  let file = join(artifactDir, filename)
  while (existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256) {
    digestLength = Math.min(sha256.length, digestLength + 8)
    filename = `${options.phase}-${sha256.slice(0, digestLength)}.log`
    file = join(artifactDir, filename)
  }
  if (!existsSync(file)) writeFileSync(file, raw, { encoding: 'utf8', mode: 0o600 })

  const relativePath = `${relativeDir.replace(/\\/gu, '/')}/${filename}`
  const bytes = Buffer.byteLength(raw)
  return {
    relativePath,
    bytes,
    sha256,
    marker: `[full output: ${relativePath} | ${bytes} bytes | sha256:${sha256}]`,
  }
}
