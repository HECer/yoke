import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, saveConfig, defaultConfig, resolveVerifyCommand, YokeConfigSchema } from '../../src/retrofit/config.js'
import { writeFileSync } from 'node:fs'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('yoke config', () => {
  it('returns null when no config exists', () => {
    expect(loadConfig(dir)).toBeNull()
  })

  it('saves and reloads a config round-trip', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } }
    saveConfig(dir, cfg)
    expect(existsSync(join(dir, '.yoke', 'config.yaml'))).toBe(true)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('defaultConfig has loop disabled', () => {
    expect(defaultConfig('0.1.0').loop.enabled).toBe(false)
  })

  it('round-trips an optional verify command', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false }, verify: { command: 'npm test' } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('resolveVerifyCommand prefers config.verify.command', () => {
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true }, verify: { command: 'pytest' } })).toBe('pytest')
  })

  it('resolveVerifyCommand falls back to npm test when package.json has a test script', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true } })).toBe('npm test')
  })

  it('resolveVerifyCommand returns null when nothing is configured or detectable', () => {
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true } })).toBeNull()
  })

  it('resolveVerifyCommand returns null when package.json has only the npm default test stub', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
    expect(resolveVerifyCommand(dir, { canonVersion: '0', agents: [], loop: { enabled: true } })).toBeNull()
  })

  it('accepts an optional loop.timeoutMinutes', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true, timeoutMinutes: 30 } }
    saveConfig(dir, cfg)
    const loaded = loadConfig(dir)!
    expect(loaded.loop.timeoutMinutes).toBe(30)
    expect(loaded).toEqual(cfg)
  })

  it('leaves timeoutMinutes undefined when omitted', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)!.loop.timeoutMinutes).toBeUndefined()
  })

  it('accepts an optional verify.retries', () => {
    const parsed = YokeConfigSchema.parse({ canonVersion: '0.1.0', agents: ['claude'], loop: { enabled: true }, verify: { command: 'npm test', retries: 2 } })
    expect(parsed.verify?.retries).toBe(2)
  })
  it('accepts verify without retries', () => {
    const parsed = YokeConfigSchema.parse({ canonVersion: '0.1.0', agents: [], loop: { enabled: false }, verify: { command: 'npm test' } })
    expect(parsed.verify?.retries).toBeUndefined()
  })

  it('round-trips an explicit runner permission profile', () => {
    const cfg = { ...defaultConfig('1.0.0'), runner: { permissions: 'read-only' as const } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)?.runner?.permissions).toBe('read-only')
  })

  it('round-trips a preferred runner agent independently from permissions', () => {
    const cfg = { ...defaultConfig('1.1.0'), agents: ['claude', 'codex'] as const, runner: { agent: 'codex' as const } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)?.runner).toEqual({ agent: 'codex' })
  })

  it('round-trips opt-in adaptive routing with opaque provider model ids', () => {
    const cfg = {
      ...defaultConfig('1.2.0'),
      routing: {
        enabled: true, strategy: 'cost' as const, maxCandidates: 2,
        orchestrator: { model: 'parent-current', reasoningEffort: 'deep-vNext' },
        workers: [{ id: 'cheap-worker', agent: 'gemini' as const, model: 'provider-current', costTier: 'low' as const, capabilities: ['exploration'] }],
      },
    }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)?.routing).toEqual(cfg.routing)
  })

  it('rejects routing worker ids that are unsafe for prompts and logs', () => {
    expect(() => YokeConfigSchema.parse({
      ...defaultConfig('1'), routing: { enabled: true, workers: [{ id: '../bad', agent: 'codex', costTier: 'low', capabilities: [] }] },
    })).toThrow()
  })

  it('rejects an unknown runner permission profile', () => {
    expect(() => YokeConfigSchema.parse({ canonVersion: '1', agents: [], loop: { enabled: true }, runner: { permissions: 'root' } })).toThrow()
  })

  it('round-trips commit identity and defaults co-authors in the resolver, not YAML', () => {
    const cfg = { ...defaultConfig('1.0.0'), commit: { authorName: 'HECer', authorEmail: 'hec_er@web.de' } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)?.commit).toEqual(cfg.commit)
  })

  it('round-trips an optional codeGraph choice', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false }, codeGraph: 'serena' as const }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('round-trips a smoke section', () => {
    const config = { ...defaultConfig('1.0.0'), smoke: { baseUrl: 'http://localhost:3000', flows: [{ name: 'home', path: '/', landmark: 'main h1' }, { name: 'login', path: '/login' }] } }
    saveConfig(dir, config)
    expect(loadConfig(dir)?.smoke?.flows).toHaveLength(2)
    expect(loadConfig(dir)?.smoke?.flows[0].landmark).toBe('main h1')
  })

  it('config without smoke stays valid', () => {
    saveConfig(dir, defaultConfig('1.0.0'))
    expect(loadConfig(dir)?.smoke).toBeUndefined()
  })

  it('round-trips an optional perf gate command', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true }, perf: { command: 'node bench.mjs' } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)!.perf?.command).toBe('node bench.mjs')
  })

  it('accepts an optional perf.retries', () => {
    const parsed = YokeConfigSchema.parse({ canonVersion: '1', agents: [], loop: { enabled: true }, perf: { command: 'npm run bench', retries: 2 } })
    expect(parsed.perf?.retries).toBe(2)
  })

  it('rejects a perf section with an empty command', () => {
    expect(() => YokeConfigSchema.parse({ canonVersion: '1', agents: [], loop: { enabled: true }, perf: { command: '' } })).toThrow()
  })

  it('accepts loop.onAmbiguity abort and round-trips it', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true, onAmbiguity: 'abort' as const } }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)!.loop.onAmbiguity).toBe('abort')
  })

  it('round-trips the auto and critical decision policies', () => {
    for (const decisionPolicy of ['auto', 'critical'] as const) {
      const cfg = { ...defaultConfig('1.1.0'), loop: { enabled: true, decisionPolicy } }
      saveConfig(dir, cfg)
      expect(loadConfig(dir)?.loop.decisionPolicy).toBe(decisionPolicy)
    }
  })

  it('leaves loop.onAmbiguity undefined when omitted (default: do not stop)', () => {
    saveConfig(dir, defaultConfig('1.0.0'))
    expect(loadConfig(dir)!.loop.onAmbiguity).toBeUndefined()
  })

  it('rejects an unknown loop.onAmbiguity value', () => {
    expect(() => YokeConfigSchema.parse({ canonVersion: '1', agents: [], loop: { enabled: true, onAmbiguity: 'ask' } })).toThrow()
  })

  it('rejects a smoke section with empty flows', () => {
    mkdirSync(join(dir, '.yoke'), { recursive: true })
    writeFileSync(join(dir, '.yoke', 'config.yaml'), 'canonVersion: "1"\nagents: []\nloop:\n  enabled: false\nsmoke:\n  baseUrl: http://x\n  flows: []\n')
    expect(() => loadConfig(dir)).toThrow()
  })
})
