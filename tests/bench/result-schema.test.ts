import { describe, expect, it } from 'vitest'
import { validateResult } from '../../bench/result-schema.mjs'
describe('benchmark result schema', () => {
  it('requires reproducibility, availability, quality, and cost fields', () => {
    const row = { schemaVersion: 1, fixtureVersion: 'string-kit@1', runner: 'codex', sampleLabel: 'release-1', permissionProfile: 'safe', usageAvailable: false, modelAvailable: false, verdict: 'unavailable', conflicts: 0, wallClockMs: null, iterations: 0, finalTestsPass: false }
    expect(validateResult(row)).toEqual(row)
    expect(() => validateResult({ ...row, fixtureVersion: undefined })).not.toThrow()
    const { conflicts: _, ...missing } = row
    expect(() => validateResult(missing)).toThrow(/conflicts/)
  })
})
