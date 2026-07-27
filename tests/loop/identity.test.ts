import { describe, expect, it } from 'vitest'
import { resolveCommitIdentity } from '../../src/loop/identity.js'

describe('resolveCommitIdentity', () => {
  it('prefers explicit config over git', () => {
    const result = resolveCommitIdentity('.', { authorName: 'HECer', authorEmail: 'hec_er@web.de' }, () => 'ambient')
    expect(result).toEqual({ authorName: 'HECer', authorEmail: 'hec_er@web.de', allowCoAuthors: false })
  })

  it('falls back to repository git identity and defaults co-authors off', () => {
    const git = (key: string) => key === 'user.name' ? 'Repo User' : 'repo@example.com'
    expect(resolveCommitIdentity('.', undefined, git)).toEqual({ authorName: 'Repo User', authorEmail: 'repo@example.com', allowCoAuthors: false })
  })

  it('preserves an explicit co-author policy', () => {
    expect(resolveCommitIdentity('.', { authorName: 'A', authorEmail: 'a@b.co', allowCoAuthors: true }, () => '')).toMatchObject({ allowCoAuthors: true })
  })

  it('fails clearly when either identity field is missing', () => {
    expect(() => resolveCommitIdentity('.', { authorName: 'Only Name' }, () => '')).toThrow(/email/i)
    expect(() => resolveCommitIdentity('.', { authorEmail: 'only@example.com' }, () => '')).toThrow(/name/i)
  })
})
