import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { validateCanon } from '../../src/canon/validate.js'
import { loadManifest } from '../../src/canon/manifest.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('real canon', () => {
  it('validates with zero errors', () => {
    const errors = validateCanon(join(repoRoot, 'canon')).filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('registers the maintaining-context skill', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'maintaining-context')).toBe(true)
  })

  it('no longer ships the eng-review skill (folded into review)', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'eng-review')).toBe(false)
    expect(manifest.skills.some(s => s.id === 'review')).toBe(true)
  })

  it('AGENTS.md carries the skill routing/precedence section', () => {
    const agents = readFileSync(join(repoRoot, 'canon', 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/Skill routing/i)
    expect(agents).toContain('Pre-merge code review')
    expect(agents).toContain('`review`')
  })

  it('registers the authoring-prd skill', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'authoring-prd')).toBe(true)
  })

  it('registers the visual verification skills', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'unslop-ui')).toBe(true)
    expect(manifest.skills.some(s => s.id === 'visual-verification')).toBe(true)
  })

  it('declares an invocation policy for every skill', () => {
    const source = readFileSync(join(repoRoot, 'canon', 'manifest.yaml'), 'utf8')
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))

    expect(manifest.skills.every(skill => skill.invocation === 'auto' || skill.invocation === 'manual')).toBe(true)
    expect(source.match(/invocation:/gu)).toHaveLength(manifest.skills.length)
  })

  it('registers the prose, domain, design, merge, and agent-writing capabilities', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    const ids = manifest.skills.map(skill => skill.id)

    expect(ids).toEqual(expect.arrayContaining([
      'no-ai-slop',
      'domain-modeling',
      'codebase-design',
      'resolving-merge-conflicts',
      'writing-for-agents',
    ]))
    expect(manifest.skills.filter(skill => ids.slice(-5).includes(skill.id)).every(skill => skill.invocation === 'auto')).toBe(true)
  })

  it('ships referenced resources and source attribution for adapted skills', () => {
    expect(readFileSync(join(repoRoot, 'canon', 'skills', 'no-ai-slop', 'eval.md'), 'utf8')).toContain('No AI slop eval')
    expect(readFileSync(join(repoRoot, 'canon', 'skills', 'domain-modeling', 'ADR-FORMAT.md'), 'utf8')).toContain('ADR')
    expect(readFileSync(join(repoRoot, 'canon', 'skills', 'codebase-design', 'DEEPENING.md'), 'utf8')).toContain('Deepening')
    expect(readFileSync(join(repoRoot, 'canon', 'skills', 'writing-for-agents', 'SKILL-MECHANICS.md'), 'utf8')).toContain('Skill mechanics')
    const attribution = readFileSync(join(repoRoot, 'canon', 'skills', 'ATTRIBUTION.md'), 'utf8')
    expect(attribution).toContain('https://github.com/petergyang/no-ai-slop')
    expect(attribution).toContain('https://github.com/mattpocock/skills')
    expect(attribution).toContain('Copyright (c) 2026 Peter Yang')
    expect(attribution).toContain('Copyright (c) 2026 Matt Pocock')
  })

  it('routes documentation prose through the advisory no-ai-slop evaluation', () => {
    const release = readFileSync(join(repoRoot, 'canon', 'skills', 'document-release', 'SKILL.md'), 'utf8')

    expect(release).toContain('no-ai-slop')
    expect(release).toContain('eval.md')
    expect(release).toMatch(/advisory|not a mechanical gate/iu)
  })
})
