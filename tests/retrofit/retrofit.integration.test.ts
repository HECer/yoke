import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runRetrofit } from '../../src/cli.js'
import { loadConfig, saveConfig } from '../../src/retrofit/config.js'


let target: string
beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'yoke-retro-')) })
afterEach(() => { rmSync(target, { recursive: true, force: true }) })

describe('yoke retrofit (integration, Claude)', () => {
  it('generates Claude artifacts and writes config with loop disabled by default', () => {
    const code = runRetrofit(target, { loop: false })
    expect(code).toBe(0)
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/review/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/yoke-retrofit/SKILL.md'))).toBe(true)
    const cfg = loadConfig(target)!
    expect(cfg.agents).toContain('claude')
    expect(cfg.loop.enabled).toBe(false)
  })

  it('additively merges claude into pre-existing agents', () => {
    saveConfig(target, { canonVersion: '0.1.0', agents: ['codex'], loop: { enabled: false } })
    runRetrofit(target, { loop: false })
    const cfg = loadConfig(target)!
    expect(cfg.agents).toContain('codex')
    expect(cfg.agents).toContain('claude')
  })

  it('records loop enabled when --loop is passed', () => {
    runRetrofit(target, { loop: true })
    expect(loadConfig(target)!.loop.enabled).toBe(true)
  })

  it('is idempotent on a second run', () => {
    runRetrofit(target, { loop: false })
    const agentsBefore = readFileSync(join(target, 'AGENTS.md'), 'utf8')
    const settingsPath = join(target, '.claude/settings.json')
    const settingsBefore = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null
    const code = runRetrofit(target, { loop: false })
    expect(code).toBe(0)
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe(agentsBefore)
    if (settingsBefore !== null) {
      expect(readFileSync(settingsPath, 'utf8')).toBe(settingsBefore)
    }
  })

  it('retrofits all three agents when --agent all is selected', () => {
    const code = runRetrofit(target, { loop: false, agents: ['claude', 'codex', 'gemini'] })
    expect(code).toBe(0)
    expect(existsSync(join(target, '.claude/skills/tdd/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.codex/config.toml'))).toBe(true)
    expect(existsSync(join(target, '.gemini/settings.json'))).toBe(true)
    const cfg = loadConfig(target)!
    expect(cfg.agents).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini']))
  })

  it('retrofits only the selected agent', () => {
    runRetrofit(target, { loop: false, agents: ['gemini'] })
    expect(existsSync(join(target, '.gemini/settings.json'))).toBe(true)
    expect(existsSync(join(target, '.codex/config.toml'))).toBe(false)
  })

  it('defaults codeGraph to graphify and records it', () => {
    runRetrofit(target, { loop: false, agents: ['claude'] })
    expect(loadConfig(target)!.codeGraph).toBe('graphify')
  })

  it('honors an explicit codeGraph and persists it', () => {
    runRetrofit(target, { loop: false, agents: ['claude'], codeGraph: 'serena' })
    expect(loadConfig(target)!.codeGraph).toBe('serena')
    expect(existsSync(join(target, '.mcp.json'))).toBe(true)
  })

  it('keeps a previously-chosen codeGraph on a later run that does not specify one', () => {
    runRetrofit(target, { loop: false, agents: ['claude'], codeGraph: 'serena' })
    runRetrofit(target, { loop: false, agents: ['claude'] })
    expect(loadConfig(target)!.codeGraph).toBe('serena')
  })
})
