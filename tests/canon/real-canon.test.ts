import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateCanon } from '../../src/canon/validate.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('real canon', () => {
  it('validates with zero errors', () => {
    const errors = validateCanon(join(repoRoot, 'canon')).filter(i => i.level === 'error')
    expect(errors).toEqual([])
  })
})
