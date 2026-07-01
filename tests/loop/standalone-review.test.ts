import { describe, it, expect } from 'vitest'
import { buildStandaloneReviewPrompt } from '../../src/loop/runner.js'

describe('buildStandaloneReviewPrompt', () => {
  it('names the scope and forbids file changes', () => {
    const p = buildStandaloneReviewPrompt('the uncommitted working-tree changes')
    expect(p).toContain('the uncommitted working-tree changes')
    expect(p).toMatch(/independent reviewer/i)
    expect(p).toMatch(/exit(ing)? 0/i)
    expect(p).toMatch(/do not modify files/i)
  })
  it('injects an optional focus line', () => {
    const p = buildStandaloneReviewPrompt('the diff main..HEAD', 'authentication and access control')
    expect(p).toContain('the diff main..HEAD')
    expect(p).toContain('authentication and access control')
  })
  it('omits the focus line when no focus is given', () => {
    expect(buildStandaloneReviewPrompt('x')).not.toMatch(/Pay particular attention/i)
  })
})
