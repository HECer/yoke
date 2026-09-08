import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectProject } from '../../src/retrofit/detect.js'

describe('project detection for additional harnesses', () => {
  it('detects OpenCode, Kilo, and Pi project markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yoke-detect-'))
    try {
      mkdirSync(join(dir, '.opencode'))
      mkdirSync(join(dir, '.kilo'))
      mkdirSync(join(dir, '.pi'))
      expect(detectProject(dir).agents).toEqual(['opencode', 'kilo', 'pi'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
