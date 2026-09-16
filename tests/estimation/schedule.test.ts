import { expect, it } from 'vitest'
import { estimateSchedule } from '../../src/estimation/schedule.js'
const history = [{ storyId: 'past', ms: 1000 }]
it('uses per-story ranges instead of scaling by unrelated pooled durations', () => {
  const measured = [100, 200, 300].map(ms => ({ storyId: 'a', ms }))
    .concat([1000, 2000, 3000].map(ms => ({ storyId: 'b', ms })))
  expect(estimateSchedule([{ id: 'a' }, { id: 'b', needs: ['a'] }], 2, measured))
    .toMatchObject({ available: true, etaMs: 2200, lowerMs: 1100, upperMs: 3300, confidence: 'low' })
})
it('estimates parallel critical paths with dependencies and exclusive areas', () => {
  const result = estimateSchedule([{ id: 'a', area: 'db' }, { id: 'b', area: 'db' }, { id: 'c' }, { id: 'd', needs: ['a', 'b'] }], 2, history)
  expect(result).toMatchObject({ available: true, etaMs: 3000, sampleCount: 1, confidence: 'low' })
  if (result.available) expect(result.tasks.find(task => task.storyId === 'd')?.startMs).toBe(2000)
})
it('reports unknown when evidence or a schedulable DAG is missing', () => {
  expect(estimateSchedule([{ id: 'a' }], 2, [])).toMatchObject({ available: false })
  expect(estimateSchedule([{ id: 'a', needs: ['b'] }, { id: 'b', needs: ['a'] }], 2, history)).toMatchObject({ available: false })
  expect(estimateSchedule([{ id: 'a' }], 0, history)).toMatchObject({ available: false })
})
it('respects declared write overlap and dependency critical-path priority', () => {
  const overlap = estimateSchedule([{ id: 'a', writes: ['src/api'] }, { id: 'b', writes: ['src/api/client.ts'] }], 2, history)
  expect(overlap).toMatchObject({ available: true, etaMs: 2000 })
  const ordered = estimateSchedule([{ id: 'a' }, { id: 'z' }, { id: 'child', needs: ['z'] }], 1, history)
  if (ordered.available) expect(ordered.tasks[0].storyId).toBe('z')
})
