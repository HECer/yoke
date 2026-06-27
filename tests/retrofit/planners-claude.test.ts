import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planClaude } from '../../src/retrofit/planners/claude.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
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
})
