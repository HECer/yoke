import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadManifest } from '../../src/canon/manifest.js'

function withManifest(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mani-'))
  writeFileSync(join(dir, 'manifest.yaml'), yaml)
  return join(dir, 'manifest.yaml')
}

describe('loadManifest', () => {
  it('parses a valid manifest', () => {
    const file = withManifest(`
name: forge-canon
version: 0.1.0
agents: [claude, codex, gemini]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
    const m = loadManifest(file)
    expect(m.name).toBe('forge-canon')
    expect(m.agents).toEqual(['claude', 'codex', 'gemini'])
    expect(m.skills[0]).toMatchObject({ id: 'tdd', kind: 'methodology' })
    rmSync(join(file, '..'), { recursive: true, force: true })
  })

  it('rejects an unknown agent', () => {
    const file = withManifest(`
name: x
version: 0.1.0
agents: [claude, mystery]
skills: []
policy: []
loop: { spec: a, prdSchema: b }
tools: []
`)
    expect(() => loadManifest(file)).toThrow()
    rmSync(join(file, '..'), { recursive: true, force: true })
  })
})
