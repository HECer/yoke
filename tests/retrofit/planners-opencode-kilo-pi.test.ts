import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planOpenCode } from '../../src/retrofit/planners/opencode.js'
import { planKilo } from '../../src/retrofit/planners/kilo.js'
import { planPi } from '../../src/retrofit/planners/pi.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, content: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), content) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [opencode, kilo, pi]
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

describe('native OpenCode, Kilo, and Pi retrofit planners', () => {
  it('writes OpenCode skills, instructions, MCP config, and read-only agent', () => {
    const actions = planOpenCode(canon, '/t')
    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      'AGENTS.md', 'opencode.json', '.opencode/skills/tdd/SKILL.md', '.opencode/skills/release/SKILL.md', '.opencode/agents/yoke-reviewer.md',
    ]))
    const config = JSON.parse(String(actions.find(action => action.target === 'opencode.json')!.content))
    expect(config.instructions).toContain('AGENTS.md')
    expect(config.mcp.graphify).toMatchObject({ type: 'local', command: ['graphify', 'serve'], enabled: true })
    expect(String(actions.find(action => action.target === '.opencode/agents/yoke-reviewer.md')!.content)).toContain('edit: false')
  })

  it('writes Kilo-native skills, instructions, MCP config, and review agent', () => {
    const actions = planKilo(canon, '/t')
    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      'AGENTS.md', 'kilo.jsonc', '.kilo/skills/tdd/SKILL.md', '.kilo/skills/release/SKILL.md', '.kilo/agents/yoke-reviewer.md',
    ]))
    const config = JSON.parse(String(actions.find(action => action.target === 'kilo.jsonc')!.content))
    expect(config.instructions).toContain('AGENTS.md')
    expect(config.mcp.graphify).toMatchObject({ type: 'local', command: ['graphify', 'serve'], enabled: true })
  })

  it('writes Pi context, project settings, and complete native skill packages', () => {
    const actions = planPi(canon, '/t')
    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      'AGENTS.md', '.pi/settings.json', '.pi/skills/tdd/SKILL.md', '.pi/skills/release/SKILL.md',
    ]))
    const settings = JSON.parse(String(actions.find(action => action.target === '.pi/settings.json')!.content))
    expect(settings.skills).toEqual(['.pi/skills'])
    expect(String(actions.find(action => action.target === 'AGENTS.md')!.content)).toContain('rtk')
  })
})
