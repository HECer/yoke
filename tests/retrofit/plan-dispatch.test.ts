import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planRetrofit } from '../../src/retrofit/plan.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [claude, codex, gemini]
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

describe('planRetrofit', () => {
  it('dispatches to one planner', () => {
    const targets = planRetrofit(canon, '/t', ['codex']).map(a => a.target)
    expect(targets).toContain('.codex/config.toml')
    expect(targets).not.toContain('.claude/skills/tdd/SKILL.md')
  })

  it('merges multiple agents and de-dupes shared targets (AGENTS.md once)', () => {
    const actions = planRetrofit(canon, '/t', ['claude', 'codex', 'gemini'])
    const targets = actions.map(a => a.target)
    expect(targets).toContain('.claude/skills/tdd/SKILL.md')
    expect(targets).toContain('.codex/config.toml')
    expect(targets).toContain('.gemini/commands/tdd.toml')
    expect(targets.filter(t => t === 'AGENTS.md')).toHaveLength(1)
  })
})
