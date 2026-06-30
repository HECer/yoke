import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
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

  it('round-trips an optional codeGraph choice', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: false }, codeGraph: 'serena' as const }
    saveConfig(dir, cfg)
    expect(loadConfig(dir)).toEqual(cfg)
  })
})
