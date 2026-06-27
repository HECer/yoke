import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectProject } from '../../src/retrofit/detect.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forge-detect-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('detectProject', () => {
  it('reports no agents in an empty project', () => {
    const d = detectProject(dir)
    expect(d.agents).toEqual([])
    expect(d.hasAgentsMd).toBe(false)
    expect(d.hasForgeConfig).toBe(false)
  })

  it('detects claude via .claude/ and a CLAUDE.md', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, 'CLAUDE.md'), '# project')
    expect(detectProject(dir).agents).toContain('claude')
  })

  it('detects codex and gemini directories', () => {
    mkdirSync(join(dir, '.codex'), { recursive: true })
    mkdirSync(join(dir, '.gemini'), { recursive: true })
    const d = detectProject(dir)
    expect(d.agents).toContain('codex')
    expect(d.agents).toContain('gemini')
  })

  it('flags an existing AGENTS.md and .forge config', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'x')
    mkdirSync(join(dir, '.forge'), { recursive: true })
    writeFileSync(join(dir, '.forge', 'config.yaml'), 'x')
    const d = detectProject(dir)
    expect(d.hasAgentsMd).toBe(true)
    expect(d.hasForgeConfig).toBe(true)
  })
})
