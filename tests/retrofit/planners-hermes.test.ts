import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planHermes } from '../../src/retrofit/planners/hermes.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, content: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), content) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [hermes]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology, invocation: auto }
  - { id: release, path: skills/release, kind: role, invocation: manual }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test-driven development\n---\nbody')
  w('skills/release/SKILL.md', '---\nname: release\ndescription: Release\n---\nmanual body')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('native Hermes retrofit planner', () => {
  it('writes Hermes skills, instructions, and read-only reviewer agent', () => {
    const actions = planHermes(canon, '/t')
    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      'AGENTS.md', '.hermes/skills/tdd/SKILL.md', '.hermes/skills/release/SKILL.md', '.hermes/agents/yoke-reviewer.md',
    ]))
    expect(String(actions.find(action => action.target === 'AGENTS.md')!.content)).toContain('Hermes integration')
    expect(String(actions.find(action => action.target === '.hermes/agents/yoke-reviewer.md')!.content)).toContain('toolsets:')
    expect(String(actions.find(action => action.target === '.hermes/skills/release/SKILL.md')!.content)).toContain('disable-model-invocation: true')
    expect(String(actions.find(action => action.target === '.hermes/skills/tdd/SKILL.md')!.content)).not.toContain('disable-model-invocation: true')
  })
})
