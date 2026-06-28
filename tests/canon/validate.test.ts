import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCanon } from '../../src/canon/validate.js'

let dir: string

function write(rel: string, content: string) {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function seedValidCanon() {
  write('manifest.yaml', `
name: c
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
  write('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
  write('policy/gates.md', 'gates')
  write('loop/loop-spec.md', 'loop')
  write('loop/prd.schema.md', 'prd')
  write('tools/rtk.md', 'rtk')
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-canon-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('validateCanon', () => {
  it('returns no errors for a well-formed canon', () => {
    seedValidCanon()
    const errors = validateCanon(dir).filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('flags a missing manifest', () => {
    const issues = validateCanon(dir)
    expect(issues.some(i => i.message.includes('manifest.yaml not found'))).toBe(true)
  })

  it('flags a skill whose SKILL.md is missing', () => {
    seedValidCanon()
    rmSync(join(dir, 'skills/tdd/SKILL.md'))
    expect(validateCanon(dir).some(i => i.message.includes('SKILL.md missing'))).toBe(true)
  })

  it('flags a skill with no frontmatter name', () => {
    seedValidCanon()
    write('skills/tdd/SKILL.md', '---\ndescription: d\n---\nbody')
    expect(validateCanon(dir).some(i => i.message.includes('missing name'))).toBe(true)
  })

  it('flags a missing policy file', () => {
    seedValidCanon()
    rmSync(join(dir, 'policy/gates.md'))
    expect(validateCanon(dir).some(i => i.message.includes('policy file not found'))).toBe(true)
  })

  it('flags a missing loop.spec file', () => {
    seedValidCanon()
    rmSync(join(dir, 'loop/loop-spec.md'))
    expect(validateCanon(dir).some(i => i.message.includes('loop.spec not found'))).toBe(true)
  })

  it('flags a missing tool path', () => {
    seedValidCanon()
    rmSync(join(dir, 'tools/rtk.md'))
    expect(validateCanon(dir).some(i => i.message.includes('tool rtk: path not found'))).toBe(true)
  })

  it('flags duplicate tool ids', () => {
    seedValidCanon()
    write('manifest.yaml', `
name: c
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
  - { id: rtk, path: tools/rtk.md }
`)
    expect(validateCanon(dir).some(i => i.message.includes('duplicate tool id'))).toBe(true)
  })

  it('flags duplicate skill ids', () => {
    seedValidCanon()
    write('manifest.yaml', `
name: c
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
  - { id: tdd, path: skills/tdd, kind: role }
policy:
  - { path: policy/gates.md }
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools:
  - { id: rtk, path: tools/rtk.md }
`)
    expect(validateCanon(dir).some(i => i.message.includes('duplicate skill id'))).toBe(true)
  })
})
