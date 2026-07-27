import { describe, expect, it } from 'vitest'
import { readyStories } from '../../src/loop/scheduler.js'
import type { Story } from '../../src/loop/prd.js'

const story = (id: string, priority: number, extra: Partial<Story> = {}): Story => ({ id, title: id, priority, acceptance: ['done'], passes: false, ...extra })

describe('readyStories', () => {
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
