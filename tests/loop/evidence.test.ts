import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { writeCriterionEvidence } from '../../src/loop/evidence.js'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yoke-evidence-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('criterion evidence', () => {
  it('keeps evidence inside the proof directory for arbitrary legacy story IDs', () => {
    const proofRoot = join(dir, '.yoke', 'proof')
    const path = writeCriterionEvidence(dir, {
      id: '../../escaped',
      title: 'Legacy identifier',
      priority: 1,
      acceptance: [{ id: 'verified', text: 'Behavior is verified', verify: ['npm test'] }],
      passes: false,
    }, [{
      criterion: { id: 'verified', text: 'Behavior is verified', verify: ['npm test'] },
      result: { passed: true, summary: 'green' },
    }])

    const fromProofRoot = relative(proofRoot, path)
    expect(isAbsolute(fromProofRoot)).toBe(false)
    expect(fromProofRoot.startsWith('..')).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(readdirSync(join(path, '..'))).toEqual(['evidence.json'])
  })
})
