import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCanonDir } from '../../src/retrofit/canon-dir.js'

describe('resolveCanonDir', () => {
  it('finds the bundled canon (contains manifest.yaml)', () => {
    const dir = resolveCanonDir()
    expect(existsSync(join(dir, 'manifest.yaml'))).toBe(true)
  })
})
