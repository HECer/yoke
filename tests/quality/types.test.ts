import { describe, expect, it } from 'vitest'
import { ProjectQualityDefaultsSchema, StoryQualityDeclarationSchema } from '../../src/quality/types.js'

describe('quality defaults contract', () => {
  it('accepts provider and variant selection for quality workers', () => {
    const parsed = ProjectQualityDefaultsSchema.parse({
      critic: { agent: 'opencode', provider: 'openrouter', model: 'openai/gpt-5.6', variant: 'high' },
      repair: { agent: 'pi', provider: 'openai', model: 'gpt-5.6', variant: 'medium' },
    })
    expect(parsed.critic).toMatchObject({ provider: 'openrouter', variant: 'high' })
    expect(parsed.repair).toMatchObject({ provider: 'openai', variant: 'medium' })
  })

  it('supports single, paired, and adaptive consistency while rejecting unsupported counts', () => {
    expect(ProjectQualityDefaultsSchema.parse({}).consistencyChecks).toBe('adaptive')
    expect(ProjectQualityDefaultsSchema.parse({ consistencyChecks: 1 }).consistencyChecks).toBe(1)
    expect(ProjectQualityDefaultsSchema.parse({ consistencyChecks: 'adaptive' }).consistencyChecks).toBe('adaptive')
    expect(() => ProjectQualityDefaultsSchema.parse({ consistencyChecks: 3 })).toThrow()
    expect(ProjectQualityDefaultsSchema.parse({ consistencyChecks: 2 }).consistencyChecks).toBe(2)
  })

  it('rejects reference and candidate paths that can escape the project', () => {
    expect(() => StoryQualityDeclarationSchema.parse({ reference: { name: 'x', kind: 'file', source: '../secret' }, candidate: { kind: 'files', paths: ['ok.txt'] }, rubric: 'compare' })).toThrow()
    expect(() => StoryQualityDeclarationSchema.parse({ reference: { name: 'x', kind: 'file', source: 'ok.txt' }, candidate: { kind: 'files', paths: ['..\\secret'] }, rubric: 'compare' })).toThrow()
  })
})
