import { describe, expect, it } from 'vitest'
import { readyStories } from '../../src/loop/scheduler.js'
import { StorySchema, type Story } from '../../src/loop/prd.js'

const story = (id: string, priority: number, extra: Partial<Story> = {}): Story => ({ id, title: id, priority, acceptance: ['done'], passes: false, ...extra })

describe('readyStories', () => {
  it('prioritizes dependency critical paths after explicit priority', () => {
    const stories = [story('A', 1), story('Z', 1), story('child', 1, { needs: ['Z'] }), story('last', 1, { needs: ['child'] }), story('urgent', 0)]
    expect(readyStories(stories).map(s => s.id)).toEqual(['urgent', 'Z', 'A'])
  })
  it('excludes overlapping declared file/directory scopes without blocking siblings', () => {
    const stories = [story('A', 1, { writes: ['src/api/client.ts'] }), story('B', 1, { writes: ['src/api-v2'] }), story('C', 1)]
    expect(readyStories(stories, { activeWrites: [['src/api']] }).map(s => s.id)).toEqual(['B', 'C'])
  })
  it.each(['/root', '../src', 'src/../test', 'C:\\src', 'src/**', 'src/[ab]', '\\\\server\\share'])('rejects invalid scope %s', scope => {
    expect(StorySchema.safeParse(story('A', 1, { writes: [scope] })).success).toBe(false)
  })
  it('returns only dependency-ready work in priority order', () => {
    const stories = [story('B', 1, { needs: ['A'] }), story('A', 2), story('C', 0)]
    expect(readyStories(stories).map(s => s.id)).toEqual(['C', 'A'])
    stories[1].passes = true
    expect(readyStories(stories).map(s => s.id)).toEqual(['C', 'B'])
  })
  it('excludes active areas and prefers agent affinity at equal priority', () => {
    const stories = [story('A', 1, { area: 'api', agent: 'claude' }), story('B', 1, { area: 'web', agent: 'codex' })]
    expect(readyStories(stories, { activeAreas: new Set(['api']), agent: 'codex' }).map(s => s.id)).toEqual(['B'])
  })
})
