import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, saveConfig, defaultConfig } from '../../src/retrofit/config.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-cfg-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('forge config', () => {
  it('returns null when no config exists', () => {
    expect(loadConfig(dir)).toBeNull()
  })

  it('saves and reloads a config round-trip', () => {
    const cfg = { canonVersion: '0.1.0', agents: ['claude'] as const, loop: { enabled: true } }
    saveConfig(dir, cfg)
    expect(existsSync(join(dir, '.forge', 'config.yaml'))).toBe(true)
    expect(loadConfig(dir)).toEqual(cfg)
  })

  it('defaultConfig has loop disabled', () => {
    expect(defaultConfig('0.1.0').loop.enabled).toBe(false)
  })
})
