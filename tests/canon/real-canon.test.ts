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

  it('registers the visual verification skills', () => {
    const manifest = loadManifest(join(repoRoot, 'canon', 'manifest.yaml'))
    expect(manifest.skills.some(s => s.id === 'unslop-ui')).toBe(true)
    expect(manifest.skills.some(s => s.id === 'visual-verification')).toBe(true)
  })
})
