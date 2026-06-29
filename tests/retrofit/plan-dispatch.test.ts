import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planRetrofit } from '../../src/retrofit/plan.js'
import { baseContextActions } from '../../src/retrofit/context-actions.js'

let canon: string
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
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
  w('context/PROJECT.md', '# Project\n')
  w('context/DECISIONS.md', '# Decisions\n')
  w('context/KNOWLEDGE.md', '# Knowledge\n')
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

  it('passes the code-graph choice to every planner', () => {
    const actions = planRetrofit(canon, '/t', ['claude', 'codex', 'gemini'], 'serena')
    const claudeMcp = actions.find(a => a.target === '.mcp.json')!
    const codexToml = actions.find(a => a.target === '.codex/config.toml')!
    const geminiSettings = actions.find(a => a.target === '.gemini/settings.json')!
    expect(claudeMcp.content).toContain('serena')
    expect(codexToml.content).toContain('mcp_servers.serena')
    expect(geminiSettings.content).toContain('serena')
  })

  it('scaffolds the three context files exactly once for --agent=all', () => {
    const actions = planRetrofit(canon, '.', ['claude', 'codex', 'gemini'])
    const ctxTargets = actions.filter(a => a.target.startsWith('.yoke/context/')).map(a => a.target)
    expect(ctxTargets.sort()).toEqual([
      '.yoke/context/DECISIONS.md',
      '.yoke/context/KNOWLEDGE.md',
      '.yoke/context/PROJECT.md',
    ])
    expect(actions.filter(a => a.target === '.yoke/context/PROJECT.md')).toHaveLength(1)
  })

  it('baseContextActions are all ifAbsent', () => {
    expect(baseContextActions(canon).every(a => a.ifAbsent)).toBe(true)
  })

  it('baseContextActions throws a framed error when a template is missing', () => {
    rmSync(join(canon, 'context/PROJECT.md'))
    expect(() => baseContextActions(canon)).toThrow(/yoke: missing context template PROJECT\.md/)
  })
})
