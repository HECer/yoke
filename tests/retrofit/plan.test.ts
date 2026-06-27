import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planClaudeRetrofit } from '../../src/retrofit/plan.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => {
    mkdirSync(join(canon, rel, '..'), { recursive: true })
    writeFileSync(join(canon, rel), c)
  }
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
  w('AGENTS.md', '# Forge Harness Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: d\n---\nbody')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planClaudeRetrofit', () => {
  it('plans a skill, AGENTS.md, and CLAUDE.md', () => {
    const actions = planClaudeRetrofit(canon, '/target')
    const targets = actions.map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('CLAUDE.md')
  })

  it('copies the canon skill content verbatim', () => {
    const action = planClaudeRetrofit(canon, '/target').find(a => a.target === '.claude/skills/tdd/SKILL.md')!
    expect(action.content).toContain('name: tdd')
  })

  it('CLAUDE.md imports AGENTS.md', () => {
    const action = planClaudeRetrofit(canon, '/target').find(a => a.target === 'CLAUDE.md')!
    expect(action.content).toContain('@AGENTS.md')
  })
})
