import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadManifest } from '../../src/canon/manifest.js'

let dir: string

function withManifest(yaml: string): string {
  const file = join(dir, 'manifest.yaml')
  writeFileSync(file, yaml)
  return file
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-mani-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('loadManifest', () => {
  it('parses a valid manifest', () => {
    const file = withManifest(`
name: yoke-canon
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
    expect(m.name).toBe('yoke-canon')
    expect(m.agents).toEqual(['claude', 'codex', 'gemini'])
    expect(m.skills[0]).toMatchObject({ id: 'tdd', kind: 'methodology' })
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
  })
})
