import { describe, expect, it } from 'vitest'
import { runParallelLoop } from '../../src/loop/parallel.js'
import type { Story } from '../../src/loop/prd.js'
const s = (id: string, extra: Partial<Story> = {}): Story => ({ id, title: id, priority: 1, acceptance: ['x'], passes: false, ...extra })
describe('parallel dispatcher', () => {
  it('returns candidate completions without marking passes or releasing dependent stories', async () => {
    const stories = [s('A', { area: 'api', agent: 'codex' }), s('B', { area: 'api' }), s('C', { needs: ['A'] })]
    let active = 0; let peak = 0; const agents: Array<string | undefined> = []
    const result = await runParallelLoop(stories, { maxConcurrency: 2, maxIterations: 3, agents: ['claude'], worker: async (_story, agent) => { agents.push(agent); active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return { success: true } } })
    expect(result.completed.sort()).toEqual(['A', 'B'])
    expect(peak).toBeLessThanOrEqual(2)
    expect(agents).toContain('codex')
    expect(stories.every(story => !story.passes)).toBe(true)
  })
  it('parallel=1 remains serial', async () => {
    let active = 0; let peak = 0
    await runParallelLoop([s('A'), s('B')], { maxConcurrency: 1, maxIterations: 2, worker: async () => { active++; peak = Math.max(peak, active); active--; return { success: true } } })
    expect(peak).toBe(1)
  })
})
