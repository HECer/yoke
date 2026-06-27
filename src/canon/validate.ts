import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest } from './manifest.js'
import { parseFrontmatter } from './frontmatter.js'

export interface Issue {
  level: 'error' | 'warn'
  message: string
}

export function validateCanon(canonDir: string): Issue[] {
  const issues: Issue[] = []
  const manifestPath = join(canonDir, 'manifest.yaml')
  if (!existsSync(manifestPath)) {
    return [{ level: 'error', message: `manifest.yaml not found in ${canonDir}` }]
  }

  let manifest
  try {
    manifest = loadManifest(manifestPath)
  } catch (e) {
    return [{ level: 'error', message: `manifest.yaml invalid: ${(e as Error).message}` }]
  }

  const seenSkill = new Set<string>()
  for (const s of manifest.skills) {
    if (seenSkill.has(s.id)) issues.push({ level: 'error', message: `duplicate skill id: ${s.id}` })
    seenSkill.add(s.id)
    const dir = join(canonDir, s.path)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      issues.push({ level: 'error', message: `skill ${s.id}: path not found: ${s.path}` })
      continue
    }
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) {
      issues.push({ level: 'error', message: `skill ${s.id}: SKILL.md missing` })
      continue
    }
    const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'))
    if (!fm) {
      issues.push({ level: 'error', message: `skill ${s.id}: SKILL.md has no frontmatter` })
    } else {
      if (!fm.name) issues.push({ level: 'error', message: `skill ${s.id}: frontmatter missing name` })
      if (!fm.description) issues.push({ level: 'error', message: `skill ${s.id}: frontmatter missing description` })
    }
  }

  for (const p of manifest.policy) {
    if (!existsSync(join(canonDir, p.path))) {
      issues.push({ level: 'error', message: `policy file not found: ${p.path}` })
    }
  }

  const loopChecks: ReadonlyArray<readonly [string, string]> = [
    ['loop.spec', manifest.loop.spec],
    ['loop.prdSchema', manifest.loop.prdSchema],
  ]
  for (const [label, rel] of loopChecks) {
    if (!existsSync(join(canonDir, rel))) {
      issues.push({ level: 'error', message: `${label} not found: ${rel}` })
    }
  }

  const seenTool = new Set<string>()
  for (const t of manifest.tools) {
    if (seenTool.has(t.id)) issues.push({ level: 'error', message: `duplicate tool id: ${t.id}` })
    seenTool.add(t.id)
    if (!existsSync(join(canonDir, t.path))) {
      issues.push({ level: 'error', message: `tool ${t.id}: path not found: ${t.path}` })
    }
  }

  return issues
}
