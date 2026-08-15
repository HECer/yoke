import { describe, expect, it } from 'vitest'
import { ProjectQualityDefaultsSchema, StoryQualityDeclarationSchema } from '../../src/quality/types.js'

describe('quality defaults contract', () => {
  it('rejects consistency counts other than the implemented swapped pair', () => {
    expect(() => ProjectQualityDefaultsSchema.parse({ consistencyChecks: 1 })).toThrow()
    expect(() => ProjectQualityDefaultsSchema.parse({ consistencyChecks: 3 })).toThrow()
    expect(ProjectQualityDefaultsSchema.parse({ consistencyChecks: 2 }).consistencyChecks).toBe(2)
  })

  it('rejects reference and candidate paths that can escape the project', () => {
    expect(() => StoryQualityDeclarationSchema.parse({ reference: { name: 'x', kind: 'file', source: '../secret' }, candidate: { kind: 'files', paths: ['ok.txt'] }, rubric: 'compare' })).toThrow()
    expect(() => StoryQualityDeclarationSchema.parse({ reference: { name: 'x', kind: 'file', source: 'ok.txt' }, candidate: { kind: 'files', paths: ['..\\secret'] }, rubric: 'compare' })).toThrow()
  })
})
