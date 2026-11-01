import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { planCodex } from '../../src/retrofit/planners/codex.js'
import { applyActions } from '../../src/retrofit/apply.js'

let canon: string
const targets: string[] = []
function targetWithConfig(source: string): string {
  const target = mkdtempSync(join(tmpdir(), 'yoke-codex-config-'))
  targets.push(target)
  mkdirSync(join(target, '.codex'))
  writeFileSync(join(target, '.codex/config.toml'), source)
  return target
}
beforeEach(() => {
  canon = mkdtempSync(join(tmpdir(), 'yoke-canon-'))
  const w = (rel: string, c: string | Uint8Array) => { mkdirSync(join(canon, rel, '..'), { recursive: true }); writeFileSync(join(canon, rel), c) }
  w('manifest.yaml', `
name: yoke-canon
version: 0.1.0
agents: [codex]
skills:
  - { id: tdd, path: skills/tdd, kind: methodology, invocation: auto }
  - { id: release, path: skills/release, kind: role, invocation: manual }
policy: []
loop: { spec: loop/loop-spec.md, prdSchema: loop/prd.schema.md }
tools: []
`)
  w('AGENTS.md', '# Baseline\n')
  w('skills/tdd/SKILL.md', '---\nname: tdd\ndescription: Test first\n---\nBody\n')
  w('skills/tdd/references/guide.md', '# Guide\n')
  w('skills/tdd/assets/sample.bin', new Uint8Array([0, 255, 4]))
  w('skills/release/SKILL.md', '---\nname: release\ndescription: Release\n---\nBody\n')
  w('tools/codex-rtk-hook.mjs', '#!/usr/bin/env node\n')
})
afterEach(() => { rmSync(canon, { recursive: true, force: true }); for (const target of targets.splice(0)) rmSync(target, { recursive: true, force: true }) })

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
    expect(actions.find(a => a.target === '.codex/hooks.json')!.content).toContain('rtk hook codex')
  })

  it('migrates only Yoke legacy hooks and preserves foreign hooks idempotently', () => {
    const target = mkdtempSync(join(tmpdir(), 'yoke-codex-hooks-'))
    const foreign = { matcher: '^Bash$', hooks: [{ type: 'command', command: 'company-check' }] }
    const legacy = JSON.parse(String(planCodex(canon, target).find(a => a.target === '.codex/hooks.json')!.content))
    legacy.hooks.PreToolUse = [foreign, { matcher: '^Bash$', hooks: [{ type: 'command', command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/rtk.mjs"', timeout: 5, statusMessage: 'Compressing command output with RTK' }] }]
    mkdirSync(join(target, '.codex'), { recursive: true })
    writeFileSync(join(target, '.codex/hooks.json'), JSON.stringify(legacy))
    try {
      const apply = () => applyActions(planCodex(canon, target).filter(a => a.target === '.codex/hooks.json'), target, { backupDir: join(target, 'backups') })
      apply()
      const bytes = readFileSync(join(target, '.codex/hooks.json'), 'utf8')
      expect(JSON.parse(bytes).hooks.PreToolUse).toEqual([foreign, { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook codex' }] }])
      apply()
      expect(readFileSync(join(target, '.codex/hooks.json'), 'utf8')).toBe(bytes)
    } finally { rmSync(target, { recursive: true, force: true }) }
  })

  it('copies complete skill packages and emits matching invocation policy', () => {
    const actions = planCodex(canon, '/t')

    expect(actions.map(action => action.target)).toEqual(expect.arrayContaining([
      '.agents/skills/tdd/references/guide.md',
      '.agents/skills/tdd/assets/sample.bin',
      '.agents/skills/tdd/agents/openai.yaml',
      '.agents/skills/release/agents/openai.yaml',
    ]))
    expect(String(actions.find(action => action.target === '.agents/skills/tdd/agents/openai.yaml')!.content))
      .toContain('allow_implicit_invocation: true')
    expect(String(actions.find(action => action.target === '.agents/skills/release/agents/openai.yaml')!.content))
      .toContain('allow_implicit_invocation: false')
  })

  it('config.toml has [mcp_servers.graphify] and [mcp_servers.playwright]', () => {
    const toml = planCodex(canon, '/t', 'graphify', 'off', true).find(a => a.target === '.codex/config.toml')!
    expect(toml.content).toContain('[mcp_servers.graphify]')
    expect(toml.content).toContain('[mcp_servers.playwright]')
    expect(toml.content).not.toContain('Merge into ~/.codex/config.toml')
  })

  it.each(['C:\\Users\\operator\\project', '/projects/quoted"name', '/projects/line\nbreak'])('round-trips a workspace path without changing TOML structure: %j', target => {
    const action = planCodex(canon, target, 'none', 'active').find(action => action.target === '.codex/config.toml')!
    expect(parseToml(String(action.content))).toEqual({
      features: { hooks: true },
      mcp_servers: { 'code-intelligence': { command: 'yoke', args: ['code-intelligence-server', `--workspace=${target}`, '--mode=active'] } },
    })
  })

  it('preserves unrelated settings and servers while removing only recognized opted-out tools', () => {
    const source = `model = "operator-model"
approval_policy = "on-request"
[features]
hooks = false
shell_snapshot = true
[profiles.company]
model = "company-model"
precise_integer = 9223372036854775807
whole_float = 1.0
[mcp_servers.foreign]
url = "https://example.test/mcp"
enabled_tools = ["inspect", "lookup"]
[mcp_servers.graphify]
command = "graphify"
args = ["serve"]
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]
[mcp_servers.serena]
command = "custom-serena-wrapper"
args = ["--operator-setting"]
`
    const target = targetWithConfig(source)
    const apply = () => applyActions(planCodex(canon, target, 'none', 'off', false).filter(action => action.target === '.codex/config.toml'), target, { backupDir: join(target, 'backups') })
    apply()
    const bytes = readFileSync(join(target, '.codex/config.toml'), 'utf8')
    const expected = parseToml(source, { integersAsBigInt: true })
    ;(expected.features as Record<string, unknown>).hooks = true
    const servers = expected.mcp_servers as Record<string, unknown>
    delete servers.graphify; delete servers.playwright
    expect(parseToml(bytes, { integersAsBigInt: true })).toEqual(expected)
    expect(readFileSync(join(target, 'backups/.codex/config.toml'), 'utf8')).toBe(source)
    expect(apply()[0].status).toBe('unchanged')
    expect(readFileSync(join(target, '.codex/config.toml'), 'utf8')).toBe(bytes)
  })

  it('replaces MCP launch arguments as a whole while preserving operator server settings', () => {
    const target = targetWithConfig(stringifyToml({
      features: { shell_snapshot: true },
      mcp_servers: {
        'code-intelligence': { command: 'yoke', args: ['code-intelligence-server', '--workspace=/old/project', '--mode=shadow'], startup_timeout_sec: 30, env: { CUSTOM: 'keep' } },
        foreign: { command: 'custom-server', args: ['--operator-arg'] },
      },
    }))
    const action = planCodex(canon, target, 'none', 'active').find(action => action.target === '.codex/config.toml')!
    expect(parseToml(String(action.content))).toEqual({
      features: { hooks: true, shell_snapshot: true },
      mcp_servers: {
        'code-intelligence': { command: 'yoke', args: ['code-intelligence-server', `--workspace=${target}`, '--mode=active'], startup_timeout_sec: 30, env: { CUSTOM: 'keep' } },
        foreign: { command: 'custom-server', args: ['--operator-arg'] },
      },
    })
  })

  it.each(['[mcp_servers.\n', '[features]\nhooks = true\n[features]\nhooks = false\n'])('rejects malformed existing TOML before applying any actions', source => {
    const target = targetWithConfig(source)
    expect(() => applyActions(planCodex(canon, target), target, { backupDir: join(target, 'backups') })).toThrow(/cannot merge \.codex\/config\.toml.*not valid TOML/u)
    expect(readFileSync(join(target, '.codex/config.toml'), 'utf8')).toBe(source)
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(target, '.agents'))).toBe(false)
    expect(existsSync(join(target, 'backups'))).toBe(false)
  })

  it('defines narrow, named role agents', () => {
    const actions = planCodex(canon, '/t')
    const reviewer = actions.find(a => a.target === '.codex/agents/reviewer.toml')!
    expect(reviewer.content).toContain('name = "reviewer"')
    expect(reviewer.content).toContain('sandbox_mode = "read-only"')
    expect(reviewer.content).toContain('developer_instructions = """')
    const docs = actions.find(a => a.target === '.codex/agents/docs.toml')!
    expect(docs.content).toContain('no-ai-slop')
  })
})
