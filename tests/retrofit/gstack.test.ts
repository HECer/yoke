import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectGstack } from '../../src/retrofit/gstack.js'

describe('detectGstack', () => {
  let target: string
  let home: string
  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'yoke-gs-t-'))
    home = mkdtempSync(join(tmpdir(), 'yoke-gs-h-'))
  })
  afterEach(() => {
    rmSync(target, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('is false when gstack is not installed anywhere', () => {
    expect(detectGstack(target, home)).toBe(false)
  })
  it('detects a repo-local gstack skill dir', () => {
    mkdirSync(join(target, '.claude', 'skills', 'gstack'), { recursive: true })
    expect(detectGstack(target, home)).toBe(true)
  })
  it('detects a global (home) gstack skill dir', () => {
    mkdirSync(join(home, '.claude', 'skills', 'gstack'), { recursive: true })
    expect(detectGstack(target, home)).toBe(true)
  })
})
