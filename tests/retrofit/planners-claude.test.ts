import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planClaude } from '../../src/retrofit/planners/claude.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [claude]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planClaude', () => {
  it('plans skill, AGENTS.md, CLAUDE.md and an .mcp.json with both servers', () => {
    const targets = planClaude(canon, '/t').map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('CLAUDE.md')
    expect(targets).toContain('.mcp.json')
  })

  it('the .mcp.json content references graphify and playwright', () => {
    const mcp = planClaude(canon, '/t').find(a => a.target === '.mcp.json')!
    expect(mcp.content).toContain('graphify')
    expect(mcp.content).toContain('playwright')
  })

  it('with WSL available, emits .claude/settings.json wiring the rtk hook', () => {
    const actions = planClaude(canon, '/t', true)
    const settings = actions.find(a => a.target === '.claude/settings.json')
    expect(settings).toBeDefined()
    expect(settings!.content).toContain('rtk')
  })

  it('without WSL, falls back to the rtk instruction in CLAUDE.md and no settings.json', () => {
    const actions = planClaude(canon, '/t', false)
    expect(actions.find(a => a.target === '.claude/settings.json')).toBeUndefined()
    const claudeMd = actions.find(a => a.target === 'CLAUDE.md')!
    expect(claudeMd.content).toMatch(/rtk/i)
  })

  it('marks .claude/settings.json as a merge action', () => {
    const settings = planClaude(canon, '/t', true).find(a => a.target === '.claude/settings.json')!
    expect(settings.merge).toBe(true)
  })

  it('wires the chosen code-graph into .mcp.json', () => {
    const mcp = planClaude(canon, '/t', false, 'serena').find(a => a.target === '.mcp.json')!
    expect(mcp.content).toContain('serena')
    expect(mcp.content).not.toContain('graphify')
  })
})
