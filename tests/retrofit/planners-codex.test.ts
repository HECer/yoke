import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planCodex } from '../../src/retrofit/planners/codex.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [codex]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test first\n---\nBody\n')
  w('tools/codex-rtk-hook.mjs', '#!/usr/bin/env node\n')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planCodex', () => {
  it('plans native skills, hooks, role agents, AGENTS.md, config, and RTK guidance', () => {
    const actions = planCodex(canon, '/t')
    const targets = actions.map(a => a.target)
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('.agents/skills/tdd/SKILL.md')
    expect(targets).toContain('.codex/config.toml')
    expect(targets).toContain('.codex/hooks.json')
    expect(targets).toEqual(expect.arrayContaining([
      '.codex/agents/implementer.toml',
      '.codex/agents/reviewer.toml',
      '.codex/agents/security.toml',
      '.codex/agents/docs.toml',
    ]))
    expect(targets).toContain('RTK.md')
    expect(actions.find(a => a.target === 'AGENTS.md')!.content).toContain('@RTK.md')
    expect(actions.find(a => a.target === '.codex/hooks.json')!.content).toContain('.codex/hooks/rtk.mjs')
  })

  it('config.toml has [mcp_servers.graphify] and [mcp_servers.playwright]', () => {
    const toml = planCodex(canon, '/t').find(a => a.target === '.codex/config.toml')!
    expect(toml.content).toContain('[mcp_servers.graphify]')
    expect(toml.content).toContain('[mcp_servers.playwright]')
    expect(toml.content).not.toContain('Merge into ~/.codex/config.toml')
  })

  it('defines narrow, named role agents', () => {
    const actions = planCodex(canon, '/t')
    const reviewer = actions.find(a => a.target === '.codex/agents/reviewer.toml')!
    expect(reviewer.content).toContain('name = "reviewer"')
    expect(reviewer.content).toContain('sandbox_mode = "read-only"')
    expect(reviewer.content).toContain('developer_instructions = """')
  })
})
