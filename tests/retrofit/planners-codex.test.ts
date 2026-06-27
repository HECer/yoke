import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planCodex } from '../../src/retrofit/planners/codex.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'forge-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: forge-canon
version: 0.1.0
agents: [codex]
skills: []
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }) })

describe('planCodex', () => {
  it('plans AGENTS.md, .codex/config.toml, and RTK.md', () => {
    const targets = planCodex(canon, '/t').map(a => a.target)
    expect(targets).toContain('AGENTS.md')
    expect(targets).toContain('.codex/config.toml')
    expect(targets).toContain('RTK.md')
  })

  it('config.toml has [mcp_servers.graphify] and [mcp_servers.playwright]', () => {
    const toml = planCodex(canon, '/t').find(a => a.target === '.codex/config.toml')!
    expect(toml.content).toContain('[mcp_servers.graphify]')
    expect(toml.content).toContain('[mcp_servers.playwright]')
  })
})
