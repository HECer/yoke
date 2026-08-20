import type { Manifest } from './manifest.js'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'
import { parse } from 'yaml'

export type SkillEntry = Manifest['skills'][number]

export interface SkillPackageFile {
  readonly relativePath: string
  readonly content: Buffer
  readonly executable: boolean
}

export interface SkillPackageReferenceIssue {
  readonly source: string
  readonly reference: string
  readonly reason: 'missing' | 'escape'
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

export function enumerateSkillPackage(canonDir: string, skill: SkillEntry): readonly SkillPackageFile[] {
  const canonRoot = resolve(canonDir)
  const skillRoot = resolve(canonRoot, skill.path)
  if (!isWithin(canonRoot, skillRoot)) {
    throw new Error(`skill ${skill.id}: package path escapes Canon directory: ${skill.path}`)
  }

  const rootStats = lstatSync(skillRoot)
  if (rootStats.isSymbolicLink()) throw new Error(`skill ${skill.id}: package root is a symbolic link`)
  if (!rootStats.isDirectory()) throw new Error(`skill ${skill.id}: package root is not a directory`)

  const files: SkillPackageFile[] = []
  const targetKeys = new Set<string>()
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePath(left.name, right.name))
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name)
      if (!isWithin(skillRoot, absolutePath)) {
        throw new Error(`skill ${skill.id}: package entry escapes skill root: ${entry.name}`)
      }
      const stats = lstatSync(absolutePath)
      const relativePath = relative(skillRoot, absolutePath).split(sep).join('/')
      if (stats.isSymbolicLink()) throw new Error(`skill ${skill.id}: symbolic link is not allowed: ${relativePath}`)
      if (stats.isDirectory()) {
        visit(absolutePath)
        continue
      }
      if (!stats.isFile()) throw new Error(`skill ${skill.id}: unsupported file type: ${relativePath}`)
      const targetKey = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
      if (targetKeys.has(targetKey)) throw new Error(`skill ${skill.id}: duplicate target path: ${relativePath}`)
      targetKeys.add(targetKey)
      files.push({
        relativePath,
        content: readFileSync(absolutePath),
        executable: (stats.mode & 0o111) !== 0,
      })
    }
  }
  visit(skillRoot)
  return files.sort((left, right) => comparePath(left.relativePath, right.relativePath))
}

function markdownDestinations(markdown: string): string[] {
  const destinations: string[] = []
  const inline = /!?\[[^\]]*\]\(([^)]+)\)/gu
  for (const match of markdown.matchAll(inline)) {
    const raw = match[1]?.trim() ?? ''
    const destination = raw.startsWith('<')
      ? raw.slice(1, raw.indexOf('>'))
      : raw.match(/^\S+/u)?.[0]
    if (destination) destinations.push(destination)
  }
  return destinations
}

export function findSkillPackageReferenceIssues(files: readonly SkillPackageFile[]): readonly SkillPackageReferenceIssue[] {
  const paths = new Set(files.map(file => file.relativePath.normalize('NFC').toLocaleLowerCase('en-US')))
  const issues: SkillPackageReferenceIssue[] = []
  for (const file of files) {
    if (!file.relativePath.toLowerCase().endsWith('.md')) continue
    for (const rawReference of markdownDestinations(file.content.toString('utf8'))) {
      if (rawReference.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(rawReference) || rawReference.startsWith('//')) continue
      const withoutSuffix = rawReference.split(/[?#]/u, 1)[0] ?? ''
      let reference: string
      try {
        reference = decodeURIComponent(withoutSuffix).replaceAll('\\', '/')
      } catch {
        reference = withoutSuffix.replaceAll('\\', '/')
      }
      const joined = posix.normalize(posix.join(posix.dirname(file.relativePath), reference))
      const escapes = reference.startsWith('/') || joined === '..' || joined.startsWith('../')
      if (escapes || !paths.has(joined.normalize('NFC').toLocaleLowerCase('en-US'))) {
        issues.push({ source: file.relativePath, reference: rawReference, reason: escapes ? 'escape' : 'missing' })
      }
    }
  }
  return issues
}

export function codexInvocationPolicyIssue(files: readonly SkillPackageFile[], skill: SkillEntry): string | undefined {
  const policyFile = files.find(file => file.relativePath === 'agents/openai.yaml')
  if (!policyFile) return undefined
  const document = parse(policyFile.content.toString('utf8'))
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return `skill ${skill.id}: agents/openai.yaml must contain a YAML object`
  }
  const policy = (document as Record<string, unknown>).policy
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    return `skill ${skill.id}: agents/openai.yaml policy must be a YAML object`
  }
  const declared = (policy as Record<string, unknown>).allow_implicit_invocation
  const expected = skill.invocation === 'auto'
  return declared !== undefined && declared !== expected
    ? `skill ${skill.id}: agents/openai.yaml invocation policy conflicts with manifest`
    : undefined
}
